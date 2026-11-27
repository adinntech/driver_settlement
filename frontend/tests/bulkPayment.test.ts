import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bulkBody, bulkError, bulkTotal, submitBulk, type BulkLine } from "../src/utils/bulkPayment";

const date = "2026-11-27";
const entry = (x: string, patch: Partial<BulkLine> = {}) => ({ trackingVehicle: x, pifNumber: `PIF-${x}`, trackupNumber: "T1", vehicleNo: null, driverName: null, reason: "Toll", amount: "500", description: "", ...patch });

test("identifier cells stay table cells, so columns line up under their headers", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  assert.match(css, /^td\.num \{ display: table-cell; \}/m);
});

test("every row is validated and the error names its vehicle", () => {
  const second = (patch: Partial<BulkLine>) => bulkError([entry("a"), entry("b", patch)], date)!;
  assert.equal(bulkError([entry("a"), entry("b", { reason: "Fuel", amount: "75.25" })], date), null);
  assert.match(bulkError([], date)!, /vehicle/);
  assert.match(bulkError([entry("a")], "")!, /date/);
  assert.match(second({ reason: "" }), /^PIF PIF-b: .*reason/);
  for (const amount of ["", "0", "-5", "abc", "1.234", "100000000"]) assert.match(second({ amount }), /^PIF PIF-b: .*amount/, amount);
  assert.match(second({ reason: "Others" }), /Description/);
});

test("the total adds different row amounts exactly", () => {
  assert.equal(bulkTotal([entry("a", { amount: "0.1" }), entry("b", { amount: "0.2" }), entry("c", { amount: "" })]), 0.3);
});

test("each reason maps to the individual form's fields", () => {
  const body = (reason: string) => bulkBody({ reason, amount: "500", date, description: "Parking" }, "key-12345") as Record<string, unknown>;
  assert.deepEqual(body("Fuel").dieselEntries, [{ amount: "500" }]);
  assert.equal(body("Food").foodAmount, "500");
  for (const r of ["Toll", "Travel", "Permit", "Service"]) assert.deepEqual(body(r).expenses, [{ optionKey: r.toUpperCase(), amount: "500" }]);
  assert.deepEqual(body("Others").expenses, [{ optionKey: "OTHERS", amount: "500", description: "Parking" }]);
});

test("one request per vehicle with its own reason, amount and key; a failure does not stop the rest", async () => {
  const calls: [string, string][] = [];
  const bodies: Record<string, unknown>[] = [];
  const rows = [entry("a", { reason: "Fuel", amount: "100" }), entry("b"), entry("c", { reason: "Food", amount: "250" })];
  const out = await submitBulk(rows, date, "batch1", async (path, body) => {
    calls.push([path, (body as { idempotencyKey: string }).idempotencyKey]);
    bodies.push(body as Record<string, unknown>);
    if (path.includes("/b/")) throw new Error("already covers part of this period");
    return { paymentNumber: "DVP-1" };
  });
  assert.deepEqual(calls, ["a", "b", "c"].map((x) => [`/settlements/projects/${x}/daily`, `bulk-batch1-${x}`]));
  assert.deepEqual([bodies[0].dieselEntries, bodies[1].expenses, bodies[2].foodAmount], [[{ amount: "100" }], [{ optionKey: "TOLL", amount: "500" }], "250"]);
  assert.deepEqual(out.map((r) => r.ok), [true, false, true]);
  assert.match(out[1].message, /already covers/);
});
