import test from 'node:test';
import assert from 'node:assert/strict';
import { annualTax, buildPayslip } from '../src/utils/payroll.js';
import { countWorkingDays, parseMonth } from '../src/utils/dates.js';

test('annual tax slabs are continuous at the stated thresholds', () => {
  assert.equal(annualTax(600000), 0);
  assert.equal(annualTax(600001), 0.05);
  assert.equal(annualTax(1200000), 30000);
  assert.equal(annualTax(1200001), 30000.15);
  assert.equal(annualTax(2400000), 210000);
  assert.equal(annualTax(2400001), 210000.25);
  assert.equal(annualTax(3600000), 510000);
  assert.equal(annualTax(3600001), 510000.35);
});

test('payslip includes 40% HRA, 10% medical, absence and unpaid-leave deductions', () => {
  const result = buildPayslip({ basicSalary: 100000, otherAllowances: 5000, workingDays: 20, absentDays: 1, unpaidLeaveDays: 1 });
  assert.equal(result.hra, 40000);
  assert.equal(result.medical, 10000);
  assert.equal(result.gross, 155000);
  assert.equal(result.absenceDeduction, 7750);
  assert.equal(result.unpaidLeaveDeduction, 7750);
  assert.equal(result.tax, 10750);
  assert.equal(result.net, 128750);
});

test('working-day count excludes weekends and configured holidays', () => {
  assert.equal(countWorkingDays('2026-10-05', '2026-10-09', [1,2,3,4,5], new Set()), 5);
  assert.equal(countWorkingDays('2026-10-03', '2026-10-11', [1,2,3,4,5], new Set(['2026-10-06'])), 4);
});

test('payroll period parser rejects malformed periods and handles month length', () => {
  assert.deepEqual(parseMonth('2026-02'), { year: 2026, month: 2, daysInMonth: 28 });
  assert.equal(parseMonth('2024-02').daysInMonth, 29);
  assert.throws(() => parseMonth('2026-13'));
  assert.throws(() => parseMonth('October 2026'));
});
