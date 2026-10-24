import mongoose from 'mongoose';
const { Schema, model, models } = mongoose;

const userSchema = new Schema({
  email: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
  username: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true, minlength: 3, maxlength: 30 },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['admin', 'hr', 'employee'], required: true, index: true },
  active: { type: Boolean, default: true, index: true },
  mustChangePassword: { type: Boolean, default: false },
  profile: {
    fullName: { type: String, trim: true, maxlength: 100, default: '' },
    phone: { type: String, trim: true, maxlength: 30, default: '' },
    address: { type: String, trim: true, maxlength: 300, default: '' },
    avatarUrl: { type: String, default: '' },
    avatarPublicId: { type: String, default: '' }
  },
  lastLoginAt: { type: Date },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });
userSchema.set('toJSON', { transform(_doc, ret) { delete ret.passwordHash; delete ret.__v; return ret; } });

const employeeSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  employeeCode: { type: String, required: true, uppercase: true, trim: true, unique: true, index: true },
  department: { type: Schema.Types.ObjectId, ref: 'Department', default: null, index: true },
  designation: { type: String, trim: true, maxlength: 100, default: '' },
  joiningDate: { type: Date, required: true },
  employmentStatus: { type: String, enum: ['active', 'on_leave', 'inactive', 'terminated'], default: 'active', index: true },
  salary: { type: Number, min: 0, default: 0 },
  emergencyContact: { type: String, trim: true, maxlength: 100, default: '' },
  employmentHistory: [{ title: String, department: String, startDate: Date, endDate: Date, notes: String }]
}, { timestamps: true });

const companySettingsSchema = new Schema({
  singleton: { type: String, default: 'company', unique: true },
  initialized: { type: Boolean, default: false, index: true },
  name: { type: String, trim: true, default: 'My Company', maxlength: 120 },
  logoUrl: { type: String, default: '' },
  address: { type: String, default: '', maxlength: 300 },
  timezone: { type: String, default: 'Asia/Karachi' },
  officeStart: { type: String, default: '09:00' },
  officeEnd: { type: String, default: '17:00' },
  gracePeriodMinutes: { type: Number, default: 15, min: 0, max: 180 },
  workingDays: { type: [Number], default: [1, 2, 3, 4, 5] },
  officeLatitude: { type: Number, default: null },
  officeLongitude: { type: Number, default: null },
  geofenceRadiusMeters: { type: Number, default: 100 },
  policies: { type: String, default: '' },
  leaveQuotas: { annual: { type: Number, default: 14 }, sick: { type: Number, default: 8 }, casual: { type: Number, default: 10 } }
}, { timestamps: true });

const departmentSchema = new Schema({ name: { type: String, required: true, trim: true, unique: true }, description: { type: String, default: '' }, active: { type: Boolean, default: true } }, { timestamps: true });
const designationSchema = new Schema({ name: { type: String, required: true, trim: true, unique: true }, department: { type: Schema.Types.ObjectId, ref: 'Department', default: null } }, { timestamps: true });
const leaveTypeSchema = new Schema({ name: { type: String, required: true, trim: true, unique: true }, key: { type: String, required: true, lowercase: true, unique: true }, annualQuota: { type: Number, default: null, min: 0 }, paid: { type: Boolean, default: true }, active: { type: Boolean, default: true } }, { timestamps: true });
const holidaySchema = new Schema({ name: { type: String, required: true, trim: true }, date: { type: Date, required: true, index: true }, notes: { type: String, default: '' } }, { timestamps: true });

const attendanceSchema = new Schema({
  employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  dayKey: { type: String, required: true },
  checkIn: { type: Date, default: null }, checkOut: { type: Date, default: null },
  hoursWorked: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['present', 'late', 'half_day', 'absent', 'on_leave', 'missing_checkout'], default: 'present', index: true },
  source: { type: String, enum: ['web', 'manual', 'camera'], default: 'web' },
  location: { latitude: Number, longitude: Number, accuracy: Number },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  note: { type: String, maxlength: 500, default: '' }
}, { timestamps: true });
attendanceSchema.index({ employee: 1, dayKey: 1 }, { unique: true });

const attendanceCorrectionSchema = new Schema({
  employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  attendance: { type: Schema.Types.ObjectId, ref: 'Attendance', default: null },
  dayKey: { type: String, required: true }, reason: { type: String, required: true, maxlength: 1000 },
  requestedCheckIn: Date, requestedCheckOut: Date,
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  reviewer: { type: Schema.Types.ObjectId, ref: 'User', default: null }, reviewerComment: { type: String, default: '' }, decidedAt: Date
}, { timestamps: true });

const leaveRequestSchema = new Schema({
  employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  leaveType: { type: String, enum: ['annual', 'sick', 'casual', 'unpaid', 'other'], required: true },
  startDate: { type: Date, required: true }, endDate: { type: Date, required: true }, workingDays: { type: Number, required: true, min: 0.5 },
  reason: { type: String, required: true, maxlength: 1000 },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
  reviewer: { type: Schema.Types.ObjectId, ref: 'User', default: null }, reviewerComment: { type: String, default: '' }, decidedAt: Date
}, { timestamps: true });

const salaryStructureSchema = new Schema({ employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, unique: true }, basicSalary: { type: Number, required: true, min: 0 }, allowances: [{ name: String, amount: { type: Number, min: 0 } }], effectiveFrom: { type: Date, default: Date.now } }, { timestamps: true });
const payrollRunSchema = new Schema({ period: { type: String, required: true, match: /^\d{4}-\d{2}$/, unique: true, index: true }, status: { type: String, enum: ['draft', 'finalized'], default: 'draft', index: true }, preparedBy: { type: Schema.Types.ObjectId, ref: 'User' }, finalizedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null }, finalizedAt: Date, summary: { employeeCount: Number, grossTotal: Number, deductionsTotal: Number, netTotal: Number } }, { timestamps: true });
const payslipSchema = new Schema({ payrollRun: { type: Schema.Types.ObjectId, ref: 'PayrollRun', required: true, index: true }, employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true }, period: { type: String, required: true }, currency: { type: String, default: 'PKR' }, breakdown: { basic: Number, hra: Number, medical: Number, otherAllowances: Number, gross: Number, absenceDeduction: Number, unpaidLeaveDeduction: Number, tax: Number, deductions: Number, net: Number, workingDays: Number, absentDays: Number }, notifiedAt: Date }, { timestamps: true });
payslipSchema.index({ payrollRun: 1, employee: 1 }, { unique: true });

const announcementSchema = new Schema({ title: { type: String, required: true, trim: true, maxlength: 160 }, body: { type: String, required: true, maxlength: 5000 }, audience: { type: String, enum: ['all', 'hr', 'employee'], default: 'all' }, author: { type: Schema.Types.ObjectId, ref: 'User', required: true } }, { timestamps: true });
const notificationSchema = new Schema({ user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, type: { type: String, required: true }, title: { type: String, required: true }, message: { type: String, default: '' }, readAt: { type: Date, default: null }, link: { type: String, default: '' } }, { timestamps: true });
const auditLogSchema = new Schema({ actor: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true }, actorRole: String, action: { type: String, required: true, index: true }, entity: { type: String, required: true }, entityId: String, before: Schema.Types.Mixed, after: Schema.Types.Mixed, ip: String, createdAt: { type: Date, default: Date.now, immutable: true, index: true } }, { versionKey: false });
auditLogSchema.pre('findOneAndDelete', function rejectAuditMutation(next) { next(new Error('Audit logs are append-only.')); });

function getModel(name, schema) { return models[name] || model(name, schema); }
export const User = getModel('User', userSchema);
export const Employee = getModel('Employee', employeeSchema);
export const CompanySettings = getModel('CompanySettings', companySettingsSchema);
export const Department = getModel('Department', departmentSchema);
export const Designation = getModel('Designation', designationSchema);
export const LeaveType = getModel('LeaveType', leaveTypeSchema);
export const Holiday = getModel('Holiday', holidaySchema);
export const Attendance = getModel('Attendance', attendanceSchema);
export const AttendanceCorrectionRequest = getModel('AttendanceCorrectionRequest', attendanceCorrectionSchema);
export const LeaveRequest = getModel('LeaveRequest', leaveRequestSchema);
export const SalaryStructure = getModel('SalaryStructure', salaryStructureSchema);
export const PayrollRun = getModel('PayrollRun', payrollRunSchema);
export const Payslip = getModel('Payslip', payslipSchema);
export const Announcement = getModel('Announcement', announcementSchema);
export const Notification = getModel('Notification', notificationSchema);
export const AuditLog = getModel('AuditLog', auditLogSchema);
const aiLogSchema = new Schema({ user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, role: String, model: String, durationMs: Number, success: { type: Boolean, default: false }, toolsUsed: [String], errorCode: String, createdAt: { type: Date, default: Date.now, immutable: true } }, { versionKey: false });
export const AILog = getModel('AILog', aiLogSchema);

const liveSessionSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  coverUrl: { type: String, default: '' },
  coverPublicId: { type: String, default: '' },
  host: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  roomName: { type: String, required: true, unique: true, index: true },
  status: { type: String, enum: ['live', 'ended'], default: 'live' },
  startedAt: { type: Date, default: Date.now, immutable: true },
  endedAt: { type: Date, default: null }
}, { timestamps: true });
liveSessionSchema.index({ status: 1 }, { unique: true, partialFilterExpression: { status: 'live' } });
liveSessionSchema.index({ startedAt: -1 });

const liveMessageSchema = new Schema({
  session: { type: Schema.Types.ObjectId, ref: 'LiveSession', required: true, index: true },
  sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  senderName: { type: String, required: true, maxlength: 100 },
  senderRole: { type: String, required: true },
  senderAvatarUrl: { type: String, default: '' },
  text: { type: String, required: true, maxlength: 500 },
  createdAt: { type: Date, default: Date.now, immutable: true }
}, { versionKey: false });
liveMessageSchema.index({ session: 1, createdAt: 1 });
export const LiveSession = getModel('LiveSession', liveSessionSchema);
export const LiveMessage = getModel('LiveMessage', liveMessageSchema);
