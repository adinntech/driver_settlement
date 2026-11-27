// Final settlement: Travel KM x rate and an edited campaign period.
import test from "node:test";
import assert from "node:assert/strict";
import { finalData, finalPeriod, validateFinalInput } from "../src/utils/settlement.js";

const base = { fixedMileage: "8", onRoadDays: "5", perDaySalary: "800", idempotencyKey: "abcdefgh9" };
const check = (more: object) => validateFinalInput({ ...base, ...more }, { totalDays: 10 });
const campaign = { fromDate: "2026-11-01", toDate: "2026-11-10", totalDays: 10 };

test("Travel Pay is KM x rate, counted once in gross and net", () => {
  const v = check({ travelKm: "120.5", travelRate: "12.40", travelPay: "99999" });
  assert.deepEqual(v.errors, []);
  const d = finalData(v.data!, campaign);
  assert.deepEqual([d.rates.travelKm, d.rates.travelRate, d.rates.travelPay], [120.5, 12.4, 1494.2]);
  assert.equal(d.netAmount, 4000 + 1494.2);
});

test("without KM and rate the amount stands; half-filled or invalid values are refused", () => {
  assert.equal(finalData(check({ travelPay: "1500" }).data!, campaign).netAmount, 5500);
  assert.match(check({ travelKm: "10" }).errors.join(), /both the Travel KM and the rate/);
  assert.match(check({ travelRate: "10" }).errors.join(), /both the Travel KM and the rate/);
  assert.match(check({ travelKm: "-1", travelRate: "5" }).errors.join(), /Travel KM cannot be negative/);
  assert.match(check({ travelKm: "1", travelRate: "abc" }).errors.join(), /Travel rate per KM must/);
});

test("campaign period: the project's by default, edited dates give their own day count", () => {
  assert.equal(finalPeriod({}, { ...campaign, totalDays: 8 }).period.totalDays, 8);
  const p = finalPeriod({ campaignFrom: "2026-11-01", campaignTo: "2026-11-15" }, campaign);
  assert.deepEqual([p.errors, p.period.days, p.period.totalDays], [[], 15, 15]);
  assert.match(finalPeriod({ campaignTo: "2026-10-01" }, campaign).errors.join(), /before the Start Date/);
  assert.match(finalPeriod({ campaignFrom: "2026-13-01" }, campaign).errors.join(), /valid date/);
  assert.match(finalPeriod({ campaignTo: "2028-11-01" }, campaign).errors.join(), /366/);
});
