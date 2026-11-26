import { countDays } from "../utils/days.js";
import { isYmd, todayIst } from "../utils/dates.js";
import { normalizeIndianPhone } from "../utils/phone.js";
import { kmAllowanceOf, MAX_EXTRA_KM, parseKmPerDay } from "../utils/kmAllowance.js";

/** RSOP "Elements & Billing" dates: [key, label]. All of them must fall within the campaign. */
export const ELEMENT_DATES = [
  ["artsFileDate", "Arts File Date"], ["printingDate", "Printing Date"], ["fabricationDate", "Fabrication Date"],
  ["vehicleDeliveryDate", "Vehicle Delivery Date"], ["supportingDate", "Supporting Date"], ["invoiceDate", "Invoice Date"],
] as const;

type Obj = Record<string, unknown>;
export interface ValidationResult {
  errors: string[];
  clientName: string;
  vehicleCount: number;
  details: Obj;
  projectCode: string;
}

/** Project Code: exactly 8 digits. */
export const PROJECT_CODE = /^\d{8}$/;

const isDate = isYmd;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const yesNo = (v: unknown) => v === "YES" || v === "NO";

export interface TrackingValidationOptions {
  /** Reference "now" (tests). */
  now?: Date;
  /** Historical imports (dev seed) may record campaigns that already started. Never set from the API. */
  allowPastStart?: boolean;
}

export function validateTracking(projectType: unknown, input: unknown, opts: TrackingValidationOptions = {}): ValidationResult {
  const errors: string[] = [];
  const today = todayIst(opts.now);
  const b = (input && typeof input === "object" ? input : {}) as Obj;
  const req = (k: string, label: string) => {
    if (!str(b[k])) errors.push(`${label} is required`);
  };
  const count = Number(projectType === "ROADSHOW" ? b.numberOfVans : b.numberOfVehicles);
  if (!Number.isInteger(count) || count < 1 || count > 100)
    errors.push("Number of vehicles must be a whole number between 1 and 100");

  const details: Obj = { ...b };
  if (projectType === "ROADSHOW") delete details.model;
  let clientName = "";
  // Project Code (both types): exactly 8 digits, kept as text so leading zeros survive.
  const projectCode = typeof b.projectCode === "string" ? b.projectCode.trim() : "";
  if (b.projectCode === undefined || b.projectCode === null || b.projectCode === "") errors.push("Project Code is required");
  else if (!PROJECT_CODE.test(projectCode)) errors.push("Project Code must be exactly 8 digits (0-9 only)");
  else details.projectCode = projectCode;

  if (projectType === "ROADSHOW") {
    clientName = str(b.billingName);
    req("billingName", "Billing name");
    req("stateCode", "State code");
    for (const k of ["startDate", "endDate", "reportingDate"])
      if (!isDate(b[k])) errors.push(`${k} must be a valid date (YYYY-MM-DD)`);
    for (const k of [
      "artsFileDate",
      "printingDate",
      "fabricationDate",
      "vehicleDeliveryDate",
      "supportingDate",
      "invoiceDate",
    ])
      if (b[k] && !isDate(b[k])) errors.push(`${k} must be a valid date (YYYY-MM-DD)`);
    if (isDate(b.startDate) && !opts.allowPastStart && String(b.startDate) < today)
      errors.push("Start date cannot be in the past");
    if (isDate(b.startDate) && isDate(b.endDate) && String(b.endDate) < String(b.startDate))
      errors.push("End date cannot be before start date");
    if (isDate(b.reportingDate) && isDate(b.startDate) && isDate(b.endDate)) {
      const reporting = String(b.reportingDate);
      if (reporting < String(b.startDate) || reporting > String(b.endDate))
        errors.push("Reporting date must be within the campaign start and end dates");
    }
    // Elements & Billing dates belong to the campaign: each one lies within the campaign start and end dates.
    if (isDate(b.startDate) && isDate(b.endDate))
      for (const [k, label] of ELEMENT_DATES)
        if (isDate(b[k]) && (String(b[k]) < String(b.startDate) || String(b[k]) > String(b.endDate)))
          errors.push(`${label} must be within the campaign start and end dates`);
    // Production order: arts file -> printing -> fabrication -> vehicle delivery. Supporting and invoice dates have no fixed order.
    const milestones = ["artsFileDate", "printingDate", "fabricationDate", "vehicleDeliveryDate"] as const;
    for (let i = 1; i < milestones.length; i++) {
      const previous = b[milestones[i - 1]];
      const current = b[milestones[i]];
      if (isDate(previous) && isDate(current) && String(current) < String(previous))
        errors.push(`${milestones[i]} cannot be before ${milestones[i - 1]}`);
    }
    if (!yesNo(b.sundayHalt)) errors.push("Sunday halt must be YES or NO");
    for (const k of ["paSystem", "mike", "tv", "promoter", "leaflet", "extraKmAllowed"])
      if (b[k] && !yesNo(b[k])) errors.push(`${k} must be YES or NO`);
    if (!Array.isArray(b.reportingLocations) || b.reportingLocations.length === 0)
      errors.push("At least one reporting location is required");
    if (b.contactNumber) {
      const phone = normalizeIndianPhone(b.contactNumber);
      if (phone) details.contactNumber = phone;
      else errors.push("Contact number must be a valid 10-digit mobile number (+91)");
    }
    if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(b.email))) errors.push("Email is invalid");
    if (isDate(b.startDate) && isDate(b.endDate) && yesNo(b.sundayHalt))
      details.numberOfDays = countDays(String(b.startDate), String(b.endDate), b.sundayHalt === "YES");
    // Extra KM: an extra daily allowance (KM per day), entered only when Extra KM Allowed = YES (otherwise always 0).
    if (b.extraKmAllowed === "YES") {
      const raw = b.extraKmAllotted;
      const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+(\.\d{1,2})?$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
      if (raw === undefined || raw === null || raw === "") errors.push("Extra KM Allotted is required when Extra KM Allowed is Yes");
      else if (!Number.isFinite(n) || n <= 0 || Math.abs(Math.round(n * 100) - n * 100) > 1e-6) errors.push("Extra KM Allotted must be a number greater than 0 (up to 2 decimals)");
      else if (n > MAX_EXTRA_KM) errors.push(`Extra KM Allotted cannot be more than ${MAX_EXTRA_KM} KM per day`);
      else details.extraKmAllotted = n;
      if (parseKmPerDay(b.kmAllotted) === null) errors.push("KM Allotted (KM per day) is required as a number when Extra KM Allowed is Yes");
    } else details.extraKmAllotted = 0;
    const allowance = kmAllowanceOf("ROADSHOW", details);
    if (allowance?.totalAllowedKm !== null && allowance?.totalAllowedKm !== undefined) details.totalAllowedKm = allowance.totalAllowedKm;
    else delete details.totalAllowedKm; // derived on the server only, never taken from the browser
  } else if (projectType === "SIGNAGE") {
    clientName = str(b.client);
    req("client", "Client");
    req("jobSheetNumber", "Job sheet number");
    req("location", "Location");
    for (const k of ["date", "fromDate", "toDate"])
      if (!isDate(b[k])) errors.push(`${k} must be a valid date (YYYY-MM-DD)`);
    if (isDate(b.date) && String(b.date) > today) errors.push("Date cannot be in the future");
    if (isDate(b.fromDate) && isDate(b.toDate) && String(b.toDate) < String(b.fromDate))
      errors.push("To date cannot be before from date");
    if (b.arrivedBudget !== undefined && b.arrivedBudget !== "" && !(Number(b.arrivedBudget) >= 0))
      errors.push("Arrived budget must be a non-negative number");
    if (b.totalDaysOfWork === undefined || b.totalDaysOfWork === "") {
      if (isDate(b.fromDate) && isDate(b.toDate))
        details.totalDaysOfWork = countDays(String(b.fromDate), String(b.toDate), false);
    } else if (!(Number(b.totalDaysOfWork) >= 1)) {
      errors.push("Total days of work must be at least 1");
    }
  } else {
    errors.push("Project type must be ROADSHOW or SIGNAGE");
  }
  return { errors, clientName, vehicleCount: count, details, projectCode };
}
