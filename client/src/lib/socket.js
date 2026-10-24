import { io } from 'socket.io-client';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api').replace(/\/$/, '');
const SOCKET_URL = API_BASE.endsWith('/api') ? API_BASE.slice(0, -4) : API_BASE;

export function createRealtimeConnection() {
  return io(SOCKET_URL || window.location.origin, {
    withCredentials: true,
    transports: ['websocket', 'polling'],
    reconnectionDelayMax: 8000
  });
}
