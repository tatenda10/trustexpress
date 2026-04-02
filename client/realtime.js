import { io } from 'socket.io-client';
import { BASE_URL } from './api';

let socket = null;
let socketToken = '';

function getSocketUrl() {
  return BASE_URL.replace(/\/$/, '');
}

export function connectRealtime(token) {
  const nextToken = String(token || '').trim();
  if (!nextToken) return null;

  if (socket && socket.connected && socketToken === nextToken) {
    return socket;
  }

  if (socket) {
    socket.disconnect();
    socket = null;
  }

  socketToken = nextToken;
  socket = io(getSocketUrl(), {
    transports: ['websocket'],
    autoConnect: true,
    auth: {
      token: nextToken,
    },
  });

  return socket;
}

export function getRealtimeSocket() {
  return socket;
}

export function disconnectRealtime() {
  if (!socket) return;
  socket.disconnect();
  socket = null;
  socketToken = '';
}
