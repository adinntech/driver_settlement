import type { SettlementRow } from "./settlement";

/**
 * Bulk Approve (RSOM, Daily Payment Approvals): the existing single approval endpoint once per payment. The server checks the
 * role, the pending status and the version of each one, so an already decided or changed payment is refused on its own.
 */
export const canBulkApprove = (role: string | undefined, p: Pick<SettlementRow, "category" | "status">) => role === "RSOM" && p.category === "DAILY" && p.status === "PENDING";

export interface BulkApproval { id: string; paymentNumber: string; ok: boolean; message: string }

/** One at a time; a refusal never stops the others. The version sent is the one the approver saw. */
export async function approveBulk(rows: Pick<SettlementRow, "_id" | "paymentNumber" | "version">[], post: (path: string, body: unknown) => Promise<unknown>): Promise<BulkApproval[]> {
  const results: BulkApproval[] = [];
  for (const { _id: id, paymentNumber, version } of rows) {
    try {
      await post(`/settlements/${id}/approve`, { version });
      results.push({ id, paymentNumber, ok: true, message: "Approved" });
    } catch (e) {
      results.push({ id, paymentNumber, ok: false, message: e instanceof Error ? e.message : "Request failed" });
    }
  }
  return results;
}
