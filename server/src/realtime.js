import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { User } from './models/index.js';

let io = null;

function readAuthCookie(header = '') {
  for (const part of String(header).split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name === 'hcm_token') return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return null;
}

function allowedOrigins() {
  return (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(value => value.trim()).filter(Boolean);
}

export function initRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: allowedOrigins(), credentials: true },
    serveClient: false
  });

  io.use(async (socket, next) => {
    try {
      const secret = process.env.JWT_SECRET;
      if (!secret || secret.length < 32) return next(new Error('unauthorized'));
      const token = socket.handshake.auth?.token || readAuthCookie(socket.handshake.headers.cookie);
      if (!token) return next(new Error('unauthorized'));
      const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
      const user = await User.findById(decoded.sub).select('role active');
      if (!user || !user.active) return next(new Error('unauthorized'));
      socket.data.userId = String(user._id);
      socket.data.role = user.role;
      socket.join(`user:${user._id}`);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', socket => {
    socket.emit('realtime:ready', { connectedAt: new Date().toISOString() });
  });

  return io;
}

export function emitToUser(userId, event, payload) {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function emitToUsers(userIds, event, payload) {
  const rooms = [...new Set(userIds.map(String))].filter(Boolean).map(id => `user:${id}`);
  if (rooms.length) io?.to(rooms).emit(event, payload);
}

export function closeRealtime() {
  if (!io) return;
  io.close();
  io = null;
}
