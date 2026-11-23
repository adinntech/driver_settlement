import { formatInr } from "./format";

// ---- types of the RSA API
export interface ExpenseOption { key: string; label: string; descriptionRequired?: boolean }
export interface RsaOptions { expenseOptions: ExpenseOption[]; dieselPaymentModes: string[]; paymentFor: { key: "ROADSHOW" | "SIGNAGE"; label: string }[] }

export interface RsaProjectRow {
  trackingVehicle: string; allotment: string; trackupNumber: string; pifNumber: string; displayNumber: string | null; projectType: "ROADSHOW" | "SIGNAGE"; clientName: string;
  projectName: string | null; vehicleNo: string | null; driverNumber: string | null; driverName: string | null; campaignFromDate: string | null; campaignToDate: string | null;
  approvedBudgetAmount: number | null; budgetVersion: number | null; vehicleAllottedAt: string | null; driverAssignedAt: string | null; allotmentStatus: string;
  paymentCount: number; paymentStatus: "PENDING" | "ENTERED"; lastPaymentAt: string | null;
}
export interface RsaContext extends RsaProjectRow {
  billNumber: string | null; paymentFor: "ROADSHOW" | "SIGNAGE"; entryDateTime: string;
  vehicle: { _id: string; vehicleNo: string; make: string | null; model: string | null; type: string | null };
  driver: { _id: string; driverNumber: string; driverName: string; driverType: string | null; mobileNumber: string | null };
}
export interface RsaPaymentRow {
  _id: string; paymentNumber: string; trackupNumber: string; paymentFor: string; entryDateTime: string; cashInHand: boolean; totalPayable: number; mode: string;
  bankName: string | null; chequeNo: string | null; createdBy: string; paymentStatus: string; foodAmount: number; salaryAdvance: number; dieselTotal: number; expenseTotal: number; deductTotal: number;
  dieselEntries: { amount: number; mode: string | null; reference: string | null; entryAt: string }[];
  expenses: { optionKey: string; optionLabel: string; description: string | null; amount: number; deduct: boolean; isDefault: boolean }[];
  vehicleNo: string | null; driverNumber: string | null; driverName: string | null; clientName: string | null; campaignFromDate: string | null; campaignToDate: string | null;
  pifNumber?: string | null; billNumber?: string | null; displayNumber?: string | null;
}

// ---- amounts: digits with up to 2 decimals; integer paise internally so currency never drifts
export const MAX_AMOUNT = 99_999_999.99;
/** Keyboard filter: digits and one decimal point; letters, symbols and minus never get in. */
export const sanitizeAmount = (raw: string): string => {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const [whole, ...rest] = cleaned.split(".");
  return (rest.length ? `${whole}.${rest.join("").slice(0, 2)}` : whole).slice(0, 11);
};
/** null = not a valid amount. Empty = 0. */
export function amountPaise(raw: string): number | null {
  const t = raw.trim();
  if (!t) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  const p = Number(w) * 100 + Number(f.padEnd(2, "0"));
  return p > MAX_AMOUNT * 100 ? null : p;
}
export const money = (p: number): string => formatInr(p / 100);

// ---- form state
export interface DieselRow { id: string; amount: string; mode: string; reference: string }
export interface ExpenseRow { id: string; optionKey: string; optionLabel: string; description: string; amount: string; deduct: boolean; isDefault: boolean }
export interface PaymentForm { cashInHand: boolean; diesel: DieselRow[]; foodAmount: string; salaryAdvance: string; expenses: ExpenseRow[] }
export const emptyPaymentForm = (): PaymentForm => ({ cashInHand: false, diesel: [], foodAmount: "", salaryAdvance: "", expenses: [] });

let counter = 0;
export const rowId = (): string => `r${Date.now().toString(36)}${(counter++).toString(36)}`;

export interface ExpenseDraft { optionKey: string; description: string; amount: string; deduct: boolean; isDefault: boolean }
export const emptyExpenseDraft = (optionKey = ""): ExpenseDraft => ({ optionKey, description: "", amount: "", deduct: false, isDefault: false });

const sig = (e: { optionKey: string; description: string; amount: string; deduct: boolean }) =>
  [e.optionKey, e.description.trim().replace(/\s+/g, " ").toLowerCase(), amountPaise(e.amount), e.deduct].join("|");

/** Checks one expense row before it is added (mirrors the server). `ignoreId` = the row being edited. */
export function validateExpenseDraft(d: ExpenseDraft, options: ExpenseOption[], existing: ExpenseRow[], ignoreId?: string): string[] {
  const e: string[] = [];
  const opt = options.find((o) => o.key === d.optionKey);
  if (!opt) e.push("Choose an expense category");
  if (opt?.descriptionRequired && !d.description.trim()) e.push(`Description is required for ${opt.label}`);
  if (/[<>]/.test(d.description)) e.push("Description contains invalid characters");
  if (d.description.trim().length > 200) e.push("Description is too long (max 200)");
  const p = amountPaise(d.amount);
  if (!d.amount.trim()) e.push("Amount is required");
  else if (p === null) e.push("Amount must contain digits only (e.g. 500 or 500.50)");
  else if (p === 0) e.push("Amount must be greater than zero");
  if (opt && p && existing.some((x) => x.id !== ignoreId && sig(x) === sig(d))) e.push("This expense is already added");
  return e;
}

export interface DieselDraft { amount: string; mode: string; reference: string }
export const emptyDieselDraft = (): DieselDraft => ({ amount: "", mode: "", reference: "" });
export function validateDieselDraft(d: DieselDraft, modes: string[]): string[] {
  const e: string[] = [];
  const p = amountPaise(d.amount);
  if (!d.amount.trim()) e.push("Enter the fuel / diesel amount");
  else if (p === null) e.push("Fuel / diesel amount must contain digits only (e.g. 500 or 500.50)");
  else if (p === 0) e.push("Fuel / diesel amount must be greater than zero");
  if (d.mode && !modes.includes(d.mode)) e.push("Choose a valid payment mode");
  return e;
}

/** Total Payable = diesel + food + salary advance + expenses - expenses marked Deduct. (The server recalculates; its value is the one saved.) */
export function totals(f: PaymentForm) {
  const p = (s: string) => amountPaise(s) ?? 0;
  const diesel = f.diesel.reduce((s, d) => s + p(d.amount), 0);
  const add = f.expenses.filter((x) => !x.deduct).reduce((s, x) => s + p(x.amount), 0);
  const ded = f.expenses.filter((x) => x.deduct).reduce((s, x) => s + p(x.amount), 0);
  const total = diesel + p(f.foodAmount) + p(f.salaryAdvance) + add - ded;
  return { diesel, expenseAdd: add, expenseDeduct: ded, expenseNet: add - ded, total };
}

/** Warns (never blocks) when Fuel / Food Allowance are also typed as expense rows next to their own fields: both are counted. */
export function overlapWarnings(f: PaymentForm): string[] {
  const w: string[] = [];
  if (f.diesel.length && f.expenses.some((e) => e.optionKey === "FUEL" && !e.deduct)) w.push("Fuel is entered both as Diesel Cost and as an expense row: both amounts are added to the total.");
  if ((amountPaise(f.foodAmount) ?? 0) > 0 && f.expenses.some((e) => e.optionKey === "FOOD_ALLOWANCE" && !e.deduct)) w.push("Food is entered both in the Food field and as an expense row: both amounts are added to the total.");
  return w;
}

export function validatePaymentForm(f: PaymentForm): string[] {
  const e: string[] = [];
  if (amountPaise(f.foodAmount) === null) e.push("Food Allowance must contain digits only (e.g. 500 or 500.50)");
  if (amountPaise(f.salaryAdvance) === null) e.push("Salary Advance must contain digits only (e.g. 500 or 500.50)");
  if (!f.diesel.length && !f.expenses.length && !(amountPaise(f.foodAmount) ?? 0) && !(amountPaise(f.salaryAdvance) ?? 0)) e.push("Enter at least one amount (diesel, food, salary advance or an expense)");
  if (totals(f).total < 0) e.push("The deductions are more than the payable amount");
  return e;
}

/** Only the entered values and the submission key are sent: the entry time, user, number and project details are set by the server. */
export function toPaymentPayload(f: PaymentForm, paymentFor: string, idempotencyKey: string) {
  return {
    paymentFor, cashInHand: f.cashInHand, idempotencyKey,
    dieselEntries: f.diesel.map((d) => ({ amount: d.amount.trim(), mode: d.mode || undefined, reference: d.reference.trim() || undefined })),
    foodAmount: f.foodAmount.trim(), salaryAdvance: f.salaryAdvance.trim(),
    expenses: f.expenses.map((x) => ({ optionKey: x.optionKey, description: x.description.trim() || undefined, amount: x.amount.trim(), deduct: x.deduct, isDefault: x.isDefault })),
  };
}

export const newSubmissionKey = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `rsa-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const PAYMENT_FOR_LABEL: Record<string, string> = { ROADSHOW: "Roadshow", SIGNAGE: "Signage" };
export const PAYMENT_STATUS_LABEL: Record<string, string> = { PENDING: "No entry yet", ENTERED: "Entered" };
/** Empty values show a dash, never "undefined" / "null". */
export const dash = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : String(v));
