import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { CompanySettings, User, Department, LeaveType } from '../models/index.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import { writeAudit } from '../utils/audit.js';
const router = Router();
let initializationInProgress = false;
const setupSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  adminName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  username: z.string().trim().regex(/^[a-zA-Z0-9._-]{3,30}$/, 'Use 3–30 letters, numbers, dots, underscores or hyphens.'),
  password: z.string().min(12).max(128).regex(/[A-Z]/, 'Add an uppercase letter.').regex(/[a-z]/, 'Add a lowercase letter.').regex(/[0-9]/, 'Add a number.')
});
router.get('/status', asyncHandler(async (_req, res) => {
  const initialized = Boolean(await User.exists({ role: 'admin' })) || Boolean(await CompanySettings.exists({ initialized: true }));
  res.json({ ok: true, data: { initialized } });
}));
router.post('/initialize', asyncHandler(async (req, res) => {
  const parsed = setupSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, 'Please correct the setup fields.', parsed.error.flatten().fieldErrors);
  if (initializationInProgress) throw new HttpError(409, 'Setup is already being initialized. Try again shortly.');
  initializationInProgress = true;
  try {
    if (await User.exists({ role: 'admin' }) || await CompanySettings.exists({ initialized: true })) throw new HttpError(409, 'Initial setup has already been completed.');
    const { companyName, adminName, email, username, password } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await User.create({ email, username, passwordHash, role: 'admin', profile: { fullName: adminName }, mustChangePassword: false });
    try {
      await CompanySettings.create({ singleton: 'company', initialized: true, name: companyName });
      await Department.create([{ name: 'General', description: 'Default department; you can rename or replace it.' }]);
      await LeaveType.create([
        { name: 'Annual leave', key: 'annual', annualQuota: 14, paid: true },
        { name: 'Sick leave', key: 'sick', annualQuota: 8, paid: true },
        { name: 'Casual leave', key: 'casual', annualQuota: 10, paid: true },
        { name: 'Unpaid leave', key: 'unpaid', annualQuota: null, paid: false }
      ]);
    } catch (error) {
      await User.deleteOne({ _id: admin._id });
      await CompanySettings.deleteOne({ singleton: 'company' });
      await Department.deleteOne({ name: 'General' });
      await LeaveType.deleteMany({ key: { $in: ['annual', 'sick', 'casual', 'unpaid'] } });
      throw error;
    }
    await writeAudit(req, 'setup.initialize', 'CompanySettings', 'company', null, { name: companyName, initialized: true });
    res.status(201).json({ ok: true, data: { initialized: true, admin: { email: admin.email, username: admin.username } } });
  } finally { initializationInProgress = false; }
}));
export default router;
