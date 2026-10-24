import { Router } from 'express';
import { z } from 'zod';
import { authenticate, allowRoles } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import { CompanySettings, Department, Designation, LeaveType, Holiday } from '../models/index.js';
import { writeAudit } from '../utils/audit.js';
const router = Router(); router.use(authenticate);
router.get('/settings', asyncHandler(async (_req,res) => {
  const settings = await CompanySettings.findOne({ singleton: 'company' });
  if (!settings) throw new HttpError(404, 'Company setup has not been completed.');
  res.json({ ok: true, data: { settings } });
}));
router.patch('/settings', allowRoles('admin'), asyncHandler(async (req,res) => {
  const schema = z.object({ name: z.string().trim().min(2).max(120).optional(), address: z.string().trim().max(300).optional(), timezone: z.string().trim().min(3).max(80).optional(), officeStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), officeEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), gracePeriodMinutes: z.number().int().min(0).max(180).optional(), workingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(), officeLatitude: z.number().min(-90).max(90).nullable().optional(), officeLongitude: z.number().min(-180).max(180).nullable().optional(), geofenceRadiusMeters: z.number().min(10).max(50000).optional(), policies: z.string().max(10000).optional(), leaveQuotas: z.object({ annual: z.number().min(0).max(365).optional(), sick: z.number().min(0).max(365).optional(), casual: z.number().min(0).max(365).optional() }).optional() }).strict();
  const parsed = schema.safeParse(req.body); if (!parsed.success) throw new HttpError(422, 'Please correct company settings.', parsed.error.flatten().fieldErrors);
  const settings = await CompanySettings.findOne({ singleton: 'company' }); if (!settings) throw new HttpError(404, 'Company setup has not been completed.');
  const before = { ...settings.toObject() }; Object.assign(settings, parsed.data); await settings.save();
  await writeAudit(req, 'company.settings_update', 'CompanySettings', settings._id, { name: before.name, officeStart: before.officeStart, gracePeriodMinutes: before.gracePeriodMinutes }, { name: settings.name, officeStart: settings.officeStart, gracePeriodMinutes: settings.gracePeriodMinutes });
  res.json({ ok: true, data: { settings }, message: 'Company settings saved.' });
}));
router.get('/departments', asyncHandler(async (_req,res) => { const items = await Department.find({ active: true }).sort({ name: 1 }); res.json({ ok: true, data: { items } }); }));
router.post('/departments', allowRoles('admin'), asyncHandler(async (req,res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(100), description: z.string().trim().max(500).optional() }).safeParse(req.body); if (!parsed.success) throw new HttpError(422, 'Please enter a department name.', parsed.error.flatten().fieldErrors);
  const item = await Department.create(parsed.data); await writeAudit(req,'department.create','Department',item._id,null,{ name:item.name }); res.status(201).json({ ok:true,data:{ department:item } });
}));
router.patch('/departments/:id', allowRoles('admin'), asyncHandler(async (req,res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(100).optional(), description: z.string().trim().max(500).optional(), active: z.boolean().optional() }).strict().safeParse(req.body); if (!parsed.success) throw new HttpError(422,'Please correct the department fields.',parsed.error.flatten().fieldErrors);
  const item = await Department.findById(req.params.id); if (!item) throw new HttpError(404,'Department not found.'); const before = { name:item.name, active:item.active }; Object.assign(item,parsed.data); await item.save(); await writeAudit(req,'department.update','Department',item._id,before,{name:item.name,active:item.active}); res.json({ok:true,data:{department:item}});
}));
router.get('/designations', asyncHandler(async (_req,res) => { const items = await Designation.find().populate('department','name').sort({ name:1 }); res.json({ok:true,data:{items}}); }));
router.post('/designations', allowRoles('admin'), asyncHandler(async (req,res) => { const parsed=z.object({name:z.string().trim().min(2).max(100),department:z.string().optional().nullable()}).safeParse(req.body); if(!parsed.success) throw new HttpError(422,'Enter a valid designation.',parsed.error.flatten().fieldErrors); const item=await Designation.create(parsed.data); await writeAudit(req,'designation.create','Designation',item._id); res.status(201).json({ok:true,data:{designation:item}}); }));
router.get('/leave-types', asyncHandler(async (_req,res) => { const items = await LeaveType.find({ active:true }).sort({ name:1 }); res.json({ok:true,data:{items}}); }));
router.post('/holidays', allowRoles('admin'), asyncHandler(async (req,res) => { const parsed=z.object({name:z.string().trim().min(2).max(120),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),notes:z.string().trim().max(500).optional()}).safeParse(req.body); if(!parsed.success) throw new HttpError(422,'Enter a valid holiday.',parsed.error.flatten().fieldErrors); const item=await Holiday.create({name:parsed.data.name,date:new Date(`${parsed.data.date}T00:00:00.000Z`),notes:parsed.data.notes||''}); await writeAudit(req,'holiday.create','Holiday',item._id); res.status(201).json({ok:true,data:{holiday:item}}); }));
router.get('/holidays', asyncHandler(async (req,res) => { const year=String(req.query.year||new Date().getFullYear()); const items=await Holiday.find({date:{$gte:new Date(`${year}-01-01T00:00:00Z`),$lte:new Date(`${year}-12-31T23:59:59Z`)}}).sort({date:1}); res.json({ok:true,data:{items}}); }));
export default router;
