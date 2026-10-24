import { Notification } from '../models/index.js';
import { emitToUser } from '../realtime.js';

export function serializeNotification(item) {
  return {
    _id: item._id,
    type: item.type,
    title: item.title,
    message: item.message || '',
    link: item.link || '',
    readAt: item.readAt,
    createdAt: item.createdAt
  };
}

export async function notifyUsers(userIds, payload) {
  const ids = [...new Set(userIds.map(String))].filter(Boolean);
  if (!ids.length) return [];
  const items = await Notification.insertMany(ids.map(user => ({ user, ...payload })));
  for (const item of items) emitToUser(item.user, 'notification:new', serializeNotification(item));
  return items;
}

export async function notifyUser(userId, payload) {
  const items = await notifyUsers([userId], payload);
  return items[0] || null;
}
