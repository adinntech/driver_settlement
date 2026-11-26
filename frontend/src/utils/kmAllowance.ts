/**
 * KM allowance of a RoadShow vehicle, PER DAY basis. Mirrors backend/src/utils/kmAllowance.ts (the server's figures are saved):
 *   Total Allowed KM / day = Regular KM / day + Extra KM / day (Extra KM is 0 when not allowed)
 *   Total Allowed KM       = Total Allowed KM / day x campaign days (Sundays excluded when Sunday halt = YES)
 *   Excess KM              = actual KM above the Total Allowed KM
 * KM figures only: nothing here adds or deducts money.
 */
export const MAX_EXTRA_KM = 10_000;
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface KmAllowance {
  kmPerDay: number | null;
  extraKmAllowed: boolean;
  extraKmAllotted: number; // per day
  allowedKmPerDay: number | null;
  campaignDays: number | null;
  baseKm: number | null;
  extraKmTotal: number | null;
  totalAllowedKm: number | null;
}

/** "90 KM per day", "90", "1,200 km" -> the first positive number; anything else -> null. */
export function parseKmPerDay(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? r2(v) : null;
  if (typeof v !== "string") return null;
  const m = v.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) && n > 0 ? r2(n) : null;
}

/** The value typed in Extra KM Allotted (KM per day): a number above 0 with up to 2 decimals, or an error message. */
export function extraKmError(raw: string): string | null {
  const t = raw.trim();
  if (!t) return "Extra KM Allotted is required when Extra KM Allowed is Yes";
  if (!/^\d+(\.\d{1,2})?$/.test(t) || !(Number(t) > 0)) return "Extra KM Allotted must be a number greater than 0 (up to 2 decimals)";
  if (Number(t) > MAX_EXTRA_KM) return `Extra KM Allotted cannot be more than ${MAX_EXTRA_KM} KM per day`;
  return null;
}

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

export function kmUsage(a: KmAllowance | null | undefined, actualKm: number) {
  const actual = r2(Math.max(0, actualKm));
  const base = a ?? kmAllowance(null, null, false, 0);
  const known = base.baseKm !== null && base.totalAllowedKm !== null && base.extraKmTotal !== null;
  return {
    ...base, actualKm: actual,
    extraKmUsed: known ? r2(Math.min(Math.max(0, actual - base.baseKm!), base.extraKmTotal!)) : null,
    excessKm: known ? r2(Math.max(0, actual - base.totalAllowedKm!)) : null,
  };
}

const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
/** "(90 + 20) km/day x 10 days = 1,100 km" / "90 km/day x 10 days = 900 km" / "-" */
export function allowanceText(a: KmAllowance | null | undefined): string {
  if (!a || a.totalAllowedKm === null || a.kmPerDay === null) return "-";
  const perDay = a.extraKmAllotted > 0 ? `(${fmt(a.kmPerDay)} + ${fmt(a.extraKmAllotted)} extra) km/day` : `${fmt(a.kmPerDay)} km/day`;
  return `${perDay} x ${a.campaignDays} days = ${fmt(a.totalAllowedKm)} km`;
}
export const kmText = (n: number | null | undefined) => (n === null || n === undefined ? "-" : `${fmt(n)} km`);
