import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import { User, Employee, Attendance, AttendanceCorrectionRequest, LeaveRequest, PayrollRun, Payslip, Department, Notification, Announcement, AuditLog, CompanySettings } from '../models/index.js';
import { dayKeyInTimezone } from '../utils/dates.js';
const router=Router();router.use(authenticate);
router.get('/',asyncHandler(async(req,res)=>{
 const settings=await CompanySettings.findOne({singleton:'company'});const today=dayKeyInTimezone(new Date(),settings?.timezone||'Asia/Karachi');
 if(req.user.role==='employee'){
   const employee=await Employee.findOne({user:req.user._id});if(!employee)throw new HttpError(404,'Your employee profile has not been set up.');
   const [todayAttendance,attendance,leaveRequests,payslip,unread,announcements]=await Promise.all([
     Attendance.findOne({employee:employee._id,dayKey:today}),Attendance.find({employee:employee._id,dayKey:{$gte:`${new Date().getFullYear()}-01-01`}}).sort({dayKey:-1}).limit(100),LeaveRequest.find({employee:employee._id,startDate:{$gte:new Date(`${new Date().getFullYear()}-01-01T00:00:00Z`)}}).sort({createdAt:-1}),Payslip.findOne({employee:employee._id}).populate({path:'payrollRun',match:{status:'finalized'}}).sort({period:-1}),Notification.countDocuments({user:req.user._id,readAt:null}),Announcement.find({audience:{$in:['all','employee']}}).sort({createdAt:-1}).limit(5)
   ]);
   const weekStart=new Date();weekStart.setDate(weekStart.getDate()-6);const hours=attendance.filter(a=>new Date(a.dayKey)>=new Date(weekStart.toISOString().slice(0,10))).reduce((s,a)=>s+(a.hoursWorked||0),0);
   const lateCount=attendance.filter(a=>a.status==='late').length;const pending=leaveRequests.filter(l=>l.status==='pending').length;const leaveUsed=leaveRequests.filter(l=>l.status==='approved'&&l.leaveType!=='unpaid').reduce((s,l)=>s+l.workingDays,0);
   const leaveBalances=Object.fromEntries(['annual','sick','casual','unpaid'].map(type=>[type,{used:leaveRequests.filter(l=>l.status==='approved'&&l.leaveType===type).reduce((sum,l)=>sum+l.workingDays,0)}]));
   res.json({ok:true,data:{role:'employee',todayAttendance,weekHours:Math.round(hours*100)/100,lateCount,pendingLeaveRequests:pending,leaveUsed,leaveBalances,leaveQuotas:settings?.leaveQuotas||{annual:14,sick:8,casual:10},latestPayslip:payslip?.payrollRun?payslip:null,unreadNotifications:unread,attendanceRecent:attendance.slice(0,7),leaveRecent:leaveRequests.slice(0,5),announcements}});return;
 }
 const [activeEmployees,allEmployees,activeUsers,pendingLeaves,todayAttendance,departments,latestRun,recentAudit,unreadCorrections]=await Promise.all([
   Employee.countDocuments({employmentStatus:'active'}),Employee.countDocuments(),User.countDocuments({active:true}),LeaveRequest.countDocuments({status:'pending'}),Attendance.find({dayKey:today}).populate({path:'employee',populate:{path:'user',select:'profile.fullName'}}),Department.find({active:true}),PayrollRun.findOne({status:'finalized'}).sort({period:-1}),req.user.role==='admin'?AuditLog.find().sort({createdAt:-1}).limit(6).populate('actor','profile.fullName'):Promise.resolve([]), AttendanceCorrectionRequest.countDocuments({status:'pending'})
 ]);
 const grouped=await Employee.aggregate([{$match:{employmentStatus:{$in:['active','on_leave']}}},{$group:{_id:'$department',headcount:{$sum:1},salary:{$sum:'$salary'}}}]);
 const departmentNameMap=new Map(departments.map(d=>[String(d._id),d.name]));
 const departmentStats=grouped.map(g=>({department:g._id?departmentNameMap.get(String(g._id))||'Unknown department':'unassigned',headcount:g.headcount,payrollCost:g.salary}));
 const attendanceCounts={present:todayAttendance.filter(a=>a.status==='present').length,late:todayAttendance.filter(a=>a.status==='late').length,halfDay:todayAttendance.filter(a=>a.status==='half_day').length,checkedOut:todayAttendance.filter(a=>a.checkOut).length};
 const finalizedRuns=await PayrollRun.find({status:'finalized'}).sort({period:-1}).limit(12).select('period summary');
 const turnoverThisYear=await Employee.countDocuments({employmentStatus:'terminated',updatedAt:{$gte:new Date(new Date().getFullYear(),0,1)}});
 const avg=await Employee.aggregate([{$match:{employmentStatus:'active',salary:{$gt:0}}},{$group:{_id:null,avg:{$avg:'$salary'}}}]);
 res.json({ok:true,data:{role:req.user.role,activeHeadcount:activeEmployees,totalEmployees:allEmployees,activeUsers,pendingLeaveRequests:pendingLeaves,pendingAttendanceCorrections:unreadCorrections,attendanceCounts,departmentStats,latestPayroll:latestRun,recentPayroll:finalizedRuns,attritionYearToDate:turnoverThisYear,averageSalary:Math.round(avg[0]?.avg||0),recentAudit,departments:departments.map(d=>({id:d._id,name:d.name})),dataNote:'Metrics are calculated from saved application records. Absence for a day without attendance is not written as a fabricated record.'}});
}));
export default router;
