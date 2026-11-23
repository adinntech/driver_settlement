import { formatInr } from "./format";

type Obj = Record<string, unknown>;

const text = (v: unknown): string => (v === null || v === undefined || v === "" ? "" : String(v));
const amount = (v: unknown): string => (typeof v === "number" ? formatInr(v) : text(v) || "—");

/**
 * Formats one list entry by its shape, so every kind of repeatable row reads correctly:
 *  toll       { location, rate }
 *  others     { description, amount }
 *  other info { name, value }
 * Never returns "undefined" or "[object Object]".
 */
export function formatEntry(entry: unknown): string {
  if (entry === null || typeof entry !== "object") return text(entry) || "—";
  const e = entry as Obj;
  if ("location" in e || "rate" in e) return `${text(e.location) || "—"} ${amount(e.rate)}`;
  if ("description" in e || "amount" in e) return `${text(e.description) || "—"} ${amount(e.amount)}`;
  if ("name" in e || "value" in e) return `${text(e.name) || "—"}: ${text(e.value) || "—"}`;
  const parts = Object.entries(e).map(([k, v]) => `${k}: ${text(v) || "—"}`);
  return parts.length ? parts.join(", ") : "—";
}

export const formatList = (list: unknown): string =>
  Array.isArray(list) && list.length ? list.map(formatEntry).join("; ") : "—";
