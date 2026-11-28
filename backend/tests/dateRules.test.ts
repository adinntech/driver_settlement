process.env.ROADSHOW = "on";
import test from "node:test";
import assert from "node:assert/strict";
import { addDaysYmd, istDateOf, isYmd, todayIst } from "../src/utils/dates.js";
import { validateTracking } from "../src/validators/tracking.validator.js";
import { validateBudget } from "../src/validators/budget.validator.js";
import { validateDailyInput, validateFinalInput } from "../src/utils/settlement.js";

const NOW = new Date("2026-11-25T06:00:00Z"); // 11:30 IST
const roadshow = (over: Record<string, unknown> = {}) => ({
  projectCode: "12345678", billingName: "KFC", stateCode: "33", numberOfVans: 1, vehicleTypes: [{ code: "CENTRE_NO_ROOF", quantity: 1 }], sundayHalt: "NO", reportingLocations: ["Chennai"],
  startDate: "2026-11-25", endDate: "2026-11-30", reportingDate: "2026-11-27", ...over,
});
const errs = (over: Record<string, unknown>, opts = {}) => validateTracking("ROADSHOW", roadshow(over), { now: NOW, ...opts }).errors;

test("date helpers: strict calendar dates, IST today, IST day of an instant", () => {
  assert.ok(isYmd("2028-02-29"));
  assert.ok(!isYmd("2026-02-29") && !isYmd("2026-13-01") && !isYmd("2026-1-01") && !isYmd(20261101));
  // 20:00 UTC is already the next day in India
  assert.equal(todayIst(new Date("2026-11-25T20:00:00Z")), "2026-11-26");
  assert.equal(todayIst(new Date("2026-11-25T18:29:59Z")), "2026-11-25");
  assert.equal(istDateOf("2026-03-31T18:30:00.000Z"), "2026-04-01");
  assert.equal(istDateOf("2026-04-01"), "2026-04-01");
  assert.equal(istDateOf("garbage"), null);
  assert.equal(addDaysYmd("2026-12-31", 1), "2027-01-01");
});

test("RSOP start date: today back to 7 days ago is allowed; older or future dates are not (IST boundary)", () => {
  assert.deepEqual(errs({}), []);
  assert.deepEqual(errs({ startDate: "2026-11-24", reportingDate: "2026-11-25" }), []); // yesterday
  assert.deepEqual(errs({ startDate: "2026-11-18", reportingDate: "2026-11-18" }), []); // exactly 7 days back
  assert.ok(errs({ startDate: "2026-11-17", reportingDate: "2026-11-18" }).includes("Start date cannot be more than 7 days in the past"));
  assert.ok(errs({ startDate: "2026-11-26", reportingDate: "2026-11-27" }).includes("Start date cannot be in the future"));
  // just before midnight UTC on the 24th is already the 25th in India -> the 25th is still "today"
  assert.deepEqual(validateTracking("ROADSHOW", roadshow(), { now: new Date("2026-11-24T19:00:00Z") }).errors, []);
  // historical imports (dev seed only) may keep a started campaign
  assert.deepEqual(errs({ startDate: "2026-11-20", reportingDate: "2026-11-21" }, { allowPastStart: true }), []);
});

test("RSOP end date: same day as start is fine, before start is not", () => {
  assert.deepEqual(errs({ endDate: "2026-11-25", reportingDate: "2026-11-25" }), []);
  assert.ok(errs({ endDate: "2026-11-24" }).includes("End date cannot be before start date"));
});

test("RSOP reporting date: before / on start / within / on end / after the campaign", () => {
  const msg = "Reporting date must be within the campaign start and end dates";
  assert.ok(errs({ reportingDate: "2026-11-24" }).includes(msg)); // before
  assert.deepEqual(errs({ reportingDate: "2026-11-25" }), []); // first day
  assert.deepEqual(errs({ reportingDate: "2026-11-28" }), []); // within
  assert.deepEqual(errs({ reportingDate: "2026-11-30" }), []); // last day
  assert.ok(errs({ reportingDate: "2026-12-01" }).includes(msg)); // after
  // campaign moved after the reporting date was entered: the old reporting date is now outside
  assert.ok(errs({ startDate: "2026-12-01", endDate: "2026-12-10", reportingDate: "2026-11-27" }).includes(msg));
  assert.ok(errs({ reportingDate: "2026-02-30" }).some((e) => /reportingDate must be a valid date/.test(e)));
});

test("RSOP: the Model / Backlit field is not stored for a roadshow", () => {
  const r = validateTracking("ROADSHOW", roadshow({ model: "Backlit Van" }), { now: NOW });
  assert.deepEqual(r.errors, []);
  assert.equal("model" in r.details, false);
});

test("signage: entry date cannot be in the future; From date is today back to 7 days ago; To date may be later", () => {
  const sig = { projectCode: "12345678", client: "D", jobSheetNumber: "1", location: "X", numberOfVehicles: 1, vehicleTypes: [{ code: "CENTRE_NO_ROOF", quantity: 1 }], date: "2026-11-25", fromDate: "2026-11-18", toDate: "2026-12-05" };
  const sErr = (o: Record<string, unknown>) => validateTracking("SIGNAGE", { ...sig, ...o }, { now: NOW }).errors;
  assert.deepEqual(sErr({}), []);
  assert.deepEqual(sErr({ fromDate: "2026-11-25" }), []);
  assert.ok(sErr({ date: "2026-11-26" }).includes("Date cannot be in the future"));
  assert.ok(sErr({ fromDate: "2026-11-17" }).includes("From date cannot be more than 7 days in the past"));
  assert.ok(sErr({ fromDate: "2026-11-26" }).includes("From date cannot be in the future"));
  assert.ok(sErr({ fromDate: "2026-11-25", toDate: "2026-11-24" }).includes("To date cannot be before from date"));
});

// ------------------------------------------------------------------------------------------------ RBP budget

const camp = { campaignFrom: "2026-12-01", campaignTo: "2026-12-10" };
const budget = (on: string, done: string) => ({ onRoadDate: on, completionDate: done, numberOfDays: 1 });
const bErr = (on: string, done: string, extra = {}) => validateBudget(budget(on, done), { ...camp, ...extra }).errors;

test("budget: on road and completion inside the campaign, completion on or after on road", () => {
  assert.deepEqual(bErr("2026-12-01", "2026-12-10"), []); // both boundaries
  assert.deepEqual(bErr("2026-12-05", "2026-12-05"), []); // same day
  assert.ok(bErr("2026-11-30", "2026-12-05").includes("On road date cannot be before the campaign start date"));
  assert.ok(bErr("2026-12-11", "2026-12-12").includes("On road date cannot be after the campaign end date"));
  assert.ok(bErr("2026-12-05", "2026-12-11").includes("Completion date cannot be after the campaign end date"));
  assert.ok(bErr("2026-12-05", "2026-12-04").includes("Completion date cannot be before on road date"));
  // past dates are legitimate for a budget of a running campaign (no "not in the past" rule here)
  assert.deepEqual(validateBudget(budget("2026-01-02", "2026-01-03"), { campaignFrom: "2026-01-01", campaignTo: "2026-01-05" }).errors, []);
});

test("budget edit: unchanged dates saved before the rule stay editable; changed ones are checked", () => {
  const previous = { onRoadDate: "2026-11-29", completionDate: "2026-12-10" };
  assert.deepEqual(bErr("2026-11-29", "2026-12-10", { previous }), []);
  assert.ok(bErr("2026-11-28", "2026-12-10", { previous }).includes("On road date cannot be before the campaign start date"));
});

// ------------------------------------------------------------------------------------------------ driver payments

const daily = (from: string, to: string) => ({ fromDate: from, toDate: to, foodAmount: "100", idempotencyKey: "abcdefgh1" });
const dErr = (from: string, to: string, b = {}) => validateDailyInput(daily(from, to), { ...camp, ...b }).errors;

test("daily payment period: inside the campaign; past periods allowed; corrected payments keep their period", () => {
  assert.deepEqual(dErr("2026-12-01", "2026-12-10"), []);
  assert.ok(dErr("2026-11-30", "2026-12-02").includes("From Date cannot be before the campaign start date"));
  assert.ok(dErr("2026-12-09", "2026-12-11").includes("To Date cannot be after the campaign end date"));
  assert.ok(dErr("2026-12-05", "2026-12-04").includes("To Date cannot be before From Date"));
  assert.deepEqual(dErr("2026-11-30", "2026-12-02", { previous: { fromDate: "2026-11-30", toDate: "2026-12-02" } }), []);
  assert.deepEqual(validateDailyInput(daily("2026-11-30", "2026-12-02")).errors, []); // no campaign known: only the basic rules
});

test("final settlement reporting date inside the campaign", () => {
  const ctx = { totalDays: 10, fromDate: "2026-12-01", toDate: "2026-12-10" };
  const err = (d: string) => validateFinalInput({ reportingDate: d, idempotencyKey: "abcdefgh1" }, ctx).errors;
  assert.ok(err("2026-11-30").includes("Reporting Date must be within the campaign start and end dates"));
  assert.ok(!err("2026-12-01").includes("Reporting Date must be within the campaign start and end dates"));
  assert.ok(err("2026-12-11").includes("Reporting Date must be within the campaign start and end dates"));
});

test("payment completion: payment date between the IST approval day and today; reference date not in the future", async () => {
  process.env.JWT_SECRET ??= "test-secret";
  const { validateCompletion } = await import("../src/services/settlement.service.js");
  const now = new Date("2026-11-25T06:00:00Z");
  const approved = new Date("2026-11-20T20:00:00Z"); // 21 Nov in India
  const ok = { referenceNumber: "UTR1", paymentMode: "EPAYMENT", bankName: "HDFC", transactionDetails: "UTR1" };
  assert.match(validateCompletion({ ...ok, paymentDate: "2026-11-20" }, approved, now).errors.join(), /before the approval date/);
  assert.deepEqual(validateCompletion({ ...ok, paymentDate: "2026-11-21" }, approved, now).errors, []);
  assert.deepEqual(validateCompletion({ ...ok, paymentDate: "2026-11-25" }, approved, now).errors, []);
  assert.match(validateCompletion({ ...ok, paymentDate: "2026-11-26" }, approved, now).errors.join(), /cannot be in the future/);
  assert.match(validateCompletion({ ...ok, paymentDate: "2026-11-25", referenceDate: "2026-11-26" }, approved, now).errors.join(), /Reference date cannot be in the future/);
  assert.deepEqual(validateCompletion({ ...ok, paymentDate: "2026-11-25", referenceDate: "2026-10-01" }, approved, now).errors, []); // older cheque / DD date is fine
});
