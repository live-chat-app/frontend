import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL } from '../api/axios';

const SocketContext = createContext();

export const useSocket = () => useContext(SocketContext);

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(null); // null means "connecting"

  useEffect(() => {
    const token = localStorage.getItem('token');

    if (token) {
      setIsConnected(null); // Set to connecting state

      const newSocket = io(API_URL, {
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 500,
        reconnectionAttempts: 10,
        timeout: 10000,
      });

      newSocket.on('connect', () => {
        setIsConnected(true);
        setSocket(newSocket);
        console.log('Socket connected:', newSocket.id);
      });

      newSocket.on('disconnect', () => {
        setIsConnected(false);
        console.log('Socket disconnected');
      });

      newSocket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
        setIsConnected(false);
      });

      return () => {
        if (newSocket) {
          newSocket.close();
        }
      };
    } else {
      setSocket(null);
      setIsConnected(null);
    }

    // Re-run when localStorage changes (after login)
    const handleStorageChange = () => {
      const newToken = localStorage.getItem('token');
      if (newToken && !socket) {
        window.location.reload();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  return (
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
};
