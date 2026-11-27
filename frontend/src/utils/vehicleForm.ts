import type { Attachment } from "@/types/domain";
import { sanitizeDecimal } from "./budgetForm";
import { formatDate } from "./format";
import { AV_LABEL, ISSUE_STATUS_LABEL, PROJECT_TYPE_LABEL, formatLabelAt, type AvStatus } from "./vehicleAvailability";

export const VEHICLE_TYPES = ["Dynamic", "Static", "Utility", "Ladder Vehicle", "Event"]; // same list as the backend
export const DOC_KEYS = ["fc", "insurance", "rtoPermission", "policePermission", "permit"] as const;
export type DocKey = (typeof DOC_KEYS)[number];
export const DOC_LABEL: Record<DocKey, string> = {
  fc: "FC", insurance: "Insurance", rtoPermission: "RTO Permission", policePermission: "Police Permission", permit: "Permit",
};

/** One renewal entry from the Vehicle Detail popup: next renewal date + optional attachment. */
export interface DocRow {
  id: string;
  nextRenewalDate: string;
  attachment: Attachment | null;
}

export interface VForm {
  vehicleNo: string; make: string; model: string; type: string; yearOfManufacture: string; purchaseDate: string;
  currentRunning: string; totalRunning: string; stepneyStatus: string; batteryStatus: string;
  oilTopUpOn: string; greasePackingOn: string; generalCheckUpOn: string;
  fc: DocRow[]; insurance: DocRow[]; rtoPermission: DocRow[]; policePermission: DocRow[]; permit: DocRow[];
  condition: string; specification: string;
}

let seq = 0;
export const newDoc = (p: Partial<Omit<DocRow, "id">> = {}): DocRow => ({ id: `d${++seq}`, nextRenewalDate: "", attachment: null, ...p });

/** Today in India as YYYY-MM-DD. */
export const todayIST = (now = new Date()): string => new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

export const emptyForm = (now = new Date()): VForm => ({
  vehicleNo: "", make: "", model: "", type: "Dynamic", yearOfManufacture: "", purchaseDate: todayIST(now),
  currentRunning: "", totalRunning: "", stepneyStatus: "", batteryStatus: "", oilTopUpOn: "", greasePackingOn: "", generalCheckUpOn: "",
  fc: [], insurance: [], rtoPermission: [], policePermission: [], permit: [], condition: "", specification: "",
});

// ---- input sanitisers: stop invalid characters at the keyboard
export const sanitizeVehicleNo = (raw: string): string => raw.toUpperCase().replace(/[^A-Z0-9 -]/g, "").slice(0, 14);
export const sanitizeYear = (raw: string): string => raw.replace(/[^0-9]/g, "").slice(0, 4);
export const sanitizeRunning = (raw: string): string => sanitizeDecimal(raw).slice(0, 11);

const STANDARD = /^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{1,4}$/;
const BH = /^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$/;
export function normalizeVehicleNo(raw: string): string | null {
  const v = raw.trim().replace(/[ -]/g, "").toUpperCase();
  return STANDARD.test(v) || BH.test(v) ? v : null;
}

const realDate = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

// ---- document rows
export const addDoc = (f: VForm, k: DocKey, row: Partial<Omit<DocRow, "id">> = {}): VForm => ({ ...f, [k]: [...f[k], newDoc(row)] });
export const removeDoc = (f: VForm, k: DocKey, id: string): VForm => ({ ...f, [k]: f[k].filter((d) => d.id !== id) });
export const updateDoc = (f: VForm, k: DocKey, id: string, patch: Partial<Omit<DocRow, "id">>): VForm => ({
  ...f, [k]: f[k].map((d) => (d.id === id ? { ...d, ...patch } : d)),
});
/** Completely empty rows are never saved. */
export const filledDocs = (rows: DocRow[]): DocRow[] => rows.filter((d) => d.nextRenewalDate || d.attachment);

export type DocStatus = "VALID" | "EXPIRING_SOON" | "EXPIRED" | "NONE";
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export function docStatus(expiry: string | null | undefined, now = new Date()): DocStatus {
  if (!expiry) return "NONE";
  const t = todayIST(now);
  return expiry < t ? "EXPIRED" : expiry <= addDays(t, 30) ? "EXPIRING_SOON" : "VALID";
}
export const DOC_STATUS_LABEL: Record<DocStatus, string> = { VALID: "Valid", EXPIRING_SOON: "Expiring soon", EXPIRED: "Expired", NONE: "No expiry" };

/** Mirrors the server rules. Drafts only check the format of what was entered. */
export function validateForm(f: VForm, draft: boolean, now = new Date()): string[] {
  const e: string[] = [];
  const today = todayIST(now);
  if (!draft) {
    const need: [string, string][] = [
      [f.vehicleNo, "Vehicle number"], [f.make, "Make"], [f.model, "Model"], [f.type, "Type"], [f.yearOfManufacture, "Year of manufacture"],
      [f.purchaseDate, "Purchase date"], [f.currentRunning, "Current running"], [f.totalRunning, "Total running"],
    ];
    for (const [v, label] of need) if (!v.trim()) e.push(`${label} is required`);
  }
  if (f.vehicleNo.trim() && !normalizeVehicleNo(f.vehicleNo)) e.push("Vehicle number is not a valid registration number (e.g. TN58BM6554)");
  if (f.yearOfManufacture) {
    const y = Number(f.yearOfManufacture);
    if (!(y >= 1950 && y <= Number(today.slice(0, 4)))) e.push(`Year of manufacture must be between 1950 and ${today.slice(0, 4)}`);
  }
  if (f.purchaseDate) {
    if (!realDate(f.purchaseDate)) e.push("Purchase date is not a valid date");
    else {
      if (f.purchaseDate > today) e.push("Purchase date cannot be in the future");
      if (f.yearOfManufacture && Number(f.purchaseDate.slice(0, 4)) < Number(f.yearOfManufacture)) e.push("Purchase date cannot be before the year of manufacture");
    }
  }
  for (const [v, label] of [[f.currentRunning, "Current running"], [f.totalRunning, "Total running"]] as const)
    if (v !== "" && !(Number(v) >= 0)) e.push(`${label} must be a valid number`);
  for (const [v, label] of [[f.oilTopUpOn, "Oil top up date"], [f.greasePackingOn, "Grease packing date"], [f.generalCheckUpOn, "General check up date"]] as const) {
    if (!v) continue;
    if (!realDate(v)) e.push(`${label} is not a valid date`);
    else if (f.purchaseDate && v < f.purchaseDate) e.push(`${label} cannot be before the purchase date`);
  }
  for (const k of DOC_KEYS)
    filledDocs(f[k]).forEach((d, i) => {
      const tag = `${DOC_LABEL[k]} entry ${i + 1}`;
      if (!d.nextRenewalDate) e.push(`${tag}: next renewal date is required`);
      else if (!realDate(d.nextRenewalDate)) e.push(`${tag}: next renewal date is not a valid date`);
    });
  return e;
}

export function toPayload(f: VForm, saveAs: "DRAFT" | "FINAL", status?: string) {
  const docs = {} as Record<DocKey, { nextRenewalDate: string; attachment: Omit<Attachment, "url"> | null }[]>;
  for (const k of DOC_KEYS)
    docs[k] = filledDocs(f[k]).map((d) => ({
      nextRenewalDate: d.nextRenewalDate,
      attachment: d.attachment ? { storage: d.attachment.storage, key: d.attachment.key, name: d.attachment.name, size: d.attachment.size, mimeType: d.attachment.mimeType } : null,
    }));
  return {
    saveAs, ...(status ? { status } : {}),
    vehicleNo: f.vehicleNo, make: f.make, model: f.model, type: f.type, yearOfManufacture: f.yearOfManufacture,
    purchaseDate: f.purchaseDate, currentRunning: f.currentRunning, totalRunning: f.totalRunning,
    stepneyStatus: f.stepneyStatus, batteryStatus: f.batteryStatus, oilTopUpOn: f.oilTopUpOn, greasePackingOn: f.greasePackingOn,
    generalCheckUpOn: f.generalCheckUpOn, condition: f.condition, specification: f.specification, ...docs,
  };
}

type Saved = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
/** Restores every saved value into the form. */
export function fromVehicle(v: Saved): VForm {
  const docs = (k: DocKey): DocRow[] =>
    (Array.isArray(v[k]) ? (v[k] as Saved[]) : []).map((d) => newDoc({ nextRenewalDate: s(d.nextRenewalDate), attachment: (d.attachment as Attachment | null | undefined) ?? null }));
  return {
    vehicleNo: s(v.vehicleNo), make: s(v.make), model: s(v.model), type: s(v.type) || "Dynamic", yearOfManufacture: s(v.yearOfManufacture),
    purchaseDate: s(v.purchaseDate), currentRunning: s(v.currentRunning), totalRunning: s(v.totalRunning), stepneyStatus: s(v.stepneyStatus),
    batteryStatus: s(v.batteryStatus), oilTopUpOn: s(v.oilTopUpOn), greasePackingOn: s(v.greasePackingOn), generalCheckUpOn: s(v.generalCheckUpOn),
    fc: docs("fc"), insurance: docs("insurance"), rtoPermission: docs("rtoPermission"), policePermission: docs("policePermission"),
    permit: docs("permit"), condition: s(v.condition), specification: s(v.specification),
  };
}

// ---- history display
export const HISTORY_LABEL: Record<string, string> = {
  CREATED: "Vehicle created", DRAFT_SAVED: "Draft saved", DRAFT_CONVERTED: "Draft converted to final record", UPDATED: "Vehicle updated",
  FC_UPDATED: "FC updated", INSURANCE_UPDATED: "Insurance updated", RTO_UPDATED: "RTO permission updated", POLICE_UPDATED: "Police permission updated",
  PERMIT_UPDATED: "Permit updated", MAINTENANCE_UPDATED: "Maintenance dates changed", STATUS_CHANGED: "Status changed", DRAFT_DELETED: "Draft deleted",
  MARKED_AVAILABLE: "Vehicle marked Available", PROJECT_ASSIGNED: "Assigned to another project", PROJECT_UPDATED: "Project allocation updated",
  RELEASE_CHANGED: "Release / next available date changed", ISSUE_REPORTED: "Vehicle issue reported", ISSUE_UPDATED: "Issue details updated",
  REPAIR_DATE_CHANGED: "Expected repair date changed", ISSUE_RESOLVED: "Issue resolved", AUTO_AVAILABILITY_UPDATE: "Automatically marked Available",
};
export const FIELD_LABEL: Record<string, string> = {
  vehicleNo: "Vehicle No", make: "Make", model: "Model", type: "Type", yearOfManufacture: "Year of Manufacture", purchaseDate: "Purchase Date",
  currentRunning: "Current Running", totalRunning: "Total Running", stepneyStatus: "Stepney Status", batteryStatus: "Battery Status",
  oilTopUpOn: "Oil Top Up On", greasePackingOn: "Grease Packing On", generalCheckUpOn: "General Check Up On", fc: "FC", insurance: "Insurance",
  rtoPermission: "RTO Permission", policePermission: "Police Permission", permit: "Permit", condition: "Condition", specification: "Specification", status: "Status",
  availabilityStatus: "Vehicle Status", availableFrom: "Available From", projectType: "Project Type", projectName: "Project Name", clientName: "Client / Billing Name",
  trackupNumber: "Trackup Number", pifNumber: "PIF Number", projectStart: "Project Start Date", projectEnd: "Project End Date", location: "Location",
  projectRemarks: "Additional Remarks", expectedRelease: "Expected Release", nextAvailable: "Next Available", issueCategory: "Issue Category",
  issueDescription: "Issue Description / Reason", issueReported: "Issue Reported", expectedRepair: "Expected Repair Completion", garage: "Garage / Service Centre",
  repairRemarks: "Repair Remarks", issueStatus: "Issue Status",
};

/** Human-readable value for a history change; never "undefined" or "[object Object]". */
export function fmtValue(field: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v))
    return v.length
      ? v.map((d: Saved) => {
          const att = d.attachment as { name?: string } | null | undefined;
          const date = d.nextRenewalDate ? `renewal ${formatDate(s(d.nextRenewalDate))}` : "";
          return [date, att?.name].filter(Boolean).join(", ") || "—";
        }).join("; ")
      : "—";
  if (field === "availabilityStatus") return AV_LABEL[v as AvStatus] ?? String(v);
  if (field === "projectType") return PROJECT_TYPE_LABEL[String(v)] ?? String(v);
  if (field === "issueStatus") return ISSUE_STATUS_LABEL[String(v)] ?? String(v);
  if (["availableFrom", "expectedRelease", "nextAvailable", "issueReported", "expectedRepair"].includes(field) && typeof v === "string") return formatLabelAt(v);
  if (["projectStart", "projectEnd"].includes(field) && typeof v === "string") return formatDate(v);
  if (/On$|Date$/.test(field) && typeof v === "string") return formatDate(v);
  return String(v);
}
