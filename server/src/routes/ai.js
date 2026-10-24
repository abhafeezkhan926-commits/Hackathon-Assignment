import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import { User, Employee, Attendance, LeaveRequest, PayrollRun, Payslip, CompanySettings, Department, AILog } from '../models/index.js';
import { dayKeyInTimezone, countWorkingDays } from '../utils/dates.js';
import { Holiday } from '../models/index.js';
const router=Router();router.use(authenticate);
const aiLimiter=rateLimit({windowMs:60*60*1000,limit:Math.max(1,Number(process.env.AI_REQUESTS_PER_HOUR)||20),standardHeaders:true,legacyHeaders:false,keyGenerator:(req)=>String(req.user?._id||req.ip),message:{ok:false,error:{message:'You have reached the AI assistant hourly limit. Please try again later.'}}});
const requestSchema=z.object({message:z.string().trim().min(2).max(2000)});
const toolDefinitions=[
 {type:'function',function:{name:'get_headcount',description:'Get current active headcount and department headcounts. Admin or HR only.',parameters:{type:'object',properties:{},additionalProperties:false}}},
 {type:'function',function:{name:'get_attendance_summary',description:'Get saved attendance counts for a day. Admin or HR only.',parameters:{type:'object',properties:{dayKey:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'}},required:['dayKey'],additionalProperties:false}}},
 {type:'function',function:{name:'get_late_comers',description:'Get employees marked late on a date. Admin or HR only.',parameters:{type:'object',properties:{dayKey:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'}},required:['dayKey'],additionalProperties:false}}},
 {type:'function',function:{name:'get_leave_summary',description:'Get counts of leave requests by status. Admin or HR only.',parameters:{type:'object',properties:{},additionalProperties:false}}},
 {type:'function',function:{name:'get_my_leave_balance',description:'Get the signed-in employee own leave requests and configured quotas.',parameters:{type:'object',properties:{},additionalProperties:false}}},
 {type:'function',function:{name:'get_payroll_summary',description:'Get totals from finalized payroll runs. Admin or HR only.',parameters:{type:'object',properties:{period:{type:'string',pattern:'^\\d{4}-(0[1-9]|1[0-2])$'}},additionalProperties:false}}},
 {type:'function',function:{name:'search_employees',description:'Search the employee directory for authorized Admin/HR requests. Do not reveal salaries via search.',parameters:{type:'object',properties:{query:{type:'string',minLength:1,maxLength:80}},required:['query'],additionalProperties:false}}}
];
router.post('/parse-leave',aiLimiter,asyncHandler(async(req,res)=>{
 if(req.user.role!=='employee')throw new HttpError(403,'Smart leave suggestions are available to employee accounts.');
 const parsed=z.object({text:z.string().trim().min(4).max(1500)}).safeParse(req.body);if(!parsed.success)throw new HttpError(422,'Describe the time off you are requesting.',parsed.error.flatten().fieldErrors);
 const employee=await Employee.findOne({user:req.user._id});if(!employee)throw new HttpError(404,'Your employee profile has not been set up.');
 if(!process.env.AI_API_KEY||!process.env.AI_API_BASE_URL||!process.env.AI_MODEL){res.json({ok:true,data:{suggestion:null,warnings:[],generatedByAI:false,message:'AI is not configured. Complete the standard leave form manually.'}});return;}
 const settings=await CompanySettings.findOne({singleton:'company'});const timezone=settings?.timezone||'Asia/Karachi';const today=dayKeyInTimezone(new Date(),timezone);
 let raw;
 try{
  const response=await fetch(process.env.AI_API_BASE_URL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.AI_API_KEY}`},body:JSON.stringify({model:process.env.AI_MODEL,messages:[{role:'system',content:`Convert an employee's natural language leave request into one JSON object only. Current company-local date is ${today} in timezone ${timezone}. Fields: leaveType (one of annual, sick, casual, unpaid, other), startDate (YYYY-MM-DD), endDate (YYYY-MM-DD), reason (brief faithful description). Infer relative dates from the current date. Never invent a reason the employee did not suggest. If dates cannot be confidently inferred, use empty strings for startDate and endDate. Do not approve or submit anything.`},{role:'user',content:parsed.data.text}],response_format:{type:'json_object'},temperature:0.1}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`provider_${response.status}`);const payload=await response.json();raw=payload.choices?.[0]?.message?.content;
 }catch{res.json({ok:true,data:{suggestion:null,warnings:[],generatedByAI:false,message:'AI is unavailable. Complete the standard leave form manually.'}});return;}
 let obj;try{obj=JSON.parse(String(raw||'').replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch{res.json({ok:true,data:{suggestion:null,warnings:[],generatedByAI:false,message:'AI could not prepare a reliable structured suggestion. Complete the standard leave form manually.'}});return;}
 const suggestionSchema=z.object({leaveType:z.enum(['annual','sick','casual','unpaid','other']),startDate:z.string().refine(v=>!v||/^\d{4}-\d{2}-\d{2}$/.test(v)),endDate:z.string().refine(v=>!v||/^\d{4}-\d{2}-\d{2}$/.test(v)),reason:z.string().trim().min(1).max(1000)});
 const validated=suggestionSchema.safeParse(obj);if(!validated.success){res.json({ok:true,data:{suggestion:null,warnings:[],generatedByAI:false,message:'AI could not prepare a reliable structured suggestion. Complete the standard leave form manually.'}});return;}
 const suggestion=validated.data;const warnings=[];
 if(suggestion.startDate&&suggestion.endDate){
  const isoValid=v=>{const d=new Date(`${v}T00:00:00.000Z`);return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;};
  if(!isoValid(suggestion.startDate)||!isoValid(suggestion.endDate)||suggestion.startDate>suggestion.endDate){warnings.push('The suggested dates are invalid or out of order. Please review them before submitting.');}
  else if(suggestion.startDate.slice(0,4)!==suggestion.endDate.slice(0,4)){warnings.push('Requests must stay within one calendar year. Split a cross-year request into separate forms.');}
  else {
   const holidays=await Holiday.find({date:{$gte:new Date(`${suggestion.startDate}T00:00:00Z`),$lte:new Date(`${suggestion.endDate}T23:59:59Z`)}}).select('date');const holidayKeys=new Set(holidays.map(h=>h.date.toISOString().slice(0,10)));
   const workingDays=countWorkingDays(suggestion.startDate,suggestion.endDate,settings?.workingDays||[1,2,3,4,5],holidayKeys);
   if(!workingDays)warnings.push('The suggested range contains no working days after weekends and public holidays are excluded.');
   const overlap=await LeaveRequest.findOne({employee:employee._id,status:{$in:['pending','approved']},startDate:{$lte:new Date(`${suggestion.endDate}T23:59:59.999Z`)},endDate:{$gte:new Date(`${suggestion.startDate}T00:00:00.000Z`)}});
   if(overlap)warnings.push('This date range overlaps an existing pending or approved leave request.');
   if(['annual','sick','casual'].includes(suggestion.leaveType)){
    const quota=settings?.leaveQuotas?.[suggestion.leaveType]??({annual:14,sick:8,casual:10}[suggestion.leaveType]);
    const usedRows=await LeaveRequest.find({employee:employee._id,leaveType:suggestion.leaveType,status:{$in:['approved','pending']},startDate:{$gte:new Date(`${suggestion.startDate.slice(0,4)}-01-01T00:00:00Z`),$lte:new Date(`${suggestion.startDate.slice(0,4)}-12-31T23:59:59.999Z`)}}).select('workingDays');
    const used=usedRows.reduce((sum,row)=>sum+row.workingDays,0);if(workingDays+used>quota)warnings.push(`This may exceed the ${suggestion.leaveType} allowance: ${Math.max(0,quota-used)} day(s) remain before this request.`);
   }
   suggestion.workingDays=workingDays;
  }
 }else warnings.push('AI did not identify both dates. Select the dates manually.');
 res.json({ok:true,data:{suggestion,warnings,generatedByAI:true,message:'Review every suggested field before submitting. This has not created or approved a leave request.'}});
}));

router.post('/chat',aiLimiter,asyncHandler(async(req,res)=>{
 const parsed=requestSchema.safeParse(req.body);if(!parsed.success)throw new HttpError(422,'Enter a question for the assistant.',parsed.error.flatten().fieldErrors);
 if(!process.env.AI_API_KEY||!process.env.AI_API_BASE_URL||!process.env.AI_MODEL){res.json({ok:true,data:{answer:'The AI assistant is currently unavailable because its provider is not configured. You can continue using the HR modules normally.',generatedByAI:false,toolsUsed:[]}});return;}
 const started=Date.now();const toolsUsed=[];let success=false;let errorCode='';
 try{
   const allowedTools=toolDefinitions.filter(t=>{
     const name=t.function.name;if(name==='get_my_leave_balance')return req.user.role==='employee';return req.user.role==='admin'||req.user.role==='hr';
   });
   const history=[{role:'system',content:`You are HCM Lite's HR assistant. Current date: ${new Date().toISOString().slice(0,10)}. Caller role: ${req.user.role}. Use tools for factual company data. Never invent numbers, employee names, salary or policies. Do not reveal data beyond the caller role. Employees can only receive their own personal data and general company policies. State clearly when information is missing. Do not make approvals or change records.`},{role:'user',content:parsed.data.message}];
   let answer='';
   for(let round=0;round<3;round++){
     const response=await fetch(process.env.AI_API_BASE_URL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.AI_API_KEY}`},body:JSON.stringify({model:process.env.AI_MODEL,messages:history,tools:allowedTools,tool_choice:allowedTools.length?'auto':'none',temperature:0.2}),signal:AbortSignal.timeout(15000)});
     if(!response.ok)throw Object.assign(new Error(`AI provider returned ${response.status}`),{code:`provider_${response.status}`});
     const payload=await response.json();const message=payload.choices?.[0]?.message;if(!message)throw Object.assign(new Error('AI provider response had no message.'),{code:'invalid_response'});
     history.push(message);
     if(message.tool_calls?.length){
       for(const call of message.tool_calls.slice(0,5)){
         let args={};try{args=JSON.parse(call.function.arguments||'{}');}catch{history.push({role:'tool',tool_call_id:call.id,content:JSON.stringify({error:'Invalid tool arguments. Please retry with valid JSON.'})});continue;}
         let result;try{result=await executeTool(call.function.name,args,req.user);}catch(error){result={error:error.message||'Tool could not be completed.'};}
         toolsUsed.push(call.function.name);history.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)});
       }
       continue;
     }
     answer=String(message.content||'').trim();break;
   }
   if(!answer)answer='I could not produce a reliable answer from the available data. Please try asking in a different way.';
   success=true;res.json({ok:true,data:{answer,generatedByAI:true,toolsUsed}});
 }catch(error){errorCode=error.code||'provider_unavailable';res.json({ok:true,data:{answer:'The AI assistant is temporarily unavailable. Your saved HR data and normal application workflows are unaffected. Please try again later.',generatedByAI:false,toolsUsed:[]}});}
 finally{await AILog.create({user:req.user._id,role:req.user.role,model:process.env.AI_MODEL,durationMs:Date.now()-started,success,toolsUsed,errorCode}).catch(()=>{});}
}));
async function executeTool(name,args,user){
 const privileged=['admin','hr'].includes(user.role);
 if(name!=='get_my_leave_balance'&&!privileged)throw new HttpError(403,'This data is not available for your role.');
 if(name==='get_headcount'){
   const [active,total,groups]=await Promise.all([Employee.countDocuments({employmentStatus:'active'}),Employee.countDocuments(),Employee.aggregate([{$match:{employmentStatus:'active'}},{$group:{_id:'$department',count:{$sum:1}}}])]);
   const depts=await Department.find({_id:{$in:groups.map(g=>g._id).filter(Boolean)}}).select('name');const map=new Map(depts.map(d=>[String(d._id),d.name]));return {active,total,departmentHeadcount:groups.map(g=>({department:g._id?map.get(String(g._id))||'Unknown':'Unassigned',count:g.count}))};
 }
 if(name==='get_attendance_summary'){
   const dayKey=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(args.dayKey);const records=await Attendance.find({dayKey}).select('status');return {dayKey,recordedAttendance:records.length,present:records.filter(r=>r.status==='present').length,late:records.filter(r=>r.status==='late').length,halfDay:records.filter(r=>r.status==='half_day').length,onLeave:records.filter(r=>r.status==='on_leave').length,note:'Counts include recorded attendance only; no missing records have been fabricated.'};
 }
 if(name==='get_late_comers'){
   const dayKey=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(args.dayKey);const records=await Attendance.find({dayKey,status:'late'}).populate({path:'employee',populate:{path:'user',select:'profile.fullName'}}).limit(100);return {dayKey,lateCount:records.length,employees:records.map(r=>({employeeCode:r.employee?.employeeCode||'N/A',name:r.employee?.user?.profile?.fullName||'Unknown'}))};
 }
 if(name==='get_leave_summary'){
   const groups=await LeaveRequest.aggregate([{$group:{_id:'$status',count:{$sum:1},days:{$sum:'$workingDays'}}}]);return {leaveRequests:groups.map(g=>({status:g._id,count:g.count,days:g.days}))};
 }
 if(name==='get_my_leave_balance'){
   if(user.role!=='employee')throw new HttpError(403,'This tool is for employees.');const employee=await Employee.findOne({user:user._id});if(!employee) return {error:'Your employee profile is not configured.'};const settings=await CompanySettings.findOne({singleton:'company'});const year=new Date().getFullYear();const rows=await LeaveRequest.find({employee:employee._id,startDate:{$gte:new Date(`${year}-01-01T00:00:00Z`),$lte:new Date(`${year}-12-31T23:59:59Z`)},status:'approved'});const used=Object.fromEntries(['annual','sick','casual','unpaid'].map(type=>[type,rows.filter(r=>r.leaveType===type).reduce((s,r)=>s+r.workingDays,0)]));return {year,quotas:settings?.leaveQuotas||{annual:14,sick:8,casual:10},approvedLeaveUsed:used};
 }
 if(name==='get_payroll_summary'){
   const filter={status:'finalized'};if(args.period)filter.period=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(args.period);const runs=await PayrollRun.find(filter).sort({period:-1}).limit(12).select('period summary');return {runs:runs.map(r=>({period:r.period,...r.summary})),note:'Only finalized runs are included.'};
 }
 if(name==='search_employees'){
   const q=z.string().trim().min(1).max(80).parse(args.query);const safe=q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const users=await User.find({$or:[{email:new RegExp(safe,'i')},{username:new RegExp(safe,'i')},{'profile.fullName':new RegExp(safe,'i')}] }).select('_id email username profile').limit(20);const employees=await Employee.find({user:{$in:users.map(u=>u._id)}}).populate('department','name');const map=new Map(users.map(u=>[String(u._id),u]));return {employees:employees.map(e=>({employeeCode:e.employeeCode,name:map.get(String(e.user))?.profile?.fullName||'Unknown',department:e.department?.name||'Unassigned',designation:e.designation,status:e.employmentStatus}))};
 }
 throw new HttpError(400,'Unknown assistant tool.');
}
export default router;
