import test from "node:test";
import assert from "node:assert/strict";
import {
  canEdit, canSubmit, describeBudget, fieldLabel, homeFor, rejectableFields, statusOf, STATUS_LABEL,
} from "../src/utils/budgetDescribe";

const v2 = {
  schemaVersion: 2, mileage: 12, estimatedKmPerDay: 150, onRoadDate: "2026-10-21", completionDate: "2026-10-26", sundayHalt: false,
  numberOfDays: 6, dieselAmount: 5000, salaryAmount: 800, salaryUnit: "PER_DAY", foodAmount: 300, foodUnit: "PER_DAY", haltFood: 200,
  tolls: [{ location: "Salem", rate: 120 }], others: [{ description: "Parking", amount: 100 }], fromLocation: "Chennai", toLocation: "Madurai",
  totalKm: 900, upDownValue: 50,
  computed: { dieselValue: 5000, salaryValue: 4800, foodValue: 1800, tollAmount: 120, totalValue: 12270 },
};

test("RSOM role gets its own home page; unknown roles fall back to login", () => {
  assert.equal(homeFor("RSOM"), "/rsom");
  assert.equal(homeFor("RBP"), "/rbp");
  assert.equal(homeFor("RSOP"), "/rsop");
  assert.equal(homeFor("NOPE"), "/login");
});

test("status helpers: missing status is Draft; only Draft/Rejected editable; resubmit needs a new version", () => {
  assert.equal(statusOf(undefined), "DRAFT");
  assert.equal(statusOf(null), "DRAFT");
  assert.equal(statusOf("PENDING"), "PENDING");
  assert.equal(statusOf("garbage"), "DRAFT");
  assert.equal(STATUS_LABEL.PENDING, "Pending Approval");
  assert.equal(canEdit(undefined), true);
  assert.equal(canEdit("DRAFT"), true);
  assert.equal(canEdit("REJECTED"), true);
  assert.equal(canEdit("PENDING"), false);
  assert.equal(canEdit("APPROVED"), false);
  assert.equal(canSubmit("DRAFT", 1), true);
  assert.equal(canSubmit("REJECTED", 1, 1), false); // same version cannot be resubmitted
  assert.equal(canSubmit("REJECTED", 2, 1), true);
  assert.equal(canSubmit("PENDING", 1), false);
  assert.equal(canSubmit("APPROVED", 1), false);
});

test("describeBudget carries field keys for rejection highlighting and never prints undefined", () => {
  const rows = describeBudget(v2);
  const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
  assert.equal(byLabel["Toll Detail"].key, "tolls");
  assert.equal(byLabel["Others"].key, "others");
  assert.equal(byLabel["Halt Food"].key, "haltFood");
  assert.equal(byLabel["Total Value"].key, null);
  assert.ok(byLabel["Total Value"].value.includes("12,270"));
  assert.ok(byLabel["Toll Detail"].value.includes("Salem"));
  for (const r of rows) assert.ok(!/undefined|\[object/.test(r.value), `${r.label}: ${r.value}`);
});

test("rejectable fields: v2 layout list, legacy layout uses its own saved keys", () => {
  const keys = rejectableFields(v2).map((f) => f.key);
  for (const k of ["tolls", "others", "haltFood", "mileage", "fromLocation", "toLocation", "dieselAmount", "salaryAmount", "foodAmount"])
    assert.ok(keys.includes(k), k);
  assert.ok(!keys.includes("computed") && !keys.includes("schemaVersion"));
  assert.ok(!keys.includes("otherDetails"));
  assert.ok(rejectableFields({ ...v2, otherDetails: [{ name: "A", value: "1" }] }).some((f) => f.key === "otherDetails"));
  const legacy = rejectableFields({ permitCharges: 500, tollCharges: 300, driverType: "IN_HOUSE" });
  assert.deepEqual(legacy.map((f) => f.key), ["permitCharges", "tollCharges", "driverType"]);
  assert.equal(fieldLabel("tolls"), "Toll Detail (Location & Rate)");
  assert.equal(fieldLabel("permitCharges"), "Permit Charges"); // falls back to a readable label
});

test("legacy budgets still describe without errors", () => {
  const rows = describeBudget({ permitCharges: 500, driverType: "IN_HOUSE" });
  assert.deepEqual(rows.map((r) => r.key), ["permitCharges", "driverType"]);
  assert.ok(rows[0].value.includes("500"));
});
