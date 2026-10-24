import { Router } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { authenticate, allowRoles } from '../middleware/auth.js';
import { LiveSession, LiveMessage } from '../models/index.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import { cloudinaryConfigured, uploadLiveCover, deleteCloudAsset } from '../services/cloudinary.js';
import { livekitConfigured, createLiveRoom, deleteLiveRoom, createLiveToken } from '../services/livekit.js';
import { writeAudit } from '../utils/audit.js';

const router = Router();
router.use(authenticate);
const liveRoles = allowRoles('admin', 'hr');
const hostSelect = 'username role profile.fullName profile.avatarUrl';
const maxBytes = Math.max(1, Number(process.env.MAX_UPLOAD_MB) || 5) * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxBytes, files: 1 },
  fileFilter(_req, file, cb) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return cb(new HttpError(422, 'Upload a JPG, PNG, or WebP cover image.'));
    cb(null, true);
  }
});

function serializeSession(session, messageCount = 0) {
  return {
    id: String(session._id),
    title: session.title,
    coverUrl: session.coverUrl,
    status: session.status,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    messageCount,
    host: session.host && session.host._id ? {
      id: String(session.host._id),
      name: session.host.profile?.fullName || session.host.username,
      role: session.host.role,
      avatarUrl: session.host.profile?.avatarUrl || ''
    } : null
  };
}

function serializeMessage(message) {
  return {
    id: String(message._id),
    text: message.text,
    senderId: String(message.sender),
    senderName: message.senderName,
    senderRole: message.senderRole,
    senderAvatarUrl: message.senderAvatarUrl || '',
    createdAt: message.createdAt
  };
}

function sessionId(value) {
  if (!mongoose.isValidObjectId(value)) throw new HttpError(404, 'Live meeting not found.');
  return value;
}

router.get('/sessions/live', liveRoles, asyncHandler(async (req, res) => {
  const session = await LiveSession.findOne({ status: 'live' }).sort({ startedAt: -1 }).populate('host', hostSelect);
  const messageCount = session ? await LiveMessage.countDocuments({ session: session._id }) : 0;
  res.json({ ok: true, data: { configured: livekitConfigured(), session: session ? serializeSession(session, messageCount) : null } });
}));

router.get('/sessions', liveRoles, asyncHandler(async (req, res) => {
  const sessions = await LiveSession.find().sort({ startedAt: -1 }).limit(20).populate('host', hostSelect);
  const counts = sessions.length ? await LiveMessage.aggregate([
    { $match: { session: { $in: sessions.map(session => session._id) } } },
    { $group: { _id: '$session', count: { $sum: 1 } } }
  ]) : [];
  const countMap = new Map(counts.map(row => [String(row._id), row.count]));
  res.json({ ok: true, data: { configured: livekitConfigured(), sessions: sessions.map(session => serializeSession(session, countMap.get(String(session._id)) || 0)) } });
}));

router.post('/sessions', allowRoles('admin'), upload.single('cover'), asyncHandler(async (req, res) => {
  if (!livekitConfigured()) throw new HttpError(503, 'Live meetings are not configured yet. Add LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET to the server environment.');
  const parsed = z.object({ title: z.string().trim().min(3, 'Use at least 3 characters.').max(120, 'Keep the title under 120 characters.') }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, 'Add a title for the live meeting.', parsed.error.flatten().fieldErrors);
  const active = await LiveSession.findOne({ status: 'live' });
  if (active) throw new HttpError(409, 'A live meeting is already running. End it before starting another one.');

  let cover = null;
  if (req.file) {
    if (!cloudinaryConfigured()) throw new HttpError(503, 'Cover image upload is unavailable because Cloudinary is not configured.');
    const type = await fileTypeFromBuffer(req.file.buffer);
    if (!type || type.mime !== req.file.mimetype || !['image/jpeg', 'image/png', 'image/webp'].includes(type.mime)) {
      throw new HttpError(422, 'The cover image must be a real JPG, PNG, or WebP file.');
    }
    try { cover = await uploadLiveCover(req.file.buffer, req.user._id.toString()); }
    catch { throw new HttpError(502, 'The cover image could not be saved. Please try again.'); }
  }

  const roomName = `hcm-live-${new mongoose.Types.ObjectId().toString()}`;
  let session;
  try {
    session = await LiveSession.create({
      title: parsed.data.title,
      coverUrl: cover?.secure_url || '',
      coverPublicId: cover?.public_id || '',
      host: req.user._id,
      roomName,
      status: 'live',
      startedAt: new Date()
    });
    await createLiveRoom(roomName);
  } catch (error) {
    if (error?.code === 11000) {
      if (cover?.public_id) await deleteCloudAsset(cover.public_id).catch(() => {});
      throw new HttpError(409, 'A live meeting is already running. End it before starting another one.');
    }
    if (session) await LiveSession.deleteOne({ _id: session._id }).catch(() => {});
    if (cover?.public_id) await deleteCloudAsset(cover.public_id).catch(() => {});
    console.error('LiveKit room creation failed:', error?.message || error);
    throw new HttpError(502, 'The live meeting room could not be created. Check the LiveKit settings and try again.');
  }

  const populated = await LiveSession.findById(session._id).populate('host', hostSelect);
  await writeAudit(req, 'live.start', 'LiveSession', session._id, null, { title: session.title });
  res.status(201).json({ ok: true, data: { session: serializeSession(populated) }, message: 'Live meeting started.' });
}));

router.post('/sessions/:id/join', liveRoles, asyncHandler(async (req, res) => {
  if (!livekitConfigured()) throw new HttpError(503, 'Live meetings are not configured yet. Add LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET to the server environment.');
  const session = await LiveSession.findById(sessionId(req.params.id)).populate('host', hostSelect);
  if (!session) throw new HttpError(404, 'Live meeting not found.');
  if (session.status !== 'live') throw new HttpError(409, 'This live meeting has ended.');
  const token = await createLiveToken(req.user, session.roomName);
  res.json({
    ok: true,
    data: {
      url: process.env.LIVEKIT_URL,
      token,
      identity: `user-${req.user._id}`,
      session: serializeSession(session)
    }
  });
}));

router.post('/sessions/:id/end', allowRoles('admin'), asyncHandler(async (req, res) => {
  const session = await LiveSession.findById(sessionId(req.params.id)).populate('host', hostSelect);
  if (!session) throw new HttpError(404, 'Live meeting not found.');
  if (session.status === 'live') {
    session.status = 'ended';
    session.endedAt = new Date();
    await session.save();
  }
  await deleteLiveRoom(session.roomName);
  await writeAudit(req, 'live.end', 'LiveSession', session._id, null, { title: session.title, endedAt: session.endedAt });
  res.json({ ok: true, data: { session: serializeSession(session) }, message: 'Live meeting ended.' });
}));

router.get('/sessions/:id/messages', liveRoles, asyncHandler(async (req, res) => {
  const session = await LiveSession.findById(sessionId(req.params.id)).select('_id');
  if (!session) throw new HttpError(404, 'Live meeting not found.');
  const items = await LiveMessage.find({ session: session._id }).sort({ createdAt: -1 }).limit(200);
  items.reverse();
  res.json({ ok: true, data: { messages: items.map(serializeMessage) } });
}));

router.post('/sessions/:id/messages', liveRoles, asyncHandler(async (req, res) => {
  const parsed = z.object({ text: z.string().trim().min(1, 'Write a comment before sending.').max(500, 'Keep comments under 500 characters.') }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, 'Write a comment before sending.', parsed.error.flatten().fieldErrors);
  const session = await LiveSession.findById(sessionId(req.params.id)).select('_id status');
  if (!session) throw new HttpError(404, 'Live meeting not found.');
  if (session.status !== 'live') throw new HttpError(409, 'This live meeting has ended.');
  const message = await LiveMessage.create({
    session: session._id,
    sender: req.user._id,
    senderName: req.user.profile?.fullName || req.user.username,
    senderRole: req.user.role,
    senderAvatarUrl: req.user.profile?.avatarUrl || '',
    text: parsed.data.text
  });
  res.status(201).json({ ok: true, data: { message: serializeMessage(message) } });
}));

export default router;
