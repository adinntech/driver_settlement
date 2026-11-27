import { DESCRIPTION_REQUIRED, DIESEL_PAYMENT_MODES, EXPENSE_OPTIONS, PAYMENT_FOR } from "../config/rsaOptions.js";

type Obj = Record<string, unknown>;
const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
// eslint-disable-next-line no-control-regex -- intentionally rejects control characters in free text
const SAFE_TEXT = /^[^<>\u0000-\u001f\u007f]+$/u;
export const MAX_AMOUNT_PAISE = 9_999_999_999; // 99,999,999.99

/** Decimal-safe amount: digits with up to 2 decimals (string or number), never negative. Returns integer paise. */
export function parseAmountPaise(raw: unknown): { paise: number | null; error: string | null } {
  if (blank(raw)) return { paise: 0, error: null };
  let t: string;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { paise: null, error: "must be a number" };
    if (raw < 0) return { paise: null, error: "cannot be negative" };
    t = String(raw);
    if (/e/i.test(t)) return { paise: null, error: "must be a plain number" };
  } else if (typeof raw === "string") {
    t = raw.trim();
    if (/^-/.test(t)) return { paise: null, error: "cannot be negative" };
  } else return { paise: null, error: "must be a number" };
  if (!/^\d+(\.\d+)?$/.test(t)) return { paise: null, error: "must contain digits only (e.g. 500 or 500.50)" };
  if (/\.\d{3,}/.test(t)) return { paise: null, error: "can have at most 2 decimal places" };
  const [w, f = ""] = t.split(".");
  const paise = Number(w) * 100 + Number(f.padEnd(2, "0"));
  if (paise > MAX_AMOUNT_PAISE) return { paise: null, error: "is too large" };
  return { paise, error: null };
}
export const rupees = (p: number) => p / 100;

export interface DieselIn { amountPaise: number; mode: string | null; reference: string | null }
export interface ExpenseIn { optionKey: string; optionLabel: string; description: string | null; amountPaise: number; deduct: boolean; isDefault: boolean }
export interface PaymentInput {
  paymentFor: (typeof PAYMENT_FOR)[number] | null;
  cashInHand: boolean;
  diesel: DieselIn[];
  foodPaise: number;
  salaryAdvancePaise: number;
  expenses: ExpenseIn[];
  idempotencyKey: string;
}

/**
 * Total Payable = diesel + food + salary advance + expenses - expenses marked Deduct.
 * (Working rule until the business confirms the exact formula; kept in this one function so it can be changed in one place.)
 */
export function calculatePayable(p: Pick<PaymentInput, "diesel" | "foodPaise" | "salaryAdvancePaise" | "expenses">) {
  const dieselP = p.diesel.reduce((s, d) => s + d.amountPaise, 0);
  const addP = p.expenses.filter((e) => !e.deduct).reduce((s, e) => s + e.amountPaise, 0);
  const dedP = p.expenses.filter((e) => e.deduct).reduce((s, e) => s + e.amountPaise, 0);
  const totalP = dieselP + p.foodPaise + p.salaryAdvancePaise + addP - dedP;
  return { dieselP, expenseAddP: addP, expenseDeductP: dedP, totalP };
}

const KEY = /^[A-Za-z0-9_-]{8,64}$/;

export function validatePaymentInput(input: unknown): { errors: string[]; data: PaymentInput | null } {
  const b = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Obj;
  const errors: string[] = [];
  const amount = (raw: unknown, label: string, mustBePositive = false): number => {
    const r = parseAmountPaise(raw);
    if (r.error) {
      errors.push(`${label} ${r.error}`);
      return 0;
    }
    if (mustBePositive && !r.paise) errors.push(`${label} must be greater than zero`);
    return r.paise ?? 0;
  };
  const text = (v: unknown, label: string, max: number, required = false): string | null => {
    if (blank(v)) {
      if (required) errors.push(`${label} is required`);
      return null;
    }
    if (typeof v !== "string") {
      errors.push(`${label} is invalid`);
      return null;
    }
    const t = v.trim().replace(/\s+/g, " ");
    if (t.length > max) errors.push(`${label} is too long (max ${max})`);
    else if (!SAFE_TEXT.test(t)) errors.push(`${label} contains invalid characters`);
    return t;
  };

  let paymentFor: PaymentInput["paymentFor"] = null;
  if (!blank(b.paymentFor)) {
    if (!(PAYMENT_FOR as readonly string[]).includes(b.paymentFor as string)) errors.push("Payment For must be Roadshow or Signage");
    else paymentFor = b.paymentFor as PaymentInput["paymentFor"];
  }
  if (b.cashInHand !== undefined && typeof b.cashInHand !== "boolean") errors.push("Cash in Hand must be true or false");

  const diesel: DieselIn[] = [];
  if (b.dieselEntries !== undefined && b.dieselEntries !== null) {
    if (!Array.isArray(b.dieselEntries)) errors.push("Diesel entries must be a list");
    else {
      if (b.dieselEntries.length > 20) errors.push("Too many diesel entries (max 20)");
      b.dieselEntries.slice(0, 20).forEach((raw, i) => {
        const e = (raw && typeof raw === "object" ? raw : {}) as Obj;
        const amt = amount(e.amount, `Diesel entry ${i + 1} amount`, true);
        let mode: string | null = null;
        if (!blank(e.mode)) {
          if (!DIESEL_PAYMENT_MODES.includes(e.mode as string)) errors.push(`Diesel entry ${i + 1} payment mode is not valid`);
          else mode = e.mode as string;
        }
        diesel.push({ amountPaise: amt, mode, reference: text(e.reference, `Diesel entry ${i + 1} reference`, 120) });
      });
    }
  }
  const foodPaise = amount(b.foodAmount, "Food amount");
  const salaryAdvancePaise = amount(b.salaryAdvance, "Salary advance");

  const expenses: ExpenseIn[] = [];
  if (b.expenses !== undefined && b.expenses !== null) {
    if (!Array.isArray(b.expenses)) errors.push("Expenses must be a list");
    else {
      if (b.expenses.length > 50) errors.push("Too many expense entries (max 50)");
      const seen = new Set<string>();
      b.expenses.slice(0, 50).forEach((raw, i) => {
        const e = (raw && typeof raw === "object" ? raw : {}) as Obj;
        const opt = EXPENSE_OPTIONS.find((o) => o.key === e.optionKey);
        if (!opt) errors.push(`Expense ${i + 1}: choose one of the listed expense options`);
        const description = text(e.description, `Expense ${i + 1} description`, 200, !!opt && DESCRIPTION_REQUIRED.includes(opt.key));
        const amt = amount(e.amount, `Expense ${i + 1} amount`, true);
        if (e.deduct !== undefined && typeof e.deduct !== "boolean") errors.push(`Expense ${i + 1}: Deduct must be true or false`);
        if (e.isDefault !== undefined && typeof e.isDefault !== "boolean") errors.push(`Expense ${i + 1}: Is Default must be true or false`);
        if (opt) {
          const sig = [opt.key, (description ?? "").toLowerCase(), amt, e.deduct === true].join("|");
          if (seen.has(sig)) errors.push(`Expense ${i + 1} duplicates an earlier entry`);
          seen.add(sig);
          expenses.push({ optionKey: opt.key, optionLabel: opt.label, description, amountPaise: amt, deduct: e.deduct === true, isDefault: e.isDefault === true });
        }
      });
    }
  }
  if (typeof b.idempotencyKey !== "string" || !KEY.test(b.idempotencyKey)) errors.push("A valid submission key is required");

  if (errors.length) return { errors, data: null };
  const data: PaymentInput = { paymentFor, cashInHand: b.cashInHand === true, diesel, foodPaise, salaryAdvancePaise, expenses, idempotencyKey: b.idempotencyKey as string };
  const t = calculatePayable(data);
  if (!diesel.length && !foodPaise && !salaryAdvancePaise && !expenses.length) errors.push("Enter at least one amount (diesel, food, salary advance or an expense)");
  else if (t.totalP < 0) errors.push("The deductions are more than the payable amount");
  return errors.length ? { errors, data: null } : { errors, data };
}
