import { Router } from 'express';
import { authenticate, allowRoles } from '../middleware/auth.js';
import { asyncHandler } from '../utils/httpError.js';
import { AuditLog } from '../models/index.js';
const router=Router();router.use(authenticate,allowRoles('admin'));
router.get('/',asyncHandler(async(req,res)=>{const page=Math.max(1,Number(req.query.page)||1);const limit=Math.min(100,Math.max(1,Number(req.query.limit)||25));const filter={};if(req.query.action)filter.action=String(req.query.action).slice(0,100);const [items,total]=await Promise.all([AuditLog.find(filter).populate('actor','profile.fullName email role').sort({createdAt:-1}).skip((page-1)*limit).limit(limit),AuditLog.countDocuments(filter)]);res.json({ok:true,data:{items,total,page,limit,pages:Math.ceil(total/limit)}});}));
export default router;
