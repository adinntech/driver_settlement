// Bulk Payment posts these bodies to the existing daily endpoint: the server's own validator must accept each reason.
import test from "node:test";
import assert from "node:assert/strict";
import { dailyData, validateDailyInput } from "../src/utils/settlement.js";
import { bulkBody, BULK_REASONS } from "../../frontend/src/utils/bulkPayment.js";

test("every bulk reason is a valid daily payment of exactly that amount", () => {
  for (const reason of BULK_REASONS) {
    const v = validateDailyInput(bulkBody({ reason, amount: "250.50", date: "2026-11-27", description: "Parking" }, "bulk-batch1-0123456789abcdef01234567"));
    assert.deepEqual(v.errors, [], reason);
    assert.equal(dailyData(v.data!).totalPayable, 250.5, reason);
  }
});
