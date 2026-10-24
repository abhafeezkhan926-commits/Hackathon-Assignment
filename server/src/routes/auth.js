import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { User } from '../models/index.js';
import { authenticate, createToken, setAuthCookie } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import { writeAudit } from '../utils/audit.js';
const router = Router();
const loginSchema = z.object({ identifier: z.string().trim().min(1).max(254), password: z.string().min(1).max(128) });
const passwordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(12).max(128).regex(/[A-Z]/, 'Add an uppercase letter.').regex(/[a-z]/, 'Add a lowercase letter.').regex(/[0-9]/, 'Add a number.') });
router.post('/login', asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, 'Enter your email/username and password.', parsed.error.flatten().fieldErrors);
  const identifier = parsed.data.identifier.toLowerCase().trim();
  const user = await User.findOne({ $or: [{ email: identifier }, { username: identifier }] }).select('+passwordHash');
  const valid = user ? await bcrypt.compare(parsed.data.password, user.passwordHash) : await bcrypt.compare(parsed.data.password, '$2a$12$C6UzMDM.H6dfI/f/IKcEe.1kgLkV7ngjVN8wR3sbfP6wP8pS5h3yK');
  if (!user || !user.active || !valid) throw new HttpError(401, 'Invalid email/username or password.');
  user.lastLoginAt = new Date(); await user.save();
  const token = createToken(user); setAuthCookie(res, token);
  await writeAudit(req, 'auth.login', 'User', user._id, null, { role: user.role });
  res.json({ ok: true, data: { user: safeUser(user), mustChangePassword: user.mustChangePassword } });
}));
router.get('/me', authenticate, asyncHandler(async (req, res) => res.json({ ok: true, data: { user: safeUser(req.user), mustChangePassword: req.user.mustChangePassword } })));
router.post('/logout', (_req, res) => { res.clearCookie('hcm_token', { httpOnly: true, secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' }); res.json({ ok: true, data: { loggedOut: true } }); });
router.post('/change-password', authenticate, asyncHandler(async (req, res) => {
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, 'Please choose a stronger password.', parsed.error.flatten().fieldErrors);
  if (!req.user.mustChangePassword && !(await bcrypt.compare(parsed.data.currentPassword, req.user.passwordHash))) throw new HttpError(400, 'Current password is incorrect.');
  if (await bcrypt.compare(parsed.data.newPassword, req.user.passwordHash)) throw new HttpError(422, 'Choose a password you have not used before.');
  req.user.passwordHash = await bcrypt.hash(parsed.data.newPassword, 12); req.user.mustChangePassword = false; await req.user.save();
  setAuthCookie(res, createToken(req.user));
  await writeAudit(req, 'auth.change_password', 'User', req.user._id);
  res.json({ ok: true, data: { user: safeUser(req.user) }, message: 'Password updated successfully.' });
}));
function safeUser(user) { return { id: user._id, email: user.email, username: user.username, role: user.role, active: user.active, mustChangePassword: user.mustChangePassword, profile: user.profile, lastLoginAt: user.lastLoginAt, createdAt: user.createdAt }; }
export default router;
