/* eslint-disable @typescript-eslint/no-explicit-any */
// Regression: a driver + project vehicle with a Final Settlement (any status) must not be selectable or creatable again.
process.env.ROADSHOW = "on";
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_final_settled";
process.env.JWT_SECRET = "test-secret";
for (const [r, p] of [["RBP", "p2"], ["RSA", "p4"], ["RSO", "p5"]]) {
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
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-final-settled-test-"));
cfg.storage.localDir = storageDir;
const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { seedDevData } = await import("../src/seed/devSeed.js");
const { SettlementPayment } = await import("../src/models/SettlementPayment.js");

let server: Server;
let base = "";
const tok: Record<string, string> = {};
let tv = "";
let id = "";

async function api(role: string, method: string, url: string, body?: unknown) {
  const res = await fetch(`${base}${url}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok[role]}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
}
const listed = async (kind: string) => {
  const d = (await api("RBP", "GET", `/settlements/projects?limit=100${kind}`)).body.data;
  assert.equal(d.total, d.items.length);
  return d.items.map((x: any) => x.trackingVehicle) as string[];
};
const context = async () => (await api("RBP", "GET", `/settlements/projects/${tv}`)).body.data;
const final = async (key: string) => {
  const c = await context();
  return { fixedMileage: "8", onRoadDays: "5", perDaySalary: "9000", driverChangeAmount: c.prefill.driverChangeAmount, deductions: { previousSalary: String(c.prefill.driverChangeAmount) }, idempotencyKey: key };
};
const create = async (key: string) => api("RBP", "POST", `/settlements/projects/${tv}/final`, await final(key));

before(async () => {
  await connectDB();
  assert.match(mongoose.connection.name, /_test_/);
  await mongoose.connection.dropDatabase();
  await seedUsers();
  await seedDevData();
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  for (const [role, password] of [["RBP", "p2"], ["RSA", "p4"], ["RSO", "p5"]]) {
    const r = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, username: role, password }) });
    tok[role] = ((await r.json()) as any).data.token;
  }
  const used = new Set((await SettlementPayment.distinct("trackingVehicle")).map(String));
  for (const x of (await listed("&kind=final")).filter((v) => !used.has(v))) {
    tv = x;
    if (!(await context()).prefill.suspenseAmount) break;
  }
  assert.ok(tv);
});
after(async () => {
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  fs.rmSync(storageDir, { recursive: true, force: true });
});

test("a settled driver + vehicle leaves the final list in every status; others and daily stay", async () => {
  const others = (await listed("&kind=final")).filter((x) => x !== tv);
  const daily = await listed("");
  const saved = await create("settled-key-1");
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  id = saved.body.data._id;
  for (const status of ["PENDING", "APPROVED", "REJECTED", "COMPLETED"]) {
    await SettlementPayment.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { status } });
    for (let refresh = 0; refresh < 2; refresh++) assert.deepEqual(await listed("&kind=final"), others, status);
    assert.deepEqual(await listed(""), daily, "the daily picker is unchanged");
    const again = await create(`settled-again-${status}`);
    assert.equal(again.status, 409, status);
    assert.match(again.body.message, /already exists/);
    assert.equal((await context()).existingFinal.status, status);
    assert.ok((await api("RSA", "GET", "/settlements?scope=all&category=FINAL&limit=100")).body.data.items.some((x: any) => x._id === id), "still in its own views");
  }
});

test("a new allotment of the same driver and project vehicle is still blocked", async () => {
  // the earlier record was raised on another allotment (released and allotted again)
  await SettlementPayment.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { status: "APPROVED", allotment: new mongoose.Types.ObjectId() }, $unset: { finalLock: "" } });
  assert.ok(!(await listed("&kind=final")).includes(tv));
  assert.equal((await create("settled-reallot")).status, 409);
});

test("another driver on that project vehicle is eligible", async () => {
  await SettlementPayment.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { driver: new mongoose.Types.ObjectId() } });
  assert.ok((await listed("&kind=final")).includes(tv));
  assert.equal((await context()).existingFinal, null);
});
