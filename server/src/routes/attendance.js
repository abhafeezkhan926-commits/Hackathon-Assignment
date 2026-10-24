import { Router } from 'express';
import { z } from 'zod';
import { Attendance, AttendanceCorrectionRequest, Employee, CompanySettings, Holiday, LeaveRequest } from '../models/index.js';
import { notifyUser } from '../utils/notify.js';
import { authenticate, allowRoles } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import { dayKeyInTimezone, countWorkingDays } from '../utils/dates.js';
import { writeAudit } from '../utils/audit.js';
const router = Router(); router.use(authenticate);
router.post('/check-in', allowRoles('employee'), asyncHandler(async (req, res) => {
  const employee = await Employee.findOne({ user: req.user._id }); if (!employee) throw new HttpError(404, 'Your employee profile has not been set up.');
  const settings = await CompanySettings.findOne({ singleton: 'company' });
  const now = new Date(); const dayKey = dayKeyInTimezone(now, settings?.timezone || 'Asia/Karachi');
  const localTime = new Intl.DateTimeFormat('en-GB', { timeZone: settings?.timezone || 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const start = settings?.officeStart || '09:00';
  const [lh,lm] = localTime.split(':').map(Number); const [sh,sm] = start.split(':').map(Number);
  const late = (lh*60+lm) > (sh*60+sm+(settings?.gracePeriodMinutes ?? 15));
  try {
    const record = await Attendance.create({ employee: employee._id, dayKey, checkIn: now, status: late ? 'late' : 'present', source: 'web' });
    await writeAudit(req, 'attendance.check_in', 'Attendance', record._id, null, { dayKey, status: record.status });
    res.status(201).json({ ok: true, data: { attendance: record }, message: `Checked in at ${localTime}.` });
  } catch (error) { if (error.code === 11000) throw new HttpError(409, 'You have already checked in for today.'); throw error; }
}));
router.post('/check-out', allowRoles('employee'), asyncHandler(async (req, res) => {
  const employee = await Employee.findOne({ user: req.user._id }); if (!employee) throw new HttpError(404, 'Your employee profile has not been set up.');
  const settings = await CompanySettings.findOne({ singleton: 'company' }); const now = new Date(); const dayKey = dayKeyInTimezone(now, settings?.timezone || 'Asia/Karachi');
  const record = await Attendance.findOne({ employee: employee._id, dayKey });
  if (!record || !record.checkIn) throw new HttpError(409, 'Check in before checking out.');
  if (record.checkOut) throw new HttpError(409, 'You have already checked out for today.');
  if (now <= record.checkIn) throw new HttpError(422, 'Check-out time must be after check-in time.');
  record.checkOut = now; record.hoursWorked = Math.round(((now - record.checkIn) / 3600000) * 100) / 100;
  if (record.hoursWorked < 4 && record.status !== 'late') record.status = 'half_day';
  await record.save(); await writeAudit(req, 'attendance.check_out', 'Attendance', record._id, null, { dayKey, hoursWorked: record.hoursWorked });
  res.json({ ok: true, data: { attendance: record }, message: 'Checked out successfully.' });
}));
router.get('/mine', allowRoles('employee'), asyncHandler(async (req,res) => {
  const employee = await Employee.findOne({ user: req.user._id }); if (!employee) throw new HttpError(404, 'Your employee profile has not been set up.');
  const year = String(req.query.year || new Date().getFullYear());
  if (!/^\d{4}$/.test(year)) throw new HttpError(422, 'Year must be a four-digit year.');
  const items = await Attendance.find({ employee: employee._id, dayKey: { $gte: `${year}-01-01`, $lte: `${year}-12-31` } }).sort({ dayKey: -1 }).limit(370);
  res.json({ ok: true, data: { items } });
}));
router.get('/', allowRoles('admin','hr'), asyncHandler(async (req,res) => {
  const filter = {};
  if (req.query.dayKey) filter.dayKey = String(req.query.dayKey);
  if (req.query.status && ['present','late','half_day','absent','on_leave','missing_checkout'].includes(req.query.status)) filter.status = req.query.status;
  const items = await Attendance.find(filter).populate({ path: 'employee', populate: [{ path: 'user', select: 'profile email username' }, { path: 'department', select: 'name' }] }).sort({ dayKey: -1, checkIn: -1 }).limit(Math.min(500, Number(req.query.limit) || 100));
  res.json({ ok: true, data: { items } });
}));
router.post('/corrections', allowRoles('employee'), asyncHandler(async (req,res) => {
  const parsed = z.object({ dayKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(5).max(1000), requestedCheckIn: z.string().datetime().optional(), requestedCheckOut: z.string().datetime().optional() }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, 'Provide a date, reason, and valid optional times.', parsed.error.flatten().fieldErrors);
  const employee = await Employee.findOne({ user: req.user._id }); if (!employee) throw new HttpError(404, 'Your employee profile has not been set up.');
  const item = await AttendanceCorrectionRequest.create({ employee: employee._id, ...parsed.data, requestedCheckIn: parsed.data.requestedCheckIn ? new Date(parsed.data.requestedCheckIn) : undefined, requestedCheckOut: parsed.data.requestedCheckOut ? new Date(parsed.data.requestedCheckOut) : undefined });
  await writeAudit(req, 'attendance.correction_request', 'AttendanceCorrectionRequest', item._id);
  res.status(201).json({ ok: true, data: { request: item }, message: 'Correction request submitted for review.' });
}));
router.get('/corrections', allowRoles('admin','hr'), asyncHandler(async (_req,res) => {
  const items = await AttendanceCorrectionRequest.find().populate({ path: 'employee', populate: { path: 'user', select: 'profile email' } }).populate('reviewer', 'profile.fullName').sort({ createdAt: -1 }).limit(200);
  res.json({ ok: true, data: { items } });
}));
router.patch('/corrections/:id/decision', allowRoles('admin','hr'), asyncHandler(async (req,res) => {
  const parsed = z.object({ status: z.enum(['approved','rejected']), reviewerComment: z.string().trim().max(1000).optional() }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, 'Choose approve or reject.');
  const request = await AttendanceCorrectionRequest.findById(req.params.id); if (!request) throw new HttpError(404, 'Correction request not found.');
  if (request.status !== 'pending') throw new HttpError(409, 'This request has already been reviewed.');
  request.status = parsed.data.status; request.reviewer = req.user._id; request.reviewerComment = parsed.data.reviewerComment || ''; request.decidedAt = new Date();
  if (request.status === 'approved') {
    let record = await Attendance.findOne({ employee: request.employee, dayKey: request.dayKey });
    if (!record) record = new Attendance({ employee: request.employee, dayKey: request.dayKey, status: 'present', source: 'manual' });
    if (request.requestedCheckIn) record.checkIn = request.requestedCheckIn;
    if (request.requestedCheckOut) record.checkOut = request.requestedCheckOut;
    if (record.checkIn && record.checkOut && record.checkOut > record.checkIn) record.hoursWorked = Math.round(((record.checkOut-record.checkIn)/3600000)*100)/100;
    record.reviewedBy = req.user._id; await record.save();
  }
  await request.save();
  const employee = await Employee.findById(request.employee).select('user'); if (employee?.user) await notifyUser(employee.user, { type: 'attendance_correction', title: `Attendance correction ${request.status}`, message: `Your request for ${request.dayKey} was ${request.status}.`, link: '/attendance' });
  await writeAudit(req, 'attendance.correction_decision', 'AttendanceCorrectionRequest', request._id, null, { status: request.status });
  res.json({ ok: true, data: { request } });
}));
export default router;
