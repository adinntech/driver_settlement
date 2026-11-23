import { istNowAt, istParts, joinAt, realDate, realTime } from "./availability.validator.js";
import { ALLOWED_MIME, KEY_PATTERN, type Attachment } from "../services/storage.service.js";

type Obj = Record<string, unknown>;
const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const SAFE_TEXT = /^[^<>\u0000-\u001f\u007f]+$/u;
const toInstant = (d: string, t: string) => new Date(`${d}T${t}:00+05:30`);

export interface Schedule {
  expectedReleaseDate: string | null;
  expectedReleaseTime: string | null;
  nextAvailableDate: string;
  nextAvailableTime: string;
}

const hex = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{24}$/i.test(v);

function text(o: Obj, k: string, label: string, max: number, errors: string[], required = false): string | null {
  if (blank(o[k])) {
    if (required) errors.push(`${label} is required`);
    return null;
  }
  if (typeof o[k] !== "string") {
    errors.push(`${label} is invalid`);
    return null;
  }
  const t = (o[k] as string).trim().replace(/\s+/g, " ");
  if (t.length > max) errors.push(`${label} is too long (max ${max})`);
  else if (!SAFE_TEXT.test(t)) errors.push(`${label} contains invalid characters`);
  return t;
}

/** Expected release (optional pair) and next available (mandatory pair), checked against the allotment moment. */
function schedule(b: Obj, errors: string[], allotted: Date | null): Schedule | null {
  const ed = blank(b.expectedReleaseDate) ? null : String(b.expectedReleaseDate);
  const et = blank(b.expectedReleaseTime) ? null : String(b.expectedReleaseTime);
  const nd = blank(b.nextAvailableDate) ? null : String(b.nextAvailableDate);
  const nt = blank(b.nextAvailableTime) ? null : String(b.nextAvailableTime);
  let ok = true;
  const bad = (m: string) => { errors.push(m); ok = false; };
  if (ed !== null && !realDate(ed)) bad("Expected release date must be a valid date (YYYY-MM-DD)");
  if (et !== null && !realTime(et)) bad("Expected release time must be a valid time (HH:mm)");
  if ((ed === null) !== (et === null)) bad("Expected release: both date and time are required");
  if (nd === null) bad("Next available date is required");
  else if (!realDate(nd)) bad("Next available date must be a valid date (YYYY-MM-DD)");
  if (nt === null) bad("Next available time is required");
  else if (!realTime(nt)) bad("Next available time must be a valid time (HH:mm)");
  if (!ok || nd === null || nt === null) return null;
  const next = toInstant(nd, nt);
  if (ed !== null && et !== null) {
    const rel = toInstant(ed, et);
    if (allotted && rel < allotted) errors.push("Expected release cannot be before the allotment date & time");
    if (next < rel) errors.push("Next available date & time cannot be before the expected release");
  }
  if (allotted && next < allotted) errors.push("Next available date & time cannot be before the allotment date & time");
  return { expectedReleaseDate: ed, expectedReleaseTime: et, nextAvailableDate: nd, nextAvailableTime: nt };
}

export function parseAttachments(raw: unknown, errors: string[]): Attachment[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.push("Attachments must be a list");
    return [];
  }
  if (raw.length > 5) errors.push("Too many attachments (max 5)");
  const out: Attachment[] = [];
  raw.slice(0, 5).forEach((r, i) => {
    const x = (r && typeof r === "object" ? r : {}) as Obj;
    const name = typeof x.name === "string" ? x.name.trim() : "";
    const ok =
      (x.storage === "local" || x.storage === "space") && typeof x.key === "string" && KEY_PATTERN.test(x.key) &&
      name.length > 0 && name.length <= 120 && typeof x.mimeType === "string" && ALLOWED_MIME.includes(x.mimeType) &&
      typeof x.size === "number" && x.size > 0 && x.size <= 10 * 1024 * 1024;
    if (!ok) return void errors.push(`Attachment ${i + 1} is invalid, upload the file again`);
    out.push({ storage: x.storage as Attachment["storage"], key: x.key as string, name, size: x.size as number, mimeType: x.mimeType as string });
  });
  return out;
}

export interface AllotInput {
  trackupNumber: string | null;
  pifNumber: string | null;
  vehicleId: string;
  driverId: string | null; // optional: null = vehicle-only allotment (a driver can be assigned later)
  allottedAt: Date;
  schedule: Schedule;
  remarks: string | null;
}

export function validateAllot(input: unknown, now = new Date()): { errors: string[]; data: AllotInput | null } {
  const b = (input && typeof input === "object" ? input : {}) as Obj;
  const errors: string[] = [];
  const ref = (k: string, label: string) => {
    if (blank(b[k])) return null;
    const t = String(b[k]).trim().toUpperCase();
    if (t.length > 40 || !/^[A-Z0-9 \-_/.]+$/.test(t)) errors.push(`${label} is invalid`);
    return t;
  };
  const trackupNumber = ref("trackupNumber", "Trackup number");
  const pifNumber = ref("pifNumber", "PIF number");
  if (!trackupNumber && !pifNumber) errors.push("Project (Trackup Number) is required");
  if (!hex(b.vehicleId)) errors.push("Vehicle is required");
  let driverId: string | null = null;
  if (!blank(b.driverId)) {
    if (hex(b.driverId)) driverId = b.driverId;
    else errors.push("Driver is invalid; choose a driver from the suggestions");
  }

  // allotment moment: defaults to now; it cannot be in the future
  let allottedAt = now;
  const ad = blank(b.allottedDate) ? null : String(b.allottedDate);
  const at = blank(b.allottedTime) ? null : String(b.allottedTime);
  if (ad !== null || at !== null) {
    if (ad === null || at === null || !realDate(ad) || !realTime(at)) errors.push("Allotment date & time is invalid");
    else {
      allottedAt = toInstant(ad, at);
      if (allottedAt.getTime() > now.getTime() + 60_000) errors.push("Allotment date & time cannot be in the future");
    }
  }
  const sch = schedule(b, errors, allottedAt);
  const remarks = text(b, "remarks", "Remarks", 300, errors);
  if (errors.length || !sch) return { errors, data: null };
  return { errors, data: { trackupNumber, pifNumber, vehicleId: b.vehicleId as string, driverId, allottedAt, schedule: sch, remarks } };
}

export function validateChange(input: unknown): { errors: string[]; data: { vehicleId: string; reason: string; remarks: string | null; attachments: Attachment[] } | null } {
  const b = (input && typeof input === "object" ? input : {}) as Obj;
  const errors: string[] = [];
  if (!hex(b.vehicleId)) errors.push("Replacement vehicle is required");
  const reason = text(b, "reason", "Change reason", 300, errors, true);
  const remarks = text(b, "remarks", "Additional remarks", 300, errors);
  const attachments = parseAttachments(b.attachments, errors);
  if (errors.length || !reason) return { errors, data: null };
  return { errors, data: { vehicleId: b.vehicleId as string, reason, remarks, attachments } };
}

export function validateSchedule(input: unknown): { errors: string[]; data: { schedule: Schedule; reason: string | null } | null } {
  const b = (input && typeof input === "object" ? input : {}) as Obj;
  const errors: string[] = [];
  const sch = schedule(b, errors, null);
  const reason = text(b, "reason", "Reason", 300, errors);
  if (errors.length || !sch) return { errors, data: null };
  return { errors, data: { schedule: sch, reason } };
}

export function validateRelease(input: unknown): { errors: string[]; data: { remarks: string | null } | null } {
  const b = (input && typeof input === "object" ? input : {}) as Obj;
  const errors: string[] = [];
  const remarks = text(b, "remarks", "Remarks", 300, errors);
  return errors.length ? { errors, data: null } : { errors, data: { remarks } };
}

export { istNowAt, istParts, joinAt };
