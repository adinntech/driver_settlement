import { amountPaise } from "./rsa";
import { countDays } from "./format";
import { isYmd } from "./dates";
import type { KmAllowance } from "./kmAllowance";

// ---------------------------------------------------------------- API types
export type PaymentCategory = "DAILY" | "FINAL";
export type SettlementStatus = "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED";

export interface SettlementRow {
  _id: string; paymentNumber: string; category: PaymentCategory; categoryLabel: string; status: SettlementStatus; version: number; submittedRole?: "RBP" | "RSA";
  trackingVehicle: string; trackupNumber: string; pifNumber: string | null; jsNumber: string | null; clientName: string | null; projectType: "ROADSHOW" | "SIGNAGE";
  vehicleNo: string | null; driverNumber: string | null; driverName: string | null; fromDate: string; toDate: string; amount: number;
  bank: { accountName: string | null; bankName: string | null; ifscCode: string | null; accountMasked: string | null } | null;
  submittedBy: string; submittedAt: string; reviewedBy: string | null; reviewedRole: string | null; reviewedAt: string | null; rejectionReason: string | null;
  approver: "RSOM" | "RSO"; exportedAt: string | null; exportCount: number;
  completion: null | { referenceNumber: string; referenceDate?: string | null; paymentDate: string; paymentMode: string; bankName: string | null; transactionMasked: string | null; remarks: string | null; completedBy: string; completedAt: string };
}
/** Payment modes of the RSA payment Entry popup. Older completed records may carry NEFT / RTGS / IMPS / UPI. */
export const ENTRY_MODES = [{ v: "CASH", l: "Cash" }, { v: "CHEQUE", l: "Cheque" }, { v: "DD", l: "DD" }, { v: "EPAYMENT", l: "ePayment" }] as const;
export const modeLabel = (m: string | null | undefined) => (m ? ENTRY_MODES.find((x) => x.v === m)?.l ?? m : "-");
/** Reference number as typed: letters, digits, / - _ only (spaces and other characters are dropped while typing). */
export const cleanReference = (v: string) => v.replace(/[^A-Za-z0-9/_-]/g, "").slice(0, 60);

export interface PaymentEntryForm { paymentMode: string; paymentDate: string; bankName: string; referenceNumber: string; referenceDate: string }
/** Same rules as the server's validateCompletion: mode, payment date and reference are required; bank except for Cash. */
export function validatePaymentEntry(f: PaymentEntryForm, today: string, approvedOn = ""): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.paymentMode) e.paymentMode = "Choose the payment mode";
  if (!f.paymentDate) e.paymentDate = "Enter the payment date";
  else if (!isYmd(f.paymentDate)) e.paymentDate = "Payment date must be a valid date";
  else if (f.paymentDate > today) e.paymentDate = "Payment date cannot be in the future";
  else if (approvedOn && f.paymentDate < approvedOn) e.paymentDate = "Payment date cannot be before the approval date";
  if (f.paymentMode && f.paymentMode !== "CASH" && !f.bankName.trim()) e.bankName = "Enter the bank name";
  else if (/[<>]/.test(f.bankName)) e.bankName = "Bank name contains invalid characters";
  if (!f.referenceNumber.trim()) e.referenceNumber = "Enter the reference number of this payment";
  if (f.referenceDate && !isYmd(f.referenceDate)) e.referenceDate = "Reference date must be a valid date";
  else if (f.referenceDate && f.referenceDate > today) e.referenceDate = "Reference date cannot be in the future";
  return e;
}

export interface HistoryEntry { action: string; version: number; fromStatus: string | null; toStatus: string | null; username: string; role: string; comment: string | null; amount: number | null; createdAt: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface SettlementDetail extends SettlementRow { data: Record<string, any>; history: HistoryEntry[] }
export interface SettlementPage { items: SettlementRow[]; total: number; page: number; limit: number; summary: Record<string, { count: number; amount: number }> }

export interface SettlementContext {
  trackingVehicle: string; trackupNumber: string; pifNumber: string; clientName: string; projectType: "ROADSHOW" | "SIGNAGE"; vehicleNo: string; driverNumber: string; driverName: string;
  approvedBudgetAmount: number | null; budgetVersion: number | null;
  campaign: { fromDate: string | null; toDate: string | null; totalDays: number | null; location: string | null; jsNumber: string | null; reportingDate: string | null; sundayHalt?: boolean; km?: KmAllowance | null };
  advances?: { source: string; date: string; amount: number; note: string }[];
  previousPayments?: { source: string; paymentNumber: string; status: string; date: string; amount: number; mode: string; bankName: string | null; referenceNumber?: string | null }[];
  dailyPayments?: { paymentNumber: string; status: string; fromDate: string; toDate: string; amount: number; salaryAdvance: number; diesel: number; food: number }[];
  bank: { accountName: string | null; bankName: string | null; ifscCode: string | null; accountMasked: string | null };
  existingFinal: { paymentNumber: string; status: string } | null;
  prefill: Record<string, number | string | null>;
}
export interface SettlementOptions {
  dailyExpenseOptions: { key: string; label: string; descriptionRequired?: boolean }[];
  finalExpenseCategories: { key: string; label: string; descriptionRequired: boolean }[];
  deductions: { key: string; label: string }[];
  paymentModes: { value: string; label: string }[];
}

// ---------------------------------------------------------------- labels
export const STATUS_LABEL: Record<SettlementStatus, string> = { PENDING: "Pending Approval", APPROVED: "Approved", REJECTED: "Rejected", COMPLETED: "Paid" };
export const CATEGORY_SHORT: Record<PaymentCategory, string> = { DAILY: "Daily", FINAL: "Final" };
export const ACTION_LABEL: Record<string, string> = { SUBMITTED: "Submitted", RESUBMITTED: "Resubmitted", APPROVED: "Approved", REJECTED: "Rejected", EXPORTED: "Exported to accounts", COMPLETED: "Payment completed" };

export interface QueueFilters { category: "" | PaymentCategory; status: string; q: string; from: string; to: string; sort: string; dir: "asc" | "desc" }
export const emptyQueueFilters = (category: "" | PaymentCategory = "", status = ""): QueueFilters => ({ category, status, q: "", from: "", to: "", sort: "submittedAt", dir: "desc" });

/** The table's filters (not its sort or page) for Export Approved, so the file and the list are narrowed the same way. */
export function exportQuery(f: QueueFilters): string {
  const p = new URLSearchParams(queueQuery(f, 1, 1));
  for (const k of ["sort", "dir", "page", "limit"]) p.delete(k);
  return p.toString();
}

export function queueQuery(f: QueueFilters, page: number, limit: number): string {
  const p = new URLSearchParams();
  if (f.category) p.set("category", f.category);
  if (f.status) p.set("status", f.status);
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  p.set("sort", f.sort);
  p.set("dir", f.dir);
  p.set("page", String(page));
  p.set("limit", String(limit));
  return p.toString();
}

/** Driver Payments is one shared module: RBP and RSA enter and correct the same records. */
export const ENTRY_ROLES = ["RBP", "RSA"] as const;
export const paymentsBase = (role: string | undefined): string => (role === "RSA" ? "/rsa/driver-payments" : "/rbp/payments");
/** On Road Vehicles tab of each entry role (delivered vehicles; daily payments start here). */
export const onRoadBase = (role: string | undefined): string => (role === "RSA" ? "/rsa/on-road-vehicles" : "/rbp/on-road-vehicles");
/** The existing Daily Vehicle Payment form for a project vehicle, opened from On Road Vehicles (returns there afterwards). */
export const dailyPaymentHref = (role: string | undefined, tv: string): string => `${paymentsBase(role)}/daily?tv=${tv}&from=on-road`;

/** Which actions a role has on an entry (the server enforces the same rules). */
export function actionsFor(role: string, p: Pick<SettlementRow, "status" | "approver" | "category">) {
  return {
    canDecide: p.status === "PENDING" && role === p.approver,
    canResubmit: p.status === "REJECTED" && (ENTRY_ROLES as readonly string[]).includes(role),
    canComplete: p.status === "APPROVED" && role === "RSA",
    canPdf: p.category === "FINAL" && (p.status === "APPROVED" || p.status === "COMPLETED") && (role === "RSO" || role === "RSA"),
  };
}

// ---------------------------------------------------------------- final settlement form (mirrors backend/src/utils/settlement.ts)
export const FINAL_NUMBER_FIELDS = [
  "estimatedKmPerDay", "fixedMileage", "openingKm", "closingKm", "dieselCost", "ioclLitres", "ioclKms", "estimatedBudget", "estimatedKm", "estimatedFuel",
  "perDaySalary", "perDayFood", "travelPay", "travelKm", "travelRate", "onRoadDays", "onRoadSundays", "suspenseAmount",
] as const;
export type FinalNumberKey = (typeof FINAL_NUMBER_FIELDS)[number];
export const DEDUCTION_KEYS = ["mileageShort", "vehicleDamage", "previousSalary", "other"] as const;
export type DeductionKey = (typeof DEDUCTION_KEYS)[number];

export interface FinalExpenseRow { id: string; category: string; description: string; quantity: string; cost: string; approved: string }
export interface FinalForm {
  jsNumber: string; location: string; reportingDate: string; travelDetails: string;
  campaignFrom: string; campaignTo: string;
  driverChangeAmount: string; // owed from Change Driver: the minimum of Previous Salary Deduction ("" when nothing)
  n: Record<FinalNumberKey, string>;
  expenses: FinalExpenseRow[];
  deductions: Record<DeductionKey, string>;
  otherRemark: string;
}

const str = (v: unknown) => (v === null || v === undefined || v === 0 ? "" : String(v));
export function finalFormFrom(ctx: SettlementContext | null, saved?: Record<string, unknown> | null): FinalForm {
  const due = Number(ctx?.prefill.driverChangeAmount) || 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = saved as any;
  const n = Object.fromEntries(FINAL_NUMBER_FIELDS.map((k) => [k, ""])) as Record<FinalNumberKey, string>;
  if (s) {
    // what was added by hand stays; the driver-change part is replaced by what is owed now
    const manual = Math.round(((Number(s.deductions?.previousSalary) || 0) - (Number(s.driverChangeAmount) || 0)) * 100) / 100;
    Object.assign(n, {
      estimatedKmPerDay: str(s.estimatedKmPerDay), fixedMileage: str(s.fuel?.fixedMileage), openingKm: str(s.fuel?.openingKm), closingKm: str(s.fuel?.closingKm), dieselCost: str(s.fuel?.dieselCost),
      ioclLitres: str(s.fuel?.ioclLitres), ioclKms: str(s.fuel?.ioclKms), estimatedBudget: str(s.estimate?.estimatedBudget), estimatedKm: str(s.estimate?.estimatedKm), estimatedFuel: str(s.estimate?.estimatedFuel),
      perDaySalary: str(s.rates?.perDaySalary), perDayFood: str(s.rates?.perDayFood), travelPay: str(s.rates?.travelPay), travelKm: str(s.rates?.travelKm), travelRate: str(s.rates?.travelRate),
      onRoadDays: str(s.days?.onRoadDays), onRoadSundays: str(s.days?.onRoadSundays), suspenseAmount: str(s.suspenseAmount),
    });
    return {
      jsNumber: s.jsNumber ?? "", location: s.location ?? "", reportingDate: s.reportingDate ?? "", travelDetails: s.travelDetails ?? "", n,
      campaignFrom: s.campaignFrom ?? ctx?.campaign.fromDate ?? "", campaignTo: s.campaignTo ?? ctx?.campaign.toDate ?? "",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expenses: (s.expenses ?? []).map((e: any, i: number) => ({ id: `e${i}`, category: e.category, description: e.description ?? "", quantity: str(e.quantity), cost: str(e.cost), approved: String(e.approved ?? "") })),
      deductions: { ...(Object.fromEntries(DEDUCTION_KEYS.map((k) => [k, str(s.deductions?.[k])])) as Record<DeductionKey, string>), previousSalary: str(Math.max(manual, 0) + due) }, otherRemark: s.otherDeductionRemark ?? "",
      driverChangeAmount: str(due),
    };
  }
  const p: Record<string, unknown> = ctx?.prefill ?? {};
  for (const k of FINAL_NUMBER_FIELDS) n[k] = str(p[k]);
  const days = ctx ? campaignDays(ctx) : null;
  if (days) Object.assign(n, { onRoadDays: str(days.onRoadDays), onRoadSundays: str(days.onRoadSundays) });
  return {
    jsNumber: String(p.jsNumber ?? ""), location: String(p.location ?? ""), reportingDate: String(p.reportingDate ?? ctx?.campaign.fromDate ?? ""), travelDetails: "", n, expenses: [],
    campaignFrom: ctx?.campaign.fromDate ?? "", campaignTo: ctx?.campaign.toDate ?? "",
    deductions: { mileageShort: "", vehicleDamage: "", previousSalary: str(due), other: "" }, otherRemark: "", driverChangeAmount: str(due),
  };
}

/**
 * Days of the campaign period, split with the project's own Sunday rule (RSOP "Sunday halt"):
 *   Sunday halt = YES -> Sundays are not paid;   NO -> Sundays are on-road Sundays.   Every other day is an on-road day.
 */
export function campaignDays(ctx: Pick<SettlementContext, "campaign">) {
  const { fromDate, toDate, sundayHalt } = ctx.campaign;
  if (!fromDate || !toDate) return null;
  const calendar = countDays(fromDate, toDate, false);
  if (!calendar) return null;
  const sundays = calendar - countDays(fromDate, toDate, true);
  return { calendar, onRoadDays: calendar - sundays, onRoadSundays: sundayHalt ? 0 : sundays };
}

/** Travel Pay in paise: KM x rate when either is entered, otherwise the saved amount (mirrors validateFinalInput). */
export function travelPayPaise(n: Pick<Record<FinalNumberKey, string>, "travelPay" | "travelKm" | "travelRate">): number {
  const v = (s: string) => amountPaise(s) ?? 0;
  const km = v(n.travelKm), rate = v(n.travelRate);
  return km || rate ? Math.round((km * rate) / 100) : v(n.travelPay);
}

/** Same rules as the server; the server's figures are the ones saved. Values are in paise / hundredths. */
export function finalTotals(f: FinalForm) {
  const v = (s: string) => amountPaise(s) ?? 0;
  const n = Object.fromEntries(FINAL_NUMBER_FIELDS.map((k) => [k, v(f.n[k])])) as Record<FinalNumberKey, number>;
  const mul = (a: number, b: number) => Math.round((a * b) / 100);
  const resultKm = (n.closingKm - n.openingKm) / 100;
  const expectedLitres = n.fixedMileage ? Math.round((resultKm / (n.fixedMileage / 100)) * 100) / 100 : 0;
  const variationLitres = Math.round((n.ioclLitres / 100 - expectedLitres) * 100) / 100;
  const mileageShortSuggested = Math.max(0, Math.round(variationLitres * n.dieselCost));
  const earnings = [
    { label: "On Road Days Salary", amount: mul(n.onRoadDays, n.perDaySalary) },
    { label: "On Road Sunday Salary", amount: mul(n.onRoadSundays, n.perDaySalary) },
    { label: "Food (Per Day)", amount: mul(n.onRoadDays + n.onRoadSundays, n.perDayFood) },
    { label: "Travel Pay", amount: travelPayPaise(f.n) },
  ];
  const earningsTotal = earnings.reduce((s, e) => s + e.amount, 0);
  const rows = f.expenses.map((e) => {
    const claimed = mul(v(e.quantity), v(e.cost));
    const approved = e.approved.trim() === "" ? claimed : v(e.approved);
    return { id: e.id, claimed, approved, rejected: claimed - approved };
  });
  const claimed = rows.reduce((s, r) => s + r.claimed, 0);
  const approved = rows.reduce((s, r) => s + r.approved, 0);
  const gross = earningsTotal + approved;
  const totalDeduction = DEDUCTION_KEYS.reduce((s, k) => s + v(f.deductions[k]), 0);
  const net = gross - totalDeduction - n.suspenseAmount;
  return { resultKm, expectedLitres, variationLitres, mileageShortSuggested, earnings, earningsTotal, rows, claimed, approved, rejected: claimed - approved, gross, totalDeduction, net };
}

export function validateFinalForm(f: FinalForm, totalDays: number | null): string[] {
  const e: string[] = [];
  const v = (s: string) => amountPaise(s);
  if (!isYmd(f.campaignFrom) || !isYmd(f.campaignTo)) e.push("Campaign Start Date and End Date are required");
  else if (f.campaignTo < f.campaignFrom) e.push("Campaign End Date cannot be before the Start Date");
  if (!(v(f.n.travelKm) ?? 0) !== !(v(f.n.travelRate) ?? 0)) e.push("Enter both the Travel KM and the rate per KM");
  for (const k of FINAL_NUMBER_FIELDS) if (v(f.n[k]) === null) e.push(`${k} must contain digits only`);
  if (!(v(f.n.fixedMileage) ?? 0)) e.push("Fixed Mileage must be greater than zero");
  if ((v(f.n.closingKm) ?? 0) < (v(f.n.openingKm) ?? 0)) e.push("Closing KM cannot be less than Opening KM");
  const days = ["onRoadDays", "onRoadSundays"] as const;
  if (days.some((k) => (v(f.n[k]) ?? 0) % 100 !== 0)) e.push("Days must be whole numbers");
  const total = days.reduce((s, k) => s + (v(f.n[k]) ?? 0), 0) / 100;
  if (!total) e.push("Enter the On Road Days or On Road Sundays");
  if (totalDays && total > totalDays) e.push(`On road days and Sundays (${total}) cannot exceed the campaign's ${totalDays} days`);
  if ((v(f.deductions.previousSalary) ?? 0) < (v(f.driverChangeAmount) ?? 0)) e.push(`Previous Salary Deduction must be at least ${f.driverChangeAmount} (driver change deduction)`);
  const seen = new Set<string>();
  f.expenses.forEach((x, i) => {
    const sig = `${x.category}|${x.description.trim().toLowerCase()}`;
    if (seen.has(sig)) e.push(`Expense ${i + 1} duplicates an earlier entry`);
    seen.add(sig);
    if (!x.category) e.push(`Expense ${i + 1}: choose a category`);
    if (x.category === "OTHERS" && !x.description.trim()) e.push(`Expense ${i + 1}: description is required for Others`);
    if (!(v(x.quantity) ?? 0) || !(v(x.cost) ?? 0)) e.push(`Expense ${i + 1}: quantity and cost must be greater than zero`);
  });
  const t = finalTotals(f);
  t.rows.forEach((r, i) => r.approved > r.claimed && e.push(`Expense ${i + 1}: approved amount cannot be more than the claimed amount`));
  if ((v(f.deductions.other) ?? 0) > 0 && !f.otherRemark.trim()) e.push("Enter a remark for the other deduction");
  if (!e.length && t.net < 0) e.push("Total deduction and suspense amount are more than the gross amount");
  return e;
}

export function finalPayload(f: FinalForm, idempotencyKey: string) {
  return {
    driverChangeAmount: f.driverChangeAmount || undefined, campaignFrom: f.campaignFrom || undefined, campaignTo: f.campaignTo || undefined, jsNumber: f.jsNumber.trim() || undefined, location: f.location.trim() || undefined, travelDetails: f.travelDetails.trim() || undefined, ...Object.fromEntries(FINAL_NUMBER_FIELDS.map((k) => [k, f.n[k].trim()])),
    expenses: f.expenses.map((x) => ({ category: x.category, description: x.description.trim() || undefined, quantity: x.quantity.trim(), cost: x.cost.trim(), approved: x.approved.trim() || undefined })),
    deductions: { ...Object.fromEntries(DEDUCTION_KEYS.map((k) => [k, f.deductions[k].trim()])), otherRemark: f.otherRemark.trim() || undefined }, idempotencyKey,
  };
}
