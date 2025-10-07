import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import api from '../api/axios';
import { formatDistanceToNow } from 'date-fns';
import './Chat.css';

function Chat() {
  const { user, logout } = useAuth();
  const { socket, isConnected } = useSocket();

  const [users, setUsers] = useState([]);
  const [channels, setChannels] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [channelName, setChannelName] = useState('');
  const [channelDescription, setChannelDescription] = useState('');
  const [typingUsers, setTypingUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);

  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);

  // Fetch users and channels
  useEffect(() => {
    fetchUsers();
    fetchChannels();
  }, []);

  // Socket listeners
  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (message) => {
      console.log('Received new message:', message);
      console.log('Active chat:', activeChat);

      // For channel messages
      if (activeChat?.type === 'channel' && message.channelId) {
        if (message.channelId === activeChat.id || message.channelId._id === activeChat.id) {
          setMessages((prev) => [...prev, message]);
        }
      }
      // For direct messages
      else if (activeChat?.type === 'user') {
        const senderId = message.sender._id || message.sender;
        const recipientId = message.recipientId?._id || message.recipientId;

        if (senderId === activeChat.id || recipientId === activeChat.id || senderId === user.id) {
          setMessages((prev) => [...prev, message]);
        }
      }
    };

    socket.on('newMessage', handleNewMessage);

    socket.on('newUser', (newUser) => {
      console.log('New user registered:', newUser);
      // Only add if not the current user and not already in list
      if (newUser._id !== user.id) {
        setUsers((prev) => {
          const exists = prev.find(u => u._id === newUser._id);
          if (!exists) {
            return [...prev, newUser];
          }
          return prev;
        });
      }
    });

    socket.on('userStatusChange', ({ userId, isOnline }) => {
      setUsers((prev) =>
        prev.map((u) => (u._id === userId ? { ...u, isOnline } : u))
      );
    });

    socket.on('userTyping', ({ userId, username, isTyping, channelId }) => {
      // Only show typing for the current active chat
      if (channelId && activeChat?.type === 'channel' && channelId === activeChat.id) {
        // Channel typing
        if (isTyping) {
          setTypingUsers((prev) => [...prev.filter((u) => u.userId !== userId), { userId, username }]);
        } else {
          setTypingUsers((prev) => prev.filter((u) => u.userId !== userId));
        }
      } else if (!channelId && activeChat?.type === 'user' && userId === activeChat.id) {
        // Direct message typing
        if (isTyping) {
          setTypingUsers((prev) => [...prev.filter((u) => u.userId !== userId), { userId, username }]);
        } else {
          setTypingUsers((prev) => prev.filter((u) => u.userId !== userId));
        }
      }
    });

    socket.on('messageReactionUpdate', ({ messageId, reactions }) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg._id === messageId ? { ...msg, reactions } : msg
        )
      );
    });

    socket.on('messageRead', ({ messageId, readBy, readAt }) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg._id === messageId
            ? { ...msg, readBy: [...(msg.readBy || []), { userId: readBy, readAt }] }
            : msg
        )
      );
    });

    return () => {
      socket.off('newMessage', handleNewMessage);
      socket.off('newUser');
      socket.off('userStatusChange');
      socket.off('userTyping');
      socket.off('messageReactionUpdate');
      socket.off('messageRead');
    };
  }, [socket, activeChat, user.id]);

  // Load messages when active chat changes
  useEffect(() => {
    if (activeChat) {
      loadMessages();
      setShowMobileMenu(false);
      setTypingUsers([]); // Clear typing indicators when switching chats
    }
  }, [activeChat]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchUsers = async () => {
    try {
      const response = await api.get('/users');
      setUsers(response.data.filter((u) => u._id !== user.id));
    } catch (error) {
      console.error('Failed to fetch users:', error);
    }
  };

  const fetchChannels = async () => {
    try {
      const response = await api.get('/channels');
      console.log('Fetched channels:', response.data);
      setChannels(response.data);
    } catch (error) {
      console.error('Failed to fetch channels:', error);
    }
  };

  const loadMessages = async () => {
    try {
      // Don't load messages if user is not a member of the channel
      if (activeChat.type === 'channel' && activeChat.isMember === false) {
        setMessages([]);
        return;
      }

      if (activeChat.type === 'channel') {
        const response = await api.get(`/messages/channel/${activeChat.id}`);
        setMessages(response.data.reverse());
      } else {
        const response = await api.get(`/messages/direct/${activeChat.id}`);
        setMessages(response.data.reverse());
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        alert('File size must be less than 10MB');
        return;
      }
      setSelectedFile(file);
    }
  };

  const uploadFile = async () => {
    if (!selectedFile) return null;

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      setUploading(true);
      const response = await api.post('/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return response.data;
    } catch (error) {
      console.error('File upload error:', error);
      alert('Failed to upload file');
      return null;
    } finally {
      setUploading(false);
    }
  };

  const sendMessage = async () => {
    if ((!newMessage.trim() && !selectedFile) || !socket) return;

    let fileData = null;
    if (selectedFile) {
      fileData = await uploadFile();
      if (!fileData) return; // Upload failed
      console.log('Uploaded file data:', fileData);
    }

    // Determine message type based on file format, not resourceType
    let messageType = 'text';
    if (fileData) {
      const imageFormats = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
      messageType = imageFormats.includes(fileData.format.toLowerCase()) ? 'image' : 'file';
    }

    const messageData = {
      content: newMessage || '',
      channelId: activeChat.type === 'channel' ? activeChat.id : null,
      recipientId: activeChat.type === 'user' ? activeChat.id : null,
      type: messageType,
      fileUrl: fileData ? fileData.url : null,
    };

    console.log('Sending message:', messageData);
    socket.emit('sendMessage', messageData);
    setNewMessage('');
    setSelectedFile(null);
    handleTyping(false);
  };

  const handleTyping = (isTyping) => {
    if (!socket) return;

    clearTimeout(typingTimeoutRef.current);

    socket.emit('typing', {
      channelId: activeChat?.type === 'channel' ? activeChat.id : null,
      recipientId: activeChat?.type === 'user' ? activeChat.id : null,
      isTyping,
    });

    if (isTyping) {
      typingTimeoutRef.current = setTimeout(() => {
        handleTyping(false);
      }, 2000);
    }
  };

  const createChannel = async () => {
    if (!channelName.trim()) return;

    try {
      const response = await api.post('/channels', {
        name: channelName,
        description: channelDescription,
      });
      setChannels([...channels, response.data]);
      setShowCreateChannel(false);
      setChannelName('');
      setChannelDescription('');
    } catch (error) {
      console.error('Failed to create channel:', error);
    }
  };

  const joinChannel = async (channelId) => {
    try {
      await api.post(`/channels/${channelId}/join`);
      // Refresh channels to update member list
      fetchChannels();
      // Reload messages after joining
      if (activeChat?.id === channelId) {
        loadMessages();
      }
    } catch (error) {
      console.error('Failed to join channel:', error);
    }
    // Also join socket room
    if (socket) {
      socket.emit('joinChannel', { channelId });
    }
  };

  const isChannelMember = (channel) => {
    if (!channel || !channel.members) {
      console.log('Channel missing or no members:', channel);
      return false;
    }
    const isMember = channel.members.some(member => member._id === user.id || member === user.id);
    console.log(`Checking membership for channel ${channel.name}:`, isMember, 'members:', channel.members);
    return isMember;
  };

  const addReaction = (messageId, emoji) => {
    if (!socket) return;
    socket.emit('messageReaction', { messageId, emoji });
  };

  const filteredUsers = users.filter((u) =>
    u.username?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredChannels = channels.filter((c) =>
    c.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="chat-container">
      {/* Sidebar */}
      <div className={`sidebar ${showMobileMenu ? 'sidebar-visible' : 'sidebar-hidden'}`}>
        {/* Header */}
        <div className="sidebar-header">
          <div className="header-content">
            <div>
              <h2 className="header-title">Chat App</h2>
              <p className="header-username">@{user.username}</p>
            </div>
            <button
              onClick={logout}
              className="logout-btn"
              title="Logout"
            >
              <svg className="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>

          {/* Connection status */}
          <div className="connection-status">
            <div className={`status-dot ${isConnected === true ? 'status-connected' : isConnected === false ? 'status-disconnected' : 'status-connecting'}`}></div>
            {isConnected === true ? 'Connected' : isConnected === false ? 'Disconnected' : 'Connecting...'}
          </div>
        </div>

        {/* Search */}
        <div className="search-container">
          <input
            type="text"
            placeholder="Search users or channels..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>

        {/* Channels */}
        <div className="list-container">
          <div className="list-section">
            <div className="list-header">
              <h3 className="list-title">Channels</h3>
              <button
                onClick={() => setShowCreateChannel(true)}
                className="create-channel-btn"
                title="Create Channel"
              >
                <svg className="icon-sm" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>

            {filteredChannels.map((channel) => {
              const isMember = isChannelMember(channel);
              return (
                <button
                  key={channel._id}
                  onClick={() => {
                    setActiveChat({ id: channel._id, name: channel.name, type: 'channel', isMember });
                    if (isMember) {
                      socket?.emit('joinChannel', { channelId: channel._id });
                    }
                  }}
                  className={`chat-item ${activeChat?.id === channel._id ? 'chat-item-active' : ''}`}
                >
                  <div className="channel-content">
                    <span className="channel-hash">#</span>
                    <span className="channel-name">{channel.name}</span>
                    {!isMember && (
                      <span style={{
                        marginLeft: 'auto',
                        fontSize: '11px',
                        backgroundColor: '#4f46e5',
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontWeight: '600'
                      }}>
                        Join
                      </span>
                    )}
                  </div>
                  {channel.description && (
                    <p className="channel-description">{channel.description}</p>
                  )}
                </button>
              );
            })}
          </div>

          {/* Direct Messages */}
          <div className="list-section">
            <h3 className="list-title">Direct Messages</h3>
            {filteredUsers.map((u) => (
              <button
                key={u._id}
                onClick={() => setActiveChat({ id: u._id, name: u.username, type: 'user' })}
                className={`chat-item ${activeChat?.id === u._id ? 'chat-item-active' : ''}`}
              >
                <div className="user-content">
                  <div className="user-avatar-container">
                    <div className="user-avatar">
                      {u.username[0].toUpperCase()}
                    </div>
                    <div className={`user-status ${u.isOnline ? 'status-online' : 'status-offline'}`}></div>
                  </div>
                  <div className="user-info">
                    <p className="user-name">{u.username}</p>
                    <p className="user-online-status">{u.isOnline ? 'Online' : 'Offline'}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="main-chat">
        {activeChat ? (
          <>
            {/* Chat Header */}
            <div className="chat-header">
              <div className="chat-header-content">
                <button
                  onClick={() => setShowMobileMenu(true)}
                  className="menu-btn"
                >
                  <svg className="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
                <div>
                  <h2 className="chat-title">
                    {activeChat.type === 'channel' && '#'}{activeChat.name}
                  </h2>
                  {typingUsers.length > 0 && (
                    <p className="typing-indicator">
                      {typingUsers[0].username} is typing...
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="messages-container">
              {activeChat.type === 'channel' && activeChat.isMember === false ? (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  padding: '40px'
                }}>
                  <div style={{
                    width: '80px',
                    height: '80px',
                    borderRadius: '50%',
                    backgroundColor: '#eef2ff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '24px'
                  }}>
                    <svg style={{ width: '40px', height: '40px', color: '#4f46e5' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  </div>
                  <h3 style={{ fontSize: '20px', fontWeight: '600', color: '#111827', marginBottom: '8px' }}>
                    Join #{activeChat.name}
                  </h3>
                  <p style={{ fontSize: '14px', color: '#6b7280', textAlign: 'center', marginBottom: '24px', maxWidth: '400px' }}>
                    You need to join this channel to view and send messages
                  </p>
                  <button
                    onClick={() => joinChannel(activeChat.id)}
                    style={{
                      backgroundColor: '#4f46e5',
                      color: 'white',
                      padding: '12px 32px',
                      borderRadius: '8px',
                      border: 'none',
                      fontSize: '15px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'background-color 0.2s'
                    }}
                    onMouseEnter={(e) => e.target.style.backgroundColor = '#4338ca'}
                    onMouseLeave={(e) => e.target.style.backgroundColor = '#4f46e5'}
                  >
                    Join Channel
                  </button>
                </div>
              ) : messages.map((msg) => (
                <div
                  key={msg._id}
                  className={`message-wrapper ${msg.sender._id === user.id ? 'message-align-right' : 'message-align-left'}`}
                >
                  <div className="message-content">
                    <div className={`message-bubble ${msg.sender._id === user.id ? 'message-sent' : 'message-received'}`}>
                      {msg.sender._id !== user.id && (
                        <p className="message-sender">{msg.sender.username}</p>
                      )}
                      {msg.type === 'image' && msg.fileUrl ? (
                        <div style={{ marginBottom: msg.content ? '8px' : '0' }}>
                          <img
                            src={msg.fileUrl}
                            alt="Shared image"
                            style={{
                              width: '250px',
                              height: '250px',
                              borderRadius: '8px',
                              cursor: 'pointer',
                              objectFit: 'cover',
                              display: 'block'
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setImagePreview(msg.fileUrl);
                            }}
                          />
                        </div>
                      ) : msg.type === 'file' && msg.fileUrl ? (
                        <div
                          onClick={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            // Download file directly
                            try {
                              const response = await fetch(msg.fileUrl);
                              const blob = await response.blob();
                              const url = window.URL.createObjectURL(blob);
                              const link = document.createElement('a');
                              link.href = url;
                              link.download = msg.fileUrl.split('/').pop().split('?')[0] || 'document.pdf';
                              document.body.appendChild(link);
                              link.click();
                              document.body.removeChild(link);
                              window.URL.revokeObjectURL(url);
                            } catch (error) {
                              console.error('Download failed:', error);
                              // Fallback: open in new tab
                              window.open(msg.fileUrl, '_blank');
                            }
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            padding: '16px',
                            backgroundColor: msg.sender._id === user.id ? 'rgba(255,255,255,0.15)' : '#f3f4f6',
                            borderRadius: '12px',
                            cursor: 'pointer',
                            marginBottom: msg.content ? '8px' : '0',
                            border: `1px solid ${msg.sender._id === user.id ? 'rgba(255,255,255,0.3)' : '#e5e7eb'}`,
                            transition: 'all 0.2s'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'scale(1.02)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'scale(1)';
                          }}
                        >
                          <div style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: '8px',
                            backgroundColor: msg.sender._id === user.id ? 'rgba(255,255,255,0.2)' : '#e5e7eb',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}>
                            <svg style={{ width: '28px', height: '28px', color: msg.sender._id === user.id ? 'white' : '#4f46e5' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '15px', fontWeight: '600', color: msg.sender._id === user.id ? 'white' : '#111827', marginBottom: '4px' }}>
                              Document
                            </div>
                            <div style={{ fontSize: '13px', color: msg.sender._id === user.id ? 'rgba(255,255,255,0.8)' : '#6b7280' }}>
                              Click to download
                            </div>
                          </div>
                          <svg style={{ width: '20px', height: '20px', color: msg.sender._id === user.id ? 'rgba(255,255,255,0.6)' : '#9ca3af' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      ) : null}
                      {msg.content && msg.content !== 'Sent a file' && <p style={{ margin: 0 }}>{msg.content}</p>}
                      <div className="message-footer">
                        <p className={`message-time ${msg.sender._id === user.id ? 'message-time-sent' : 'message-time-received'}`}>
                          {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                        </p>
                        {msg.readBy?.length > 0 && msg.sender._id === user.id && (
                          <span className="message-read">✓✓</span>
                        )}
                      </div>
                    </div>

                    {/* Reactions */}
                    <div className="reactions-container">
                      {msg.reactions?.map((reaction, idx) => (
                        <span key={idx} className="reaction-item">
                          {reaction.emoji}
                        </span>
                      ))}
                      <button
                        onClick={() => addReaction(msg._id, '👍')}
                        className="reaction-add-btn"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            {(activeChat.type !== 'channel' || activeChat.isMember !== false) && (
            <div className="message-input-container">
              {selectedFile && (
                <div style={{ padding: '8px 16px', backgroundColor: '#f3f4f6', borderRadius: '8px', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '14px', color: '#374151' }}>📎 {selectedFile.name}</span>
                  <button
                    onClick={() => setSelectedFile(null)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontWeight: 'bold' }}
                  >
                    ✕
                  </button>
                </div>
              )}
              <div className="message-input-wrapper">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  accept="image/*,application/pdf,.doc,.docx"
                  style={{ display: 'none' }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="attach-btn"
                  title="Attach file"
                >
                  <svg className="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                </button>
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => {
                    setNewMessage(e.target.value);
                    handleTyping(true);
                  }}
                  onKeyPress={(e) => e.key === 'Enter' && !uploading && sendMessage()}
                  placeholder="Type a message..."
                  className="message-input"
                  disabled={uploading}
                />
                <button
                  onClick={sendMessage}
                  disabled={(!newMessage.trim() && !selectedFile) || uploading}
                  className="send-btn"
                >
                  {uploading ? (
                    <svg className="icon" fill="none" viewBox="0 0 24 24">
                      <circle className="spinner" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    </svg>
                  ) : (
                    <svg className="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            )}
          </>
        ) : (
          <>
            <div className="chat-header">
              <button
                onClick={() => setShowMobileMenu(true)}
                className="menu-btn"
              >
                <svg className="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
            <div className="empty-state">
              <div className="empty-state-content">
                <svg className="empty-state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <h3 className="empty-state-title">Select a chat to start messaging</h3>
                <p className="empty-state-text">Choose a user or channel from the sidebar</p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Create Channel Modal */}
      {showCreateChannel && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-title">Create Channel</h3>
            <div className="modal-form">
              <div className="form-group">
                <label>Channel Name</label>
                <input
                  type="text"
                  value={channelName}
                  onChange={(e) => setChannelName(e.target.value)}
                  placeholder="general"
                />
              </div>
              <div className="form-group">
                <label>Description (optional)</label>
                <textarea
                  value={channelDescription}
                  onChange={(e) => setChannelDescription(e.target.value)}
                  rows="3"
                  placeholder="What is this channel about?"
                />
              </div>
              <div className="modal-actions">
                <button
                  onClick={createChannel}
                  className="modal-btn modal-btn-primary"
                >
                  Create
                </button>
                <button
                  onClick={() => {
                    setShowCreateChannel(false);
                    setChannelName('');
                    setChannelDescription('');
                  }}
                  className="modal-btn modal-btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile overlay */}
      {showMobileMenu && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            zIndex: 40
          }}
          onClick={() => setShowMobileMenu(false)}
        />
      )}

      {/* Image Preview Modal */}
      {imagePreview && (
        <div
          className="modal-overlay"
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.95)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          onClick={() => setImagePreview(null)}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setImagePreview(null);
            }}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              background: 'white',
              border: 'none',
              borderRadius: '50%',
              width: '48px',
              height: '48px',
              cursor: 'pointer',
              fontSize: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#111827',
              fontWeight: 'bold',
              boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
              zIndex: 101
            }}
          >
            ×
          </button>
          <img
            src={imagePreview}
            alt="Preview"
            style={{
              maxWidth: '95%',
              maxHeight: '95vh',
              objectFit: 'contain',
              borderRadius: '4px',
              boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)'
            }}
            onClick={(e) => e.stopPropagation()}
            onError={(e) => {
              console.error('Image failed to load:', imagePreview);
              e.target.style.display = 'none';
            }}
          />
        </div>
      )}
    </div>
  );
}

export default Chat;
