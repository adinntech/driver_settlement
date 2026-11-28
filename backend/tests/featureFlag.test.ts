/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.ROADSHOW = "on";
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_feature_flag";
process.env.JWT_SECRET = "test-secret";
process.env.RSOP_USERNAME = "RSOP";
process.env.RSOP_PASSWORD = "pass2";
process.env.RBP_USERNAME = "RBP";
process.env.RBP_PASSWORD = "123123";
process.env.ROADSHOW = "on";

import test from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import mongoose from "mongoose";

const { addDaysYmd, todayIst } = await import("../src/utils/dates.js");
const { roadshowOn, roadshowAllocation } = await import("../src/utils/features.js");
const day = (n: number) => addDaysYmd(todayIst(), n);
const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { createTracking } = await import("../src/services/tracking.service.js");
const { User } = await import("../src/models/User.js");
const { TrackingProject } = await import("../src/models/TrackingProject.js");
const { TrackingVehicle } = await import("../src/models/TrackingVehicle.js");

let server: Server;
let base = "";
{
  await connectDB();
  assert.match(mongoose.connection.name, /_test/, "refusing to drop a non-test database");
  await mongoose.connection.dropDatabase();
  await Promise.all([User, TrackingProject, TrackingVehicle].map((m: any) => m.init()));
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

const signage = (projectCode: string) => ({
  projectCode, date: day(-3), client: "Flag Signage", jobSheetNumber: "22403", location: "RAMNAD",
  numberOfVehicles: 1, vehicleTypes: [{ code: "CENTRE_NO_ROOF", quantity: 1 }], fromDate: day(-2), toDate: day(3),
});
/** A Roadshow request saved while the flag was on (written directly: only visibility is under test here). */
async function oldRoadshow() {
  const _id = new mongoose.Types.ObjectId();
  const now = new Date();
  await mongoose.connection.collection("trackingprojects").insertOne({ _id, projectType: "ROADSHOW", clientName: "Old Roadshow", projectCode: "55555555", vehicleCount: 1, details: {}, createdByName: "RSOP", createdAt: now, updatedAt: now });
  await mongoose.connection.collection("trackingvehicles").insertOne({ project: _id, vehicleIndex: 1, trackupNumber: "RS-OLD-1", pifNumber: "PIF-OLD-1", budgetStatus: "PENDING", createdAt: now });
  return _id;
}
const raw = (name: string) => mongoose.connection.collection(name).find().sort({ _id: 1 }).toArray();

test("only the value on enables Roadshow", () => {
  for (const v of [undefined, "", "off", "yes", "1", "true"]) {
    if (v === undefined) delete process.env.ROADSHOW;
    else process.env.ROADSHOW = v;
    assert.equal(roadshowOn(), false, String(v));
  }
  process.env.ROADSHOW = " ON ";
  assert.equal(roadshowOn(), true);
});

test("off hides and refuses Roadshow, keeps Signage and the stored records; on restores it", async () => {
  process.env.ROADSHOW = "on";
  const rsop = await login("RSOP", "pass2");
  const rbp = await login("RBP", "123123");
  const id = await oldRoadshow();
  const seen = async () => (await call("/tracking", "GET", undefined, rsop)).body.data.map((p: any) => p.clientName).sort();
  assert.deepEqual(await seen(), ["Old Roadshow"]);
  const before = [await raw("trackingprojects"), await raw("trackingvehicles")];

  process.env.ROADSHOW = "off";
  const refused = await call("/tracking", "POST", { projectType: "ROADSHOW", details: {} }, rsop);
  assert.equal(refused.status, 403);
  assert.match(refused.body.message, /Roadshow is currently disabled/);
  await assert.rejects(createTracking({ id: "a".repeat(24), username: "x" }, { projectType: "ROADSHOW", details: {} }), /disabled/);
  assert.equal((await call("/tracking", "POST", { projectType: "SIGNAGE", details: signage("66666666") }, rsop)).status, 201);
  assert.deepEqual(await seen(), ["Flag Signage"]);
  const stats = (await call("/tracking/stats", "GET", undefined, rsop)).body.data;
  assert.deepEqual([stats.total, stats.roadshow, stats.signage, stats.pendingBudget], [1, 0, 1, 1]);
  assert.equal((await call(`/tracking/${id}`, "GET", undefined, rsop)).status, 404);
  assert.equal((await call("/tracking?projectType=ROADSHOW", "GET", undefined, rsop)).body.data.length, 0);
  const vehicle = (await mongoose.connection.collection("trackingvehicles").findOne({ project: id }))!._id;
  assert.equal((await call(`/budgets/vehicle/${vehicle}`, "GET", undefined, rbp)).status, 404);
  assert.ok(!JSON.stringify((await call("/auth/roles")).body.data).includes("Roadshow /"));
  assert.deepEqual((await raw("trackingprojects")).filter((p) => p.projectType === "ROADSHOW"), before[0]);
  assert.deepEqual((await raw("trackingvehicles")).filter((v) => String(v.project) === String(id)), before[1]);

  process.env.ROADSHOW = "on";
  assert.deepEqual(await seen(), ["Flag Signage", "Old Roadshow"]);
  assert.equal((await call(`/tracking/${id}`, "GET", undefined, rsop)).status, 200);
});

test("vehicle / driver allocation: new Roadshow refused when off, an existing one is left as saved", () => {
  const saved = { status: "IN_USE", project: { projectType: "ROADSHOW", pifNumber: "PIF-1", trackupNumber: "T-1", clientName: "A", location: "Salem", remarks: null } };
  process.env.ROADSHOW = "off";
  assert.match(roadshowAllocation({ status: "IN_USE", project: { projectType: "ROADSHOW" } })!.error!, /disabled/);
  const kept = roadshowAllocation({ status: "IN_USE", project: { pifNumber: "PIF-1", trackupNumber: "T-1", remarks: "note" } }, saved)!;
  assert.equal(kept.error, undefined);
  assert.deepEqual([kept.input.project.projectType, kept.input.project.clientName, kept.input.project.remarks], ["ROADSHOW", "A", "note"]);
  assert.equal(roadshowAllocation({ status: "IN_USE", project: { projectType: "SIGNAGE" } }), null);
  assert.equal(roadshowAllocation({ status: "AVAILABLE" }, saved), null);
  process.env.ROADSHOW = "on";
  assert.equal(roadshowAllocation({ status: "IN_USE", project: { projectType: "ROADSHOW" } }), null);
});

test("cleanup", async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  server.close();
});
