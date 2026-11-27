import test from "node:test";
import assert from "node:assert/strict";
import { approveBulk, canBulkApprove } from "../src/utils/bulkApproval";

test("only RSOM can select, and only pending daily payments", () => {
  assert.equal(canBulkApprove("RSOM", { category: "DAILY", status: "PENDING" }), true);
  for (const status of ["APPROVED", "REJECTED", "COMPLETED"] as const) assert.equal(canBulkApprove("RSOM", { category: "DAILY", status }), false, status);
  assert.equal(canBulkApprove("RSOM", { category: "FINAL", status: "PENDING" }), false);
  for (const role of ["RBP", "RSA", "RSO", undefined]) assert.equal(canBulkApprove(role, { category: "DAILY", status: "PENDING" }), false, String(role));
});

test("each payment is approved with the version seen; a refusal does not stop the rest", async () => {
  const calls: [string, unknown][] = [];
  const rows = ["a", "b", "c"].map((x, i) => ({ _id: x, paymentNumber: `DVP-${x}`, version: i + 1 }));
  const out = await approveBulk(rows, async (path, body) => {
    calls.push([path, body]);
    if (path.includes("/b/")) throw new Error("This payment is already approved");
  });
  assert.deepEqual(calls, ["a", "b", "c"].map((x, i) => [`/settlements/${x}/approve`, { version: i + 1 }]));
  assert.deepEqual(out.map((r) => r.ok), [true, false, true]);
  assert.match(out[1].message, /already approved/);
});
