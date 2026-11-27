/**
 * Bulk Payment (RBP, On Road Vehicles): one ordinary Daily Vehicle Payment per selected vehicle, posted to the existing
 * endpoint. The server resolves vehicle, driver and campaign, applies its usual rules and sends each one to RSOM.
 */
export const BULK_REASONS = ["Fuel", "Food", "Toll", "Travel", "Permit", "Service", "Others"] as const;

export interface BulkForm { reason: string; amount: string; date: string; description: string }
export interface BulkVehicle { projectType?: string | null; trackingVehicle: string; pifNumber: string; trackupNumber: string; vehicleNo: string | null; driverName: string | null }
/** What is typed for one vehicle in the popup table. */
export interface BulkLine { reason: string; amount: string; description: string }
export type BulkEntry = BulkVehicle & BulkLine;
export interface BulkResult { trackingVehicle: string; pifNumber: string; ok: boolean; message: string }

function lineError(f: BulkLine): string | null {
  if (!(BULK_REASONS as readonly string[]).includes(f.reason)) return "Select a payment reason";
  const amount = f.amount.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || !(Number(amount) > 0) || Number(amount) > 99_999_999.99) return "Enter an amount greater than zero (up to 2 decimals)";
  if (f.reason === "Others" && !f.description.trim()) return "Description is required for Others";
  return null;
}

/** Every row is checked before anything is sent; the message names the vehicle. */
export function bulkError(entries: BulkEntry[], date: string): string | null {
  if (!entries.length) return "Select at least one vehicle";
  if (!date) return "Select the payment date";
  for (const e of entries) {
    const problem = lineError(e);
    if (problem) return `PIF ${e.pifNumber}: ${problem}`;
  }
  return null;
}

/** Added in paise; blank or unfinished amounts count as zero. */
export const bulkTotal = (lines: BulkLine[]) => lines.reduce((s, l) => s + (Math.round(Number(l.amount) * 100) || 0), 0) / 100;

/** Fuel and Food go in the same fields as on the individual form; the other reasons are expense lines. */
export function bulkBody(f: BulkForm, idempotencyKey: string) {
  const amount = f.amount.trim();
  const line =
    f.reason === "Fuel" ? { dieselEntries: [{ amount }] }
    : f.reason === "Food" ? { foodAmount: amount }
    : { expenses: [{ optionKey: f.reason.toUpperCase(), amount, ...(f.reason === "Others" ? { description: f.description.trim() } : {}) }] };
  return { fromDate: f.date, toDate: f.date, idempotencyKey, ...line };
}

/** One at a time; a refused vehicle never stops the others. `batch` makes a repeated request of one popup a server replay. */
export async function submitBulk(entries: BulkEntry[], date: string, batch: string, post: (path: string, body: unknown) => Promise<unknown>): Promise<BulkResult[]> {
  const results: BulkResult[] = [];
  for (const { trackingVehicle, pifNumber, reason, amount, description } of entries) {
    try {
      const p = (await post(`/settlements/projects/${trackingVehicle}/daily`, bulkBody({ reason, amount, description, date }, `bulk-${batch}-${trackingVehicle}`))) as { paymentNumber?: string } | null;
      results.push({ trackingVehicle, pifNumber, ok: true, message: p?.paymentNumber ?? "Submitted" });
    } catch (e) {
      results.push({ trackingVehicle, pifNumber, ok: false, message: e instanceof Error ? e.message : "Request failed" });
    }
  }
  return results;
}
