process.env.ROADSHOW = "on";
import test from "node:test";
import assert from "node:assert/strict";
import { kmAllowance, kmAllowanceOf, kmUsage, parseKmPerDay } from "../src/utils/kmAllowance.js";
import { validateTracking } from "../src/validators/tracking.validator.js";
import { buildContext } from "../src/services/budget.service.js";
import { calculateFinal, finalData, validateFinalInput } from "../src/utils/settlement.js";

const NOW = new Date("2026-11-25T06:00:00Z");
// 2026-11-25 (Wed) .. 2026-12-04 (Fri): 10 calendar days, 1 Sunday (29 Nov)
const roadshow = (over: Record<string, unknown> = {}) => ({
  projectCode: "12345678", billingName: "KFC", stateCode: "33", numberOfVans: 1, vehicleTypes: [{ code: "CENTRE_NO_ROOF", quantity: 1 }], sundayHalt: "NO", reportingLocations: ["Chennai"],
  startDate: "2026-11-25", endDate: "2026-12-04", reportingDate: "2026-11-26", kmAllotted: "90 KM per day", ...over,
});
const v = (over: Record<string, unknown> = {}) => validateTracking("ROADSHOW", roadshow(over), { now: NOW });

test("KM per day is read from the RSOP text field", () => {
  assert.equal(parseKmPerDay("90 KM per day"), 90);
  assert.equal(parseKmPerDay("1,200 km"), 1200);
  assert.equal(parseKmPerDay("62.5"), 62.5);
  assert.equal(parseKmPerDay(80), 80);
  for (const bad of ["", "per day", "0 km", -5, null, undefined, {}]) assert.equal(parseKmPerDay(bad), null);
});

test("Extra KM Allowed = No: extra KM per day is always stored as 0, even if one is sent", () => {
  for (const over of [{ extraKmAllowed: "NO" }, { extraKmAllowed: "NO", extraKmAllotted: 50 }, {}]) {
    const r = v(over);
    assert.deepEqual(r.errors, []);
    assert.equal(r.details.extraKmAllotted, 0);
    assert.equal(r.details.totalAllowedKm, 900); // 90 km/day x 10 days
  }
});

test("Extra KM Allowed = Yes: per-day value required, > 0, max 2 decimals, capped, and needs a numeric KM per day", () => {
  const ok = v({ extraKmAllowed: "YES", extraKmAllotted: "20" });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.details.extraKmAllotted, 20);
  assert.equal(ok.details.totalAllowedKm, 1100); // (90 + 20) x 10, per day basis
  assert.equal(v({ extraKmAllowed: "YES", extraKmAllotted: 12.34 }).details.extraKmAllotted, 12.34);
  const has = (over: Record<string, unknown>, rx: RegExp) => assert.ok(v(over).errors.some((e) => rx.test(e)), JSON.stringify(over));
  has({ extraKmAllowed: "YES" }, /Extra KM Allotted is required/);
  has({ extraKmAllowed: "YES", extraKmAllotted: "" }, /Extra KM Allotted is required/);
  for (const bad of ["0", "-5", "abc", "1.234", "1e3", 0, -1]) has({ extraKmAllowed: "YES", extraKmAllotted: bad }, /greater than 0/);
  has({ extraKmAllowed: "YES", extraKmAllotted: 10001 }, /cannot be more than 10000 KM per day/);
  has({ extraKmAllowed: "YES", extraKmAllotted: 10, kmAllotted: "as per client" }, /KM Allotted \(KM per day\) is required/);
  has({ extraKmAllowed: "MAYBE" }, /extraKmAllowed must be YES or NO/);
});

test("daily and campaign totals: Sunday halt and different campaign durations", () => {
  const total = (over: Record<string, unknown>) => v({ extraKmAllowed: "YES", extraKmAllotted: 20, ...over }).details.totalAllowedKm;
  assert.equal(total({}), 1100); // 10 days, Sundays on road: 110 x 10
  assert.equal(total({ sundayHalt: "YES" }), 990); // Sunday halt: 9 days x 110
  assert.equal(total({ endDate: "2026-11-25", reportingDate: "2026-11-25" }), 110); // 1-day campaign
  assert.equal(total({ endDate: "2026-12-24" }), 3300); // 30 days x 110
  assert.equal(total({ endDate: "2026-12-24", sundayHalt: "YES" }), 2860); // 30 days, 4 Sundays halted -> 26 x 110
  const a = kmAllowanceOf("ROADSHOW", v({ extraKmAllowed: "YES", extraKmAllotted: 20, sundayHalt: "YES" }).details)!;
  assert.deepEqual(
    [a.kmPerDay, a.extraKmAllotted, a.allowedKmPerDay, a.campaignDays, a.baseKm, a.extraKmTotal, a.totalAllowedKm],
    [90, 20, 110, 9, 810, 180, 990],
  );
  assert.equal(v({ totalAllowedKm: 999999 }).details.totalAllowedKm, 900); // derived on the server only
  assert.equal("totalAllowedKm" in v({ kmAllotted: "as per client" }).details, false);
});

test("usage: extra KM used is capped at extra/day x days; excess only above the total (no double counting)", () => {
  const a = kmAllowance("90", 10, true, 20); // 900 regular + 200 extra = 1100
  const u = (km: number) => { const x = kmUsage(a, km); return [x.extraKmUsed, x.excessKm]; };
  assert.deepEqual(u(850), [0, 0]);
  assert.deepEqual(u(900), [0, 0]);
  assert.deepEqual(u(1000), [100, 0]);
  assert.deepEqual(u(1100), [200, 0]);
  assert.deepEqual(u(1250), [200, 150]);
  const none = kmAllowance("90", 10, false, 20);
  assert.deepEqual([none.extraKmAllotted, none.allowedKmPerDay, none.totalAllowedKm], [0, 90, 900]);
  assert.deepEqual([kmUsage(none, 950).extraKmUsed, kmUsage(none, 950).excessKm], [0, 50]);
  assert.equal(kmAllowanceOf("SIGNAGE", { kmAllotted: "90" }), null);
  const legacy = kmAllowanceOf("ROADSHOW", { numberOfDays: 10 })!;
  assert.equal(legacy.totalAllowedKm, null);
  assert.deepEqual([kmUsage(legacy, 500).extraKmUsed, kmUsage(legacy, 500).excessKm, kmUsage(legacy, 500).actualKm], [null, null, 500]);
});

test("budget context carries the per-day allowance (roadshow) and none for signage", () => {
  const vehicle = { trackupNumber: "T", pifNumber: "P", vehicleIndex: 1 };
  const details = { ...v({ extraKmAllowed: "YES", extraKmAllotted: 20 }).details };
  const km = buildContext({ projectType: "ROADSHOW", clientName: "KFC", details }, vehicle).km!;
  assert.deepEqual([km.allowedKmPerDay, km.totalAllowedKm], [110, 1100]);
  assert.equal(buildContext({ projectType: "SIGNAGE", clientName: "D", details: { fromDate: "2026-11-01", toDate: "2026-11-05" } }, vehicle).km, null);
});

test("final settlement stores Regular KM, Extra KM/day, Total Allowed, Actual and Excess KM; money is unchanged", () => {
  const input = {
    fixedMileage: "10", openingKm: "10000", closingKm: "11250", dieselCost: "95", ioclLitres: "130", perDaySalary: "800", perDayFood: "200",
    onRoadDays: "9", onRoadSundays: "1", reportingDate: "2026-11-26", expenses: [{ category: "FUEL", quantity: "1", cost: "5000" }], idempotencyKey: "abcdefgh1",
  };
  const r = validateFinalInput(input, { totalDays: 10, fromDate: "2026-11-25", toDate: "2026-12-04" });
  assert.deepEqual(r.errors, []);
  const camp = { fromDate: "2026-11-25", toDate: "2026-12-04", totalDays: 10 };
  const withExtra = finalData(r.data!, { ...camp, km: kmAllowance("90", 10, true, 20) });
  const noExtra = finalData(r.data!, { ...camp, km: kmAllowance("90", 10, false, 0) });
  const legacy = finalData(r.data!, camp);
  assert.deepEqual(withExtra.km, {
    kmPerDay: 90, extraKmAllowed: true, extraKmAllotted: 20, allowedKmPerDay: 110, campaignDays: 10, baseKm: 900, extraKmTotal: 200, totalAllowedKm: 1100,
    actualKm: 1250, extraKmUsed: 200, excessKm: 150,
  });
  assert.equal(noExtra.km!.excessKm, 350);
  assert.equal(legacy.km, null);
  for (const k of ["gross", "netAmount", "earningsTotal", "approvedTotal", "totalDeduction"] as const) {
    assert.equal(withExtra[k], legacy[k], k);
    assert.equal(noExtra[k], legacy[k], k);
  }
  assert.equal(withExtra.fuel.mileageShortSuggested, legacy.fuel.mileageShortSuggested); // mileage rule unchanged
  assert.equal(calculateFinal(r.data!).resultKm, 1250); // actual KM = closing - opening
});

test("Elements & Billing dates: inside the campaign (both boundaries), never before start or after end", () => {
  const keys = ["artsFileDate", "printingDate", "fabricationDate", "vehicleDeliveryDate", "supportingDate", "invoiceDate"];
  const labels = ["Arts File Date", "Printing Date", "Fabrication Date", "Vehicle Delivery Date", "Supporting Date", "Invoice Date"];
  keys.forEach((k, i) => {
    const msg = `${labels[i]} must be within the campaign start and end dates`;
    assert.ok(!v({ [k]: "2026-11-25" }).errors.includes(msg), `${k} on start`);
    assert.ok(!v({ [k]: "2026-12-04" }).errors.includes(msg), `${k} on end`);
    assert.ok(v({ [k]: "2026-11-24" }).errors.includes(msg), `${k} before start`);
    assert.ok(v({ [k]: "2026-12-05" }).errors.includes(msg), `${k} after end`);
  });
  assert.deepEqual(v({ artsFileDate: "2026-11-25", printingDate: "2026-11-26", fabricationDate: "2026-11-27", vehicleDeliveryDate: "2026-11-28", supportingDate: "2026-11-29", invoiceDate: "2026-12-04" }).errors, []);
  assert.ok(v({ artsFileDate: "2026-11-27", printingDate: "2026-11-26" }).errors.includes("printingDate cannot be before artsFileDate"));
  assert.deepEqual(v({ invoiceDate: "" }).errors, []);
});
