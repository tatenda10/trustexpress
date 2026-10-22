import { io } from 'socket.io-client';
import { BASE_URL } from './api';

let socket = null;
let socketToken = '';
/** event -> Set<handler>; re-attached whenever the socket is recreated (e.g. after a token refresh). */
const persistentListeners = new Map();

function getSocketUrl() {
  return BASE_URL.replace(/\/$/, '');
}

function attachPersistentListeners(target) {
  for (const [event, handlers] of persistentListeners) {
    for (const handler of handlers) target.on(event, handler);
  }
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
  attachPersistentListeners(socket);

  return socket;
}

export function getRealtimeSocket() {
  return socket;
}

/** Listens on the current socket and on any socket created later. Returns an unsubscribe function. */
export function onRealtimeEvent(event, handler) {
  if (!persistentListeners.has(event)) persistentListeners.set(event, new Set());
  persistentListeners.get(event).add(handler);
  socket?.on(event, handler);
  return () => {
    persistentListeners.get(event)?.delete(handler);
    socket?.off(event, handler);
  };
}

/** Emits and waits for the server's acknowledgement. */
export function emitRealtimeWithAck(event, payload, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (!socket) {
      reject(new Error('Not connected. Check your internet connection.'));
      return;
    }
    socket.timeout(timeoutMs).emit(event, payload, (error, response) => {
      if (error) {
        reject(new Error('The server did not respond. Check your internet connection.'));
        return;
      }
      resolve(response || {});
    });
  });
}

export function disconnectRealtime() {
  if (!socket) return;
  socket.disconnect();
  socket = null;
  socketToken = '';
}
