import { formatDate, formatInr, labelize } from "./format";
import { formatList } from "./historyFormat";

export interface DescribedField {
  /** Backend field key (used for rejection highlighting); null for derived totals. */
  key: string | null;
  label: string;
  value: string;
}

const yesNo = (b: unknown) => (b ? "Yes" : "No");
const unitLabel = (u: unknown) => (u === "PER_CAMPAIGN" ? "Per Campaign" : "Per Day");
const money = (v: unknown) => (typeof v === "number" ? formatInr(v) : "—");

export function show(x: unknown): string {
  if (x === null || x === undefined || x === "") return "—";
  if (typeof x === "boolean") return yesNo(x);
  if (Array.isArray(x)) return formatList(x);
  return String(x);
}

function othersText(data: Record<string, unknown>): string {
  if (Array.isArray(data.others)) return formatList(data.others);
  return data.othersDescription || data.othersAmount ? `${show(data.othersDescription)} ${money(data.othersAmount)}` : "—"; // earlier single pair
}

/** Human-readable labels for every field RSOM can flag. */
export const FIELD_LABELS: Record<string, string> = {
  mileage: "Mileage", estimatedKmPerDay: "Estimated KM per day", onRoadDate: "On Road Date", completionDate: "Completion Date",
  sundayHalt: "Sunday Halt", numberOfDays: "Number of days", dieselAmount: "Diesel Cost", salaryAmount: "Salary", salaryUnit: "Salary unit",
  foodAmount: "Food", foodUnit: "Food unit", haltFood: "Halt Food", tolls: "Toll Detail (Location & Rate)", others: "Others",
  fromLocation: "From", toLocation: "To", totalKm: "Total Km", upDownValue: "Up/Down Value", otherDetails: "Other Details",
};
export const fieldLabel = (key: string): string => FIELD_LABELS[key] ?? labelize(key);

const V2_REJECTABLE = [
  "mileage", "estimatedKmPerDay", "onRoadDate", "completionDate", "sundayHalt", "numberOfDays", "dieselAmount", "salaryAmount",
  "foodAmount", "haltFood", "tolls", "others", "fromLocation", "toLocation", "totalKm", "upDownValue",
];

/** Fields RSOM can pick when rejecting this budget (depends on the layout it was saved in). */
export function rejectableFields(data: Record<string, unknown>): { key: string; label: string }[] {
  const keys =
    data.schemaVersion === 2
      ? [...V2_REJECTABLE, ...(Array.isArray(data.otherDetails) && data.otherDetails.length ? ["otherDetails"] : [])]
      : Object.keys(data).filter((k) => k !== "computed" && k !== "schemaVersion");
  return keys.map((key) => ({ key, label: fieldLabel(key) }));
}

export function describeBudget(data: Record<string, unknown>): DescribedField[] {
  if (data.schemaVersion !== 2)
    // Legacy budget (before the redesign): show whatever was saved.
    return Object.entries(data).map(([k, v]) => ({ key: k, label: labelize(k), value: typeof v === "number" ? formatInr(v) : show(v) }));
  const c = (data.computed ?? {}) as Record<string, number>;
  const out: DescribedField[] = [
    { key: "mileage", label: "Mileage", value: show(data.mileage) },
    { key: "estimatedKmPerDay", label: "Estimated KM per day", value: show(data.estimatedKmPerDay) },
    { key: "onRoadDate", label: "On Road Date", value: formatDate(data.onRoadDate as string) },
    { key: "completionDate", label: "Completion Date", value: formatDate(data.completionDate as string) },
    { key: "sundayHalt", label: "Sunday Halt", value: yesNo(data.sundayHalt) },
    { key: "numberOfDays", label: "Number of days", value: show(data.numberOfDays) },
    { key: "dieselAmount", label: "Diesel Cost", value: `${money(data.dieselAmount)} (Per Campaign) = ${money(c.dieselValue)}` },
    { key: "salaryAmount", label: "Salary", value: `${money(data.salaryAmount)} (${unitLabel(data.salaryUnit)}) = ${money(c.salaryValue)}` },
    { key: "foodAmount", label: "Food", value: `${money(data.foodAmount)} (${unitLabel(data.foodUnit)}) = ${money(c.foodValue)}` },
    { key: "haltFood", label: "Halt Food", value: money(data.haltFood) },
    { key: "tolls", label: "Toll Detail", value: formatList(data.tolls) },
    { key: "tolls", label: "Toll Amount", value: money(c.tollAmount) },
    { key: "others", label: "Others", value: othersText(data) },
    { key: "fromLocation", label: "From", value: show(data.fromLocation) },
    { key: "toLocation", label: "To", value: show(data.toLocation) },
    { key: "totalKm", label: "Total Km", value: show(data.totalKm) },
    { key: "upDownValue", label: "Up/Down Value", value: money(data.upDownValue) },
    { key: null, label: "Total Value", value: money(c.totalValue) },
  ];
  if (Array.isArray(data.otherDetails) && data.otherDetails.length)
    out.push({ key: "otherDetails", label: "Other Details", value: formatList(data.otherDetails) });
  return out;
}

export type ApprovalStatus = "DRAFT" | "PENDING" | "APPROVED" | "REJECTED";
export const STATUS_LABEL: Record<ApprovalStatus, string> = {
  DRAFT: "Draft", PENDING: "Pending Approval", APPROVED: "Approved", REJECTED: "Rejected",
};
export const statusOf = (s: string | null | undefined): ApprovalStatus =>
  s === "PENDING" || s === "APPROVED" || s === "REJECTED" ? s : "DRAFT";

/** Only Draft and Rejected budgets can be edited by RBP. */
export const canEdit = (s: string | null | undefined): boolean => statusOf(s) === "DRAFT" || statusOf(s) === "REJECTED";
/** Draft can be submitted; Rejected only after a new version exists. */
export const canSubmit = (s: string | null | undefined, currentVersion: number, rejectedVersion?: number | null): boolean =>
  statusOf(s) === "DRAFT" || (statusOf(s) === "REJECTED" && currentVersion > (rejectedVersion ?? 0));

export const ROLE_HOME: Record<string, string> = { RSOP: "/rsop", RBP: "/rbp", RSOM: "/rsom" };
export const homeFor = (role: string): string => ROLE_HOME[role] ?? "/login";
