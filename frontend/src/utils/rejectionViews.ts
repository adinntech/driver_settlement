import { request } from "@/services/api";
import type { Budget } from "@/types/domain";

/** Fired after a rejection is marked viewed so the sidebar badge refreshes at once. */
export const REJECTIONS_CHANGED = "rbp-rejections-changed";

/** The version to mark when RBP opens this budget, or null when there is nothing new to see. */
export const unviewedRejection = (b: Pick<Budget, "approvalStatus" | "rejectedVersion" | "rejectionViewedVersion"> | null | undefined): number | null =>
  b?.approvalStatus === "REJECTED" && b.rejectedVersion && b.rejectionViewedVersion !== b.rejectedVersion ? b.rejectedVersion : null;

export async function markRejectionViewed(budgetId: string, version: number): Promise<void> {
  await request(`/budgets/${budgetId}/rejection-viewed`, "POST", { version });
  window.dispatchEvent(new Event(REJECTIONS_CHANGED));
}
