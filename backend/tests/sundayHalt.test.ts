process.env.ROADSHOW = "on";
import test from "node:test";
import assert from "node:assert/strict";
import { validateTracking } from "../src/validators/tracking.validator.js";

const NOW = new Date("2026-11-25T06:00:00Z");
// 2026-11-29 and 2026-12-06 are Sundays
const errors = (over: Record<string, unknown>, allowPastStart = false) =>
  validateTracking("ROADSHOW", {
    projectCode: "12345678", billingName: "KFC", stateCode: "33", numberOfVans: 1, vehicleTypes: [{ code: "CENTRE_NO_ROOF", quantity: 1 }], reportingLocations: ["Chennai"],
    startDate: "2026-11-25", endDate: "2026-12-04", reportingDate: "2026-11-26", sundayHalt: "YES", ...over,
  }, { now: NOW, allowPastStart }).errors;

test("Sunday Halt Yes: reporting date and end date cannot be a Sunday", () => {
  assert.deepEqual(errors({}), []);
  assert.deepEqual(errors({ reportingDate: "2026-11-29" }), ["Reporting date cannot be a Sunday when Sunday Halt is Yes"]);
  assert.deepEqual(errors({ endDate: "2026-12-06" }), ["End date cannot be a Sunday when Sunday Halt is Yes"]);
  assert.equal(errors({ reportingDate: "2026-11-29", endDate: "2026-12-06" }).length, 2);
});

test("Sunday Halt No (and historical imports): Sunday dates stay allowed", () => {
  const sundays = { reportingDate: "2026-11-29", endDate: "2026-12-06" };
  assert.deepEqual(errors({ ...sundays, sundayHalt: "NO" }), []);
  assert.deepEqual(errors(sundays, true), []);
});
