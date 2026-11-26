/**
 * KM allowance of a RoadShow campaign vehicle (one place, so budget, payments, settlement and reports use the same rule).
 * Everything is on a PER DAY basis:
 *   Regular KM / day         = the number in the RSOP "KM Allotted" field (stored as text, e.g. "90 KM per day")
 *   Extra KM / day           = RSOP "Extra KM Allotted" (only when Extra KM Allowed = YES, otherwise 0)
 *   Total Allowed KM / day   = Regular KM / day + Extra KM / day
 *   Campaign days            = the RSOP number of days (Sundays excluded when Sunday halt = YES)
 *   Regular KM (campaign)    = Regular KM / day x campaign days
 *   Extra KM (campaign)      = Extra KM / day x campaign days
 *   Total Allowed KM         = Total Allowed KM / day x campaign days
 * Against the actual KM run (closing KM - opening KM):
 *   Extra KM Used            = the part of the actual KM above the regular KM, up to the campaign extra KM
 *   Excess KM                = the actual KM above the Total Allowed KM
 * These are KM figures only: they never add or deduct money (diesel is reimbursed through expenses, and the mileage
 * shortage hint already uses every KM run, so a money effect here would count the same diesel twice).
 */
type Obj = Record<string, unknown>;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Largest Extra KM Allotted per day accepted (guards against typos such as an extra zero). */
export const MAX_EXTRA_KM = 10_000;

/** "90 KM per day", "90", 90, "1,200 km" -> the first positive number; anything else -> null. */
export function parseKmPerDay(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? r2(v) : null;
  if (typeof v !== "string") return null;
  const m = v.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) && n > 0 ? r2(n) : null;
}

export interface KmAllowance {
  kmPerDay: number | null; // regular KM / day
  extraKmAllowed: boolean;
  extraKmAllotted: number; // extra KM per day (the RSOP value; 0 when not allowed)
  allowedKmPerDay: number | null; // regular + extra, per day
  campaignDays: number | null;
  baseKm: number | null; // regular KM for the campaign
  extraKmTotal: number | null; // extra KM for the campaign
  totalAllowedKm: number | null; // allowed KM per day x campaign days
}

/** Allowance from its parts (also used by the frontend mirror and tests). */
export function kmAllowance(kmAllotted: unknown, campaignDays: unknown, extraKmAllowed: boolean, extraKmAllotted: unknown): KmAllowance {
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
export function kmAllowanceOf(projectType: unknown, details: unknown): KmAllowance | null {
  if (projectType !== "ROADSHOW") return null;
  const d = (details && typeof details === "object" ? details : {}) as Obj;
  return kmAllowance(d.kmAllotted, d.numberOfDays, d.extraKmAllowed === "YES", d.extraKmAllotted);
}

export interface KmUsage extends KmAllowance {
  actualKm: number;
  extraKmUsed: number | null;
  excessKm: number | null;
}

/** Actual KM against the allowance. Without a known allowance only the actual KM is reported. */
export function kmUsage(a: KmAllowance | null, actualKm: number): KmUsage {
  const actual = r2(Math.max(0, actualKm));
  const base = a ?? kmAllowance(null, null, false, 0);
  const known = base.baseKm !== null && base.totalAllowedKm !== null && base.extraKmTotal !== null;
  return {
    ...base, actualKm: actual,
    extraKmUsed: known ? r2(Math.min(Math.max(0, actual - base.baseKm!), base.extraKmTotal!)) : null,
    excessKm: known ? r2(Math.max(0, actual - base.totalAllowedKm!)) : null,
  };
}
