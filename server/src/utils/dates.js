export function dayKeyInTimezone(date = new Date(), timezone = 'Asia/Karachi') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
export function dateAtDayStart(dayKey) { return new Date(`${dayKey}T00:00:00.000Z`); }
export function countWorkingDays(startDate, endDate, workingDays = [1,2,3,4,5], holidayKeys = new Set()) {
  const start = new Date(startDate); const end = new Date(endDate);
  start.setUTCHours(0,0,0,0); end.setUTCHours(0,0,0,0);
  let count = 0;
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const key = cursor.toISOString().slice(0,10);
    if (workingDays.includes(cursor.getUTCDay()) && !holidayKeys.has(key)) count += 1;
  }
  return count;
}
export function monthKey(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`; }
export function parseMonth(period) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period || '')) throw Object.assign(new Error('Period must be in YYYY-MM format.'), { status: 422 });
  const [year, month] = period.split('-').map(Number);
  return { year, month, daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate() };
}
