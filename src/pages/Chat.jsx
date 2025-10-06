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

  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

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
      if (isTyping) {
        setTypingUsers((prev) => [...prev.filter((u) => u.userId !== userId), { userId, username }]);
      } else {
        setTypingUsers((prev) => prev.filter((u) => u.userId !== userId));
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
      setChannels(response.data);
    } catch (error) {
      console.error('Failed to fetch channels:', error);
    }
  };

  const loadMessages = async () => {
    try {
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

  const sendMessage = () => {
    if (!newMessage.trim() || !socket) return;

    const messageData = {
      content: newMessage,
      channelId: activeChat.type === 'channel' ? activeChat.id : null,
      recipientId: activeChat.type === 'user' ? activeChat.id : null,
    };

    socket.emit('sendMessage', messageData);
    setNewMessage('');
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
    if (!socket) return;
    socket.emit('joinChannel', { channelId });
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

            {filteredChannels.map((channel) => (
              <button
                key={channel._id}
                onClick={() => {
                  setActiveChat({ id: channel._id, name: channel.name, type: 'channel' });
                  joinChannel(channel._id);
                }}
                className={`chat-item ${activeChat?.id === channel._id ? 'chat-item-active' : ''}`}
              >
                <div className="channel-content">
                  <span className="channel-hash">#</span>
                  <span className="channel-name">{channel.name}</span>
                </div>
                {channel.description && (
                  <p className="channel-description">{channel.description}</p>
                )}
              </button>
            ))}
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
              {messages.map((msg) => (
                <div
                  key={msg._id}
                  className={`message-wrapper ${msg.sender._id === user.id ? 'message-align-right' : 'message-align-left'}`}
                >
                  <div className="message-content">
                    <div className={`message-bubble ${msg.sender._id === user.id ? 'message-sent' : 'message-received'}`}>
                      {msg.sender._id !== user.id && (
                        <p className="message-sender">{msg.sender.username}</p>
                      )}
                      <p>{msg.content}</p>
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
            <div className="message-input-container">
              <div className="message-input-wrapper">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => {
                    setNewMessage(e.target.value);
                    handleTyping(true);
                  }}
                  onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                  placeholder="Type a message..."
                  className="message-input"
                />
                <button
                  onClick={sendMessage}
                  disabled={!newMessage.trim()}
                  className="send-btn"
                >
                  <svg className="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-state-content">
              <svg className="empty-state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <h3 className="empty-state-title">Select a chat to start messaging</h3>
              <p className="empty-state-text">Choose a user or channel from the sidebar</p>
            </div>
          </div>
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
    </div>
  );
}

export default Chat;
