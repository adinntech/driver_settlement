/* eslint-disable @typescript-eslint/no-explicit-any */
// Integration tests run against a separate test database; never the real one.
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test";
process.env.JWT_SECRET = "test-secret";
process.env.RSOP_USERNAME = "RSOP";
process.env.RSOP_PASSWORD = "pass2";
process.env.RBP_USERNAME = "RBP";
process.env.RBP_PASSWORD = "123123";

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import mongoose from "mongoose";

const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { User } = await import("../src/models/User.js");
const { TrackingVehicle } = await import("../src/models/TrackingVehicle.js");
const { TrackingProject } = await import("../src/models/TrackingProject.js");

let server: Server;
let base = "";

before(async () => {
  await connectDB();
  await mongoose.connection.dropDatabase();
  await Promise.all([User.init(), TrackingVehicle.init(), TrackingProject.init()]);
  await seedUsers();
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});

after(async () => {
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const call = async (path: string, method = "GET", body?: unknown, token?: string) => {
  const res = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as { success: boolean; message: string; data: any } };
};
const login = async (role: string, username: string, password: string) =>
  (await call("/auth/login", "POST", { role, username, password })).body.data?.token as string;

const signage = {
  date: "2026-10-20", client: "DALMIA", jobSheetNumber: "22070649", location: "RAMNAD",
  numberOfVehicles: 2, fromDate: "2026-10-21", toDate: "2026-10-26", arrivedBudget: 25000,
};
const roadshow = {
  billingName: "Sapphire Foods (KFC)", stateCode: "33", numberOfVans: 7,
  startDate: "2026-10-22", endDate: "2026-10-23", reportingDate: "2026-10-22",
  sundayHalt: "NO", reportingLocations: ["Madurai"],
};

test("every response follows sendResponse shape; health untouched", async () => {
  const r = await call("/health");
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ["data", "message", "success"]);
  const bad = await call("/nope");
  assert.equal(bad.status, 404);
  assert.equal(bad.body.data, null);
});

test("roles endpoint is public and lists RSOP and RBP", async () => {
  const r = await call("/auth/roles");
  assert.equal(r.status, 200);
  assert.ok(r.body.data.RSOP.description && r.body.data.RBP.defaultUsername === "RBP");
});

test("login: success, wrong password, wrong role, passwords are hashed", async () => {
  assert.ok(await login("RSOP", "RSOP", "pass2"));
  assert.ok(await login("RBP", "RBP", "123123"));
  assert.equal((await call("/auth/login", "POST", { role: "RSOP", username: "RSOP", password: "x" })).status, 401);
  assert.equal((await call("/auth/login", "POST", { role: "RBP", username: "RSOP", password: "pass2" })).status, 401);
  assert.equal((await call("/auth/login", "POST", { role: "HACK", username: "a", password: "b" })).status, 400);
  const u = await User.findOne({ username: "RSOP" }).select("+passwordHash");
  assert.notEqual(u.passwordHash, "pass2");
});

test("tracking requires auth; RBP cannot create", async () => {
  assert.equal((await call("/tracking")).status, 401);
  const rbp = await login("RBP", "RBP", "123123");
  const r = await call("/tracking", "POST", { projectType: "SIGNAGE", details: signage }, rbp);
  assert.equal(r.status, 403);
  assert.equal(r.body.success, false);
});

test("signage with 2 vehicles creates 2 unique number sets; RBP can read", async () => {
  const rsop = await login("RSOP", "RSOP", "pass2");
  const r = await call("/tracking", "POST", { projectType: "SIGNAGE", details: signage }, rsop);
  assert.equal(r.status, 201);
  const v = r.body.data.vehicles;
  assert.equal(v.length, 2);
  assert.match(v[0].trackupNumber, /^JS-\d{5}\/\d{4}-\d{2}$/);
  assert.match(v[0].pifNumber, /^PIF-\d{5}$/);
  assert.match(v[0].displayNumber, /^\d{4}$/);
  assert.notEqual(v[0].trackupNumber, v[1].trackupNumber);
  assert.equal(r.body.data.createdByName, "RSOP");
  assert.ok(r.body.data.createdAt);

  const rbp = await login("RBP", "RBP", "123123");
  const list = await call("/tracking", "GET", undefined, rbp);
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 1);
});

test("roadshow with 7 vans: all numbers unique across the whole DB, original data kept", async () => {
  const rsop = await login("RSOP", "RSOP", "pass2");
  const r = await call("/tracking", "POST", { projectType: "ROADSHOW", details: roadshow }, rsop);
  assert.equal(r.status, 201);
  assert.equal(r.body.data.vehicles.length, 7);
  assert.equal(r.body.data.details.numberOfDays, 2);
  const all = await TrackingVehicle.find().lean();
  for (const k of ["trackupNumber", "pifNumber", "displayNumber"])
    assert.equal(new Set(all.map((x: any) => x[k])).size, all.length);
});

test("idempotent requestId does not regenerate numbers", async () => {
  const rsop = await login("RSOP", "RSOP", "pass2");
  const body = { projectType: "SIGNAGE", details: signage, requestId: "abc-123" };
  const a = await call("/tracking", "POST", body, rsop);
  const b = await call("/tracking", "POST", body, rsop);
  assert.equal(a.body.data._id, b.body.data._id);
  assert.deepEqual(
    a.body.data.vehicles.map((x: any) => x.trackupNumber),
    b.body.data.vehicles.map((x: any) => x.trackupNumber),
  );
});

test("concurrent creates never produce duplicates", async () => {
  const rsop = await login("RSOP", "RSOP", "pass2");
  const before = await TrackingVehicle.countDocuments();
  const rs = await Promise.all(
    Array.from({ length: 8 }, () => call("/tracking", "POST", { projectType: "SIGNAGE", details: signage }, rsop)),
  );
  assert.ok(rs.every((r) => r.status === 201));
  const all = await TrackingVehicle.find().lean();
  assert.equal(all.length, before + 16);
  for (const k of ["trackupNumber", "pifNumber", "displayNumber"])
    assert.equal(new Set(all.map((x: any) => x[k])).size, all.length);
});

test("invalid payload returns 400 with sendResponse shape and creates nothing", async () => {
  const rsop = await login("RSOP", "RSOP", "pass2");
  const count = await TrackingProject.countDocuments();
  const r = await call("/tracking", "POST", { projectType: "ROADSHOW", details: {} }, rsop);
  assert.equal(r.status, 400);
  assert.equal(r.body.success, false);
  assert.equal(r.body.data, null);
  assert.equal(await TrackingProject.countDocuments(), count);
});

test("search by number, client and type; stats; viewing never changes numbers", async () => {
  const rsop = await login("RSOP", "RSOP", "pass2");
  const all = (await call("/tracking", "GET", undefined, rsop)).body.data;
  const target = all[0].vehicles[0];
  const byNum = await call(`/tracking?q=${encodeURIComponent(target.pifNumber)}`, "GET", undefined, rsop);
  assert.equal(byNum.body.data.length, 1);
  assert.equal((await call("/tracking?q=dalmia", "GET", undefined, rsop)).body.data.every((p: any) => p.clientName === "DALMIA"), true);
  assert.ok((await call("/tracking?projectType=ROADSHOW", "GET", undefined, rsop)).body.data.length >= 1);
  const one = await call(`/tracking/${all[0]._id}`, "GET", undefined, rsop);
  assert.equal(one.body.data.vehicles[0].trackupNumber, target.trackupNumber);
  assert.equal((await call("/tracking/not-an-id", "GET", undefined, rsop)).status, 400);
  const st = await call("/tracking/stats", "GET", undefined, rsop);
  assert.ok(st.body.data.total >= 2 && st.body.data.pendingBudget > 0);
});
