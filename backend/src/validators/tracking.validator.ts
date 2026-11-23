import { countDays } from "../utils/days.js";
import { normalizeIndianPhone } from "../utils/phone.js";

type Obj = Record<string, unknown>;
export interface ValidationResult {
  errors: string[];
  clientName: string;
  vehicleCount: number;
  details: Obj;
}

const isDate = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const yesNo = (v: unknown) => v === "YES" || v === "NO";

export function validateTracking(projectType: unknown, input: unknown): ValidationResult {
  const errors: string[] = [];
  const b = (input && typeof input === "object" ? input : {}) as Obj;
  const req = (k: string, label: string) => {
    if (!str(b[k])) errors.push(`${label} is required`);
  };
  const count = Number(projectType === "ROADSHOW" ? b.numberOfVans : b.numberOfVehicles);
  if (!Number.isInteger(count) || count < 1 || count > 100)
    errors.push("Number of vehicles must be a whole number between 1 and 100");

  const details: Obj = { ...b };
  let clientName = "";

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
    if (isDate(b.startDate) && isDate(b.endDate) && String(b.endDate) < String(b.startDate))
      errors.push("End date cannot be before start date");
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
  } else if (projectType === "SIGNAGE") {
    clientName = str(b.client);
    req("client", "Client");
    req("jobSheetNumber", "Job sheet number");
    req("location", "Location");
    for (const k of ["date", "fromDate", "toDate"])
      if (!isDate(b[k])) errors.push(`${k} must be a valid date (YYYY-MM-DD)`);
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
  return { errors, clientName, vehicleCount: count, details };
}
