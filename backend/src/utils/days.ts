/** Inclusive day count between two YYYY-MM-DD dates. If sundayHalt, Sundays are excluded. */
export function countDays(start: string, end: string, sundayHalt: boolean): number {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return 0;
  let count = 0;
  for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    if (sundayHalt && d.getUTCDay() === 0) continue;
    count++;
  }
  return count;
}
