import { Router } from 'express';
import mongoose from 'mongoose';
import { authenticate } from '../middleware/auth.js';
import { Notification } from '../models/index.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import { emitToUser } from '../realtime.js';
import { serializeNotification } from '../utils/notify.js';

const router = Router();
router.use(authenticate);

router.get('/', asyncHandler(async (req, res) => {
  const requested = Number(req.query.limit);
  const limit = Number.isFinite(requested) ? Math.min(100, Math.max(1, Math.floor(requested))) : 20;
  const [items, unread] = await Promise.all([
    Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(limit),
    Notification.countDocuments({ user: req.user._id, readAt: null })
  ]);
  res.json({ ok: true, data: { items: items.map(serializeNotification), unread } });
}));

router.patch('/read-all', asyncHandler(async (req, res) => {
  const result = await Notification.updateMany({ user: req.user._id, readAt: null }, { $set: { readAt: new Date() } });
  emitToUser(req.user._id, 'notifications:read-all', { updated: result.modifiedCount });
  res.json({ ok: true, data: { updated: result.modifiedCount }, message: 'All notifications marked as read.' });
}));

router.patch('/:id/read', asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Notification not found.');
  const item = await Notification.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { $set: { readAt: new Date() } },
    { new: true }
  );
  if (!item) throw new HttpError(404, 'Notification not found.');
  emitToUser(req.user._id, 'notification:read', { id: String(item._id), readAt: item.readAt });
  res.json({ ok: true, data: { notification: serializeNotification(item) } });
}));

export default router;
