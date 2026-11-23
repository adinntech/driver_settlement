import type { DriverAvailability, DriverAvStatus, DriverHistoryRow } from "@/types/domain";
import { formatDate } from "./format";
import { emptyProject, formatAt, type ProjectForm } from "./vehicleAvailability";

export const DRIVER_AV_STATUSES: DriverAvStatus[] = ["AVAILABLE", "IN_USE", "NOT_AVAILABLE"];
export const DRIVER_AV_LABEL: Record<DriverAvStatus, string> = { AVAILABLE: "Available Now", IN_USE: "In Use – Another Project", NOT_AVAILABLE: "Not Available" };
/** Colour tone per status: green / blue / red (the badge-av-* styles are shared with the vehicle status badges). */
export const DRIVER_AV_TONE: Record<DriverAvStatus, string> = { AVAILABLE: "green", IN_USE: "blue", NOT_AVAILABLE: "red" };
export const UNAVAILABLE_CATEGORIES = ["Personal Leave", "Medical Leave", "License Issue", "Vehicle/Project Related", "Other"];

export interface NotAvailableForm { reason: string; category: string; fromDate: string; expectedAvailableDate: string; remarks: string }
/** Holds the fields of all three statuses so switching never loses what was typed; only the chosen one is saved. */
export interface DriverAvForm {
  status: "" | DriverAvStatus;
  availableFromDate: string; availableFromTime: string;
  project: ProjectForm;
  notAvailable: NotAvailableForm;
  /** The To date the driver was saved with (an unchanged, already overdue date stays editable). */
  savedEndDate: string;
}

const nowParts = (now: Date) => {
  const iso = new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
};
const emptyNotAvailable = (now: Date): NotAvailableForm => ({ reason: "", category: "", fromDate: nowParts(now).date, expectedAvailableDate: "", remarks: "" });

/** New driver: Available Now from the current IST date & time. */
export const emptyDriverAvailability = (now = new Date()): DriverAvForm => ({
  status: "AVAILABLE", availableFromDate: nowParts(now).date, availableFromTime: nowParts(now).time,
  project: emptyProject(), notAvailable: emptyNotAvailable(now), savedEndDate: "",
});

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/**
 * Restores a saved driver's availability. A driver saved before this feature has none: the status stays unchosen
 * (never silently "Available") and RBP picks one on the next save.
 */
export function fromDriverAvailability(saved: DriverAvailability | null | undefined, now = new Date()): DriverAvForm {
  const base: DriverAvForm = { ...emptyDriverAvailability(now), status: "" };
  if (!saved || typeof saved !== "object") return base;
  const p = saved.project ?? {};
  const n = saved.notAvailable ?? {};
  const status = DRIVER_AV_STATUSES.includes(saved.status as DriverAvStatus) ? (saved.status as DriverAvStatus) : "";
  return {
    status,
    availableFromDate: s(saved.availableFromDate) || base.availableFromDate, availableFromTime: s(saved.availableFromTime) || base.availableFromTime,
    project: {
      ...emptyProject(),
      trackingProject: s(p.trackingProject), trackingVehicle: s(p.trackingVehicle), budget: s(p.budget), budgetVersion: typeof p.budgetVersion === "number" ? p.budgetVersion : null,
      projectType: s(p.projectType), projectName: s(p.projectName), clientName: s(p.clientName), trackupNumber: s(p.trackupNumber), pifNumber: s(p.pifNumber),
      startDate: s(p.startDate), endDate: s(p.endDate), remarks: s(p.remarks),
    },
    notAvailable: {
      reason: s(n.reason), category: s(n.category), fromDate: s(n.fromDate) || base.notAvailable.fromDate, expectedAvailableDate: s(n.expectedAvailableDate), remarks: s(n.remarks),
    },
    savedEndDate: status === "IN_USE" ? s(p.endDate) : "",
  };
}

const realDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const realTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** Mirrors the server rules; the server stays the authority. */
export function validateDriverAvailability(a: DriverAvForm, now = new Date()): string[] {
  const e: string[] = [];
  if (!a.status) return ["Driver status is required"];
  const today = nowParts(now).date;
  if (a.status === "AVAILABLE") {
    if (a.availableFromDate && !realDate(a.availableFromDate)) e.push("Available from date is not a valid date");
    if (a.availableFromTime && !realTime(a.availableFromTime)) e.push("Available from time is not a valid time");
    if (!a.availableFromDate !== !a.availableFromTime) e.push("Available from: both date and time are required");
  }
  if (a.status === "IN_USE") {
    const p = a.project;
    if (!p.trackingProject) e.push("Select an approved project by Trackup Number or PIF Number");
    if (!p.startDate) e.push("Project from date is required");
    else if (!realDate(p.startDate)) e.push("Project from date is not a valid date");
    if (!p.endDate) e.push("Project to date is required");
    else if (!realDate(p.endDate)) e.push("Project to date is not a valid date");
    if (realDate(p.startDate) && realDate(p.endDate) && p.endDate < p.startDate) e.push("Project to date cannot be earlier than the from date");
    if (realDate(p.endDate) && p.endDate < today && p.endDate !== a.savedEndDate) e.push("Project to date cannot be in the past");
  }
  if (a.status === "NOT_AVAILABLE") {
    const n = a.notAvailable;
    if (!n.reason.trim()) e.push("Unavailable reason is required");
    if (!n.category) e.push("Reason category is required");
    else if (!UNAVAILABLE_CATEGORIES.includes(n.category)) e.push("Reason category is not valid");
    if (n.fromDate && !realDate(n.fromDate)) e.push("Unavailable from date is not a valid date");
    if (n.expectedAvailableDate && !realDate(n.expectedAvailableDate)) e.push("Expected available date is not a valid date");
    if (realDate(n.fromDate) && realDate(n.expectedAvailableDate) && n.expectedAvailableDate < n.fromDate) e.push("Expected available date cannot be before the unavailable from date");
  }
  return e;
}

/** Only the chosen status's fields are sent; the other sections stay in the form but are not saved. */
export function toDriverAvailabilityPayload(a: DriverAvForm) {
  if (!a.status) return { status: "" };
  if (a.status === "AVAILABLE") return { status: a.status, availableFromDate: a.availableFromDate, availableFromTime: a.availableFromTime };
  if (a.status === "IN_USE") {
    const p = a.project; // the server fills the project details from the approved records
    return { status: a.status, project: { trackupNumber: p.trackupNumber, pifNumber: p.pifNumber, startDate: p.startDate, endDate: p.endDate, remarks: p.remarks } };
  }
  return { status: a.status, notAvailable: { ...a.notAvailable } };
}

// ---- display helpers (listing: minimal; view: complete)
/** Project name shown in the listing: only while the driver is allocated. */
export const driverProjectName = (a?: DriverAvailability | null): string => (a?.status === "IN_USE" && a.project?.projectName ? a.project.projectName : "—");

/** The relevant date(s) for the status: Available -> from; In Use -> project from – to; Not Available -> since (+ expected). */
export function driverAvailabilityDates(a?: DriverAvailability | null): string {
  if (!a?.status) return "—";
  if (a.status === "AVAILABLE") return a.availableFromDate ? `From ${formatAt(a.availableFromDate, a.availableFromTime)}` : "Now";
  if (a.status === "IN_USE") return a.project?.startDate ? `${formatDate(a.project.startDate)} – ${a.project.endDate ? formatDate(a.project.endDate) : "…"}` : "—";
  const n = a.notAvailable;
  if (!n?.fromDate) return "—";
  return n.expectedAvailableDate ? `${formatDate(n.fromDate)} → exp. ${formatDate(n.expectedAvailableDate)}` : `Since ${formatDate(n.fromDate)}`;
}

export const HISTORY_ACTION_LABEL: Record<string, string> = {
  CREATED: "Driver Created", UPDATED: "Driver Updated", STATUS_CHANGED: "Status Changed", PROJECT_ASSIGNED: "Project Assigned",
  PROJECT_EXTENDED: "Project Extended", PROJECT_UPDATED: "Project Updated", MARKED_NOT_AVAILABLE: "Marked Not Available",
  NOT_AVAILABLE_UPDATED: "Not Available Details Updated", AVAILABILITY_CONFIRMED: "Availability Confirmed", AVAILABILITY_UPDATED: "Availability Updated",
  AUTO_AVAILABILITY_UPDATE: "Automatically Marked Available",
};
export const HISTORY_FIELD_LABEL: Record<string, string> = {
  driverName: "Name", driverType: "Driver Type", address: "Address", mobileNumber: "Mobile No", accountName: "Account Name", accountNumber: "Account No",
  ifscCode: "IFSC Code", bankName: "Bank Name", licenceNumber: "Licence No", licenceType: "Licence Type", licenceExpiryDate: "Licence Expiry Date",
  salary: "Salary", status: "Record Status", availabilityStatus: "Availability Status", availableFrom: "Available From", projectType: "Project Type",
  projectName: "Project Name", clientName: "Client / Billing Name", trackupNumber: "Trackup Number", pifNumber: "PIF Number", projectFromDate: "Project From Date",
  projectToDate: "Project To Date", projectRemarks: "Additional Remarks", unavailableReason: "Unavailable Reason", reasonCategory: "Reason Category",
  unavailableFrom: "Unavailable From", expectedAvailableDate: "Expected Available Date", availabilityRemarks: "Additional Remarks",
};
const VALUE_LABEL: Record<string, string> = { ...DRIVER_AV_LABEL, COMPANY_DRIVER: "Company Driver", ACTING_DRIVER: "Acting Driver", ACTIVE: "Active", INACTIVE: "Inactive", ROADSHOW: "Roadshow", SIGNAGE: "Signage" };

/** One history value for display ("—" when empty; dates and statuses in friendly form). */
export function historyValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const t = String(v);
  if (VALUE_LABEL[t]) return VALUE_LABEL[t];
  const m = /^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?$/.exec(t);
  return m ? formatAt(m[1], m[2]) : t;
}
export const historyStatus = (v: string | null | undefined): string => (v && VALUE_LABEL[v] ? VALUE_LABEL[v] : v ? v : "—");

/** Latest first (the API already sorts this way; this keeps the view correct for any input order). */
export const latestFirst = (rows: DriverHistoryRow[]): DriverHistoryRow[] =>
  [...rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a._id < b._id ? 1 : -1));
