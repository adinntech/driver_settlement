import { formatDate } from "./format";

export type AvStatus = "AVAILABLE" | "IN_USE" | "ISSUE";
export const AV_STATUSES: AvStatus[] = ["AVAILABLE", "IN_USE", "ISSUE"];
export const AV_LABEL: Record<AvStatus, string> = { AVAILABLE: "Available Now", IN_USE: "In Use – Another Project", ISSUE: "Vehicle Issue" };
/** Colour tone per status (green / blue / red). */
export const AV_TONE: Record<AvStatus, string> = { AVAILABLE: "green", IN_USE: "blue", ISSUE: "red" };
export const ISSUE_CATEGORIES = [
  "Engine Problem", "Battery Problem", "Tyre / Stepney Problem", "Accident / Body Damage", "Electrical Problem",
  "Mechanical Problem", "Document / Permit Issue", "Other",
];
export const ISSUE_STATUS_LABEL: Record<string, string> = { OPEN: "Open", IN_REPAIR: "In Repair" };
export const PROJECT_TYPE_LABEL: Record<string, string> = { ROADSHOW: "Roadshow", SIGNAGE: "Signage" };

export interface ProjectForm {
  trackingProject: string; trackingVehicle: string; budget: string; budgetVersion: number | null; projectType: string; projectName: string; clientName: string; trackupNumber: string; pifNumber: string;
  startDate: string; endDate: string; location: string; remarks: string;
}
export interface IssueForm {
  category: string; description: string; reportedDate: string; reportedTime: string; expectedRepairDate: string; expectedRepairTime: string;
  garage: string; repairRemarks: string; issueStatus: string;
}
/** Holds the fields of all three statuses so switching the dropdown never loses what was typed; only the chosen one is saved. */
export interface AvForm {
  status: "" | AvStatus;
  availableFromDate: string; availableFromTime: string;
  project: ProjectForm;
  expectedReleaseDate: string; expectedReleaseTime: string; nextAvailableDate: string; nextAvailableTime: string;
  issue: IssueForm;
}

/** Approved project picked from the tracking records (GET /vehicles/projects, /projects/lookup). */
export interface ProjectChoice {
  trackingProject: string; trackingVehicle: string; budget: string | null; budgetVersion: number | null; budgetNumber?: string; projectType: string; projectName: string; clientName: string; trackupNumber: string; pifNumber: string;
  startDate: string | null; endDate: string | null; location: string | null; allocatedTo: string | null;
}

const nowParts = (now: Date) => {
  const iso = new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
};

export const emptyProject = (): ProjectForm => ({
  trackingProject: "", trackingVehicle: "", budget: "", budgetVersion: null, projectType: "", projectName: "", clientName: "", trackupNumber: "", pifNumber: "", startDate: "", endDate: "", location: "", remarks: "",
});
export const emptyIssue = (now = new Date()): IssueForm => ({
  category: "", description: "", reportedDate: nowParts(now).date, reportedTime: nowParts(now).time, expectedRepairDate: "", expectedRepairTime: "",
  garage: "", repairRemarks: "", issueStatus: "OPEN",
});

/** New vehicle: Available Now from the current IST date & time. */
export const emptyAvailability = (now = new Date()): AvForm => ({
  status: "AVAILABLE", availableFromDate: nowParts(now).date, availableFromTime: nowParts(now).time,
  project: emptyProject(), expectedReleaseDate: "", expectedReleaseTime: "", nextAvailableDate: "", nextAvailableTime: "", issue: emptyIssue(now),
});

type Saved = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/**
 * Restores a saved vehicle's availability. Vehicles saved before this feature have none: the status stays unchosen
 * (never silently "Available") and RBP picks one on the next final save.
 */
export function fromAvailability(saved: unknown, now = new Date()): AvForm {
  const base = { ...emptyAvailability(now), status: "" as const };
  if (!saved || typeof saved !== "object") return base;
  const a = saved as Saved;
  const p = (a.project && typeof a.project === "object" ? a.project : {}) as Saved;
  const i = (a.issue && typeof a.issue === "object" ? a.issue : {}) as Saved;
  const st = AV_STATUSES.includes(a.status as AvStatus) ? (a.status as AvStatus) : "";
  return {
    status: st,
    availableFromDate: s(a.availableFromDate) || base.availableFromDate, availableFromTime: s(a.availableFromTime) || base.availableFromTime,
    project: {
      trackingProject: s(p.trackingProject), trackingVehicle: s(p.trackingVehicle), budget: s(p.budget),
      budgetVersion: typeof p.budgetVersion === "number" ? p.budgetVersion : null, projectType: s(p.projectType), projectName: s(p.projectName), clientName: s(p.clientName),
      trackupNumber: s(p.trackupNumber), pifNumber: s(p.pifNumber), startDate: s(p.startDate), endDate: s(p.endDate), location: s(p.location), remarks: s(p.remarks),
    },
    expectedReleaseDate: s(a.expectedReleaseDate), expectedReleaseTime: s(a.expectedReleaseTime),
    nextAvailableDate: s(a.nextAvailableDate), nextAvailableTime: s(a.nextAvailableTime),
    issue: {
      category: s(i.category), description: s(i.description), reportedDate: s(i.reportedDate) || base.issue.reportedDate, reportedTime: s(i.reportedTime) || base.issue.reportedTime,
      expectedRepairDate: s(i.expectedRepairDate), expectedRepairTime: s(i.expectedRepairTime), garage: s(i.garage), repairRemarks: s(i.repairRemarks),
      issueStatus: s(i.issueStatus) || "OPEN",
    },
  };
}

/** Fills the project block from a picked approved project (trackup and PIF always come as a matching pair); RBP's own location / remarks are kept. */
export const applyProject = (cur: ProjectForm, c: ProjectChoice): ProjectForm => ({
  trackingProject: c.trackingProject, trackingVehicle: c.trackingVehicle, budget: c.budget ?? "", budgetVersion: c.budgetVersion, projectType: c.projectType, projectName: c.projectName, clientName: c.clientName,
  trackupNumber: c.trackupNumber, pifNumber: c.pifNumber, startDate: c.startDate ?? "", endDate: c.endDate ?? "",
  location: cur.location || c.location || "", remarks: cur.remarks,
});
/** Changing / clearing the project drops every value that came from it, so nothing stale is left behind. Remarks stay. */
export const unlinkProject = (cur: ProjectForm): ProjectForm => ({ ...emptyProject(), remarks: cur.remarks });
/** Editing the trackup / PIF text by hand also drops the previous project's values. */
export const typeProjectRef = (cur: ProjectForm, field: "trackupNumber" | "pifNumber", text: string): ProjectForm => ({
  ...unlinkProject(cur), [field]: text.toUpperCase().replace(/[^A-Z0-9-_/. ]/g, "").slice(0, 40),
});

// ---- validation (mirrors the server; the server is the authority)
const realDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const realTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const at = (d: string, t: string) => (d && t ? `${d}T${t}` : "");

export function validateAvailability(a: AvForm, draft: boolean, now = new Date()): string[] {
  const e: string[] = [];
  const dt = (d: string, t: string, label: string) => {
    if (d && !realDate(d)) e.push(`${label} date is not a valid date`);
    if (t && !realTime(t)) e.push(`${label} time is not a valid time`);
  };
  if (!a.status) {
    if (!draft) e.push("Vehicle status is required");
    return e;
  }
  const p = nowParts(now);
  const nowAt = `${p.date}T${p.time}`;
  if (a.status === "AVAILABLE") {
    dt(a.availableFromDate, a.availableFromTime, "Available from");
    if (!draft && (!a.availableFromDate) !== (!a.availableFromTime)) e.push("Available from: both date and time are required");
  }
  if (a.status === "IN_USE") {
    const pr = a.project;
    dt(pr.startDate, "", "Project start"); dt(pr.endDate, "", "Project end");
    dt(a.expectedReleaseDate, a.expectedReleaseTime, "Expected release"); dt(a.nextAvailableDate, a.nextAvailableTime, "Next available");
    if (pr.startDate && pr.endDate && pr.endDate < pr.startDate) e.push("Project end date cannot be before the start date");
    if (!draft) {
      // only an approved project, picked by Trackup / PIF number, can be allocated
      if (!pr.trackingProject) e.push("Select an approved project by Trackup Number or PIF Number");
      if (!a.nextAvailableDate) e.push("Next available date is required");
      if (!a.nextAvailableTime) e.push("Next available time is required");
      if ((!a.expectedReleaseDate) !== (!a.expectedReleaseTime)) e.push("Expected release: both date and time are required");
    }
    const rel = at(a.expectedReleaseDate, a.expectedReleaseTime);
    const nxt = at(a.nextAvailableDate, a.nextAvailableTime);
    if (rel && nxt && nxt < rel) e.push("Next available date & time cannot be before the expected release");
    if (pr.startDate && a.nextAvailableDate && a.nextAvailableDate < pr.startDate) e.push("Next available date cannot be before the project start date");
  }
  if (a.status === "ISSUE") {
    const i = a.issue;
    dt(i.reportedDate, i.reportedTime, "Issue reported"); dt(i.expectedRepairDate, i.expectedRepairTime, "Expected repair completion");
    if (!draft) {
      if (!i.category) e.push("Issue category is required");
      if (!i.description.trim()) e.push("Issue description / reason is required");
      if (i.expectedRepairTime && !i.expectedRepairDate) e.push("Expected repair completion date is required when a time is given");
    }
    const rep = at(i.reportedDate, i.reportedTime);
    if (rep && rep > nowAt) e.push("Issue reported date & time cannot be in the future");
    if (rep && i.expectedRepairDate && (at(i.expectedRepairDate, i.expectedRepairTime) || `${i.expectedRepairDate}T23:59`) < rep)
      e.push("Expected repair completion cannot be before the issue was reported");
  }
  return e;
}

/** Only the chosen status's fields are sent; the other sections stay in the form but are not saved. */
export function toAvailabilityPayload(a: AvForm) {
  if (!a.status) return { status: "" };
  if (a.status === "AVAILABLE") return { status: a.status, availableFromDate: a.availableFromDate, availableFromTime: a.availableFromTime };
  if (a.status === "IN_USE") {
    const p = a.project;
    return {
      status: a.status,
      // the server fills everything else from the approved records
      project: { trackupNumber: p.trackupNumber, pifNumber: p.pifNumber, location: p.location, remarks: p.remarks },
      expectedReleaseDate: a.expectedReleaseDate, expectedReleaseTime: a.expectedReleaseTime,
      nextAvailableDate: a.nextAvailableDate, nextAvailableTime: a.nextAvailableTime,
    };
  }
  return { status: a.status, issue: { ...a.issue } };
}

// ---- display helpers
/** "2026-11-25" + "20:00" -> "25-Nov-2026, 08:00 PM" */
export function formatAt(date: string | null | undefined, time: string | null | undefined): string {
  if (!date) return "—";
  const d = formatDate(date);
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return d;
  const [h, m] = time.split(":").map(Number);
  return `${d}, ${String(h % 12 === 0 ? 12 : h % 12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
/** History values come as "2026-11-25 20:00" (or a date alone). */
export function formatLabelAt(v: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?$/.exec(v);
  return m ? formatAt(m[1], m[2]) : v;
}

interface AvVehicle {
  availability?: {
    status?: string | null; availableFromDate?: string | null; availableFromTime?: string | null;
    project?: { projectName?: string | null; clientName?: string | null; projectType?: string | null } | null;
    expectedReleaseDate?: string | null; expectedReleaseTime?: string | null; nextAvailableDate?: string | null; nextAvailableTime?: string | null;
    issue?: { category?: string | null; description?: string | null; expectedRepairDate?: string | null; expectedRepairTime?: string | null } | null;
  } | null;
}
/** Next available moment: in-use -> project release, issue -> expected repair, available -> from now. */
export function nextAvailableText(v: AvVehicle): string {
  const a = v.availability;
  if (!a?.status) return "—";
  if (a.status === "IN_USE") return formatAt(a.nextAvailableDate, a.nextAvailableTime);
  if (a.status === "ISSUE") return a.issue?.expectedRepairDate ? formatAt(a.issue.expectedRepairDate, a.issue.expectedRepairTime) : "Not known";
  return "Now";
}
export const expectedReleaseText = (v: AvVehicle): string =>
  v.availability?.status === "IN_USE" ? formatAt(v.availability.expectedReleaseDate, v.availability.expectedReleaseTime) : "—";
export const issueReasonText = (v: AvVehicle): string =>
  v.availability?.status === "ISSUE" ? [v.availability.issue?.category, v.availability.issue?.description].filter(Boolean).join(": ") || "—" : "—";
