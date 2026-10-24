import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { User, Employee } from '../models/index.js';
import { authenticate, allowRoles } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import { writeAudit } from '../utils/audit.js';
import { generateTemporaryPassword } from '../services/accounts.js';
const router = Router();
router.use(authenticate);
const usernameField = z.string().trim().regex(/^[a-zA-Z0-9._-]{3,30}$/, 'Use 3–30 letters, numbers, dots, underscores or hyphens.');
const newHrSchema = z.object({ fullName: z.string().trim().min(2).max(100), email: z.string().trim().email().max(254), username: usernameField, temporaryPassword: z.string().min(12).max(128).regex(/[A-Z]/, 'Add an uppercase letter.').regex(/[a-z]/, 'Add a lowercase letter.').regex(/[0-9]/, 'Add a number.').optional() });
router.get('/', allowRoles('admin'), asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1); const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10));
  const filter = { role: { $in: ['admin', 'hr'] } };
  if (req.query.search) { const re = new RegExp(escapeRegex(String(req.query.search).slice(0, 80)), 'i'); filter.$or = [{ email: re }, { username: re }, { 'profile.fullName': re }]; }
  const [items, total] = await Promise.all([User.find(filter).sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit).select('-passwordHash'), User.countDocuments(filter)]);
  res.json({ ok: true, data: { items, page, limit, total, pages: Math.ceil(total/limit) } });
}));
router.post('/hr', allowRoles('admin'), asyncHandler(async (req, res) => {
  const parsed = newHrSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, 'Please correct the HR account fields.', parsed.error.flatten().fieldErrors);
  const body = parsed.data;
  const temporaryPassword = body.temporaryPassword || generateTemporaryPassword();
  const user = await User.create({ email: body.email.toLowerCase(), username: body.username.toLowerCase(), passwordHash: await bcrypt.hash(temporaryPassword, 12), role: 'hr', mustChangePassword: true, profile: { fullName: body.fullName }, createdBy: req.user._id });
  await writeAudit(req, 'user.create', 'User', user._id, null, { role: 'hr', email: user.email, username: user.username });
  res.status(201).json({ ok: true, data: { user: safeUser(user), temporaryPassword }, message: 'HR account created. Copy the temporary password now; it will not be shown again.' });
}));
router.patch('/:id/status', allowRoles('admin'), asyncHandler(async (req, res) => {
  const parsed = z.object({ active: z.boolean() }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, 'A boolean active field is required.');
  const user = await User.findById(req.params.id);
  if (!user) throw new HttpError(404, 'Account not found.');
  if (user.role === 'admin' && !parsed.data.active && await User.countDocuments({ role: 'admin', active: true }) <= 1) throw new HttpError(422, 'You cannot deactivate the last active Admin.');
  const before = { active: user.active }; user.active = parsed.data.active; await user.save();
  await writeAudit(req, 'user.status', 'User', user._id, before, { active: user.active });
  res.json({ ok: true, data: { user: safeUser(user) } });
}));
router.patch('/:id/profile', allowRoles('admin'), asyncHandler(async (req, res) => {
  const parsed = z.object({ fullName: z.string().trim().min(2).max(100).optional(), email: z.string().trim().email().max(254).optional(), username: usernameField.optional() }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, 'Please correct the account fields.', parsed.error.flatten().fieldErrors);
  const user = await User.findById(req.params.id);
  if (!user) throw new HttpError(404, 'Account not found.');
  const before = { email: user.email, username: user.username, fullName: user.profile.fullName };
  if (parsed.data.email) user.email = parsed.data.email.toLowerCase();
  if (parsed.data.username) user.username = parsed.data.username.toLowerCase();
  if (parsed.data.fullName) user.profile.fullName = parsed.data.fullName;
  await user.save(); await writeAudit(req, 'user.update', 'User', user._id, before, { email: user.email, username: user.username, fullName: user.profile.fullName });
  res.json({ ok: true, data: { user: safeUser(user) } });
}));
router.post('/:id/reset-password', allowRoles('admin'), asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('+passwordHash');
  if (!user) throw new HttpError(404, 'Account not found.');
  const temporaryPassword = generateTemporaryPassword(); user.passwordHash = await bcrypt.hash(temporaryPassword, 12); user.mustChangePassword = true; await user.save();
  await writeAudit(req, 'user.reset_password', 'User', user._id);
  res.json({ ok: true, data: { temporaryPassword }, message: 'Copy this temporary password now. It will not be shown again.' });
}));
router.get('/:id', allowRoles('admin'), asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new HttpError(404, 'Account not found.');
  res.json({ ok: true, data: { user: safeUser(user) } });
}));
function safeUser(user) { return { id: user._id, email: user.email, username: user.username, role: user.role, active: user.active, mustChangePassword: user.mustChangePassword, profile: user.profile, lastLoginAt: user.lastLoginAt, createdAt: user.createdAt }; }
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
export default router;
