/** IOCL Data (RSA): response shapes of /iocl (see backend/src/services/iocl.service.ts) and the query string. */
export type MatchStatus = "MATCHED" | "NO_DRIVER" | "NO_PROJECT" | "UNKNOWN_VEHICLE" | "NO_VEHICLE";
export const MATCH_LABEL: Record<MatchStatus, string> = {
  MATCHED: "Matched", NO_DRIVER: "No driver", NO_PROJECT: "No project on this date", UNKNOWN_VEHICLE: "Vehicle not registered", NO_VEHICLE: "No vehicle number",
};

export interface IoclSummary { imported: number; duplicate: number; failed: number; corrected: number; errors: { row: string; reason: string }[] }
export interface IoclRow {
  _id: string; txnId: string; txnDate: string; txnTime: string; txnType: string; vehicleNo: string | null; product: string | null; quantity: number | null;
  amount: number | null; fileAmount: number | null; amountCorrected: boolean; odometer: string | null; location: string | null;
  match: { status: MatchStatus; projectNo: string | null; clientName: string | null; driverName: string | null; driverCode: string | null };
}
export interface IoclPage {
  items: IoclRow[]; total: number; page: number; limit: number; products: string[];
  vehicleTotals: { vehicleNo: string; count: number; quantity: number; amount: number; status: MatchStatus }[];
  summary: { sales: number; amount: number; unmatched: number };
}

export function ioclQuery(f: { from: string; to: string; vehicleNo: string; product: string }, page?: number): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v.trim()) q.set(k, v.trim());
  if (page) q.set("page", String(page));
  return q.toString();
}
