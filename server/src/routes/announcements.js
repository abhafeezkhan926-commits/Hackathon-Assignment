import { Router } from 'express';
import { z } from 'zod';
import { authenticate, allowRoles } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import { Announcement, User } from '../models/index.js';
import { notifyUsers } from '../utils/notify.js';
import { writeAudit } from '../utils/audit.js';

const router = Router();
router.use(authenticate);

function audienceRoles(audience) {
  return audience === 'all' ? ['hr', 'employee'] : [audience];
}

function preview(body) {
  return body.length > 140 ? `${body.slice(0, 137).trimEnd()}…` : body;
}

router.get('/', asyncHandler(async (req, res) => {
  const filter = req.user.role === 'admin' ? {} : req.user.role === 'hr' ? { audience: { $in: ['all', 'hr', 'employee'] } } : { audience: { $in: ['all', 'employee'] } };
  const items = await Announcement.find(filter).populate('author', 'profile.fullName role').sort({ createdAt: -1 }).limit(100);
  res.json({ ok: true, data: { items } });
}));

router.post('/', allowRoles('admin', 'hr'), asyncHandler(async (req, res) => {
  const parsed = z.object({
    title: z.string().trim().min(3).max(160),
    body: z.string().trim().min(3).max(5000),
    audience: z.enum(['all', 'hr', 'employee']).default('all')
  }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, 'Please correct the announcement fields.', parsed.error.flatten().fieldErrors);
  const item = await Announcement.create({ ...parsed.data, author: req.user._id });
  await writeAudit(req, 'announcement.create', 'Announcement', item._id, null, { title: item.title, audience: item.audience });
  await item.populate('author', 'profile.fullName role');
  try {
    const recipients = await User.find({ active: true, role: { $in: audienceRoles(item.audience) }, _id: { $ne: req.user._id } }).select('_id').lean();
    await notifyUsers(recipients.map(user => user._id), {
      type: 'announcement',
      title: item.title,
      message: preview(item.body),
      link: '/announcements'
    });
  } catch (error) {
    console.error('[notifications] Announcement delivery failed:', error.message);
  }
  res.status(201).json({ ok: true, data: { announcement: item } });
}));

router.patch('/:id', allowRoles('admin', 'hr'), asyncHandler(async (req, res) => {
  const item = await Announcement.findById(req.params.id);
  if (!item) throw new HttpError(404, 'Announcement not found.');
  if (req.user.role === 'hr' && String(item.author) !== String(req.user._id)) throw new HttpError(403, 'HR can edit only announcements they created.');
  const parsed = z.object({
    title: z.string().trim().min(3).max(160).optional(),
    body: z.string().trim().min(3).max(5000).optional(),
    audience: z.enum(['all', 'hr', 'employee']).optional()
  }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, 'Please correct the announcement fields.', parsed.error.flatten().fieldErrors);
  Object.assign(item, parsed.data);
  await item.save();
  await writeAudit(req, 'announcement.update', 'Announcement', item._id);
  res.json({ ok: true, data: { announcement: item } });
}));

export default router;
