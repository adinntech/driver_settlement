/* eslint-disable @typescript-eslint/no-explicit-any */
// Change Driver travel deduction: owed by the replaced driver, recovered once through Previous Salary Deduction. Own test database.
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_driver_change";
process.env.JWT_SECRET = "test-secret";
for (const [r, p] of [["RBP", "p2"], ["RSOM", "p3"], ["RSA", "p4"], ["RSO", "p5"]]) {
  process.env[`${r}_USERNAME`] = r;
  process.env[`${r}_PASSWORD`] = p;
}
process.env.STORAGE_TYPE = "local";

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import mongoose from "mongoose";

const { config: cfg } = await import("../src/config/index.js");
cfg.mongoUri = process.env.MONGO_URI!;
cfg.env = "test";
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-driver-change-test-"));
cfg.storage.localDir = storageDir;
const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { seedDevData } = await import("../src/seed/devSeed.js");
const { SettlementPayment } = await import("../src/models/SettlementPayment.js");
const { AllotmentEvent } = await import("../src/models/VehicleAllotment.js");
const { pendingDriverChange } = await import("../src/services/driverChangeDeduction.js");
const { savedDeductionLines } = await import("../src/utils/settlement.js");

let server: Server;
let base = "";
const tok: Record<string, string> = {};
let tvB = ""; // a project vehicle whose current driver is B
let B = "";
const A = String(new mongoose.Types.ObjectId()); // replaced driver (history only)

async function api(role: string, method: string, url: string, body?: unknown) {
  const res = await fetch(`${base}${url}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok[role]}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
}
const change = (from: string, amount: number, allotment = new mongoose.Types.ObjectId()) =>
  AllotmentEvent.create({ allotment, action: "DRIVER_CHANGED", username: "RBP", details: { from: { driverId: from }, travelAmountDeduction: amount } });
const context = async (tv: string) => (await api("RBP", "GET", `/settlements/projects/${tv}`)).body.data;
const body = (previousSalary: string, driverChangeAmount: number | undefined, key: string) => ({
  fixedMileage: "8", onRoadDays: "5", perDaySalary: "1000", driverChangeAmount, deductions: { previousSalary }, idempotencyKey: key,
});

before(async () => {
  await connectDB();
  assert.match(mongoose.connection.name, /_test_/);
  await mongoose.connection.dropDatabase();
  await seedUsers();
  await seedDevData();
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  for (const [role, password] of [["RBP", "p2"], ["RSOM", "p3"], ["RSA", "p4"], ["RSO", "p5"]]) {
    const r = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, username: role, password }) });
    tok[role] = ((await r.json()) as any).data.token;
  }
  const used = new Set((await SettlementPayment.distinct("trackingVehicle")).map(String));
  const projects = (await api("RBP", "GET", "/settlements/projects?limit=100")).body.data.items;
  for (const p of projects.filter((x: any) => !used.has(x.trackingVehicle))) {
    const allot: any = await mongoose.connection.db!.collection("vehicleallotments").findOne({ trackingVehicle: new mongoose.Types.ObjectId(p.trackingVehicle), status: "ACTIVE" });
    if (allot?.driver && !(await pendingDriverChange(String(allot.driver))).amount && !(await context(p.trackingVehicle)).prefill.suspenseAmount) { tvB = p.trackingVehicle; B = String(allot.driver); break; }
  }
  assert.ok(tvB);
});
after(async () => {
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  fs.rmSync(storageDir, { recursive: true, force: true });
});

test("A to B: the replaced driver owes it, the replacement does not; several changes add up once", async () => {
  await change(A, 500);
  await change(A, 250.5);
  await change(A, 0);
  assert.equal((await pendingDriverChange(A)).amount, 750.5);
  assert.equal((await pendingDriverChange(A)).events.length, 2);
  assert.equal((await pendingDriverChange(B)).amount, 0);
  assert.equal((await context(tvB)).prefill.driverChangeAmount, 0, "B's settlement is not charged");
});

test("the driver's own next final: prefilled again after refresh, enforced, recovered once, freed by rejection", async () => {
  await change(B, 600); // B was replaced elsewhere earlier and now settles this project
  for (let i = 0; i < 2; i++) assert.equal((await context(tvB)).prefill.driverChangeAmount, 600);
  const url = `/settlements/projects/${tvB}/final`;
  assert.equal((await api("RBP", "POST", url, body("600", undefined, "key-stale-0"))).status, 409, "a form that did not see the amount");
  const low = await api("RBP", "POST", url, body("599.99", 600, "key-low-000"));
  assert.equal(low.status, 400);
  assert.match(low.body.message, /at least 600/);
  const saved = await api("RBP", "POST", url, body("700", 600, "key-good-00"));
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const d = saved.body.data;
  assert.deepEqual([d.data.deductions.previousSalary, d.data.totalDeduction, d.data.netAmount, d.data.deductions.driverChangeTravel], [700, 700, d.data.gross - 700, undefined]);
  assert.deepEqual([d.data.driverChangeAmount, d.data.driverChangeEvents.length], [600, 1]);
  assert.equal((await pendingDriverChange(B)).amount, 0, "not offered to another settlement");
  assert.equal((await api("RSO", "POST", `/settlements/${d._id}/reject`, { reason: "Check the days" })).status, 200);
  assert.equal((await pendingDriverChange(B)).amount, 600);
  const re = await api("RBP", "POST", `/settlements/${d._id}/resubmit`, body("700", 600, "ignored-key"));
  assert.equal(re.status, 200, JSON.stringify(re.body));
  assert.equal((await pendingDriverChange(B)).amount, 0);
});

test("settlements saved before this keep their line and count their changes as recovered", async () => {
  const driver = new mongoose.Types.ObjectId(), allotment = new mongoose.Types.ObjectId();
  await change(String(driver), 300, allotment);
  await SettlementPayment.collection.insertOne({ driver, allotment, category: "FINAL", status: "APPROVED", submittedAt: new Date(Date.now() + 1000), data: { deductions: { driverChangeTravel: 300 } }, paymentNumber: "OLD-1", idempotencyKey: "old-1" });
  assert.equal((await pendingDriverChange(String(driver))).amount, 0);
  assert.equal(savedDeductionLines({ driverChangeTravel: 300, previousSalary: 0 }).length, 5);
  assert.deepEqual(savedDeductionLines({ previousSalary: 700 }).map((l) => l[0]), ["Mileage Shortage Deduction", "Vehicle Damage Deduction", "Previous Salary Deduction", "Other Deduction"]);
});
