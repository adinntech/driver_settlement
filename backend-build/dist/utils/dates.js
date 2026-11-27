/**
 * Calendar dates are plain "YYYY-MM-DD" strings in the business timezone (IST). They are compared as strings and never
 * passed through `new Date(ymd)` + local getters, which is what shifts dates by one day in other timezones.
 */
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const IST_OFFSET_MS = 5.5 * 3600_000;
/** A real calendar date in YYYY-MM-DD form (rejects 2026-02-31, 2026-13-01). */
export function isYmd(value) {
    if (typeof value !== "string" || !YMD.test(value))
        return false;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    if (month < 1 || month > 12 || day < 1)
        return false;
    return new Date(Date.UTC(year, month - 1, day)).getUTCDate() === day;
}
/** Today in India as YYYY-MM-DD, independent of the server's timezone. */
export function todayIst(now = new Date()) {
    return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
/** The IST calendar date of an instant (e.g. "2026-03-31T18:30:00.000Z" -> "2026-04-01"). Plain YMD strings pass through. */
export function istDateOf(value) {
    if (isYmd(value))
        return value;
    if (typeof value !== "string" && !(value instanceof Date))
        return null;
    const t = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isNaN(t) ? null : new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
}
export function inYmdRange(value, from, to) {
    return value >= from && value <= to;
}
export function addDaysYmd(ymd, days) {
    return new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
