import { Router } from 'express';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { User, Employee, Attendance, LeaveRequest, Payslip, Notification } from '../models/index.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import { cloudinaryConfigured, uploadAvatar, deleteCloudAsset } from '../services/cloudinary.js';
import { writeAudit } from '../utils/audit.js';
const router = Router(); router.use(authenticate);
const maxBytes = Math.max(1, Number(process.env.MAX_UPLOAD_MB) || 5) * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1 }, fileFilter(_req, file, cb) { if (!['image/jpeg','image/png','image/webp'].includes(file.mimetype)) return cb(new HttpError(422, 'Upload a JPG, PNG, or WebP image.')); cb(null, true); } });
router.get('/', asyncHandler(async (req, res) => {
  const [employee, notifications] = await Promise.all([
    req.user.role === 'employee' ? Employee.findOne({ user: req.user._id }).populate('department', 'name') : null,
    Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(10)
  ]);
  res.json({ ok: true, data: { user: safeUser(req.user), employee, notifications } });
}));
router.patch('/', asyncHandler(async (req, res) => {
  const parsed = z.object({ phone: z.string().trim().max(30).optional(), address: z.string().trim().max(300).optional(), fullName: z.string().trim().min(2).max(100).optional() }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, 'Please correct your profile fields.', parsed.error.flatten().fieldErrors);
  if (req.user.role === 'employee' && parsed.data.fullName !== undefined) throw new HttpError(403, 'Employees can update their phone number and address only. Contact HR to change your registered name.');
  const before = { profile: req.user.profile };
  if (parsed.data.phone !== undefined) req.user.profile.phone = parsed.data.phone;
  if (parsed.data.address !== undefined) req.user.profile.address = parsed.data.address;
  if (parsed.data.fullName !== undefined) req.user.profile.fullName = parsed.data.fullName;
  await req.user.save(); await writeAudit(req, 'profile.update', 'User', req.user._id, before, { profile: req.user.profile });
  res.json({ ok: true, data: { user: safeUser(req.user) }, message: 'Profile updated.' });
}));
router.post('/avatar', upload.single('avatar'), asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(422, 'Choose an image to upload.');
  if (!cloudinaryConfigured()) throw new HttpError(503, 'Profile image upload is unavailable because Cloudinary is not configured. Your current profile remains unchanged.');
  const type = await fileTypeFromBuffer(req.file.buffer);
  const accepted = new Set(['image/jpeg','image/png','image/webp']);
  if (!type || !accepted.has(type.mime) || type.mime !== req.file.mimetype) throw new HttpError(422, 'The file contents are not a supported image. Upload a real JPG, PNG, or WebP image.');
  if (type.mime === 'image/svg+xml' || type.mime === 'image/gif') throw new HttpError(422, 'SVG and animated images are not accepted.');
  let uploaded;
  try { uploaded = await uploadAvatar(req.file.buffer, req.user._id.toString()); }
  catch { throw new HttpError(502, 'The image service could not save your picture. Please try again later.'); }
  const oldPublicId = req.user.profile.avatarPublicId;
  req.user.profile.avatarUrl = uploaded.secure_url;
  req.user.profile.avatarPublicId = uploaded.public_id;
  try { await req.user.save(); }
  catch (error) { await deleteCloudAsset(uploaded.public_id).catch(() => {}); throw error; }
  if (oldPublicId) await deleteCloudAsset(oldPublicId).catch(() => {});
  await writeAudit(req, 'profile.avatar_update', 'User', req.user._id, null, { avatarUpdated: true });
  res.json({ ok: true, data: { user: safeUser(req.user) }, message: 'Profile picture updated.' });
}));
router.delete('/avatar', asyncHandler(async (req, res) => {
  const oldPublicId = req.user.profile.avatarPublicId;
  req.user.profile.avatarUrl = ''; req.user.profile.avatarPublicId = ''; await req.user.save();
  if (oldPublicId) await deleteCloudAsset(oldPublicId).catch(() => {});
  await writeAudit(req, 'profile.avatar_remove', 'User', req.user._id);
  res.json({ ok: true, data: { user: safeUser(req.user) }, message: 'Profile picture removed.' });
}));
router.get('/summary', asyncHandler(async (req, res) => {
  const employee = await Employee.findOne({ user: req.user._id });
  if (req.user.role !== 'employee' || !employee) throw new HttpError(403, 'Personal summary is available to employee accounts only.');
  const now = new Date(); const yearStart = new Date(now.getFullYear(),0,1);
  const [attendance, leaves, payslip, unread] = await Promise.all([
    Attendance.find({ employee: employee._id, dayKey: { $gte: `${now.getFullYear()}-01-01` } }).sort({ dayKey: -1 }).limit(50),
    LeaveRequest.find({ employee: employee._id, startDate: { $gte: yearStart }, status: { $in: ['pending','approved','rejected'] } }).sort({ createdAt: -1 }),
    Payslip.findOne({ employee: employee._id }).sort({ period: -1 }),
    Notification.countDocuments({ user: req.user._id, readAt: null })
  ]);
  const approvedUsed = leaves.filter(l => l.status === 'approved' && l.leaveType !== 'unpaid').reduce((sum,l) => sum + l.workingDays, 0);
  res.json({ ok: true, data: { attendance, leaves, latestPayslip: payslip, unreadNotifications: unread, leaveUsed: approvedUsed } });
}));
router.get('/notifications', asyncHandler(async (req, res) => {
  const items = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
  res.json({ ok: true, data: { items, unread: items.filter(n => !n.readAt).length } });
}));
router.patch('/notifications/:id/read', asyncHandler(async (req, res) => {
  const item = await Notification.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, { $set: { readAt: new Date() } }, { new: true });
  if (!item) throw new HttpError(404, 'Notification not found.');
  res.json({ ok: true, data: { notification: item } });
}));
function safeUser(user) { return { id: user._id, email: user.email, username: user.username, role: user.role, active: user.active, mustChangePassword: user.mustChangePassword, profile: user.profile, lastLoginAt: user.lastLoginAt, createdAt: user.createdAt }; }
export default router;
