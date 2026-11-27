import { sanitizeDigits, sanitizeIfsc, sanitizeSalary } from "./driverForm";
import { formatInr } from "./format";

/** The bank fields Driver Management already has (no new bank fields). */
export interface BankForm { accountName: string; bankName: string; accountNumber: string; ifscCode: string }
export interface BankView extends Record<keyof BankForm, string | null> {
  driverId: string; driverNumber: string; driverName: string; accountNumberMasked: string | null; hasBankDetails: boolean;
}

export const emptyBankForm = (): BankForm => ({ accountName: "", bankName: "", accountNumber: "", ifscCode: "" });
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Form values from the driver's SAVED bank record (the one just fetched for the selected driver, never another driver's). */
export const bankFormFrom = (b: Partial<BankView> | null | undefined): BankForm =>
  b ? { accountName: s(b.accountName), bankName: s(b.bankName), accountNumber: s(b.accountNumber), ifscCode: s(b.ifscCode) } : emptyBankForm();

export const maskAccount = (n: string | null | undefined): string => {
  if (!n) return "—";
  return n.length <= 4 ? "X".repeat(n.length) : `${"X".repeat(n.length - 4)}${n.slice(-4)}`;
};

// ---- keyboard sanitisers (same behaviour as the Driver Management form)
export const sanitizeBankText = (raw: string): string => raw.replace(/[<>]/g, "").slice(0, 80);
export { sanitizeDigits, sanitizeIfsc };

/** Mirrors the server rules; every bank field is optional. The server stays the authority. */
export function validateBankForm(f: BankForm): string[] {
  const e: string[] = [];
  if (f.accountNumber && !/^[0-9]{6,20}$/.test(f.accountNumber)) e.push("Account number must be 6 to 20 digits");
  if (f.ifscCode && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(f.ifscCode.toUpperCase())) e.push("IFSC code is not valid (e.g. SBIN0001234)");
  if (f.accountName.length > 80) e.push("Account name is too long (max 80)");
  if (f.bankName.length > 80) e.push("Bank name is too long (max 80)");
  return e;
}
export const bankChanged = (a: BankForm, b: BankForm): boolean => (Object.keys(a) as (keyof BankForm)[]).some((k) => a[k].trim() !== b[k].trim());
export const toBankPayload = (f: BankForm): BankForm => ({ accountName: f.accountName.trim(), bankName: f.bankName.trim(), accountNumber: f.accountNumber.trim(), ifscCode: f.ifscCode.trim().toUpperCase() });

// ---- Travel Amount Deduction (Change Driver only): digits with an optional 2-decimal part
export const MAX_DEDUCTION = 9_999_999.99;
/** Keyboard filter: letters and symbols (including "-") never get into the box. */
export const sanitizeDeduction = (raw: string): string => sanitizeSalary(raw.replace(/-/g, ""));
export function validateDeduction(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null; // empty = 0
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return "Travel amount deduction must contain digits only (e.g. 500 or 500.50)";
  if (Number(t) > MAX_DEDUCTION) return `Travel amount deduction cannot exceed ${formatInr(MAX_DEDUCTION)}`;
  return null;
}
export const deductionValue = (raw: string): number => (raw.trim() && !validateDeduction(raw) ? Number(raw) : 0);
export const formatDeduction = (n: number | null | undefined): string => formatInr(n ?? 0);
