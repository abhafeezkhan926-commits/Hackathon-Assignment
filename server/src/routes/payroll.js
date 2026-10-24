import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import { authenticate, allowRoles } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import { PayrollRun, Payslip, Employee, SalaryStructure, Attendance, LeaveRequest, CompanySettings, Holiday } from '../models/index.js';
import { notifyUsers } from '../utils/notify.js';
import { buildPayslip } from '../utils/payroll.js';
import { parseMonth } from '../utils/dates.js';
import { writeAudit } from '../utils/audit.js';
const router=Router(); router.use(authenticate);
function periodDates(period) { const {year,month,daysInMonth}=parseMonth(period); return {year,month,daysInMonth,start:new Date(Date.UTC(year,month-1,1)),end:new Date(Date.UTC(year,month-1,daysInMonth,23,59,59,999))}; }
function getWeekdayCount(year, month, daysInMonth, workingDays, holidays) { let count=0; for(let d=1;d<=daysInMonth;d++){const day=new Date(Date.UTC(year,month-1,d)); const key=day.toISOString().slice(0,10); if(workingDays.includes(day.getUTCDay())&&!holidays.has(key))count++;} return count; }
router.get('/runs', allowRoles('admin','hr'), asyncHandler(async (_req,res)=>{const items=await PayrollRun.find().populate('preparedBy','profile.fullName').populate('finalizedBy','profile.fullName').sort({period:-1}).limit(36); res.json({ok:true,data:{items}});}));
router.post('/runs/draft', allowRoles('admin','hr'), asyncHandler(async (req,res)=>{
  const parsed=z.object({period:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)}).safeParse(req.body); if(!parsed.success)throw new HttpError(422,'Choose a payroll period in YYYY-MM format.');
  const period=parsed.data.period; let run=await PayrollRun.findOne({period}); if(run?.status==='finalized')throw new HttpError(409,'This payroll period is finalized and locked.');
  const {year,month,daysInMonth,start,end}=periodDates(period); const settings=await CompanySettings.findOne({singleton:'company'}); const holidayRows=await Holiday.find({date:{$gte:start,$lte:end}}); const holidayKeys=new Set(holidayRows.map(h=>h.date.toISOString().slice(0,10)));
  const workingDays=getWeekdayCount(year,month,daysInMonth,settings?.workingDays||[1,2,3,4,5],holidayKeys);
  const employees=await Employee.find({employmentStatus:{$in:['active','on_leave']},joiningDate:{$lte:end}}).populate('user','active');
  const summaries=[]; let grossTotal=0,deductionsTotal=0,netTotal=0;
  for(const employee of employees){ if(!employee.user?.active)continue; const salary=await SalaryStructure.findOne({employee:employee._id}); const basic=salary?.basicSalary ?? employee.salary ?? 0; if(basic<=0)continue;
    const attendance=await Attendance.find({employee:employee._id,dayKey:{$gte:`${period}-01`,$lte:`${period}-${String(daysInMonth).padStart(2,'0')}`}}).select('status');
    const absentDays=attendance.filter(a=>a.status==='absent').length+attendance.filter(a=>a.status==='half_day').length*0.5;
    const unpaid=await LeaveRequest.find({employee:employee._id,leaveType:'unpaid',status:'approved',startDate:{$lte:end},endDate:{$gte:start}}).select('workingDays startDate endDate');
    const unpaidLeaveDays=unpaid.reduce((s,l)=>s+l.workingDays,0);
    const allowanceTotal=(salary?.allowances||[]).reduce((s,a)=>s+Number(a.amount||0),0);
    const breakdown=buildPayslip({basicSalary:basic,otherAllowances:allowanceTotal,workingDays:Math.max(workingDays,1),absentDays,unpaidLeaveDays});
    const joinedThisMonth=employee.joiningDate>start; if(joinedThisMonth){const actualDays=Math.max(0,daysInMonth-employee.joiningDate.getUTCDate()+1); const fraction=actualDays/daysInMonth; for(const key of ['basic','hra','medical','otherAllowances','gross','absenceDeduction','unpaidLeaveDeduction','tax','deductions','net'])breakdown[key]=Math.round(breakdown[key]*fraction*100)/100;}
    summaries.push({employee,breakdown}); grossTotal+=breakdown.gross; deductionsTotal+=breakdown.deductions; netTotal+=breakdown.net;
  }
  if(!run)run=await PayrollRun.create({period,status:'draft',preparedBy:req.user._id});
  const payslipDocs=summaries.map(({employee,breakdown})=>({payrollRun:run._id,employee:employee._id,period,currency:'PKR',breakdown}));
  await Payslip.deleteMany({payrollRun:run._id}); if(payslipDocs.length)await Payslip.insertMany(payslipDocs);
  run.summary={employeeCount:payslipDocs.length,grossTotal:round(grossTotal),deductionsTotal:round(deductionsTotal),netTotal:round(netTotal)}; run.preparedBy=req.user._id; await run.save();
  await writeAudit(req,'payroll.draft','PayrollRun',run._id,null,{period,employeeCount:payslipDocs.length,netTotal:run.summary.netTotal});
  res.status(201).json({ok:true,data:{run,payslipsCreated:payslipDocs.length},message:'Payroll draft recalculated from current employee records. Review before finalization.'});
}));
router.post('/runs/:id/finalize', allowRoles('admin'), asyncHandler(async(req,res)=>{
  const run=await PayrollRun.findById(req.params.id); if(!run)throw new HttpError(404,'Payroll run not found.'); if(run.status==='finalized')throw new HttpError(409,'Payroll is already finalized and locked.');
  run.status='finalized';run.finalizedBy=req.user._id;run.finalizedAt=new Date();await run.save();
  const slips=await Payslip.find({payrollRun:run._id}).populate('employee','user');
  const recipientIds=slips.map(slip=>slip.employee?.user).filter(Boolean);
  try { await notifyUsers(recipientIds,{type:'payslip_available',title:'Payslip available',message:`Your ${run.period} payslip is ready to download.`,link:'/payroll'}); }
  catch(error){ console.error('[notifications] Payslip delivery failed:',error.message); }
  await writeAudit(req,'payroll.finalize','PayrollRun',run._id,null,{period:run.period,summary:run.summary});res.json({ok:true,data:{run},message:'Payroll finalized and locked.'});
}));
router.get('/mine', allowRoles('employee'), asyncHandler(async(req,res)=>{const employee=await Employee.findOne({user:req.user._id});if(!employee)throw new HttpError(404,'Your employee profile has not been set up.');const slips=await Payslip.find({employee:employee._id}).populate({path:'payrollRun',match:{status:'finalized'}}).sort({period:-1});res.json({ok:true,data:{items:slips.filter(s=>s.payrollRun)}});}));
router.get('/payslips/:id/pdf', asyncHandler(async(req,res)=>{
  const slip=await Payslip.findById(req.params.id).populate('employee').populate('payrollRun');if(!slip)throw new HttpError(404,'Payslip not found.');
  if(req.user.role==='employee'){const own=await Employee.findOne({user:req.user._id});if(!own||String(own._id)!==String(slip.employee._id)||slip.payrollRun.status!=='finalized')throw new HttpError(403,'You cannot access this payslip.');} else if(!['admin','hr'].includes(req.user.role))throw new HttpError(403,'You cannot access this payslip.');
  if(slip.payrollRun.status!=='finalized')throw new HttpError(409,'Payslip is available only after payroll finalization.');
  res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="payslip-${slip.period}.pdf"`);
  const doc=new PDFDocument({size:'A4',margin:50});doc.pipe(res);doc.fontSize(24).fillColor('#172b4d').text('HCM Lite', {continued:true});doc.fontSize(10).fillColor('#6b7280').text('  |  PAYSLIP', {align:'right'});doc.moveDown();doc.fontSize(16).fillColor('#111827').text(`Payroll period: ${slip.period}`);doc.moveDown(0.5);doc.fontSize(11).fillColor('#374151').text(`Employee: ${slip.employee.employeeCode}`);doc.text(`Employee ID: ${slip.employee._id}`);doc.moveDown();doc.moveTo(50,doc.y).lineTo(545,doc.y).strokeColor('#dbe3ef').stroke();doc.moveDown();
  const rows=[['Basic salary',slip.breakdown.basic],['House rent allowance',slip.breakdown.hra],['Medical allowance',slip.breakdown.medical],['Other allowances',slip.breakdown.otherAllowances],['Gross salary',slip.breakdown.gross],['Absence deduction',-slip.breakdown.absenceDeduction],['Unpaid leave deduction',-slip.breakdown.unpaidLeaveDeduction],['Illustrative tax',-slip.breakdown.tax],['Total deductions',-slip.breakdown.deductions],['NET PAY',slip.breakdown.net]];
  for(const [label,value] of rows){doc.fontSize(label==='NET PAY'?13:11).fillColor(label==='NET PAY'?'#087f8c':'#263447').text(label,60,doc.y,{continued:true,width:330});doc.text(`${Number(value).toLocaleString('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2})} PKR`,{align:'right'});doc.moveDown(0.4);}doc.moveDown();doc.fontSize(9).fillColor('#6b7280').text('Generated from HCM Lite. Tax is an illustrative calculation based on the configured assignment slabs.');doc.end();
}));
router.get('/payslips', allowRoles('admin','hr'), asyncHandler(async(req,res)=>{const filter={};if(req.query.period)filter.period=String(req.query.period);const items=await Payslip.find(filter).populate('employee').populate({path:'payrollRun',select:'status finalizedAt'}).sort({period:-1}).limit(500);res.json({ok:true,data:{items}});}));
function round(n){return Math.round((n+Number.EPSILON)*100)/100;}
export default router;
