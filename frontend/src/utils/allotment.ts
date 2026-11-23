import type { Attachment } from "@/types/domain";
import { formatDateTime } from "./format";

export type AllotStatus = "ACTIVE" | "RELEASED" | "CHANGED";
export const ALLOT_STATUS_LABEL: Record<AllotStatus, string> = { ACTIVE: "Active", RELEASED: "Released", CHANGED: "Changed" };
export const EVENT_LABEL: Record<string, string> = {
  ALLOTTED: "Vehicle allotted", VEHICLE_CHANGED: "Vehicle changed", RELEASED: "Vehicle released", EXTENDED: "Project extended / schedule changed",
};
export const MAX_ATTACHMENTS = 5;

/** IST date + time of an instant (the server stores UTC). */
export function istParts(d: Date): { date: string; time: string } {
  const iso = new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}
export function instantToIst(iso: string | null | undefined): { date: string; time: string } | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : istParts(d);
}
/** IST wall clock -> instant. */
export const toInstant = (date: string, time: string): Date => new Date(`${date}T${time}:00+05:30`);
export const fmtInstant = (iso: string | null | undefined): string => formatDateTime(iso ?? null);

const realDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const realTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

export interface Schedule {
  expectedReleaseDate: string; expectedReleaseTime: string; nextAvailableDate: string; nextAvailableTime: string;
}
export interface AllotForm extends Schedule {
  vehicleId: string; vehicleNo: string; vehicleLabel: string; allottedDate: string; allottedTime: string; remarks: string;
}

/** Allotment moment defaults to now (IST); everything else starts empty. */
export const emptyAllotForm = (now = new Date()): AllotForm => ({
  vehicleId: "", vehicleNo: "", vehicleLabel: "", allottedDate: istParts(now).date, allottedTime: istParts(now).time,
  expectedReleaseDate: "", expectedReleaseTime: "", nextAvailableDate: "", nextAvailableTime: "", remarks: "",
});

/** Date / time rules shared by allot and extend (mirrors the server; the server is the authority). */
export function validateSchedule(s: Schedule, allotted: Date | null): string[] {
  const e: string[] = [];
  const hasE = !!(s.expectedReleaseDate || s.expectedReleaseTime);
  if (hasE) {
    if (!s.expectedReleaseDate || !s.expectedReleaseTime) e.push("Expected release: both date and time are required");
    else if (!realDate(s.expectedReleaseDate) || !realTime(s.expectedReleaseTime)) e.push("Expected release date & time is invalid");
  }
  if (!s.nextAvailableDate) e.push("Next available date is required");
  else if (!realDate(s.nextAvailableDate)) e.push("Next available date is not a valid date");
  if (!s.nextAvailableTime) e.push("Next available time is required");
  else if (!realTime(s.nextAvailableTime)) e.push("Next available time is not a valid time");
  if (e.length) return e;
  const next = toInstant(s.nextAvailableDate, s.nextAvailableTime);
  if (hasE) {
    const rel = toInstant(s.expectedReleaseDate, s.expectedReleaseTime);
    if (allotted && rel < allotted) e.push("Expected release cannot be before the allotment date & time");
    if (next < rel) e.push("Next available date & time cannot be before the expected release");
  }
  if (allotted && next < allotted) e.push("Next available date & time cannot be before the allotment date & time");
  return e;
}

export function validateAllotForm(f: AllotForm, now = new Date()): string[] {
  const e: string[] = [];
  if (!f.vehicleId) e.push("Select a vehicle");
  let allotted: Date | null = null;
  if (!f.allottedDate || !f.allottedTime || !realDate(f.allottedDate) || !realTime(f.allottedTime)) e.push("Allotment date & time is invalid");
  else {
    allotted = toInstant(f.allottedDate, f.allottedTime);
    if (allotted.getTime() > now.getTime() + 60_000) e.push("Allotment date & time cannot be in the future");
  }
  e.push(...validateSchedule(f, allotted));
  if (!e.length && toInstant(f.nextAvailableDate, f.nextAvailableTime) < now) e.push("Next available date & time cannot be in the past");
  return e;
}

export function toAllotPayload(f: AllotForm, trackupNumber: string) {
  return {
    trackupNumber, vehicleId: f.vehicleId, allottedDate: f.allottedDate, allottedTime: f.allottedTime,
    expectedReleaseDate: f.expectedReleaseDate, expectedReleaseTime: f.expectedReleaseTime,
    nextAvailableDate: f.nextAvailableDate, nextAvailableTime: f.nextAvailableTime, remarks: f.remarks,
  };
}

export interface ChangeForm { vehicleId: string; vehicleNo: string; reason: string; remarks: string; attachments: Attachment[] }
export const emptyChangeForm = (): ChangeForm => ({ vehicleId: "", vehicleNo: "", reason: "", remarks: "", attachments: [] });

export function validateChangeForm(f: ChangeForm, currentVehicleId?: string): string[] {
  const e: string[] = [];
  if (!f.vehicleId) e.push("Select the replacement vehicle");
  else if (currentVehicleId && f.vehicleId === currentVehicleId) e.push("Choose a different vehicle as the replacement");
  if (!f.reason.trim()) e.push("Change reason is required");
  else if (f.reason.trim().length > 300) e.push("Change reason is too long (max 300)");
  if (f.attachments.length > MAX_ATTACHMENTS) e.push(`Too many attachments (max ${MAX_ATTACHMENTS})`);
  return e;
}
/** The url is computed by the server and never sent back. */
export const toChangePayload = (f: ChangeForm) => ({
  vehicleId: f.vehicleId, reason: f.reason.trim(), remarks: f.remarks,
  attachments: f.attachments.map((a) => ({ storage: a.storage, key: a.key, name: a.name, size: a.size, mimeType: a.mimeType })),
});

/** Form values for the extension dialog, from the allotment's stored instants. */
export function scheduleFromAllotment(a: { expectedReleaseAt?: string | null; nextAvailableAt: string }): Schedule {
  const e = instantToIst(a.expectedReleaseAt);
  const n = instantToIst(a.nextAvailableAt);
  return { expectedReleaseDate: e?.date ?? "", expectedReleaseTime: e?.time ?? "", nextAvailableDate: n?.date ?? "", nextAvailableTime: n?.time ?? "" };
}

export const projectPeriod = (start?: string | null, end?: string | null, fmt: (d: string) => string = (d) => d): string =>
  start ? `${fmt(start)}${end ? ` – ${fmt(end)}` : ""}` : "—";
