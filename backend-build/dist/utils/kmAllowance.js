const r2 = (n) => Math.round(n * 100) / 100;
/** Largest Extra KM Allotted per day accepted (guards against typos such as an extra zero). */
export const MAX_EXTRA_KM = 10_000;
/** "90 KM per day", "90", 90, "1,200 km" -> the first positive number; anything else -> null. */
export function parseKmPerDay(v) {
    if (typeof v === "number")
        return Number.isFinite(v) && v > 0 ? r2(v) : null;
    if (typeof v !== "string")
        return null;
    const m = v.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/);
    const n = m ? Number(m[0]) : NaN;
    return Number.isFinite(n) && n > 0 ? r2(n) : null;
}
/** Allowance from its parts (also used by the frontend mirror and tests). */
export function kmAllowance(kmAllotted, campaignDays, extraKmAllowed, extraKmAllotted) {
    const extra = Number(extraKmAllotted);
    const extraPerDay = extraKmAllowed && Number.isFinite(extra) && extra > 0 ? r2(extra) : 0;
    const kmPerDay = parseKmPerDay(kmAllotted);
    const days = Number(campaignDays);
    const d = Number.isInteger(days) && days > 0 ? days : null;
    const allowedKmPerDay = kmPerDay === null ? null : r2(kmPerDay + extraPerDay);
    return {
        kmPerDay, extraKmAllowed, extraKmAllotted: extraPerDay, allowedKmPerDay, campaignDays: d,
        baseKm: kmPerDay !== null && d !== null ? r2(kmPerDay * d) : null,
        extraKmTotal: d !== null ? r2(extraPerDay * d) : null,
        totalAllowedKm: allowedKmPerDay !== null && d !== null ? r2(allowedKmPerDay * d) : null,
    };
}
/** Allowance of a project's details. Signage jobs have no KM allotment (null). */
export function kmAllowanceOf(projectType, details) {
    if (projectType !== "ROADSHOW")
        return null;
    const d = (details && typeof details === "object" ? details : {});
    return kmAllowance(d.kmAllotted, d.numberOfDays, d.extraKmAllowed === "YES", d.extraKmAllotted);
}
/** Actual KM against the allowance. Without a known allowance only the actual KM is reported. */
export function kmUsage(a, actualKm) {
    const actual = r2(Math.max(0, actualKm));
    const base = a ?? kmAllowance(null, null, false, 0);
    const known = base.baseKm !== null && base.totalAllowedKm !== null && base.extraKmTotal !== null;
    return {
        ...base, actualKm: actual,
        extraKmUsed: known ? r2(Math.min(Math.max(0, actual - base.baseKm), base.extraKmTotal)) : null,
        excessKm: known ? r2(Math.max(0, actual - base.totalAllowedKm)) : null,
    };
}
