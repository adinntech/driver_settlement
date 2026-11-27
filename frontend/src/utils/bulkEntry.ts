import { validatePaymentEntry, type SettlementRow } from "./settlement";

/** Bulk Entry (RSA): form checks and the request body. The server repeats every check per payment. */
export interface RowEntry { paymentMode: string; paymentDate: string; bankName: string; referenceNumber: string; referenceDate: string }
/** One entry per payment id; nothing is shared between payments. */
export type BulkEntries = Record<string, RowEntry>;
export const emptyEntry = (today: string): RowEntry => ({ paymentMode: "", paymentDate: today, bankName: "", referenceNumber: "", referenceDate: "" });
type Row = Pick<SettlementRow, "_id" | "paymentNumber" | "category">;

export function bulkEntryError(rows: Row[], entries: BulkEntries, today: string, approvedOn: string): string | null {
  if (!rows.length) return "Select at least one payment";
  const seen = new Map<string, string>(); // the server's rule: one reference per payment within a category, ignoring case
  for (const p of rows) {
    const entry = entries[p._id] ?? emptyEntry(today);
    const problem = Object.values(validatePaymentEntry(entry, today, approvedOn))[0];
    if (problem) return `${p.paymentNumber}: ${problem}`;
    const ref = entry.referenceNumber.trim();
    const key = `${p.category}:${ref.toUpperCase()}`;
    if (seen.has(key)) return `${p.paymentNumber}: reference ${ref} is also entered for ${seen.get(key)}`;
    seen.set(key, p.paymentNumber);
  }
  return null;
}

export function bulkEntryBody(rows: Row[], entries: BulkEntries) {
  return {
    items: rows.map((p) => {
      const e = entries[p._id];
      return { id: p._id, paymentMode: e.paymentMode, paymentDate: e.paymentDate, bankName: e.bankName.trim() || undefined, referenceNumber: e.referenceNumber.trim(), referenceDate: e.referenceDate || undefined };
    }),
  };
}

export const bulkEntryTotal = (rows: Pick<SettlementRow, "amount">[]) => rows.reduce((s, p) => s + Math.round(p.amount * 100), 0) / 100;
