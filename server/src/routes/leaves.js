import { Router } from 'express';
import { z } from 'zod';
import { authenticate, allowRoles } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import { CompanySettings, Holiday, LeaveRequest, Employee, User } from '../models/index.js';
import { notifyUser } from '../utils/notify.js';
import { countWorkingDays } from '../utils/dates.js';
import { writeAudit } from '../utils/audit.js';
const router = Router(); router.use(authenticate);
const leaveSchema = z.object({ leaveType: z.enum(['annual','sick','casual','unpaid','other']), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(5).max(1000) });
async function balanceFor(employeeId, type, year, settings) {
  if (type === 'unpaid' || type === 'other') return { quota: null, used: 0, remaining: null };
  const quota = settings?.leaveQuotas?.[type] ?? ({ annual: 14, sick: 8, casual: 10 }[type] || 0);
  const usedRows = await LeaveRequest.find({ employee: employeeId, leaveType: type, status: 'approved', startDate: { $gte: new Date(`${year}-01-01T00:00:00.000Z`), $lte: new Date(`${year}-12-31T23:59:59.999Z`) } }).select('workingDays');
  const pendingRows = await LeaveRequest.find({ employee: employeeId, leaveType: type, status: 'pending', startDate: { $gte: new Date(`${year}-01-01T00:00:00.000Z`), $lte: new Date(`${year}-12-31T23:59:59.999Z`) } }).select('workingDays');
  const used = usedRows.reduce((s,x) => s+x.workingDays,0); const pending = pendingRows.reduce((s,x) => s+x.workingDays,0);
  return { quota, used, pending, remaining: Math.max(0, quota-used-pending) };
}
router.get('/mine', allowRoles('employee'), asyncHandler(async (req,res) => {
  const employee = await Employee.findOne({ user: req.user._id }); if (!employee) throw new HttpError(404, 'Your employee profile has not been set up.');
  const items = await LeaveRequest.find({ employee: employee._id }).sort({ createdAt: -1 }).limit(200);
  const settings = await CompanySettings.findOne({ singleton: 'company' }); const year = new Date().getFullYear();
  const balances = {};
  for (const type of ['annual','sick','casual','unpaid']) balances[type] = await balanceFor(employee._id, type, year, settings);
  res.json({ ok: true, data: { items, balances } });
}));
router.post('/', allowRoles('employee'), asyncHandler(async (req,res) => {
  const parsed = leaveSchema.safeParse(req.body); if (!parsed.success) throw new HttpError(422, 'Please correct the leave request.', parsed.error.flatten().fieldErrors);
  const { leaveType, startDate, endDate, reason } = parsed.data;
  if (startDate > endDate) throw new HttpError(422, 'End date must be on or after the start date.', { endDate: 'End date must not be before start date.' });
  const employee = await Employee.findOne({ user: req.user._id }); if (!employee) throw new HttpError(404, 'Your employee profile has not been set up.');
  const settings = await CompanySettings.findOne({ singleton: 'company' }); const holidays = await Holiday.find({ date: { $gte: new Date(`${startDate}T00:00:00Z`), $lte: new Date(`${endDate}T23:59:59Z`) } }).select('date');
  const holidayKeys = new Set(holidays.map(h => h.date.toISOString().slice(0,10)));
  const workingDays = countWorkingDays(startDate, endDate, settings?.workingDays || [1,2,3,4,5], holidayKeys);
  if (!workingDays) throw new HttpError(422, 'The selected dates contain no working days.');
  const overlap = await LeaveRequest.findOne({ employee: employee._id, status: { $in: ['pending','approved'] }, startDate: { $lte: new Date(`${endDate}T23:59:59.999Z`) }, endDate: { $gte: new Date(`${startDate}T00:00:00.000Z`) } });
  if (overlap) throw new HttpError(422, 'This request overlaps another pending or approved leave request.', { overlap: overlap._id.toString() });
  const year = Number(startDate.slice(0,4));
  if (Number(endDate.slice(0,4)) !== year) throw new HttpError(422, 'A leave request must stay within one calendar year. Submit separate requests for different years.');
  const balance = await balanceFor(employee._id, leaveType, year, settings);
  if (balance.remaining !== null && workingDays > balance.remaining) throw new HttpError(422, `This request exceeds your available ${leaveType} balance.`, { requestedDays: workingDays, remainingDays: balance.remaining });
  const item = await LeaveRequest.create({ employee: employee._id, leaveType, startDate: new Date(`${startDate}T00:00:00.000Z`), endDate: new Date(`${endDate}T00:00:00.000Z`), workingDays, reason });
  await writeAudit(req, 'leave.create', 'LeaveRequest', item._id, null, { leaveType, startDate, endDate, workingDays });
  res.status(201).json({ ok: true, data: { request: item }, message: 'Leave request submitted.' });
}));
router.get('/', allowRoles('admin','hr'), asyncHandler(async (req,res) => {
  const filter = {}; if (req.query.status && ['pending','approved','rejected','cancelled'].includes(req.query.status)) filter.status = req.query.status;
  const items = await LeaveRequest.find(filter).populate({ path: 'employee', populate: [{ path: 'user', select: 'profile email username' }, { path: 'department', select: 'name' }] }).populate('reviewer','profile.fullName').sort({ createdAt: -1 }).limit(500);
  res.json({ ok: true, data: { items } });
}));
router.patch('/:id/decision', allowRoles('admin','hr'), asyncHandler(async (req,res) => {
  const parsed = z.object({ status: z.enum(['approved','rejected']), reviewerComment: z.string().trim().max(1000).optional() }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, 'Choose approve or reject.');
  const item = await LeaveRequest.findById(req.params.id); if (!item) throw new HttpError(404, 'Leave request not found.');
  if (item.status !== 'pending') throw new HttpError(409, 'This leave request has already been reviewed.');
  if (parsed.data.status === 'approved') {
    const overlap = await LeaveRequest.findOne({ _id: { $ne: item._id }, employee: item.employee, status: 'approved', startDate: { $lte: item.endDate }, endDate: { $gte: item.startDate } });
    if (overlap) throw new HttpError(422, 'Cannot approve because it overlaps another approved leave request.');
  }
  item.status = parsed.data.status; item.reviewer = req.user._id; item.reviewerComment = parsed.data.reviewerComment || ''; item.decidedAt = new Date(); await item.save();
  const employee = await Employee.findById(item.employee).select('user'); if (employee?.user) await notifyUser(employee.user, { type: 'leave_decision', title: `Leave request ${item.status}`, message: `Your ${item.leaveType} leave from ${item.startDate.toISOString().slice(0,10)} to ${item.endDate.toISOString().slice(0,10)} was ${item.status}.`, link: '/leave' });
  await writeAudit(req, 'leave.decision', 'LeaveRequest', item._id, null, { status: item.status });
  res.json({ ok: true, data: { request: item }, message: `Leave request ${item.status}.` });
}));
router.post('/:id/cancel', allowRoles('employee'), asyncHandler(async (req,res) => {
  const employee = await Employee.findOne({ user: req.user._id }); if (!employee) throw new HttpError(404, 'Your employee profile has not been set up.');
  const item = await LeaveRequest.findOne({ _id: req.params.id, employee: employee._id }); if (!item) throw new HttpError(404, 'Leave request not found.');
  if (item.status !== 'pending') throw new HttpError(409, 'Only pending requests can be cancelled.');
  item.status = 'cancelled'; await item.save(); await writeAudit(req, 'leave.cancel', 'LeaveRequest', item._id);
  res.json({ ok: true, data: { request: item } });
}));
export default router;
