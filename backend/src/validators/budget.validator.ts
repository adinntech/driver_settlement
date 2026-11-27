import { isYmd } from "../utils/dates.js";
import { cleanText, isTollVehicleClass, type TollVehicleClass } from "../services/toll.service.js";

type Obj = Record<string, unknown>;

export const SCHEMA_VERSION = 2;
export type Unit = "PER_DAY" | "PER_CAMPAIGN";

/** Where a toll row's rate came from. Derived on the server, never taken from the browser. */
export type TollRateSource = "MANUAL" | "AUTO" | "AUTO_EDITED";
export type TollJourney = "SINGLE" | "RETURN";

/** Toll plaza picked from the directory: kept with the row so reviewers see exactly what was used. */
export interface TollPlazaRef {
  id: number;
  name: string;
  state: string | null;
  nh: string | null;
  source: string;
  sourceType: "nhai" | "state";
  confidence: string;
  vehicleClass: TollVehicleClass;
  journey: TollJourney;
  fetchedRate: number | null; // the directory's rate for the class + journey (null = none published)
  rateStatus: string; // OK | UNAVAILABLE | UNVERIFIED | OUTDATED | INACTIVE at the time of selection
  rateEffectiveDate: string | null;
  datasetUpdated: string | null;
  verified: boolean; // true only when the server re-read the plaza from the directory on save
}

export interface TollEntry {
  location: string;
  rate: number;
  plaza?: TollPlazaRef; // absent on manual rows and on budgets saved before the toll directory
  rateSource?: TollRateSource;
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
  tollVehicleClass: TollVehicleClass | null; // NHAI fee class the toll rates are for (null = not chosen / legacy)
  others: OtherCharge[]; // repeatable description + amount rows
  fromLocation: string | null;
  toLocation: string | null;
  totalKm: number;
  /** Fuel price in Rs per litre: used only to calculate the Up/Down value. */
  fuelRate: number;
  /** Always calculated on the server: (Total KM / Mileage x Fuel Rate) + Toll Amount. */
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
const isDate = isYmd;

export interface BudgetDateBounds {
  campaignFrom?: unknown;
  campaignTo?: unknown;
  previous?: { onRoadDate?: unknown; completionDate?: unknown };
}

export function validateBudget(input: unknown, bounds: BudgetDateBounds = {}): { errors: string[]; data: BudgetInput } {
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
  const unchanged = (field: "onRoadDate" | "completionDate", value: string) =>
    isYmd(bounds.previous?.[field]) && String(bounds.previous?.[field]) === value;
  if (isDate(b.onRoadDate) && isYmd(bounds.campaignFrom) && !unchanged("onRoadDate", String(b.onRoadDate)) && String(b.onRoadDate) < String(bounds.campaignFrom))
    errors.push("On road date cannot be before the campaign start date");
  if (isDate(b.onRoadDate) && isYmd(bounds.campaignTo) && !unchanged("onRoadDate", String(b.onRoadDate)) && String(b.onRoadDate) > String(bounds.campaignTo))
    errors.push("On road date cannot be after the campaign end date");
  if (isDate(b.completionDate) && isYmd(bounds.campaignTo) && !unchanged("completionDate", String(b.completionDate)) && String(b.completionDate) > String(bounds.campaignTo))
    errors.push("Completion date cannot be after the campaign end date");
  if (b.sundayHalt !== undefined && typeof b.sundayHalt !== "boolean")
    errors.push("Sunday halt must be true or false");

  const days = Number(b.numberOfDays);
  if (!Number.isInteger(days) || days < 1) errors.push("Number of days must be a whole number of at least 1");

  const tollVehicleClass = isBlank(b.tollVehicleClass) ? null : isTollVehicleClass(b.tollVehicleClass) ? b.tollVehicleClass : null;
  if (!isBlank(b.tollVehicleClass) && !tollVehicleClass) errors.push("Toll vehicle class is not valid");
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
    const entry: TollEntry = { location, rate: round2(rate) };
    if (e.plaza !== undefined && e.plaza !== null) {
      const plaza = tollPlazaRef(e.plaza, `Toll entry ${i + 1}`, errors);
      if (plaza) {
        if (!tollVehicleClass) return void errors.push(`Toll entry ${i + 1}: choose the toll vehicle class for the selected plaza`);
        if (plaza.vehicleClass !== tollVehicleClass)
          return void errors.push(`Toll entry ${i + 1}: the plaza rate is for a different vehicle class; select the plaza again`);
        entry.plaza = plaza;
        entry.rateSource = rateSourceOf(entry.rate, plaza.fetchedRate);
      }
    }
    tolls.push(entry);
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
    dieselAmount: num("dieselAmount", "Fuel cost"),
    salaryAmount: num("salaryAmount", "Salary"),
    salaryUnit: unit("salaryUnit", "Salary"),
    foodAmount: num("foodAmount", "Food"),
    foodUnit: unit("foodUnit", "Food"),
    // Halt Food applies only with Sunday Halt: without it the value is not validated, stored or counted.
    haltFood: b.sundayHalt === true ? num("haltFood", "Halt food") : 0,
    tolls,
    tollVehicleClass,
    others,
    fromLocation: text("fromLocation", "From location"),
    toLocation: text("toLocation", "To location"),
    totalKm: num("totalKm", "Total km"),
    fuelRate: num("fuelRate", "Fuel rate"),
    upDownValue: 0,
    otherDetails,
  };
  // Up/Down is never taken from the browser: it is (Total KM / Mileage x Fuel Rate) + Toll Amount.
  if (data.totalKm > 0 && data.fuelRate > 0 && !(data.mileage > 0)) errors.push("Mileage is required to calculate the Up/Down value");
  data.upDownValue = upDownFor(data);
  return { errors, data };
}

/** AUTO = the directory's rate was kept; AUTO_EDITED = a plaza was picked but the rate was changed; MANUAL = no published rate. */
export const rateSourceOf = (rate: number, fetched: number | null): TollRateSource =>
  fetched === null ? "MANUAL" : fetched === rate ? "AUTO" : "AUTO_EDITED";

const shortText = (v: unknown, max: number): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const t = cleanText(String(v)).trim();
  return t ? t.slice(0, max) : null;
};

function tollPlazaRef(v: unknown, label: string, errors: string[]): TollPlazaRef | null {
  const p = (v && typeof v === "object" ? v : {}) as Obj;
  const id = Number(p.id);
  const name = shortText(p.name, 120);
  if (!Number.isInteger(id) || id <= 0 || !name) return (errors.push(`${label}: toll plaza reference is invalid`), null);
  if (!isTollVehicleClass(p.vehicleClass)) return (errors.push(`${label}: toll plaza vehicle class is invalid`), null);
  const fetched = p.fetchedRate === null || p.fetchedRate === undefined || p.fetchedRate === "" ? null : Number(p.fetchedRate);
  if (fetched !== null && (!Number.isFinite(fetched) || fetched < 0)) return (errors.push(`${label}: fetched toll rate is invalid`), null);
  return {
    id, name, state: shortText(p.state, 60), nh: shortText(p.nh, 20), source: shortText(p.source, 160) ?? "Toll directory",
    sourceType: p.sourceType === "nhai" ? "nhai" : "state", confidence: shortText(p.confidence, 20) ?? "partial",
    vehicleClass: p.vehicleClass, journey: p.journey === "RETURN" ? "RETURN" : "SINGLE",
    fetchedRate: fetched === null ? null : round2(fetched), rateStatus: shortText(p.rateStatus, 20) ?? "UNAVAILABLE",
    rateEffectiveDate: isYmd(p.rateEffectiveDate) ? p.rateEffectiveDate : null, datasetUpdated: isYmd(p.datasetUpdated) ? p.datasetUpdated : null,
    verified: false,
  };
}

/**
 * Up/Down value in Rs = (Total KM [km] / Mileage [km per litre] x Fuel Rate [Rs per litre]) + Toll Amount [Rs].
 * Without a mileage the fuel part is 0 (validation asks for the mileage when KM and rate are entered).
 */
export function upDownFor(d: Pick<BudgetInput, "totalKm" | "mileage" | "fuelRate" | "tolls">): number {
  const tollAmount = round2(d.tolls.reduce((s, t) => s + t.rate, 0));
  const fuel = d.mileage > 0 ? (d.totalKm / d.mileage) * d.fuelRate : 0;
  return round2(fuel + tollAmount);
}

/** Per-day items multiply by number of days; per-campaign items are taken as is. */
export function computeBudget(d: BudgetInput): BudgetComputed {
  const byUnit = (amount: number, u: Unit) => round2(u === "PER_DAY" ? amount * d.numberOfDays : amount);
  const dieselValue = round2(d.dieselAmount);
  const salaryValue = byUnit(d.salaryAmount, d.salaryUnit);
  const foodValue = byUnit(d.foodAmount, d.foodUnit);
  const tollAmount = round2(d.tolls.reduce((s, t) => s + t.rate, 0));
  const totalValue = round2(
    dieselValue + salaryValue + foodValue + (d.sundayHalt ? d.haltFood : 0) + tollAmount + d.others.reduce((sum, o) => sum + o.amount, 0) + d.upDownValue,
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
