import { io } from 'socket.io-client';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api').replace(/\/$/, '');
const SOCKET_URL = API_BASE.endsWith('/api') ? API_BASE.slice(0, -4) : API_BASE;
const REALTIME_SUPPORTED = /^https?:\/\//i.test(API_BASE) && import.meta.env.VITE_REALTIME_ENABLED !== 'false';

export function createRealtimeConnection() {
  if (!REALTIME_SUPPORTED) return null;
  return io(SOCKET_URL || window.location.origin, {
    withCredentials: true,
    transports: ['websocket', 'polling'],
    reconnectionDelayMax: 8000
  });
}
