/* eslint-disable @typescript-eslint/no-explicit-any */
// RSA Bulk Entry: per-payment references, approval-date listing, permissions, duplicates and partial failure.
process.env.ROADSHOW = "on";
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_bulk_entry";
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
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-bulk-entry-test-"));
cfg.storage.localDir = storageDir;
const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { seedDevData } = await import("../src/seed/devSeed.js");
const { SettlementPayment, SettlementPaymentEvent } = await import("../src/models/SettlementPayment.js");

let server: Server;
let base = "";
const tok: Record<string, string> = {};
const ids: string[] = [];
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

async function api(role: string, method: string, url: string, body?: unknown) {
  const res = await fetch(`${base}${url}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok[role]}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
}
const item = (id: string, referenceNumber?: string, more: object = {}) => ({ id, referenceNumber, paymentMode: "EPAYMENT", paymentDate: today, bankName: "SBI", ...more });
const entry = (...items: unknown[]) => ({ items });
const bulk = async (body: unknown) => {
  const r = await api("RSA", "POST", "/settlements/complete-bulk", body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data.results as { id: string; ok: boolean; message: string }[];
};
const state = async (id: string) => (await SettlementPayment.findById(id).lean()) as any;

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
  for (const { trackingVehicle: tv } of projects.filter((x: any) => !used.has(x.trackingVehicle))) {
    if (ids.length === 5) break;
    const c = (await api("RBP", "GET", `/settlements/projects/${tv}`)).body.data;
    const r = await api("RBP", "POST", `/settlements/projects/${tv}/daily`, { fromDate: c.campaign.fromDate, toDate: c.campaign.fromDate, foodAmount: "100", idempotencyKey: `bulk-entry-${tv}` });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ids.push(r.body.data._id);
  }
  assert.equal(ids.length, 5);
  for (const id of ids.slice(0, 4)) assert.equal((await api("RSOM", "POST", `/settlements/${id}/approve`, { version: 1 })).status, 200); // the fifth stays pending
});
after(async () => {
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  fs.rmSync(storageDir, { recursive: true, force: true });
});

test("approved payments are listed by their approval date", async () => {
  const list = async (day: string) => (await api("RSA", "GET", `/settlements?scope=all&status=APPROVED&approvedOn=${day}&limit=100`)).body.data.items.map((x: any) => x._id);
  const found = await list(today);
  assert.ok(ids.slice(0, 4).every((id) => found.includes(id)) && !found.includes(ids[4]));
  assert.deepEqual(await list("2020-01-01"), []);
});

test("only RSA, with a valid request", async () => {
  for (const role of ["RBP", "RSOM", "RSO"]) assert.equal((await api(role, "POST", "/settlements/complete-bulk", entry(item(ids[0], "X1")))).status, 403, role);
  for (const body of [entry(), entry({ id: "nope" }), entry(item(ids[0], "X1"), item(ids[0], "X2"))])
    assert.equal((await api("RSA", "POST", "/settlements/complete-bulk", body)).status, 400);
  assert.match((await bulk(entry(item(ids[0]))))[0].message, /reference number is required/);
  // a shared top-level reference is not applied to the payments
  assert.match((await bulk({ ...entry({ id: ids[0] }), referenceNumber: "SHARED", paymentMode: "CASH", paymentDate: today }))[0].message, /reference number is required/);
  assert.equal((await state(ids[0])).status, "APPROVED");
});

test("each payment saves its own details; a failure does not stop the rest and nothing is entered twice", async () => {
  const body = entry(item(ids[0], "REF-A", { paymentMode: "CHEQUE", bankName: "Axis", referenceDate: today }), item(ids[4], "REF-P"), item(ids[1], "REF-B", { paymentMode: "CASH", bankName: "" }));
  const out = await bulk(body);
  assert.deepEqual(out.map((r) => r.ok), [true, false, true]);
  assert.match(out[1].message, /Only an approved payment/);
  const saved = async (id: string) => { const c = (await state(id)).completion; return [c.referenceNumber, c.paymentMode, c.bankName ?? null, c.referenceDate ?? null]; };
  assert.deepEqual(await saved(ids[0]), ["REF-A", "CHEQUE", "Axis", today]);
  assert.deepEqual(await saved(ids[1]), ["REF-B", "CASH", null, null]);
  assert.equal((await state(ids[4])).status, "PENDING");
  assert.ok((await bulk(body)).every((r) => !r.ok));
  assert.equal(await SettlementPaymentEvent.countDocuments({ payment: ids[0], action: "COMPLETED" }), 1);
});

test("a repeated reference is refused, within one submission and afterwards", async () => {
  const out = await bulk(entry(item(ids[2], "IND-1"), item(ids[3], "ind-1")));
  assert.deepEqual(out.map((r) => r.ok), [true, false]);
  assert.match(out[1].message, /already recorded/);
  assert.match((await bulk(entry(item(ids[3], "REF-A"))))[0].message, /already recorded/);
  assert.equal((await bulk(entry(item(ids[3], "IND-2"))))[0].ok, true);
});
