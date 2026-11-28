const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(value: unknown): value is string {
  if (typeof value !== "string" || !YMD.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1) return false;
  return new Date(Date.UTC(year, month - 1, day)).getUTCDate() === day;
}

export function todayIst(now = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

export function inYmdRange(value: string, from: string, to: string): boolean {
  return value >= from && value <= to;
}

/** The later / earlier of two optional YYYY-MM-DD bounds (blank values are ignored). Used for calendar min / max. */
export const laterOf = (...d: (string | null | undefined)[]): string | undefined =>
  d.filter((x): x is string => isYmd(x)).sort().pop();
export const earlierOf = (...d: (string | null | undefined)[]): string | undefined =>
  d.filter((x): x is string => isYmd(x)).sort()[0];

/**
 * A dependent date after its parent changed: kept when it still fits [min, max], otherwise cleared ("") so the user
 * re-picks it. Never silently moved to another date.
 */
export function keepInRange(value: string, min?: string | null, max?: string | null): string {
  if (!value || !isYmd(value)) return value;
  if (isYmd(min) && value < min) return "";
  if (isYmd(max) && value > max) return "";
  return value;
}

export function addDaysYmd(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Campaign start date window (same as the server): today back to this many days before today. */
export const START_DATE_PAST_DAYS = 7;
export const earliestStartYmd = (today = todayIst()) => addDaysYmd(today, -START_DATE_PAST_DAYS);
/** Error for a campaign start date outside [today - 7 days, today], or "" when it fits. */
export function startDateError(v: string, label: string, today = todayIst()): string {
  if (v > today) return `${label} cannot be in the future`;
  if (v < earliestStartYmd(today)) return `${label} cannot be more than ${START_DATE_PAST_DAYS} days in the past`;
  return "";
}

export const isSunday = (v: string): boolean => isYmd(v) && new Date(`${v}T00:00:00Z`).getUTCDay() === 0;
/** Sunday Halt (same rule as the server): the Reporting Date and the End Date cannot be a Sunday. "" when the date is allowed. */
export const sundayHaltError = (v: string, label: string, sundayHalt: boolean): string =>
  sundayHalt && isSunday(v) ? `${label} cannot be a Sunday when Sunday Halt is Yes` : "";
