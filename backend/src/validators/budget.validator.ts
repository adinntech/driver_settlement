type Obj = Record<string, unknown>;

export const SCHEMA_VERSION = 2;
export type Unit = "PER_DAY" | "PER_CAMPAIGN";

export interface TollEntry {
  location: string;
  rate: number;
}

/** Inputs of the Budget screen (see reference screenshot). Computed values are derived. */
export interface OtherCharge {
  description: string;
  amount: number;
}

export interface OtherDetail {
  name: string;
  value: string;
}

export interface BudgetInput {
  mileage: number;
  estimatedKmPerDay: number;
  onRoadDate: string;
  completionDate: string;
  sundayHalt: boolean;
  numberOfDays: number;
  dieselAmount: number; // unit is always per campaign
  salaryAmount: number;
  salaryUnit: Unit;
  foodAmount: number;
  foodUnit: Unit;
  haltFood: number;
  tolls: TollEntry[]; // paired Location + Rate
  others: OtherCharge[]; // repeatable description + amount rows
  fromLocation: string | null;
  toLocation: string | null;
  totalKm: number;
  upDownValue: number;
  otherDetails: OtherDetail[]; // free-form name/value pairs, not part of calculations
}

export interface BudgetComputed {
  dieselValue: number;
  salaryValue: number;
  foodValue: number;
  tollAmount: number;
  totalValue: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const isBlank = (v: unknown) => v === undefined || v === null || v === "";
const isDate = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export function validateBudget(input: unknown): { errors: string[]; data: BudgetInput } {
  const b = (input && typeof input === "object" ? input : {}) as Obj;
  const errors: string[] = [];

  // Optional amounts default to 0; invalid or negative values are rejected.
  const num = (k: string, label: string): number => {
    if (isBlank(b[k])) return 0;
    const n = Number(b[k]);
    if (!Number.isFinite(n) || n < 0) {
      errors.push(`${label} must be a non-negative number`);
      return 0;
    }
    return round2(n);
  };
  const text = (k: string, label: string): string | null => {
    const t = typeof b[k] === "string" ? (b[k] as string).trim() : "";
    if (t.length > 120) errors.push(`${label} is too long`);
    return t || null;
  };
  const unit = (k: string, label: string): Unit => {
    const v = isBlank(b[k]) ? "PER_DAY" : b[k];
    if (v !== "PER_DAY" && v !== "PER_CAMPAIGN") {
      errors.push(`${label} unit must be PER_DAY or PER_CAMPAIGN`);
      return "PER_DAY";
    }
    return v;
  };

  if (!isDate(b.onRoadDate)) errors.push("On road date must be a valid date (YYYY-MM-DD)");
  if (!isDate(b.completionDate)) errors.push("Completion date must be a valid date (YYYY-MM-DD)");
  if (isDate(b.onRoadDate) && isDate(b.completionDate) && String(b.completionDate) < String(b.onRoadDate))
    errors.push("Completion date cannot be before on road date");
  if (b.sundayHalt !== undefined && typeof b.sundayHalt !== "boolean")
    errors.push("Sunday halt must be true or false");

  const days = Number(b.numberOfDays);
  if (!Number.isInteger(days) || days < 1) errors.push("Number of days must be a whole number of at least 1");

  const rawTolls = Array.isArray(b.tolls) ? b.tolls : b.tolls === undefined ? [] : null;
  if (rawTolls === null) errors.push("Toll details must be a list");
  const tolls: TollEntry[] = [];
  (rawTolls ?? []).forEach((t, i) => {
    const e = (t && typeof t === "object" ? t : {}) as Obj;
    const location = typeof e.location === "string" ? e.location.trim() : "";
    if (!location && isBlank(e.rate)) return; // fully empty row is dropped, never saved
    if (!location) return void errors.push(`Toll entry ${i + 1}: location is required`);
    if (location.length > 120) return void errors.push(`Toll entry ${i + 1}: location is too long`);
    const rate = Number(e.rate);
    if (isBlank(e.rate) || !Number.isFinite(rate) || rate < 0)
      return void errors.push(`Toll entry ${i + 1}: rate must be a non-negative number`);
    tolls.push({ location, rate: round2(rate) });
  });
  if (tolls.length > 100) errors.push("Too many toll entries (max 100)");

  const rawOther = Array.isArray(b.otherDetails) ? b.otherDetails : b.otherDetails === undefined ? [] : null;
  if (rawOther === null) errors.push("Other details must be a list");
  const otherDetails: OtherDetail[] = [];
  (rawOther ?? []).forEach((o, i) => {
    const e = (o && typeof o === "object" ? o : {}) as Obj;
    const name = typeof e.name === "string" ? e.name.trim() : "";
    const value = e.value === undefined || e.value === null ? "" : String(e.value).trim();
    if (!name && !value) return; // completely empty row is dropped, never saved
    if (!name) return void errors.push(`Other details ${i + 1}: name is required when a value is entered`);
    if (name.length > 80) return void errors.push(`Other details ${i + 1}: name is too long`);
    if (value.length > 200) return void errors.push(`Other details ${i + 1}: value is too long`);
    otherDetails.push({ name, value });
  });
  if (otherDetails.length > 50) errors.push("Too many other details (max 50)");

  // "Others": a list of description + amount rows. Older payloads send one othersDescription/othersAmount pair.
  const rawOthers: unknown[] | null = Array.isArray(b.others)
    ? b.others
    : b.others !== undefined
      ? null
      : !isBlank(b.othersDescription) || !isBlank(b.othersAmount)
        ? [{ description: b.othersDescription, amount: b.othersAmount }]
        : [];
  if (rawOthers === null) errors.push("Others must be a list");
  const others: OtherCharge[] = [];
  (rawOthers ?? []).forEach((o, i) => {
    const e = (o && typeof o === "object" ? o : {}) as Obj;
    const description = typeof e.description === "string" ? e.description.trim() : "";
    if (!description && isBlank(e.amount)) return; // completely empty row is dropped
    if (description.length > 120) return void errors.push(`Others ${i + 1}: description is too long`);
    const amount = isBlank(e.amount) ? 0 : Number(e.amount);
    if (!Number.isFinite(amount) || amount < 0) return void errors.push(`Others ${i + 1}: amount must be a non-negative number`);
    if (!description && amount > 0) return void errors.push(`Others ${i + 1}: description is required when an amount is entered`);
    others.push({ description, amount: round2(amount) });
  });
  if (others.length > 50) errors.push("Too many others entries (max 50)");

  const data: BudgetInput = {
    mileage: num("mileage", "Mileage"),
    estimatedKmPerDay: num("estimatedKmPerDay", "Estimated KM per day"),
    onRoadDate: String(b.onRoadDate ?? ""),
    completionDate: String(b.completionDate ?? ""),
    sundayHalt: b.sundayHalt === true,
    numberOfDays: Number.isInteger(days) ? days : 0,
    dieselAmount: num("dieselAmount", "Diesel cost"),
    salaryAmount: num("salaryAmount", "Salary"),
    salaryUnit: unit("salaryUnit", "Salary"),
    foodAmount: num("foodAmount", "Food"),
    foodUnit: unit("foodUnit", "Food"),
    haltFood: num("haltFood", "Halt food"),
    tolls,
    others,
    fromLocation: text("fromLocation", "From location"),
    toLocation: text("toLocation", "To location"),
    totalKm: num("totalKm", "Total km"),
    upDownValue: num("upDownValue", "Up/Down value"),
    otherDetails,
  };
  return { errors, data };
}

/** Per-day items multiply by number of days; per-campaign items are taken as is. */
export function computeBudget(d: BudgetInput): BudgetComputed {
  const byUnit = (amount: number, u: Unit) => round2(u === "PER_DAY" ? amount * d.numberOfDays : amount);
  const dieselValue = round2(d.dieselAmount);
  const salaryValue = byUnit(d.salaryAmount, d.salaryUnit);
  const foodValue = byUnit(d.foodAmount, d.foodUnit);
  const tollAmount = round2(d.tolls.reduce((s, t) => s + t.rate, 0));
  const totalValue = round2(
    dieselValue + salaryValue + foodValue + d.haltFood + tollAmount + d.others.reduce((sum, o) => sum + o.amount, 0) + d.upDownValue,
  );
  return { dieselValue, salaryValue, foodValue, tollAmount, totalValue };
}

export const budgetTotal = (d: BudgetInput): number => computeBudget(d).totalValue;

/** Shape persisted in Budget.data / BudgetVersion.data. Legacy records have no schemaVersion. */
export const toStored = (d: BudgetInput) => ({ ...d, schemaVersion: SCHEMA_VERSION, computed: computeBudget(d) });

export interface Change {
  field: string;
  from: unknown;
  to: unknown;
}

// Missing, null and an empty list all mean "nothing", so budgets saved before this field do not show a false change.
const norm = (v: unknown) => (v === undefined || v === null || (Array.isArray(v) && v.length === 0) ? null : v);
const same = (a: unknown, b: unknown) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

export function diffBudget(prev: Partial<BudgetInput> | Obj, next: BudgetInput): Change[] {
  const out: Change[] = [];
  const p = prev as Obj;
  for (const k of Object.keys(next) as (keyof BudgetInput)[])
    if (!same(p[k], next[k])) out.push({ field: k, from: p[k] ?? null, to: next[k] ?? null });
  return out;
}
