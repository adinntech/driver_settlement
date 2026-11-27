import { DRIVER_AVAILABILITY_STATUSES, UNAVAILABLE_CATEGORIES, type DriverAvailabilityStatus } from "../models/Driver.js";
import { PROJECT_TYPES } from "../models/Vehicle.js";
import { istParts, realDate, realTime } from "./availability.validator.js";

type Obj = Record<string, unknown>;

export interface DriverProjectData {
  trackingProject: string | null;
  trackingVehicle: string | null;
  budget: string | null;
  budgetVersion: number | null;
  projectType: string | null;
  projectName: string | null;
  clientName: string | null;
  trackupNumber: string | null;
  pifNumber: string | null;
  startDate: string | null; // Project From Date
  endDate: string | null; // Project To Date
  remarks: string | null;
}
export interface NotAvailableData {
  reason: string;
  category: string;
  fromDate: string;
  expectedAvailableDate: string | null;
  remarks: string | null;
}
export interface DriverAvailabilityData {
  status: DriverAvailabilityStatus;
  availableFromDate: string | null;
  availableFromTime: string | null;
  project: DriverProjectData | null;
  notAvailable: NotAvailableData | null;
}
export interface PrevDriverAvailability {
  status?: string | null;
  project?: { endDate?: string | null } | null;
}

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
// eslint-disable-next-line no-control-regex -- intentionally rejects control characters in free text
const SAFE_TEXT = /^[^<>\u0000-\u001f\u007f]+$/u;
const REF_TEXT = /^[A-Za-z0-9 \-_/.]+$/;
const HEX = /^[a-f0-9]{24}$/i;

/** Today in India (YYYY-MM-DD): the reference for "the Project To Date has passed". */
export const istToday = (now = new Date()) => istParts(now).date;

/** Next calendar day of a YYYY-MM-DD date. */
export const nextDay = (ymd: string): string => new Date(new Date(`${ymd}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);

/**
 * Validates the Driver Availability & Status section.
 * `undefined` / `null` input means "not sent": the stored availability stays untouched (data undefined).
 * Only the chosen status's fields are kept; switching status never leaks stale fields into the saved record.
 */
export function validateDriverAvailability(
  input: unknown, now = new Date(), prev?: PrevDriverAvailability | null,
): { errors: string[]; data: DriverAvailabilityData | undefined } {
  if (input === undefined || input === null) return { errors: [], data: undefined };
  if (typeof input !== "object" || Array.isArray(input)) return { errors: ["Driver availability is invalid"], data: undefined };
  const b = input as Obj;
  const errors: string[] = [];
  const nowP = istParts(now);

  const text = (o: Obj, k: string, label: string, max: number): string | null => {
    if (blank(o[k])) return null;
    if (typeof o[k] !== "string") {
      errors.push(`${label} is invalid`);
      return null;
    }
    const t = (o[k] as string).trim().replace(/\s+/g, " ");
    if (t.length > max) errors.push(`${label} is too long (max ${max})`);
    else if (!SAFE_TEXT.test(t)) errors.push(`${label} contains invalid characters`);
    return t;
  };
  const ref = (o: Obj, k: string, label: string): string | null => {
    if (blank(o[k])) return null;
    const t = String(o[k]).trim().toUpperCase();
    if (t.length > 40 || !REF_TEXT.test(t)) errors.push(`${label} is invalid`);
    return t;
  };
  const date = (o: Obj, k: string, label: string): string | null => {
    if (blank(o[k])) return null;
    if (!realDate(o[k])) {
      errors.push(`${label} must be a valid date (YYYY-MM-DD)`);
      return null;
    }
    return o[k] as string;
  };
  const time = (o: Obj, k: string, label: string): string | null => {
    if (blank(o[k])) return null;
    if (!realTime(o[k])) {
      errors.push(`${label} must be a valid time (HH:mm)`);
      return null;
    }
    return o[k] as string;
  };

  if (blank(b.status)) return { errors: ["Driver status is required"], data: undefined };
  if (!DRIVER_AVAILABILITY_STATUSES.includes(b.status as DriverAvailabilityStatus))
    return { errors: [`Driver status must be one of: ${DRIVER_AVAILABILITY_STATUSES.join(", ")}`], data: undefined };
  const status = b.status as DriverAvailabilityStatus;
  const out: DriverAvailabilityData = { status, availableFromDate: null, availableFromTime: null, project: null, notAvailable: null };

  if (status === "AVAILABLE") {
    let d = date(b, "availableFromDate", "Available from date");
    let t = time(b, "availableFromTime", "Available from time");
    if (d === null && t === null) { d = nowP.date; t = nowP.time; } // default: now
    else if ((d === null) !== (t === null)) errors.push("Available from: both date and time are required");
    out.availableFromDate = d;
    out.availableFromTime = t;
  }

  if (status === "IN_USE") {
    const p = (b.project && typeof b.project === "object" ? b.project : {}) as Obj;
    let projectType: string | null = null;
    if (!blank(p.projectType)) {
      if (!PROJECT_TYPES.includes(p.projectType as never)) errors.push("Project type must be Roadshow or Signage");
      else projectType = p.projectType as string;
    }
    const hex = (k: string, label: string): string | null => {
      if (blank(p[k])) return null;
      if (typeof p[k] === "string" && HEX.test(p[k] as string)) return p[k] as string;
      errors.push(`${label} is invalid`);
      return null;
    };
    const pr: DriverProjectData = {
      trackingProject: hex("trackingProject", "Linked project"), trackingVehicle: hex("trackingVehicle", "Linked project vehicle"), budget: hex("budget", "Linked budget"),
      budgetVersion: Number.isInteger(p.budgetVersion) && (p.budgetVersion as number) > 0 ? (p.budgetVersion as number) : null, projectType,
      projectName: text(p, "projectName", "Project name", 120), clientName: text(p, "clientName", "Client / billing name", 120),
      trackupNumber: ref(p, "trackupNumber", "Trackup number"), pifNumber: ref(p, "pifNumber", "PIF number"),
      startDate: date(p, "startDate", "Project from date"), endDate: date(p, "endDate", "Project to date"), remarks: text(p, "remarks", "Additional remarks", 300),
    };
    if (!pr.trackingProject || !pr.trackingVehicle) errors.push("Select an approved project by Trackup Number or PIF Number");
    if (!pr.startDate && !errors.some((e) => /Project from date/.test(e))) errors.push("Project from date is required");
    if (!pr.endDate && !errors.some((e) => /Project to date/.test(e))) errors.push("Project to date is required");
    if (pr.startDate && pr.endDate && pr.endDate < pr.startDate) errors.push("Project to date cannot be earlier than the from date");
    // a newly entered To Date must not already be over (the driver would be released at once); an unchanged one stays editable
    if (pr.endDate && pr.endDate < nowP.date && !(prev?.status === "IN_USE" && prev.project?.endDate === pr.endDate))
      errors.push("Project to date cannot be in the past");
    out.project = pr;
  }

  if (status === "NOT_AVAILABLE") {
    const n = (b.notAvailable && typeof b.notAvailable === "object" ? b.notAvailable : {}) as Obj;
    const reason = text(n, "reason", "Unavailable reason", 300);
    if (!reason) errors.push("Unavailable reason is required");
    let category: string | null = null;
    if (blank(n.category)) errors.push("Reason category is required");
    else if (!UNAVAILABLE_CATEGORIES.includes(n.category as never)) errors.push(`Reason category must be one of: ${UNAVAILABLE_CATEGORIES.join(", ")}`);
    else category = n.category as string;
    const fromDate = date(n, "fromDate", "Unavailable from date") ?? (blank(n.fromDate) ? nowP.date : null);
    const expected = date(n, "expectedAvailableDate", "Expected available date");
    if (fromDate && expected && expected < fromDate) errors.push("Expected available date cannot be before the unavailable from date");
    out.notAvailable = { reason: reason ?? "", category: category ?? "", fromDate: fromDate ?? nowP.date, expectedAvailableDate: expected, remarks: text(n, "remarks", "Additional remarks", 300) };
  }

  return { errors, data: out };
}
