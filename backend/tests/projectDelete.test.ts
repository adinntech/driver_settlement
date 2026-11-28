/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_project_delete";
process.env.JWT_SECRET = "test-secret";
process.env.RSOP_USERNAME = "RSOP";
process.env.RSOP_PASSWORD = "pass2";
process.env.RBP_USERNAME = "RBP";
process.env.RBP_PASSWORD = "123123";
process.env.RSOM_USERNAME = "RSOM";
process.env.RSOM_PASSWORD = "pass3";
process.env.RSA_USERNAME = "RSA";
process.env.RSA_PASSWORD = "pass4";

import test from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import mongoose from "mongoose";

const { addDaysYmd, todayIst } = await import("../src/utils/dates.js");
const day = (n: number) => addDaysYmd(todayIst(), n);
const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { User } = await import("../src/models/User.js");
const { Notification } = await import("../src/models/Approval.js");
const { DeletedProject } = await import("../src/models/DeletedProject.js");
const { TrackingProject } = await import("../src/models/TrackingProject.js");
const { TrackingVehicle } = await import("../src/models/TrackingVehicle.js");
const { Budget, BudgetVersion } = await import("../src/models/Budget.js");
const { SettlementPayment } = await import("../src/models/SettlementPayment.js");

let server: Server;
let base = "";
{
  await connectDB();
  assert.match(mongoose.connection.name, /_test/, "refusing to drop a non-test database");
  await mongoose.connection.dropDatabase();
  await Promise.all([User, Notification, DeletedProject, TrackingProject, TrackingVehicle, Budget, BudgetVersion].map((m: any) => m.init()));
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
const login = async (role: string, p: string) => (await call("/auth/login", "POST", { role, username: role, password: p })).body.data.token as string;
const creds = [["RSOP", "pass2"], ["RBP", "123123"], ["RSOM", "pass3"], ["RSA", "pass4"]] as const;
const tokens: Record<string, string> = {};
const T = async () => {
  for (const [r, p] of creds) tokens[r] ??= await login(r, p);
  return tokens;
};

const signage = (projectCode: string, client: string) => ({
  projectCode, date: day(-3), client, jobSheetNumber: "22403", location: "RAMNAD",
  numberOfVehicles: 1, vehicleTypes: [{ code: "CENTRE_NO_ROOF", quantity: 1 }], fromDate: day(-2), toDate: day(3),
});
const budgetBody = {
  mileage: 12, estimatedKmPerDay: 150, onRoadDate: day(-2), completionDate: day(3), sundayHalt: true, numberOfDays: 6,
  salaryAmount: 800, salaryUnit: "PER_DAY", foodAmount: 300, foodUnit: "PER_DAY", haltFood: 200,
  tolls: [{ location: "Salem", rate: 120 }], others: [{ description: "Parking", amount: 100 }],
  fromLocation: "Chennai", toLocation: "Madurai", totalKm: 900, fuelRate: 96, upDownValue: 50,
};
async function newProject(code: string, client: string) {
  const t = await T();
  const r = await call("/tracking", "POST", { projectType: "SIGNAGE", details: signage(code, client) }, t.RSOP);
  assert.equal(r.status, 201, r.body.message);
  return r.body.data;
}
const deletionNotes = async (role: string) =>
  (await call("/notifications", "GET", undefined, (await T())[role])).body.data.items.filter((n: any) => n.type === "PROJECT_DELETED");

test("only RSOP can delete; a refused request changes and notifies nothing", async () => {
  const t = await T();
  const p = await newProject("11111111", "Guard Client");
  assert.equal((await call(`/tracking/${p._id}`, "DELETE")).status, 401);
  for (const role of ["RBP", "RSOM", "RSA"]) assert.equal((await call(`/tracking/${p._id}`, "DELETE", undefined, t[role])).status, 403, role);
  assert.equal((await call("/tracking/abc", "DELETE", undefined, t.RSOP)).status, 400);
  assert.equal((await call(`/tracking/${new mongoose.Types.ObjectId()}`, "DELETE", undefined, t.RSOP)).status, 404);
  assert.equal((await call(`/tracking/${p._id}`, "GET", undefined, t.RSOP)).status, 200);
  assert.equal(await Notification.countDocuments({ type: "PROJECT_DELETED" }), 0);
});

test("delete hides the whole project everywhere, keeps the records and notifies every login once", async () => {
  const t = await T();
  const p = await newProject("22222222", "Gone Client");
  const second = await newProject("22222222", "Gone Client"); // same dashboard row
  const other = await newProject("33333333", "Kept Client");
  const b = (await call("/budgets", "POST", { vehicleId: p.vehicles[0]._id, ...budgetBody }, t.RBP)).body.data.budget;
  assert.equal((await call(`/budgets/${b._id}/submit`, "POST", {}, t.RBP)).status, 200);
  const before = (await call("/tracking/stats", "GET", undefined, t.RSOP)).body.data.total;

  const r = await call(`/tracking/${p._id}`, "DELETE", undefined, t.RSOP);
  assert.equal(r.status, 200, r.body.message);
  assert.equal(r.body.data.requests, 2);

  for (const role of ["RSOP", "RBP"]) {
    const list = (await call("/tracking", "GET", undefined, t[role])).body.data;
    assert.deepEqual(list.filter((x: any) => x.clientName === "Gone Client"), []);
    assert.ok(list.some((x: any) => x._id === other._id));
    assert.equal((await call("/tracking?q=22222222", "GET", undefined, t[role])).body.data.length, 0);
  }
  for (const id of [p._id, second._id]) assert.equal((await call(`/tracking/${id}`, "GET", undefined, t.RSOP)).status, 404);
  assert.equal((await call("/tracking/stats", "GET", undefined, t.RSOP)).body.data.total, before - 2);
  assert.equal((await call(`/budgets/vehicle/${p.vehicles[0]._id}`, "GET", undefined, t.RBP)).status, 404);
  for (const path of ["events", "versions", "versions/1"]) assert.equal((await call(`/budgets/${b._id}/${path}`, "GET", undefined, t.RBP)).status, 404, path);
  assert.equal((await call(`/approvals/${b._id}`, "GET", undefined, t.RSOM)).status, 404);
  assert.equal((await call(`/approvals/${b._id}/approve`, "POST", { version: 1 }, t.RSOM)).status, 404);
  assert.equal((await call("/approvals", "GET", undefined, t.RSOM)).body.data.total, 0);
  assert.equal((await call("/approvals/stats", "GET", undefined, t.RSOM)).body.data.total, 0);

  // nothing was destroyed
  const raw = (name: string, filter: object) => mongoose.connection.collection(name).countDocuments(filter);
  assert.equal(await raw("trackingprojects", { projectCode: "22222222" }), 2);
  assert.equal(await raw("budgets", { _id: new mongoose.Types.ObjectId(String(b._id)), approvalStatus: "PENDING" }), 1);
  const rec: any = await DeletedProject.findOne({ projectCode: "22222222" }).lean();
  assert.equal(rec.deletedBy, "RSOP");
  assert.equal(rec.counts.budgets, 1);

  // every login gets it, including one that signs in only afterwards (persisted)
  for (const [role, pass] of creds) {
    tokens[role] = await login(role, pass);
    const notes = await deletionNotes(role);
    assert.equal(notes.length, 1, role);
    assert.equal(notes[0].message, "Project 22222222 – Gone Client has been deleted by RSOP.");
    assert.equal(notes[0].meta.deletedBy, "RSOP");
    assert.ok(notes[0].meta.deletedAt);
  }
  // a repeated request is harmless and does not notify twice
  assert.equal((await call(`/tracking/${second._id}`, "DELETE", undefined, tokens.RSOP)).status, 200);
  assert.equal((await deletionNotes("RBP")).length, 1);
  assert.equal(await DeletedProject.countDocuments(), 1);
});

test("the Project Code stays reserved for its client and can be used again by them", async () => {
  const t = await T();
  const clash = await call("/tracking", "POST", { projectType: "SIGNAGE", details: signage("22222222", "Someone Else") }, t.RSOP);
  assert.equal(clash.status, 409);
  const again = await newProject("22222222", "Gone Client");
  assert.equal((await call(`/tracking/${again._id}`, "GET", undefined, t.RSOP)).status, 200);
});

test("unsettled money blocks deletion without a record or notification", async () => {
  const t = await T();
  const p = await newProject("44444444", "Money Client");
  const id = () => new mongoose.Types.ObjectId();
  const doc = { project: new mongoose.Types.ObjectId(String(p._id)), trackingVehicle: id(), driver: id(), category: "DAILY", status: "COMPLETED" };
  await mongoose.connection.collection(SettlementPayment.collection.name).insertOne({ ...doc, paymentNumber: "T-1", idempotencyKey: "t-1" });
  const sent = await Notification.countDocuments({ type: "PROJECT_DELETED" });

  const blocked = await call(`/tracking/${p._id}`, "DELETE", undefined, t.RSOP);
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.message, /without a completed Final Settlement/);
  assert.equal((await call(`/tracking/${p._id}`, "GET", undefined, t.RSOP)).status, 200);
  assert.equal(await Notification.countDocuments({ type: "PROJECT_DELETED" }), sent);

  // once the final settlement is completed the project can be archived; the payments are kept but hidden
  await mongoose.connection.collection(SettlementPayment.collection.name).insertOne({ ...doc, category: "FINAL", paymentNumber: "T-2", idempotencyKey: "t-2" });
  assert.equal((await call(`/tracking/${p._id}`, "DELETE", undefined, t.RSOP)).status, 200);
  assert.equal(await SettlementPayment.countDocuments({ project: doc.project }), 0);
  assert.equal(await mongoose.connection.collection(SettlementPayment.collection.name).countDocuments({ project: doc.project }), 2);
});

test("cleanup", async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  server.close();
});
