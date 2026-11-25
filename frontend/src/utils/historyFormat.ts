import { formatInr } from "./format";

type Obj = Record<string, unknown>;

const text = (v: unknown): string => (v === null || v === undefined || v === "" ? "" : String(v));
const amount = (v: unknown): string => (typeof v === "number" ? formatInr(v) : text(v) || "—");

/** Where a toll rate came from, for rows linked to a toll plaza (manual rows show nothing extra). */
function tollTag(e: Obj): string {
  const p = e.plaza && typeof e.plaza === "object" ? (e.plaza as Obj) : null;
  if (!p) return "";
  const src = p.sourceType === "nhai" ? "NHAI rate" : "state-highway data";
  if (e.rateSource === "AUTO") return ` (auto: ${src}${p.verified === false ? ", unverified" : ""})`;
  if (e.rateSource === "AUTO_EDITED") return ` (edited; published ${amount(p.fetchedRate)})`;
  return " (manual; no published rate)";
}

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
  if ("location" in e || "rate" in e) return `${text(e.location) || "—"} ${amount(e.rate)}${tollTag(e)}`;
  if ("description" in e || "amount" in e) return `${text(e.description) || "—"} ${amount(e.amount)}`;
  if ("name" in e || "value" in e) return `${text(e.name) || "—"}: ${text(e.value) || "—"}`;
  const parts = Object.entries(e).map(([k, v]) => `${k}: ${text(v) || "—"}`);
  return parts.length ? parts.join(", ") : "—";
}

export const formatList = (list: unknown): string =>
  Array.isArray(list) && list.length ? list.map(formatEntry).join("; ") : "—";
