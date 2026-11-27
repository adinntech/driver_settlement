import { formatInr } from "./format";

/**
 * Advance = floor((workingDays x perDaySalary / 2) / 500) x 500, always rounded DOWN.
 * The same rule the server applies; the server recalculates and its result is the only one saved.
 * Maths is in integer paise so decimal salaries stay exact.
 */
export const ROUNDING_UNIT = 500;
export const MAX_WORKING_DAYS = 366;

export interface AdvanceCalc { eligible: number; half: number; advance: number }
export function calculateAdvance(workingDays: number, perDaySalary: number): AdvanceCalc {
  const salaryP = Math.round(perDaySalary * 100);
  const eligibleP = workingDays * salaryP;
  return {
    eligible: eligibleP / 100, half: Math.round(eligibleP / 2) / 100, advance: Math.floor(eligibleP / (2 * ROUNDING_UNIT * 100)) * ROUNDING_UNIT,
  };
}

/** Keyboard filter for the working days box: digits only. */
export const sanitizeWorkingDays = (raw: string): string => raw.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "").slice(0, 3);

export const hasSalary = (salary: number | null | undefined): salary is number => typeof salary === "number" && Number.isFinite(salary) && salary > 0;

/** null = fine. The salary message comes first: no amount is calculated without a saved salary. */
export function validateAdvance(workingDays: string, salary: number | null | undefined): string | null {
  if (!hasSalary(salary)) return "Driver salary is unavailable; set the driver's salary in Driver Management first";
  const t = workingDays.trim();
  if (!t) return "Overall working days is required";
  if (!/^\d+$/.test(t) || Number(t) < 1) return "Overall working days must be a positive whole number";
  if (Number(t) > MAX_WORKING_DAYS) return `Overall working days cannot exceed ${MAX_WORKING_DAYS}`;
  return null;
}

/** Amounts for the form; null until the inputs are valid. */
export function advancePreview(workingDays: string, salary: number | null | undefined): (AdvanceCalc & { workingDays: number; perDaySalary: number }) | null {
  if (validateAdvance(workingDays, salary) || !hasSalary(salary)) return null;
  const days = Number(workingDays.trim());
  return { ...calculateAdvance(days, salary), workingDays: days, perDaySalary: salary };
}

/** Only the working days and the submission key are sent: every amount is recalculated by the server. */
export const toAdvancePayload = (workingDays: string, idempotencyKey: string) => ({ workingDays: Number(workingDays.trim()), idempotencyKey });

/** One key per form session: a double-click or a retry carries the same key and can only ever create one advance. */
export const newSubmissionKey = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `adv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const ROUNDING_TEXT = `Half of the eligible amount, rounded down to ₹${ROUNDING_UNIT}`;
export const money = (n: number | null | undefined): string => formatInr(n);
