import { Router } from 'express';
import { stringify } from 'csv-stringify/sync';
import multer from 'multer';
import { z } from 'zod';
import { authenticate, allowRoles } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import { User, Employee, Department, SalaryStructure, LeaveRequest, Attendance, Payslip } from '../models/index.js';
import { createEmployeeAccount } from '../services/accounts.js';
import { writeAudit } from '../utils/audit.js';
import { validateEmployeeCsv } from '../services/employeeCsv.js';
const router = Router(); router.use(authenticate);
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 }, fileFilter(_req,file,cb) { if (!['text/csv','application/vnd.ms-excel','text/plain','application/octet-stream'].includes(file.mimetype)) return cb(new HttpError(422,'Upload a CSV file.')); cb(null,true); } });
const usernameField = z.string().trim().regex(/^[a-zA-Z0-9._-]{3,30}$/, 'Use 3–30 letters, numbers, dots, underscores or hyphens.');
const createSchema = z.object({ fullName: z.string().trim().min(2).max(100), email: z.string().trim().email().max(254), username: usernameField, employeeCode: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9_-]+$/), department: z.string().optional().nullable(), designation: z.string().trim().max(100).optional(), joiningDate: z.string().min(10), employmentStatus: z.enum(['active','on_leave','inactive','terminated']).optional(), salary: z.coerce.number().min(0).max(1e9), phone: z.string().trim().max(30).optional(), address: z.string().trim().max(300).optional(), emergencyContact: z.string().trim().max(100).optional(), temporaryPassword: z.string().min(12).max(128).regex(/[A-Z]/, 'Add an uppercase letter.').regex(/[a-z]/, 'Add a lowercase letter.').regex(/[0-9]/, 'Add a number.').optional() });
router.get('/', allowRoles('admin','hr'), asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1); const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10));
  const filter = {};
  if (req.query.status && ['active','on_leave','inactive','terminated'].includes(req.query.status)) filter.employmentStatus = req.query.status;
  if (req.query.department) filter.department = req.query.department;
  if (req.query.search) {
    const re = new RegExp(escapeRegex(String(req.query.search).slice(0,80)), 'i');
    const users = await User.find({ $or: [{ email: re }, { username: re }, { 'profile.fullName': re }] }).select('_id').limit(1000);
    filter.$or = [{ employeeCode: re }, { designation: re }, { user: { $in: users.map(u => u._id) } }];
  }
  const [items, total] = await Promise.all([Employee.find(filter).populate('user', 'email username role active profile createdAt').populate('department', 'name').sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit), Employee.countDocuments(filter)]);
  res.json({ ok: true, data: { items, page, limit, total, pages: Math.ceil(total/limit) } });
}));
router.post('/', allowRoles('admin','hr'), asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, 'Please correct the employee fields.', parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  if (new Date(input.joiningDate).toString() === 'Invalid Date') throw new HttpError(422, 'Joining date is invalid.', { joiningDate: 'Use a valid date.' });
  if (input.department && !(await Department.exists({ _id: input.department }))) throw new HttpError(422, 'Select a valid department.', { department: 'Department does not exist.' });
  const created = await createEmployeeAccount({ userData: { fullName: input.fullName, email: input.email, username: input.username, phone: input.phone, address: input.address }, employeeData: input, createdBy: req.user._id });
  await writeAudit(req, 'employee.create', 'Employee', created.employee._id, null, { employeeCode: created.employee.employeeCode, userId: created.user._id });
  res.status(201).json({ ok: true, data: { employee: created.employee, user: safeUser(created.user), temporaryPassword: created.temporaryPassword }, message: 'Employee created. Copy the temporary password now; the employee must change it on first login.' });
}));
router.get('/export.csv', allowRoles('admin','hr'), asyncHandler(async (_req, res) => {
  const rows = await Employee.find().populate('user', 'email username profile').populate('department', 'name').sort({ employeeCode: 1 });
  const csv = stringify(rows.map(e => ({ employeeCode: e.employeeCode, fullName: e.user?.profile?.fullName || '', username: e.user?.username || '', email: e.user?.email || '', department: e.department?.name || '', designation: e.designation, joiningDate: e.joiningDate?.toISOString().slice(0,10) || '', employmentStatus: e.employmentStatus, basicSalary: e.salary })), { header: true, columns: ['employeeCode','fullName','username','email','department','designation','joiningDate','employmentStatus','basicSalary'] });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="hcm-employees.csv"'); res.send(csv);
}));
router.post('/import/dry-run', allowRoles('admin','hr'), csvUpload.single('file'), asyncHandler(async (req,res) => {
  if (!req.file) throw new HttpError(422, 'Choose a CSV file to validate.');
  const report = await validateEmployeeCsv(req.file.buffer);
  res.json({ ok: true, data: { ...report, dryRun: true }, message: report.error || 'CSV validation completed. No accounts or employee records were created.' });
}));
router.post('/import', allowRoles('admin','hr'), csvUpload.single('file'), asyncHandler(async (req,res) => {
  if (!req.file) throw new HttpError(422, 'Choose a CSV file to import.');
  const report = await validateEmployeeCsv(req.file.buffer);
  if (report.error) throw new HttpError(422, report.error);
  if (!report.rows.length) throw new HttpError(422, 'The CSV has no data rows.');
  if (report.invalidCount) throw new HttpError(422, 'Import was stopped because one or more rows failed validation. Run dry-run and fix every row first.', { validCount: report.validCount, invalidCount: report.invalidCount, rows: report.rows.filter(r=>!r.valid) });
  const created = [];
  try {
    for (const row of report.rows) {
      const data = row.data;
      const account = await createEmployeeAccount({ userData: { fullName: data.fullName, email: data.email, username: data.username }, employeeData: { employeeCode: data.employeeCode, department: data.department, designation: data.designation, joiningDate: data.joiningDate, salary: data.salary }, createdBy: req.user._id });
      created.push({ employeeId: account.employee._id, userId: account.user._id, employeeCode: data.employeeCode, email: data.email, username: data.username, temporaryPassword: account.temporaryPassword });
    }
  } catch (error) {
    for (const item of created) {
      await Employee.deleteOne({ _id: item.employeeId }).catch(()=>{});
      await SalaryStructure.deleteOne({ employee: item.employeeId }).catch(()=>{});
      await User.deleteOne({ _id: item.userId }).catch(()=>{});
    }
    throw error;
  }
  await writeAudit(req, 'employee.csv_import', 'Employee', '', null, { count: created.length });
  res.status(201).json({ ok:true, data:{ importedCount: created.length, credentials: created }, message:'All validated employee rows were imported. Temporary passwords are shown once; download or copy them and share securely.' });
}));
router.get('/:id', allowRoles('admin','hr'), asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.params.id).populate('user', 'email username profile active createdAt').populate('department', 'name');
  if (!employee) throw new HttpError(404, 'Employee not found.');
  const [attendanceCount, leaveRequests] = await Promise.all([Attendance.countDocuments({ employee: employee._id }), LeaveRequest.find({ employee: employee._id }).sort({ createdAt: -1 }).limit(5)]);
  res.json({ ok: true, data: { employee, attendanceCount, recentLeaveRequests: leaveRequests } });
}));
router.patch('/:id', allowRoles('admin','hr'), asyncHandler(async (req, res) => {
  const schema = z.object({ fullName: z.string().trim().min(2).max(100).optional(), email: z.string().trim().email().max(254).optional(), username: usernameField.optional(), employeeCode: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9_-]+$/).optional(), department: z.string().nullable().optional(), designation: z.string().trim().max(100).optional(), joiningDate: z.string().optional(), employmentStatus: z.enum(['active','on_leave','inactive','terminated']).optional(), salary: z.coerce.number().min(0).max(1e9).optional(), phone: z.string().trim().max(30).optional(), address: z.string().trim().max(300).optional(), emergencyContact: z.string().trim().max(100).optional() }).strict();
  const parsed = schema.safeParse(req.body); if (!parsed.success) throw new HttpError(422, 'Please correct the employee fields.', parsed.error.flatten().fieldErrors);
  const employee = await Employee.findById(req.params.id).populate('user'); if (!employee) throw new HttpError(404, 'Employee not found.');
  const before = { employeeCode: employee.employeeCode, designation: employee.designation, employmentStatus: employee.employmentStatus, salary: employee.salary, department: employee.department };
  const data = parsed.data;
  if (data.fullName !== undefined) employee.user.profile.fullName = data.fullName;
  if (data.email !== undefined) employee.user.email = data.email.toLowerCase();
  if (data.username !== undefined) employee.user.username = data.username.toLowerCase();
  if (data.phone !== undefined) employee.user.profile.phone = data.phone;
  if (data.address !== undefined) employee.user.profile.address = data.address;
  if (data.employeeCode !== undefined) employee.employeeCode = data.employeeCode.toUpperCase();
  if (data.department !== undefined) { if (data.department && !(await Department.exists({ _id: data.department }))) throw new HttpError(422, 'Department does not exist.'); employee.department = data.department || null; }
  for (const key of ['designation','employmentStatus','emergencyContact']) if (data[key] !== undefined) employee[key] = data[key];
  if (data.joiningDate !== undefined) { if (Number.isNaN(new Date(data.joiningDate).getTime())) throw new HttpError(422, 'Joining date is invalid.'); employee.joiningDate = new Date(data.joiningDate); }
  if (data.salary !== undefined) employee.salary = data.salary;
  await Promise.all([employee.user.save(), employee.save()]);
  if (data.salary !== undefined) await SalaryStructure.findOneAndUpdate({ employee: employee._id }, { $set: { basicSalary: data.salary } }, { upsert: true, new: true, runValidators: true });
  await writeAudit(req, 'employee.update', 'Employee', employee._id, before, { employeeCode: employee.employeeCode, designation: employee.designation, employmentStatus: employee.employmentStatus, salary: employee.salary, department: employee.department });
  await employee.populate('department', 'name');
  res.json({ ok: true, data: { employee } });
}));
router.patch('/:id/status', allowRoles('admin','hr'), asyncHandler(async (req, res) => {
  const parsed = z.object({ employmentStatus: z.enum(['active','on_leave','inactive','terminated']), active: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, 'Provide a valid employment status.');
  const employee = await Employee.findById(req.params.id).populate('user'); if (!employee) throw new HttpError(404, 'Employee not found.');
  const before = { employmentStatus: employee.employmentStatus, active: employee.user.active };
  employee.employmentStatus = parsed.data.employmentStatus;
  if (parsed.data.active !== undefined) employee.user.active = parsed.data.active;
  if (['inactive','terminated'].includes(parsed.data.employmentStatus)) employee.user.active = false;
  await Promise.all([employee.save(), employee.user.save()]);
  await writeAudit(req, 'employee.status', 'Employee', employee._id, before, { employmentStatus: employee.employmentStatus, active: employee.user.active });
  res.json({ ok: true, data: { employee } });
}));
function safeUser(user) { return { id: user._id, email: user.email, username: user.username, role: user.role, active: user.active, profile: user.profile, mustChangePassword: user.mustChangePassword }; }
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
export default router;
