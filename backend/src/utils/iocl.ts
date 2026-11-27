import { AppError } from "./AppError.js";
import { normalizeVehicleNo } from "./vehicleNo.js";

/** Parsing of the IOCL "Financial Transaction Statement" CSV (a title block, two summaries, then the transaction table). */
export const MAX_IOCL_ROWS = 5000;
const TOLERANCE = 1; // rupees between the pump's amount and RSP x Quantity (rounding)

export interface IoclRow {
  txnId: string; txnDate: string; txnTime: string; txnType: string; vehicleNo: string | null; vehicleNoRaw: string | null; product: string | null;
  rsp: number | null; quantity: number | null; amount: number | null; fileAmount: number | null; amountCorrected: boolean;
  odometer: string | null; location: string | null; state: string | null; merchantName: string | null;
}
export interface IoclFailure { row: string; reason: string }

const COLUMNS = {
  sno: "SNo.", merchantName: "Merchant Name", state: "State", location: "Location", vehicle: "Vehicle No. (Card)", txnId: "Txn ID", txnDate: "Txn Date",
  txnType: "Txn Type", product: "Product", rsp: "RSP", quantity: "Quantity", amount: "Amount", odometer: "Odometer (User Entry)",
} as const;

/** One CSV line; understands "quoted, fields" in case a re-saved file has them. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c !== '"') cur += c;
      else if (line[i + 1] === '"') cur += line[++i];
      else quoted = false;
    } else if (c === '"' && !cur) quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** The statement wraps text in stray apostrophes ('1412511501, 14/11/2026 23:50:53'); "-" means empty. */
const clean = (s: string | undefined) => {
  const t = (s ?? "").trim().replace(/^'+|'+$/g, "").trim();
  return t === "-" ? "" : t;
};
const num = (s: string) => (/^\d+(\.\d+)?$/.test(s) ? Number(s) : null);
const r2 = (n: number) => Math.round(n * 100) / 100;

function dateTime(s: string): { txnDate: string; txnTime: string } | null {
  const m = /^(\d{2})[/-](\d{2})[/-](\d{4})(?:\s+(\d{2}:\d{2}(?::\d{2})?))?$/.exec(s);
  if (!m) return null;
  const txnDate = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${txnDate}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === txnDate ? { txnDate, txnTime: m[4] ?? "" } : null;
}

/**
 * Amounts. A sale's Amount is accepted when it agrees with RSP x Quantity. Statements re-sorted in a spreadsheet can have the
 * Amount column ordered on its own; such a sale takes the unused file amount that does agree with it (else RSP x Quantity) and is
 * flagged. In a file like that the amounts of non-sale lines cannot be trusted either, so they are left empty.
 */
export function verifyAmounts(rows: IoclRow[]): void {
  const isSale = (r: IoclRow) => r.txnType.toLowerCase() === "sale";
  const calc = (r: IoclRow) => (r.rsp !== null && r.quantity !== null ? r2(r.rsp * r.quantity) : null);
  const agrees = (a: number | null, b: number) => a !== null && Math.abs(a - b) <= TOLERANCE;
  const pool = rows.map((r) => r.fileAmount);
  const wrong: number[] = [];
  rows.forEach((r, i) => {
    if (!isSale(r)) return;
    const expected = calc(r);
    if (expected === null || agrees(r.fileAmount, expected)) {
      r.amount = r.fileAmount;
      pool[i] = null; // used by its own row
    } else wrong.push(i);
  });
  const pairs = wrong
    .flatMap((i) => pool.map((a, j) => ({ i, j, a, gap: a === null ? Infinity : Math.abs(a - calc(rows[i])!) })))
    .filter((p) => p.gap <= TOLERANCE)
    .sort((x, y) => x.gap - y.gap);
  const done = new Set<number>();
  for (const p of pairs) {
    if (done.has(p.i) || pool[p.j] === null) continue;
    rows[p.i].amount = p.a;
    done.add(p.i);
    pool[p.j] = null;
  }
  for (const i of wrong) {
    if (!done.has(i)) rows[i].amount = calc(rows[i]);
    rows[i].amountCorrected = true;
  }
  for (const r of rows) if (!isSale(r)) r.amount = wrong.length ? null : r.fileAmount;
}

export function parseIoclCsv(text: string): { rows: IoclRow[]; failed: IoclFailure[] } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim().startsWith(`${COLUMNS.sno},`));
  const header = at < 0 ? [] : cells(lines[at]).map((h) => h.trim());
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, name]) => [k, header.indexOf(name)])) as Record<keyof typeof COLUMNS, number>;
  const missing = Object.entries(col).filter(([, i]) => i < 0).map(([k]) => COLUMNS[k as keyof typeof COLUMNS]);
  if (missing.length) throw new AppError(`This is not an IOCL Financial Transaction Statement CSV (missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")})`, 400);
  const body = lines.slice(at + 1).filter((l) => l.replace(/,/g, "").trim());
  if (!body.length) throw new AppError("The file has no transactions", 400);
  if (body.length > MAX_IOCL_ROWS) throw new AppError(`The file has more than ${MAX_IOCL_ROWS} rows`, 400);

  const rows: IoclRow[] = [];
  const failed: IoclFailure[] = [];
  body.forEach((line, n) => {
    const c = cells(line);
    const get = (k: keyof typeof COLUMNS) => clean(c[col[k]]);
    const label = get("sno") || `line ${at + n + 2}`;
    const fail = (reason: string) => failed.push({ row: label, reason });
    if (c.length !== header.length) return fail("Wrong number of columns");
    const txnId = get("txnId");
    if (!/^[A-Za-z0-9-]{4,40}$/.test(txnId)) return fail("Txn ID is missing or invalid");
    const when = dateTime(get("txnDate"));
    if (!when) return fail("Txn Date is not a valid DD/MM/YYYY date");
    const txnType = get("txnType");
    if (!txnType) return fail("Txn Type is missing");
    const rsp = num(get("rsp")), quantity = num(get("quantity")), fileAmount = num(get("amount"));
    if (txnType.toLowerCase() === "sale" && fileAmount === null && (rsp === null || quantity === null)) return fail("The sale has no amount");
    const raw = get("vehicle");
    rows.push({
      txnId, ...when, txnType, vehicleNoRaw: raw || null, vehicleNo: raw ? normalizeVehicleNo(raw) ?? (raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase() || null) : null,
      product: get("product") || null, rsp, quantity, amount: null, fileAmount, amountCorrected: false,
      odometer: get("odometer") || null, location: get("location") || null, state: get("state") || null, merchantName: get("merchantName") || null,
    });
  });
  verifyAmounts(rows);
  return { rows, failed };
}
