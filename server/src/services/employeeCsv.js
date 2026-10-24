import { parse } from 'csv-parse/sync';
import { User, Employee, Department } from '../models/index.js';

const requiredHeaders = ['employeeCode','fullName','username','email','department','designation','joiningDate','basicSalary'];
const usernamePattern = /^[a-zA-Z0-9._-]{3,30}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function validateEmployeeCsv(buffer) {
  let rows;
  try { rows = parse(buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true, relax_column_count: false, max_record_size: 20000 }); }
  catch (error) { return { rows: [], validCount: 0, invalidCount: 1, error: `CSV parsing failed: ${error.message}`, departments: [] }; }
  if (!rows.length) return { rows: [], validCount: 0, invalidCount: 0, error: 'The CSV has no data rows.', departments: [] };
  if (rows.length > 500) return { rows: [], validCount: 0, invalidCount: rows.length, error: 'A single import is limited to 500 data rows.', departments: [] };
  const availableHeaders = Object.keys(rows[0] || {});
  const missingHeaders = requiredHeaders.filter(h => !availableHeaders.includes(h));
  if (missingHeaders.length) return { rows: [], validCount: 0, invalidCount: rows.length, error: `Missing CSV columns: ${missingHeaders.join(', ')}.`, departments: [] };

  const [departments, existingEmployees] = await Promise.all([Department.find().select('name active'), Employee.find().select('employeeCode')]);
  const departmentMap = new Map(departments.map(d => [d.name.trim().toLowerCase(), d]));
  const existingCodes = new Set(existingEmployees.map(e => e.employeeCode.toUpperCase()));
  const emailValues = rows.map(r => norm(r.email)).filter(Boolean);
  const usernameValues = rows.map(r => norm(r.username)).filter(Boolean);
  const existingUsers = await User.find({ $or: [{ email: { $in: emailValues } }, { username: { $in: usernameValues } }] }).select('email username');
  const existingEmails = new Set(existingUsers.map(u => norm(u.email)));
  const existingUsernames = new Set(existingUsers.map(u => norm(u.username)));
  const seenCodes = new Set(); const seenEmails = new Set(); const seenUsernames = new Set();
  const validated = [];

  for (let index=0; index<rows.length; index++) {
    const row = rows[index]; const line = index + 2; const errors = [];
    const employeeCode = String(row.employeeCode || '').trim().toUpperCase();
    const fullName = String(row.fullName || '').trim();
    const username = norm(row.username); const email = norm(row.email);
    const departmentName = String(row.department || '').trim(); const designation = String(row.designation || '').trim();
    const joiningDate = String(row.joiningDate || '').trim(); const rawSalary = String(row.basicSalary || '').trim(); const salary = Number(rawSalary);
    if (!employeeCode) errors.push({ field: 'employeeCode', reason: 'Employee code is required.' });
    else if (!/^[A-Z0-9_-]{2,30}$/.test(employeeCode)) errors.push({ field: 'employeeCode', reason: 'Use 2–30 letters, numbers, underscores or hyphens.' });
    if (employeeCode && (existingCodes.has(employeeCode) || seenCodes.has(employeeCode))) errors.push({ field: 'employeeCode', reason: 'Duplicate employee code already exists or repeats in this CSV.' });
    if (fullName.length < 2 || fullName.length > 100) errors.push({ field: 'fullName', reason: 'Full name is required and must be 2–100 characters.' });
    if (!usernamePattern.test(username)) errors.push({ field: 'username', reason: 'Username must be 3–30 letters, numbers, dots, underscores or hyphens.' });
    if (username && (existingUsernames.has(username) || seenUsernames.has(username))) errors.push({ field: 'username', reason: 'Username already exists or repeats in this CSV.' });
    if (!emailPattern.test(email) || email.length > 254) errors.push({ field: 'email', reason: 'Provide a valid email address (maximum 254 characters).' });
    if (email && (existingEmails.has(email) || seenEmails.has(email))) errors.push({ field: 'email', reason: 'Email already exists or repeats in this CSV.' });
    let department = null;
    if (departmentName) { department = departmentMap.get(departmentName.toLowerCase()); if (!department || !department.active) errors.push({ field: 'department', reason: `Unknown or inactive department: ${departmentName}.` }); }
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(joiningDate) || !isIsoDate(joiningDate)) errors.push({ field: 'joiningDate', reason: 'Use a valid ISO date in YYYY-MM-DD format.' });
    if (!rawSalary || !Number.isFinite(salary) || salary <= 0) errors.push({ field: 'basicSalary', reason: 'Basic salary must be a number greater than zero.' });
    const data = { employeeCode, fullName, username, email, department: department?._id || null, departmentName: department?.name || '', designation, joiningDate, salary };
    validated.push({ row: line, valid: errors.length === 0, errors, data: errors.length ? undefined : data });
    if (employeeCode) seenCodes.add(employeeCode); if (username) seenUsernames.add(username); if (email) seenEmails.add(email);
  }
  const validCount = validated.filter(r => r.valid).length;
  return { rows: validated, validCount, invalidCount: validated.length - validCount, error: '', departments: departments.map(d => d.name) };
}
function norm(value) { return String(value || '').trim().toLowerCase(); }
function isIsoDate(value) { const date = new Date(`${value}T00:00:00.000Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value; }
