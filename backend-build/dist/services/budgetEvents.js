import { BudgetEvent } from "../models/Approval.js";
export const statusOf = (b) => b.approvalStatus ?? "DRAFT";
export async function recordEvent(budgetId, version, action, username, role, details = null) {
    try {
        await BudgetEvent.create({ budget: budgetId, version, action, username, role, details });
    }
    catch (e) {
        if (e?.code !== 11000)
            throw e; // already recorded
    }
}
