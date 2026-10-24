import 'dotenv/config';
import { createServer } from 'node:http';
import app from './app.js';
import { connectDatabase } from './config/db.js';
import { initRealtime, closeRealtime } from './realtime.js';
import bcrypt from 'bcryptjs';
import { User, CompanySettings, Department, LeaveType } from './models/index.js';

async function bootstrapFromEnvironment() {
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) return;
  if (process.env.ADMIN_PASSWORD.length < 12 || !/[A-Z]/.test(process.env.ADMIN_PASSWORD) || !/[a-z]/.test(process.env.ADMIN_PASSWORD) || !/[0-9]/.test(process.env.ADMIN_PASSWORD)) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters and include uppercase, lowercase and a number.');
  }
  if (await User.exists({ role: 'admin' })) return;
  const email = process.env.ADMIN_EMAIL.toLowerCase().trim();
  const username = (process.env.ADMIN_USERNAME || email.split('@')[0]).toLowerCase().trim();
  await User.create({ email, username, passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD, 12), role: 'admin', profile: { fullName: process.env.ADMIN_NAME || 'Administrator' }, mustChangePassword: false });
  await CompanySettings.findOneAndUpdate({ singleton: 'company' }, { $setOnInsert: { initialized: true, name: process.env.COMPANY_NAME || 'My Company' } }, { upsert: true, new: true });
  await Department.updateOne({ name: 'General' }, { $setOnInsert: { name: 'General', description: 'Default department.' } }, { upsert: true });
  for (const item of [{name:'Annual leave',key:'annual',annualQuota:14,paid:true},{name:'Sick leave',key:'sick',annualQuota:8,paid:true},{name:'Casual leave',key:'casual',annualQuota:10,paid:true},{name:'Unpaid leave',key:'unpaid',annualQuota:null,paid:false}]) await LeaveType.updateOne({key:item.key},{$setOnInsert:item},{upsert:true});
  console.log(`Initial Admin account created for ${email}.`);
}

let server;
async function start() {
  const port = Number(process.env.PORT || 5000);
  if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) throw new Error('Set JWT_SECRET to a random value of at least 32 characters before production startup.');
  await connectDatabase();
  await bootstrapFromEnvironment();
  server = createServer(app);
  initRealtime(server);
  server.listen(port, () => console.log(`HCM Lite API listening on port ${port}`));
}
async function shutdown(signal) {
  console.log(`${signal} received; shutting down gracefully.`);
  closeRealtime();
  if (server) server.close(async () => { const { default: mongoose } = await import('mongoose'); await mongoose.disconnect(); process.exit(0); });
  else process.exit(0);
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
start().catch(error => { console.error('[startup]', error.message); process.exit(1); });
