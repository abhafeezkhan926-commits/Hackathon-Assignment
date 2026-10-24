export function annualTax(annualGross) {
  const income = Math.max(0, Number(annualGross) || 0);
  if (income <= 600000) return 0;
  if (income <= 1200000) return (income - 600000) * 0.05;
  if (income <= 2400000) return 30000 + (income - 1200000) * 0.15;
  if (income <= 3600000) return 210000 + (income - 2400000) * 0.25;
  return 510000 + (income - 3600000) * 0.35;
}
export function buildPayslip({ basicSalary, otherAllowances = 0, workingDays = 22, absentDays = 0, unpaidLeaveDays = 0 }) {
  const basic = round(basicSalary);
  const hra = round(basic * 0.4);
  const medical = round(basic * 0.1);
  const allowances = round(otherAllowances);
  const gross = round(basic + hra + medical + allowances);
  const perDay = workingDays > 0 ? gross / workingDays : 0;
  const absenceDeduction = round(Math.max(0, absentDays) * perDay);
  const unpaidLeaveDeduction = round(Math.max(0, unpaidLeaveDays) * perDay);
  const estimatedMonthlyTax = round(annualTax(gross * 12) / 12);
  const deductions = round(absenceDeduction + unpaidLeaveDeduction + estimatedMonthlyTax);
  return { basic, hra, medical, otherAllowances: allowances, gross, absenceDeduction, unpaidLeaveDeduction, tax: estimatedMonthlyTax, deductions, net: round(Math.max(0, gross - deductions)), workingDays, absentDays };
}
function round(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }
