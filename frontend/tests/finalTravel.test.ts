import test from "node:test";
import assert from "node:assert/strict";
import { finalFormFrom, finalPayload, finalTotals, travelPayPaise, validateFinalForm } from "../src/utils/settlement";

const blank = () => finalFormFrom(null);

test("live Travel Pay: KM x rate, otherwise the saved amount; it flows into the net amount", () => {
  assert.equal(travelPayPaise({ travelPay: "99", travelKm: "120.5", travelRate: "12.40" }), 149420);
  assert.equal(travelPayPaise({ travelPay: "1500", travelKm: "", travelRate: "" }), 150000);
  assert.equal(travelPayPaise({ travelPay: "", travelKm: "10", travelRate: "" }), 0);
  const f = blank();
  Object.assign(f.n, { travelKm: "10", travelRate: "15" });
  assert.equal(finalTotals(f).net, 15000);
});

test("half-filled travel and a reversed period are refused; the period is sent", () => {
  const f = { ...blank(), campaignFrom: "2026-11-10", campaignTo: "2026-11-01" };
  f.n.travelKm = "10";
  const errors = validateFinalForm(f, null).join("|");
  assert.match(errors, /before the Start Date/);
  assert.match(errors, /both the Travel KM and the rate/);
  const body = finalPayload(f, "key") as Record<string, unknown>;
  assert.deepEqual([body.campaignFrom, body.campaignTo, body.travelKm], ["2026-11-10", "2026-11-01", "10"]);
});
