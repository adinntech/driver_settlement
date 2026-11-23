/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_budget";
process.env.JWT_SECRET = "test-secret";
process.env.RSOP_USERNAME = "RSOP";
process.env.RSOP_PASSWORD = "pass2";
process.env.RBP_USERNAME = "RBP";
process.env.RBP_PASSWORD = "123123";

import test from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import mongoose from "mongoose";
import { budgetTotal, computeBudget, diffBudget, validateBudget } from "../src/validators/budget.validator.js";
import { generateDisplayNumber } from "../src/utils/numbers.js";
import { allocateOne, type NumberStore } from "../src/services/numberAllocator.js";
import { normalizeIndianPhone } from "../src/utils/phone.js";

const valid = {
  mileage: 12, estimatedKmPerDay: 150,
  onRoadDate: "2026-10-22", completionDate: "2026-10-23", sundayHalt: false, numberOfDays: 2,
  dieselAmount: 5000, salaryAmount: 800, salaryUnit: "PER_DAY", foodAmount: 300, foodUnit: "PER_DAY",
  haltFood: 200, tolls: [{ location: "Salem", rate: 120 }, { location: "Madurai", rate: 80.5 }],
  othersDescription: "Parking", othersAmount: 100, fromLocation: "Chennai", toLocation: "Madurai",
  totalKm: 900, upDownValue: 50,
};

test("budget validation: valid sample and defaults for blank amounts", () => {
  assert.deepEqual(validateBudget(valid).errors, []);
  const min = validateBudget({ onRoadDate: "2026-10-22", completionDate: "2026-10-22", numberOfDays: 1 });
  assert.deepEqual(min.errors, []);
  assert.equal(min.data.dieselAmount, 0);
  assert.deepEqual(min.data.tolls, []);
});

test("budget validation rejects bad dates, days, negative/invalid amounts", () => {
  assert.ok(validateBudget({}).errors.length >= 3);
  assert.ok(validateBudget({ ...valid, completionDate: "2026-10-01" }).errors.some((e) => /Completion/.test(e)));
  assert.ok(validateBudget({ ...valid, numberOfDays: 0 }).errors.length > 0);
  assert.ok(validateBudget({ ...valid, numberOfDays: 1.5 }).errors.length > 0);
  for (const k of ["mileage", "dieselAmount", "salaryAmount", "foodAmount", "haltFood", "othersAmount", "totalKm", "upDownValue"]) {
    assert.ok(validateBudget({ ...valid, [k]: -1 }).errors.length > 0, `${k} negative`);
    assert.ok(validateBudget({ ...valid, [k]: "abc" }).errors.length > 0, `${k} text`);
  }
  assert.ok(validateBudget({ ...valid, salaryUnit: "PER_YEAR" }).errors.length > 0);
});

test("toll entries: multiple kept in order, empty rows dropped, invalid rejected", () => {
  const ok = validateBudget({ ...valid, tolls: [{ location: " A ", rate: 10 }, { location: "", rate: "" }, { location: "B", rate: 20 }] });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.data.tolls, [{ location: "A", rate: 10 }, { location: "B", rate: 20 }]);
  assert.ok(validateBudget({ ...valid, tolls: [{ location: "A", rate: -5 }] }).errors.length > 0);
  assert.ok(validateBudget({ ...valid, tolls: [{ location: "A", rate: "x" }] }).errors.length > 0);
  assert.ok(validateBudget({ ...valid, tolls: [{ location: "A" }] }).errors.length > 0);
  assert.ok(validateBudget({ ...valid, tolls: [{ location: "", rate: 5 }] }).errors.length > 0);
  assert.ok(validateBudget({ ...valid, tolls: "x" }).errors.length > 0);
});

test("calculation: per-day items x days, per-campaign as is, tolls summed, total adds all", () => {
  const d = validateBudget(valid).data;
  const c = computeBudget(d);
  assert.equal(c.dieselValue, 5000);
  assert.equal(c.salaryValue, 1600);
  assert.equal(c.foodValue, 600);
  assert.equal(c.tollAmount, 200.5);
  assert.equal(c.totalValue, 5000 + 1600 + 600 + 200 + 200.5 + 100 + 50);
  assert.equal(budgetTotal(d), c.totalValue);
  const camp = validateBudget({ ...valid, salaryUnit: "PER_CAMPAIGN" }).data;
  assert.equal(computeBudget(camp).salaryValue, 800);
});

test("diffBudget: only changed fields, deep compare for toll lists", () => {
  const a = validateBudget(valid).data;
  assert.deepEqual(diffBudget(a, a), []);
  const b = validateBudget({ ...valid, haltFood: 250 }).data;
  assert.deepEqual(diffBudget(a, b), [{ field: "haltFood", from: 200, to: 250 }]);
  const c = validateBudget({ ...valid, tolls: [{ location: "Salem", rate: 120 }] }).data;
  assert.deepEqual(diffBudget(a, c).map((x) => x.field), ["tolls"]);
  // legacy record without the new fields: everything new shows as changed from null
  assert.ok(diffBudget({ permitCharges: 5 }, a).every((x) => x.from === null));
});

test("other details: trimmed, empty rows dropped, order kept, value without name rejected", () => {
  const ok = validateBudget({ ...valid, otherDetails: [{ name: " Accommodation ", value: " 5000 " }, { name: "", value: "" }, { name: "Parking", value: 2000 }, { name: "Note only" }] });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.data.otherDetails, [{ name: "Accommodation", value: "5000" }, { name: "Parking", value: "2000" }, { name: "Note only", value: "" }]);
  assert.ok(validateBudget({ ...valid, otherDetails: [{ name: "", value: "100" }] }).errors.some((e) => /name is required/.test(e)));
  assert.ok(validateBudget({ ...valid, otherDetails: [{ name: "x".repeat(81), value: "1" }] }).errors.length > 0);
  assert.ok(validateBudget({ ...valid, otherDetails: [{ name: "a", value: "x".repeat(201) }] }).errors.length > 0);
  assert.ok(validateBudget({ ...valid, otherDetails: "nope" }).errors.length > 0);
  assert.deepEqual(validateBudget(valid).data.otherDetails, []); // old payloads without the field still valid
});

test("other details never affect calculations; diff captures add / edit / remove", () => {
  const base = validateBudget(valid).data;
  const withOther = validateBudget({ ...valid, otherDetails: [{ name: "Accommodation", value: "5000" }] }).data;
  assert.equal(budgetTotal(withOther), budgetTotal(base));
  assert.deepEqual(diffBudget(base, base), []);
  assert.deepEqual(diffBudget({ ...base, otherDetails: undefined }, base), []); // pre-feature record: no false change
  assert.deepEqual(diffBudget(base, withOther), [{ field: "otherDetails", from: [], to: [{ name: "Accommodation", value: "5000" }] }]);
  const edited = validateBudget({ ...valid, otherDetails: [{ name: "Accommodation", value: "6000" }] }).data;
  assert.equal(diffBudget(withOther, edited)[0].field, "otherDetails");
  assert.deepEqual(diffBudget(edited, base), [{ field: "otherDetails", from: [{ name: "Accommodation", value: "6000" }], to: [] }]);
});

test("others: multiple description+amount rows, summed in total, empty dropped, legacy single pair accepted", () => {
  const rows = [{ description: " toll ", amount: 100 }, { description: "", amount: "" }, { description: "Parking", amount: "50.5" }];
  const r = validateBudget({ ...valid, others: rows });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.data.others, [{ description: "toll", amount: 100 }, { description: "Parking", amount: 50.5 }]);
  const base = validateBudget({ ...valid, others: [] }).data;
  assert.equal(budgetTotal(r.data) - budgetTotal(base), 150.5);
  // legacy payload (one pair) still works and gives the same total as before
  const legacy = validateBudget(valid).data;
  assert.deepEqual(legacy.others, [{ description: "Parking", amount: 100 }]);
  assert.equal(budgetTotal(legacy), 7750.5);
  assert.ok(validateBudget({ ...valid, others: [{ description: "x", amount: -1 }] }).errors.length > 0);
  assert.ok(validateBudget({ ...valid, others: [{ description: "x", amount: "abc" }] }).errors.length > 0);
  assert.ok(validateBudget({ ...valid, others: [{ description: "", amount: 10 }] }).errors.some((e) => /description is required/.test(e)));
  assert.ok(validateBudget({ ...valid, others: "no" }).errors.length > 0);
});

test("phone: +91 canonical form, rejects letters/specials/short/long, no duplicate +91", () => {
  assert.equal(normalizeIndianPhone("9876543210"), "+91 9876543210");
  assert.equal(normalizeIndianPhone("+91 9876543210"), "+91 9876543210");
  assert.equal(normalizeIndianPhone("+91 +91 9876543210"), null);
  assert.equal(normalizeIndianPhone("91 98765 43210"), "+91 9876543210");
  assert.equal(normalizeIndianPhone("09876543210"), "+91 9876543210");
  assert.equal(normalizeIndianPhone("75488 10034"), "+91 7548810034"); // existing sample format
  for (const bad of ["98765abcde", "98765@3210", "12345", "98765432101", "1234567890", "+44 9876543210", "", null, 5])
    assert.equal(normalizeIndianPhone(bad), null, String(bad));
});

test("display number is 4 digits, 5 digits when requested, and allocator escalates when full", async () => {
  assert.match(generateDisplayNumber(), /^\d{4}$/);
  assert.match(generateDisplayNumber(true), /^\d{5}$/);
  const used = new Set<string>();
  const store: NumberStore = {
    exists: async (s) => used.has(s.displayNumber),
    insert: async (s) => {
      used.add(s.displayNumber);
    },
  };
  for (let n = 1000; n <= 9999; n++) used.add(String(n));
  const set = await allocateOne(store, 1);
  assert.match(set.displayNumber, /^\d{5}$/);
});

const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { Budget, BudgetVersion } = await import("../src/models/Budget.js");
const { User } = await import("../src/models/User.js");
const { TrackingVehicle } = await import("../src/models/TrackingVehicle.js");
const { TrackingProject } = await import("../src/models/TrackingProject.js");

let server: Server;
let base = "";
// Setup runs before any test is registered; teardown is the last test (hook ordering is unreliable).
{
  await connectDB();
  await mongoose.connection.dropDatabase();
  await Promise.all([User.init(), TrackingVehicle.init(), TrackingProject.init(), Budget.init(), BudgetVersion.init()]);
  await seedUsers();
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
}

const call = async (path: string, method = "GET", body?: unknown, token?: string) => {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as { success: boolean; message: string; data: any } };
};
const login = async (role: string, u: string, p: string) =>
  (await call("/auth/login", "POST", { role, username: u, password: p })).body.data.token as string;

const roadshow = {
  billingName: "Sapphire Foods (KFC)", stateCode: "33", numberOfVans: 2,
  startDate: "2026-10-22", endDate: "2026-10-23", reportingDate: "2026-10-22",
  sundayHalt: "NO", paSystem: "YES", reportingLocations: ["Madurai", "Salem"],
};
const signage = {
  date: "2026-10-20", client: "DALMIA", jobSheetNumber: "22403", location: "RAMNAD",
  numberOfVehicles: 1, fromDate: "2026-10-21", toDate: "2026-10-26",
};

test("roadshow contact number is stored as +91; invalid phone rejected by the API", async () => {
  const rsop = await login("RSOP", "RSOP", "pass2");
  const ok = await call("/tracking", "POST", { projectType: "ROADSHOW", details: { ...roadshow, contactNumber: "75488 10034" } }, rsop);
  assert.equal(ok.status, 201);
  assert.equal(ok.body.data.details.contactNumber, "+91 7548810034");
  const bad = await call("/tracking", "POST", { projectType: "ROADSHOW", details: { ...roadshow, contactNumber: "98abc" } }, rsop);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.data, null);
});

test("budget context keeps existing fields; adds jobSheet / PA system; reporting date roadshow-only", async () => {
  const rsop = await login("RSOP", "RSOP", "pass2");
  const rbp = await login("RBP", "RBP", "123123");
  const r = (await call("/tracking", "POST", { projectType: "ROADSHOW", details: roadshow }, rsop)).body.data;
  const s = (await call("/tracking", "POST", { projectType: "SIGNAGE", details: signage }, rsop)).body.data;

  const rc = (await call(`/budgets/vehicle/${r.vehicles[0]._id}`, "GET", undefined, rbp)).body.data;
  assert.equal(rc.budget, null);
  assert.equal(rc.context.client, "Sapphire Foods (KFC)");
  assert.equal(rc.context.projectType, "ROADSHOW");
  assert.equal(rc.context.displayNumber, r.vehicles[0].displayNumber);
  assert.equal(rc.context.campaignFrom, "2026-10-22");
  assert.equal(rc.context.campaignTo, "2026-10-23");
  assert.equal(rc.context.reportingDate, "2026-10-22");
  assert.equal(rc.context.location, "Madurai, Salem");
  assert.equal(rc.context.paSystem, "YES");
  assert.equal(rc.context.jobSheetNumber, null);

  const sc = (await call(`/budgets/vehicle/${s.vehicles[0]._id}`, "GET", undefined, rbp)).body.data;
  assert.equal(sc.context.reportingDate, null);
  assert.equal(sc.context.jobSheetNumber, "22403");
  assert.equal(sc.context.location, "RAMNAD");
});

test("RSOP cannot touch budgets; unauthenticated is rejected", async () => {
  const rsop = await login("RSOP", "RSOP", "pass2");
  assert.equal((await call("/budgets/vehicle/abc", "GET")).status, 401);
  assert.equal((await call("/budgets", "POST", { vehicleId: "x" }, rsop)).status, 403);
});

test("create, edit restores every toll entry, versions preserved, originals untouched", async () => {
  const rsop = await login("RSOP", "RSOP", "pass2");
  const rbp = await login("RBP", "RBP", "123123");
  const p = (await call("/tracking", "POST", { projectType: "ROADSHOW", details: roadshow }, rsop)).body.data;
  const vehicle = p.vehicles[0];

  const bad = await call("/budgets", "POST", { vehicleId: vehicle._id, ...valid, tolls: [{ location: "A", rate: -1 }] }, rbp);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.data, null);

  const c = await call("/budgets", "POST", { vehicleId: vehicle._id, ...valid }, rbp);
  assert.equal(c.status, 201);
  const budget = c.body.data.budget;
  assert.match(budget.budgetNumber, /^BUD-\d{6}$/);
  assert.equal(budget.currentVersion, 1);
  assert.equal(budget.total, computeBudget(validateBudget(valid).data).totalValue);
  assert.equal(budget.data.schemaVersion, 2);
  assert.deepEqual(budget.data.tolls, valid.tolls); // all entries persisted, in order

  const reread = (await call(`/budgets/vehicle/${vehicle._id}`, "GET", undefined, rbp)).body.data.budget;
  assert.deepEqual(reread.data.tolls, valid.tolls); // edit form restores from this

  assert.equal((await call("/budgets", "POST", { vehicleId: vehicle._id, ...valid }, rbp)).status, 409);
  assert.equal((await call(`/budgets/${budget._id}`, "PUT", valid, rbp)).status, 400); // no changes

  const more = [...valid.tolls, { location: "Trichy", rate: 60 }];
  const e1 = await call(`/budgets/${budget._id}`, "PUT", { ...valid, tolls: more }, rbp);
  assert.equal(e1.status, 200);
  assert.equal(e1.body.data.currentVersion, 2);
  assert.deepEqual(e1.body.data.data.tolls, more);
  const e2 = await call(`/budgets/${budget._id}`, "PUT", { ...valid, tolls: [more[0]], haltFood: 999 }, rbp);
  assert.equal(e2.body.data.currentVersion, 3);

  const vs = (await call(`/budgets/${budget._id}/versions`, "GET", undefined, rbp)).body.data;
  assert.equal(vs.length, 3);
  assert.deepEqual(vs[0].data.tolls, valid.tolls); // V1 untouched
  assert.deepEqual(vs[1].data.tolls, more);
  assert.deepEqual(vs[1].changes.map((x: any) => x.field), ["tolls"]);
  assert.deepEqual(vs[2].changes.map((x: any) => x.field).sort(), ["haltFood", "tolls"]);
  assert.ok(vs.every((x: any) => x.updatedBy === "RBP" && x.createdAt));
  assert.equal((await call(`/budgets/${budget._id}/versions/99`, "GET", undefined, rbp)).status, 404);

  await assert.rejects(BudgetVersion.updateOne({ budget: budget._id, version: 1 }, { total: 1 }));
  await assert.rejects(BudgetVersion.deleteMany({ budget: budget._id }));

  const after = (await call(`/tracking/${p._id}`, "GET", undefined, rbp)).body.data;
  assert.deepEqual(after.details, p.details);
  assert.equal(after.vehicles[0].trackupNumber, vehicle.trackupNumber);
  assert.equal(after.vehicles[0].budgetStatus, "CREATED");
  assert.equal(after.vehicles[1].budgetStatus, "PENDING");
});

test("legacy (pre-redesign) budget stays readable and can be edited into a new version", async () => {
  const rsop = await login("RSOP", "RSOP", "pass2");
  const rbp = await login("RBP", "RBP", "123123");
  const p = (await call("/tracking", "POST", { projectType: "SIGNAGE", details: signage }, rsop)).body.data;
  const v = p.vehicles[0];
  const legacy = { permitCharges: 500, tollCharges: 300, petrolAllowance: 1000, foodAllowance: 400, iocCardPayment: 2000, driverType: "IN_HOUSE" };
  const b = await Budget.create({
    budgetNumber: "BUD-111111", vehicle: v._id, project: p._id, data: legacy, total: 4200,
    currentVersion: 1, createdBy: "RBP", updatedBy: "RBP",
  });
  await BudgetVersion.create({ budget: b._id, version: 1, data: legacy, total: 4200, changes: [], updatedBy: "RBP" });

  const read = (await call(`/budgets/vehicle/${v._id}`, "GET", undefined, rbp)).body.data.budget;
  assert.equal(read.data.permitCharges, 500);
  assert.equal(read.total, 4200);

  const e = await call(`/budgets/${b._id}`, "PUT", valid, rbp);
  assert.equal(e.status, 200);
  assert.equal(e.body.data.currentVersion, 2);
  const vs = (await call(`/budgets/${b._id}/versions`, "GET", undefined, rbp)).body.data;
  assert.equal(vs[0].data.permitCharges, 500); // old version preserved
  assert.equal(vs[1].data.schemaVersion, 2);
});

test("other details persist, restore on read, and every add/edit/remove becomes a new immutable version", async () => {
  const rsop = await login("RSOP", "RSOP", "pass2");
  const rbp = await login("RBP", "RBP", "123123");
  const p = (await call("/tracking", "POST", { projectType: "SIGNAGE", details: signage }, rsop)).body.data;
  const od1 = [{ name: "Accommodation", value: "5000" }, { name: "Parking Charges", value: "2000" }];
  const c = await call("/budgets", "POST", { vehicleId: p.vehicles[0]._id, ...valid, otherDetails: [...od1, { name: "", value: "" }] }, rbp);
  assert.equal(c.status, 201);
  const b = c.body.data.budget;
  assert.deepEqual(b.data.otherDetails, od1); // empty row not saved
  assert.equal(b.total, computeBudget(validateBudget(valid).data).totalValue); // calculation unchanged
  assert.deepEqual((await call("/budgets/vehicle/" + p.vehicles[0]._id, "GET", undefined, rbp)).body.data.budget.data.otherDetails, od1);

  const bad = await call("/budgets/" + b._id, "PUT", { ...valid, otherDetails: [{ name: "", value: "9" }] }, rbp);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.data, null);

  const od2 = [{ name: "Accommodation", value: "5500" }, od1[1], { name: "Loading Charges", value: "3000" }]; // edit + add
  assert.equal((await call("/budgets/" + b._id, "PUT", { ...valid, otherDetails: od2 }, rbp)).body.data.currentVersion, 2);
  const od3 = [od2[0], od2[2]]; // remove one
  assert.equal((await call("/budgets/" + b._id, "PUT", { ...valid, otherDetails: od3 }, rbp)).body.data.currentVersion, 3);
  assert.equal((await call("/budgets/" + b._id, "PUT", { ...valid, otherDetails: od3 }, rbp)).status, 400); // repeat submit = no duplicate version
  assert.equal((await call("/budgets/" + b._id, "PUT", { ...valid }, rbp)).body.data.currentVersion, 4); // delete all

  const vs = (await call("/budgets/" + b._id + "/versions", "GET", undefined, rbp)).body.data;
  assert.equal(vs.length, 4);
  assert.deepEqual(vs[0].data.otherDetails, od1); // V1 unchanged
  assert.deepEqual(vs[1].data.otherDetails, od2);
  assert.deepEqual(vs[2].data.otherDetails, od3);
  assert.deepEqual(vs[3].data.otherDetails, []);
  assert.deepEqual(vs[1].changes, [{ field: "otherDetails", from: od1, to: od2 }]);
  assert.deepEqual(vs[3].changes, [{ field: "otherDetails", from: od3, to: [] }]);
  assert.ok(vs.every((x: any) => x.updatedBy === "RBP" && x.createdAt));
  assert.deepEqual(vs[0].data.tolls, valid.tolls); // location/rate untouched across versions
});

test("v2 budget saved before other details existed: reads fine, editing other fields shows no false change", async () => {
  const rsop = await login("RSOP", "RSOP", "pass2");
  const rbp = await login("RBP", "RBP", "123123");
  const p = (await call("/tracking", "POST", { projectType: "SIGNAGE", details: signage }, rsop)).body.data;
  const input = validateBudget(valid).data;
  const { otherDetails: _omit, ...preFeature } = input; // eslint-disable-line @typescript-eslint/no-unused-vars
  const b = await Budget.create({
    budgetNumber: "BUD-222222", vehicle: p.vehicles[0]._id, project: p._id, data: { ...preFeature, schemaVersion: 2 },
    total: budgetTotal(input), currentVersion: 1, createdBy: "RBP", updatedBy: "RBP",
  });
  await BudgetVersion.create({ budget: b._id, version: 1, data: { ...preFeature, schemaVersion: 2 }, total: b.total, changes: [], updatedBy: "RBP" });
  const read = (await call("/budgets/vehicle/" + p.vehicles[0]._id, "GET", undefined, rbp)).body.data.budget;
  assert.equal(read.data.otherDetails, undefined);
  assert.equal((await call("/budgets/" + b._id, "PUT", valid, rbp)).status, 400); // nothing changed
  assert.equal((await call("/budgets/" + b._id, "PUT", { ...valid, haltFood: 1 }, rbp)).status, 200);
  const vs = (await call("/budgets/" + b._id + "/versions", "GET", undefined, rbp)).body.data;
  assert.deepEqual(vs[1].changes.map((x: any) => x.field), ["haltFood"]);
});

test("others rows persist through create, edit (add/remove) and versions", async () => {
  const rsop = await login("RSOP", "RSOP", "pass2");
  const rbp = await login("RBP", "RBP", "123123");
  const p = (await call("/tracking", "POST", { projectType: "SIGNAGE", details: signage }, rsop)).body.data;
  const { othersDescription: _d, othersAmount: _a, ...rest } = valid; // eslint-disable-line @typescript-eslint/no-unused-vars
  const o1 = [{ description: "toll", amount: 100 }];
  const c = await call("/budgets", "POST", { vehicleId: p.vehicles[0]._id, ...rest, others: o1 }, rbp);
  assert.equal(c.status, 201);
  const b = c.body.data.budget;
  const o2 = [...o1, { description: "Loading", amount: 250 }];
  const e1 = await call("/budgets/" + b._id, "PUT", { ...rest, others: o2 }, rbp);
  assert.equal(e1.body.data.total - b.total, 250);
  assert.deepEqual(e1.body.data.data.others, o2);
  const e2 = await call("/budgets/" + b._id, "PUT", { ...rest, others: [o2[1]] }, rbp);
  assert.equal(e2.body.data.currentVersion, 3);
  const vs = (await call("/budgets/" + b._id + "/versions", "GET", undefined, rbp)).body.data;
  assert.deepEqual(vs[0].data.others, o1); // V1 unchanged
  assert.deepEqual(vs[1].changes, [{ field: "others", from: o1, to: o2 }]);
  assert.deepEqual(vs[2].data.others, [o2[1]]);
});

test("concurrent edits from the same version: only one wins, versions stay consistent", async () => {
  const rsop = await login("RSOP", "RSOP", "pass2");
  const rbp = await login("RBP", "RBP", "123123");
  const p = (await call("/tracking", "POST", { projectType: "SIGNAGE", details: signage }, rsop)).body.data;
  const b = (await call("/budgets", "POST", { vehicleId: p.vehicles[0]._id, ...valid }, rbp)).body.data.budget;
  const rs = await Promise.all(
    [1, 2, 3, 4].map((n) => call(`/budgets/${b._id}`, "PUT", { ...valid, haltFood: 200 + n }, rbp)),
  );
  const ok = rs.filter((r) => r.status === 200).length;
  assert.ok(ok >= 1);
  assert.ok(rs.every((r) => r.status === 200 || r.status === 409));
  const vs = (await call(`/budgets/${b._id}/versions`, "GET", undefined, rbp)).body.data;
  assert.equal(vs.length, 1 + ok);
  assert.deepEqual(vs.map((x: any) => x.version), Array.from({ length: vs.length }, (_, i) => i + 1));
});

test("cleanup", async () => {
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
