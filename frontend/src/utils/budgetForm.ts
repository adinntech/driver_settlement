import { countDays } from "./format";

export type Unit = "PER_DAY" | "PER_CAMPAIGN";
export interface TollRow {
  id: string;
  location: string;
  rate: string;
}

export interface ChargeRow {
  id: string;
  description: string;
  amount: string;
}

export interface Draft {
  mileage: string;
  estimatedKmPerDay: string;
  onRoadDate: string;
  completionDate: string;
  sundayHalt: boolean;
  numberOfDays: string;
  dieselAmount: string;
  salaryAmount: string;
  salaryUnit: Unit;
  foodAmount: string;
  foodUnit: Unit;
  haltFood: string;
  tolls: TollRow[];
  others: ChargeRow[];
  fromLocation: string;
  toLocation: string;
  totalKm: string;
  upDownValue: string;
}

export interface DraftContext {
  campaignFrom: string;
  campaignTo: string;
  sundayHalt: boolean;
}

let seq = 0;
export const newTollRow = (location = "", rate = ""): TollRow => ({ id: `t${++seq}`, location, rate });

export const newChargeRow = (description = "", amount = ""): ChargeRow => ({ id: `c${++seq}`, description, amount });

/** Digits and one decimal point, max 2 decimals. Blocks letters, minus and 'e'. */
export function sanitizeDecimal(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const [int, ...rest] = cleaned.split(".");
  return rest.length ? `${int}.${rest.join("").slice(0, 2)}` : int;
}
export const sanitizeInt = (raw: string): string => raw.replace(/[^0-9]/g, "");

export const autoDays = (from: string, to: string, sundayHalt: boolean): string => {
  const n = from && to ? countDays(from, to, sundayHalt) : 0;
  return n ? String(n) : "";
};

export function emptyDraft(ctx: DraftContext): Draft {
  return {
    mileage: "", estimatedKmPerDay: "",
    onRoadDate: ctx.campaignFrom ?? "", completionDate: ctx.campaignTo ?? "",
    sundayHalt: ctx.sundayHalt,
    numberOfDays: autoDays(ctx.campaignFrom, ctx.campaignTo, ctx.sundayHalt),
    dieselAmount: "", salaryAmount: "", salaryUnit: "PER_DAY", foodAmount: "", foodUnit: "PER_DAY",
    haltFood: "", tolls: [newTollRow()], others: [newChargeRow()],
    fromLocation: "", toLocation: "", totalKm: "", upDownValue: "",
  };
}

type Stored = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** New records store a list; the earlier single pair is shown as the first row. */
function restoreCharges(data: Record<string, unknown>): ChargeRow[] {
  if (Array.isArray(data.others) && data.others.length)
    return (data.others as { description: string; amount: number }[]).map((o) => newChargeRow(s(o.description), s(o.amount)));
  if (data.othersDescription || data.othersAmount) return [newChargeRow(s(data.othersDescription), s(data.othersAmount))];
  return [newChargeRow()];
}

/** Restores every saved value. Legacy (pre-redesign) records fall back to a fresh prefilled form. */
export function draftFromData(data: Stored | undefined | null, ctx: DraftContext): Draft {
  if (!data || data.schemaVersion !== 2) return emptyDraft(ctx);
  const tolls = Array.isArray(data.tolls) ? (data.tolls as { location: string; rate: number }[]) : [];
  return {
    mileage: s(data.mileage), estimatedKmPerDay: s(data.estimatedKmPerDay),
    onRoadDate: s(data.onRoadDate), completionDate: s(data.completionDate),
    sundayHalt: data.sundayHalt === true, numberOfDays: s(data.numberOfDays),
    dieselAmount: s(data.dieselAmount),
    salaryAmount: s(data.salaryAmount), salaryUnit: data.salaryUnit === "PER_CAMPAIGN" ? "PER_CAMPAIGN" : "PER_DAY",
    foodAmount: s(data.foodAmount), foodUnit: data.foodUnit === "PER_CAMPAIGN" ? "PER_CAMPAIGN" : "PER_DAY",
    haltFood: s(data.haltFood),
    tolls: tolls.length ? tolls.map((t) => newTollRow(t.location, s(t.rate))) : [newTollRow()],
    others: restoreCharges(data),
    fromLocation: s(data.fromLocation), toLocation: s(data.toLocation),
    totalKm: s(data.totalKm), upDownValue: s(data.upDownValue),
  };
}

export const addToll = (d: Draft): Draft => ({ ...d, tolls: [...d.tolls, newTollRow()] });
export const removeToll = (d: Draft, id: string): Draft => {
  const tolls = d.tolls.filter((t) => t.id !== id);
  return { ...d, tolls: tolls.length ? tolls : [newTollRow()] };
};
export const updateToll = (d: Draft, id: string, patch: Partial<Omit<TollRow, "id">>): Draft => ({
  ...d,
  tolls: d.tolls.map((t) => (t.id === id ? { ...t, ...patch } : t)),
});
export const addCharge = (d: Draft): Draft => ({ ...d, others: [...d.others, newChargeRow()] });
export const removeCharge = (d: Draft, id: string): Draft => {
  const others = d.others.filter((c) => c.id !== id);
  return { ...d, others: others.length ? others : [newChargeRow()] };
};
export const updateCharge = (d: Draft, id: string, patch: Partial<Omit<ChargeRow, "id">>): Draft => ({
  ...d,
  others: d.others.map((c) => (c.id === id ? { ...c, ...patch } : c)),
});
/** Rows with neither description nor amount are never saved. */
export const filledCharges = (d: Draft): ChargeRow[] => d.others.filter((c) => c.description.trim() || c.amount.trim());

/** Rows with neither location nor rate are never saved. */
export const filledTolls = (d: Draft): TollRow[] => d.tolls.filter((t) => t.location.trim() || t.rate.trim());

const n = (v: string) => Number(v) || 0;
const r2 = (x: number) => Math.round(x * 100) / 100;

export function computeValues(d: Draft) {
  const days = Number(d.numberOfDays) || 0;
  const by = (amt: string, u: Unit) => r2(u === "PER_DAY" ? n(amt) * days : n(amt));
  const dieselValue = r2(n(d.dieselAmount));
  const salaryValue = by(d.salaryAmount, d.salaryUnit);
  const foodValue = by(d.foodAmount, d.foodUnit);
  const tollAmount = r2(filledTolls(d).reduce((sum, t) => sum + n(t.rate), 0));
  const totalValue = r2(dieselValue + salaryValue + foodValue + n(d.haltFood) + tollAmount + r2(filledCharges(d).reduce((sum, c) => sum + n(c.amount), 0)) + n(d.upDownValue));
  return { dieselValue, salaryValue, foodValue, tollAmount, totalValue };
}

export function validateDraft(d: Draft): string[] {
  const e: string[] = [];
  if (!d.onRoadDate) e.push("On road date is required");
  if (!d.completionDate) e.push("Completion date is required");
  if (d.onRoadDate && d.completionDate && d.completionDate < d.onRoadDate) e.push("Completion date cannot be before on road date");
  if (!(Number.isInteger(Number(d.numberOfDays)) && Number(d.numberOfDays) >= 1)) e.push("Number of days must be at least 1");
  const amounts: [string, string][] = [
    [d.mileage, "Mileage"], [d.estimatedKmPerDay, "Estimated KM per day"], [d.dieselAmount, "Diesel cost"],
    [d.salaryAmount, "Salary"], [d.foodAmount, "Food"], [d.haltFood, "Halt food"],
    [d.totalKm, "Total km"], [d.upDownValue, "Up/Down value"],
  ];
  for (const [v, label] of amounts) if (v !== "" && !(Number(v) >= 0)) e.push(`${label} must be a valid amount`);
  filledTolls(d).forEach((t, i) => {
    if (!t.location.trim()) e.push(`Toll entry ${i + 1}: location is required`);
    if (t.rate === "" || !(Number(t.rate) >= 0)) e.push(`Toll entry ${i + 1}: enter a valid rate`);
  });
  filledCharges(d).forEach((c, i) => {
    if (c.amount !== "" && !(Number(c.amount) >= 0)) e.push(`Others ${i + 1}: enter a valid amount`);
    if (!c.description.trim() && Number(c.amount) > 0) e.push(`Others ${i + 1}: enter a description`);
  });
  return e;
}

export function toPayload(d: Draft) {
  const num = (v: string) => (v === "" ? 0 : Number(v));
  return {
    mileage: num(d.mileage), estimatedKmPerDay: num(d.estimatedKmPerDay),
    onRoadDate: d.onRoadDate, completionDate: d.completionDate, sundayHalt: d.sundayHalt,
    numberOfDays: Number(d.numberOfDays),
    dieselAmount: num(d.dieselAmount),
    salaryAmount: num(d.salaryAmount), salaryUnit: d.salaryUnit,
    foodAmount: num(d.foodAmount), foodUnit: d.foodUnit,
    haltFood: num(d.haltFood),
    tolls: filledTolls(d).map((t) => ({ location: t.location.trim(), rate: Number(t.rate) })),
    others: filledCharges(d).map((c) => ({ description: c.description.trim(), amount: num(c.amount) })),
    fromLocation: d.fromLocation, toLocation: d.toLocation,
    totalKm: num(d.totalKm), upDownValue: num(d.upDownValue),
  };
}
