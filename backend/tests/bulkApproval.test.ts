/* eslint-disable @typescript-eslint/no-explicit-any */
// Bulk Approve drives the existing approval endpoint once per payment: what the server accepts and refuses for that traffic.
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_bulk_approval";
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
import { approveBulk } from "../../frontend/src/utils/bulkApproval.js";

const { config: cfg } = await import("../src/config/index.js");
cfg.mongoUri = process.env.MONGO_URI!;
cfg.env = "test";
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-bulk-approval-test-"));
cfg.storage.localDir = storageDir;
const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { seedDevData } = await import("../src/seed/devSeed.js");
const { SettlementPayment, SettlementPaymentEvent } = await import("../src/models/SettlementPayment.js");

let server: Server;
let base = "";
const tok: Record<string, string> = {};
const rows: { _id: string; paymentNumber: string; version: number }[] = [];

async function api(role: string, method: string, url: string, body?: unknown) {
  const res = await fetch(`${base}${url}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok[role]}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
}
const as = (role: string) => async (url: string, body: unknown) => {
  const r = await api(role, "POST", url, body);
  if (r.status !== 200) throw new Error(`${r.status} ${r.body.message}`);
};
const statuses = async () => (await Promise.all(rows.map((r) => SettlementPayment.findById(r._id).lean()))).map((p: any) => p.status);

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
  const projects = (await api("RBP", "GET", "/settlements/projects?limit=50")).body.data.items;
  for (const { trackingVehicle: tv } of projects.filter((x: any) => !used.has(x.trackingVehicle)).slice(0, 3)) {
    const c = (await api("RBP", "GET", `/settlements/projects/${tv}`)).body.data;
    const r = await api("RBP", "POST", `/settlements/projects/${tv}/daily`, { fromDate: c.campaign.fromDate, toDate: c.campaign.fromDate, foodAmount: "100", idempotencyKey: `bulk-test-${tv}` });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    rows.push(r.body.data);
  }
  assert.equal(rows.length, 3);
});
after(async () => {
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  fs.rmSync(storageDir, { recursive: true, force: true });
});

test("other roles cannot approve", async () => {
  for (const role of ["RBP", "RSA", "RSO"]) {
    const out = await approveBulk(rows, as(role));
    assert.ok(out.every((r) => !r.ok && r.message.startsWith("403")), role);
  }
  assert.deepEqual(await statuses(), ["PENDING", "PENDING", "PENDING"]);
});

test("partial failure: a rejected or stale payment is refused and the others are approved", async () => {
  assert.equal((await api("RSOM", "POST", `/settlements/${rows[1]._id}/reject`, { reason: "Bill missing" })).status, 200);
  const out = await approveBulk([rows[0], rows[1], { ...rows[2], version: 9 }], as("RSOM"));
  assert.deepEqual(out.map((r) => r.ok), [true, false, false]);
  assert.match(out[1].message, /409 .*already rejected/);
  assert.match(out[2].message, /409 .*newer version/);
  assert.deepEqual(await statuses(), ["APPROVED", "REJECTED", "PENDING"]);
});

test("duplicate and simultaneous bulk requests approve once", async () => {
  const [a, b] = await Promise.all([approveBulk([rows[2]], as("RSOM")), approveBulk([rows[2]], as("RSOM"))]);
  assert.deepEqual([a[0].ok, b[0].ok].sort(), [false, true]);
  assert.equal((await approveBulk([rows[0]], as("RSOM")))[0].ok, false);
  for (const r of [rows[0], rows[2]]) assert.equal(await SettlementPaymentEvent.countDocuments({ payment: r._id, action: "APPROVED" }), 1);
  const summary = (await api("RSOM", "GET", "/settlements?category=DAILY")).body.data.summary;
  assert.ok(summary["DAILY:APPROVED"].count >= 2);
});
