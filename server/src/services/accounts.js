import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { User, Employee, SalaryStructure } from '../models/index.js';

export function generateTemporaryPassword() {
  // Return the value only once in the authorized create response; never log it.
  return `${crypto.randomBytes(8).toString('hex')}A7!`;
}
export async function createEmployeeAccount({ userData, employeeData, createdBy }) {
  const temporaryPassword = employeeData.temporaryPassword || generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 12);
  let user;
  let employee;
  try {
    user = await User.create({
      email: userData.email.toLowerCase().trim(), username: userData.username.toLowerCase().trim(), passwordHash,
      role: 'employee', active: true, mustChangePassword: true,
      profile: { fullName: userData.fullName.trim(), phone: userData.phone || '', address: userData.address || '' }, createdBy
    });
    employee = await Employee.create({
      user: user._id, employeeCode: employeeData.employeeCode.toUpperCase().trim(),
      department: employeeData.department || null, designation: employeeData.designation || '',
      joiningDate: employeeData.joiningDate, employmentStatus: employeeData.employmentStatus || 'active', salary: Number(employeeData.salary || 0),
      emergencyContact: employeeData.emergencyContact || ''
    });
    if (employeeData.salary !== undefined && Number(employeeData.salary) >= 0) {
      await SalaryStructure.create({ employee: employee._id, basicSalary: Number(employeeData.salary), allowances: [], effectiveFrom: employeeData.joiningDate || new Date() });
    }
    await employee.populate('department', 'name');
    return { user, employee, temporaryPassword };
  } catch (error) {
    if (employee?._id) { await Employee.deleteOne({ _id: employee._id }).catch(() => {}); await SalaryStructure.deleteOne({ employee: employee._id }).catch(() => {}); }
    if (user?._id) await User.deleteOne({ _id: user._id }).catch(() => {});
    throw error;
  }
}
