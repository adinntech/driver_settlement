import { BudgetEvent, type EventAction } from "../models/Approval.js";

export const statusOf = (b: { approvalStatus?: string | null }) => b.approvalStatus ?? "DRAFT";

export async function recordEvent(
  budgetId: unknown, version: number, action: EventAction, username: string, role: string, details: unknown = null,
) {
  try {
    await BudgetEvent.create({ budget: budgetId, version, action, username, role, details });
  } catch (e) {
    if ((e as { code?: number })?.code !== 11000) throw e; // already recorded
  }
}
