/* eslint-disable @typescript-eslint/no-explicit-any */
// Previous Data: drafts, submission, corrections, duplicates, the Final Settlement restriction, permissions and totals.
process.env.ROADSHOW = "on";
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_previous_data";
process.env.JWT_SECRET = "test-secret";
for (const [r, p] of [["RBP", "p2"], ["RSOM", "p3"], ["RSA", "p4"], ["RSO", "p5"], ["RSOP", "p1"]]) {
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
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-previous-test-"));
cfg.storage.localDir = storageDir;
const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { seedDevData } = await import("../src/seed/devSeed.js");
const { SettlementPayment } = await import("../src/models/SettlementPayment.js");
const { HistoricalSuspense } = await import("../src/models/HistoricalSuspense.js");

let server: Server;
let base = "";
const tok: Record<string, string> = {};
let tv = "";
let spare: string[] = []; // further project vehicles with no settlement payment: each can take one submission

const api = async (role: string, method: string, url: string, body?: unknown) => {
  const res = await fetch(`${base}${url}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok[role]}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
};
const login = async (role: string, password: string) => {
  const r = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, username: role, password }) });
  tok[role] = ((await r.json()) as any).data.token;
};
const context = async (role = "RBP") => (await api(role, "GET", `/settlements/projects/${tv}`)).body.data;
const url = (rest = "") => `/settlements/projects/${tv}/previous-data${rest}`;

before(async () => {
  await connectDB();
  assert.match(mongoose.connection.name, /_test_/);
  await mongoose.connection.dropDatabase();
  await HistoricalSuspense.init();
  await seedUsers();
  await seedDevData();
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  for (const [role, password] of [["RBP", "p2"], ["RSOM", "p3"], ["RSA", "p4"], ["RSO", "p5"], ["RSOP", "p1"]]) await login(role, password);
  const used = new Set((await SettlementPayment.distinct("trackingVehicle")).map(String));
  const free = (await api("RBP", "GET", "/settlements/projects?limit=100&kind=final")).body.data.items.map((x: any) => x.trackingVehicle).filter((x: string) => !used.has(x));
  // The seed chooses which vehicles get settlement payments by their random Trackup / PIF numbers, so which ones are left over
  // differs on every run. Only the first combination must start without any suspense record; the others just need no payment.
  for (const candidate of free) {
    tv = candidate;
    if (!(await context()).suspense.rows.length) break;
  }
  spare = free.filter((x: string) => x !== tv);
});
after(async () => {
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  fs.rmSync(storageDir, { recursive: true, force: true });
});

let n = 0;
const entry = (over: Record<string, unknown> = {}) => ({
  fromDate: "2026-01-01", toDate: "2026-01-03", paymentDate: "2026-01-04", paymentMode: "CASH", referenceNumber: `OLD-${++n}`,
  salaryAdvance: "1000", dieselEntries: [{ amount: "200" }], foodAmount: "50", expenses: [], sourceDetails: "Cash book page 4",
  idempotencyKey: `previous-key-${n}-${Math.random().toString(36).slice(2, 8)}`, ...over,
});
const list = async (role = "RSA") => (await api(role, "GET", url())).body.data as any[];
const submitted = () => HistoricalSuspense.countDocuments({ trackingVehicle: tv, status: "SUBMITTED", revision: 1 });
const paymentsHere = async () => (await SettlementPayment.find({ trackingVehicle: tv }).lean()) as any[];

test("only RSA writes; values are required, never defaulted", async () => {
  for (const role of ["RBP", "RSOM", "RSO", "RSOP"]) assert.equal((await api(role, "POST", url(), entry())).status, 403, role);
  const bad = await api("RSA", "POST", url(), entry({ paymentDate: "", referenceNumber: "" }));
  assert.equal(bad.status, 400);
  for (const m of ["Payment Date is required", "Reference No. / UTR is required"]) assert.ok(bad.body.message.includes(m), m);
  assert.equal(await HistoricalSuspense.countDocuments(), 0);
});

test("drafts do not count and do not lock; a failed submission does not lock either", async () => {
  const first = (await api("RSA", "POST", url(), entry())).body.data.record.entryId;
  const second = await api("RSA", "POST", url(), entry({ fromDate: "2025-11-01", toDate: "2025-11-02", paymentDate: "2025-11-03" }));
  assert.equal(second.status, 201, "several drafts are allowed");
  assert.equal((await context()).suspense.total, 0);
  assert.equal((await list("RBP")).length, 0, "drafts are RSA's own");
  assert.equal((await api("RSA", "PUT", url(`/${first}`), entry({ foodAmount: "100" }))).status, 200);
  assert.equal((await api("RSA", "DELETE", url(`/${second.body.data.record.entryId}`))).status, 200);

  // rejected by validation, and by a failure while the completed payment is being written
  assert.equal((await api("RSA", "POST", url(), entry({ referenceNumber: "", submit: true }))).status, 400);
  const create = SettlementPayment.create.bind(SettlementPayment);
  (SettlementPayment as any).create = async () => { throw new Error("simulated write failure"); };
  try {
    assert.equal((await api("RSA", "POST", url(), entry({ submit: true }))).status, 500);
    assert.equal((await api("RSA", "POST", url(`/${first}/submit`), {})).status, 500);
  } finally {
    (SettlementPayment as any).create = create;
  }
  assert.equal(await submitted(), 0);
  assert.deepEqual((await list()).map((e) => e.current.status), ["DRAFT"]);
  assert.equal((await context()).suspense.total, 0);
});

test("simultaneous submissions: exactly one succeeds, with one completed payment", async () => {
  const draft = (await list())[0].entryId;
  const results = await Promise.all([
    api("RSA", "POST", url(`/${draft}/submit`), {}),
    api("RSA", "POST", url(), entry({ fromDate: "2025-10-01", toDate: "2025-10-02", salaryAdvance: "5", submit: true })),
    api("RSA", "POST", url(), entry({ fromDate: "2025-09-01", toDate: "2025-09-02", salaryAdvance: "6", submit: true })),
  ]);
  assert.equal(results.filter((r) => r.status < 300).length, 1, JSON.stringify(results.map((r) => r.body.message)));
  assert.equal(results.filter((r) => r.status === 409).length, 2);
  assert.equal(await submitted(), 1);
  assert.equal((await paymentsHere()).length, 1);
});

test("after one submission nothing new is accepted, whatever the dates, amounts or reference; it stays viewable", async () => {
  const [mine] = (await list()).filter((e) => e.current.status === "SUBMITTED");
  const [payment] = await paymentsHere();
  const total = (await context()).suspense.total;
  assert.equal(total, payment.amount);
  for (const over of [{ submit: true }, { submit: false }, { submit: true, fromDate: "2024-01-01", toDate: "2024-01-02", paymentDate: "2024-01-03", salaryAdvance: "98765", referenceNumber: "BRAND-NEW" }]) {
    const r = await api("RSA", "POST", url(), entry(over));
    assert.equal(r.status, 409, r.body.message);
    for (const part of ["already submitted", mine.current.referenceNumber, payment.paymentNumber, "correction"]) assert.ok(r.body.message.includes(part), `${part}: ${r.body.message}`);
  }
  for (const left of (await list()).filter((e) => e.current.status === "DRAFT")) assert.equal((await api("RSA", "POST", url(`/${left.entryId}/submit`), {})).status, 409);
  assert.equal((await api("RSA", "POST", url(`/${mine.entryId}/submit`), {})).status, 200, "repeating the successful submit changes nothing");
  assert.equal((await context()).suspense.total, total);
  assert.equal((await list("RBP")).length, 1);
  // the database itself refuses a second initial submission
  const row: any = await HistoricalSuspense.findOne({ entryId: mine.entryId }).lean();
  await assert.rejects(HistoricalSuspense.create({ ...row, _id: undefined, entryId: new mongoose.Types.ObjectId(), idempotencyKey: "direct-insert-1" }), /E11000/);
});

test("a correction is an audited revision of that entry and updates the same completed payment", async () => {
  const [mine] = (await list()).filter((e) => e.current.status === "SUBMITTED");
  const old = mine.current;
  const body = entry({ fromDate: old.fromDate, toDate: old.toDate, paymentDate: old.paymentDate, referenceNumber: old.referenceNumber, foodAmount: "400", expenses: [{ optionKey: "TOLL", amount: "4", deduct: true }], revision: 1 });
  assert.equal((await api("RSA", "POST", url(`/${mine.entryId}/corrections`), body)).status, 400); // no reason
  const ok = await api("RSA", "POST", url(`/${mine.entryId}/corrections`), { ...body, reason: "Food was misread" });
  assert.equal(ok.status, 201, ok.body.message);
  const amount = 1000 + 200 + 400 + 4; // every expense is added
  assert.equal(ok.body.data.suspense.total, amount);
  assert.equal((await api("RSA", "POST", url(`/${mine.entryId}/corrections`), { ...body, reason: "again", idempotencyKey: "another-key-1" })).status, 409); // stale revision
  const after1 = (await list("RBP"))[0];
  assert.deepEqual(after1.revisions.map((r: any) => [r.revision, r.correctionReason]), [[2, "Food was misread"], [1, null]]);
  const [p, ...extra] = await paymentsHere();
  assert.equal(extra.length, 0);
  assert.deepEqual([p.status, p.category, p.amount, p.version, p.reviewedBy ?? null, p.bank?.accountMasked ?? null], ["COMPLETED", "DAILY", amount, 2, null, null]);
});

test("completed payment is listed and reported; every reader shows it once", async () => {
  await login("RSA", "p4");
  const [p] = await paymentsHere();
  const c = await context("RSA");
  assert.equal(c.suspense.total, p.amount);
  assert.equal(c.prefill.suspenseAmount, p.amount);
  assert.ok(c.suspense.rows.every((r: any) => r.source === `Previous Data · ${p.paymentNumber}`));
  assert.ok(c.suspense.rows.some((r: any) => r.description === "Fuel" && r.amount === 200));
  const done = (await api("RSA", "GET", "/settlements?status=COMPLETED&scope=all&limit=100")).body.data.items;
  assert.ok(done.some((x: any) => x.paymentNumber === p.paymentNumber && x.previousData));
  assert.ok((await api("RSO", "GET", "/settlements/reports/approved-payments")).body.data.some((x: any) => x.paymentNumber === p.paymentNumber));
  for (const path of [`/settlements/projects/${tv}/payments-pdf`, "/settlements/export/filtered?status=COMPLETED"])
    assert.equal((await fetch(base + path, { headers: { Authorization: `Bearer ${tok.RSA}` } })).status, 200, path);
});

test("duplicates of a live daily payment are refused; another combination can still submit once, without Source Details", async () => {
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  tv = spare.shift()!;
  // previous data cannot be dated in the future: this fixture campaign is moved to have started, whatever the seed gave it
  if ((await context()).campaign.fromDate > today) {
    const vehicle: any = await mongoose.connection.collection("trackingvehicles").findOne({ _id: new mongoose.Types.ObjectId(tv) });
    const started = new Date(Date.parse(`${today}T00:00:00Z`) - 2 * 86_400_000).toISOString().slice(0, 10);
    await mongoose.connection.collection("trackingprojects").updateOne({ _id: vehicle.project }, { $set: { "details.fromDate": started, "details.startDate": started } });
  }
  const from: string = (await context()).campaign.fromDate;
  assert.ok(from && from <= today, "a second empty project vehicle with a started campaign is needed");
  const daily = await api("RBP", "POST", `/settlements/projects/${tv}/daily`, { fromDate: from, toDate: from, foodAmount: "777", idempotencyKey: "previous-daily-1" });
  assert.equal(daily.status, 201, JSON.stringify(daily.body));
  const clash = await api("RSA", "POST", url(), entry({ fromDate: from, toDate: from, paymentDate: from, salaryAdvance: "", dieselEntries: [], foodAmount: "777", submit: true }));
  assert.equal(clash.status, 409, clash.body.message);
  assert.ok(clash.body.message.includes(daily.body.data.paymentNumber) && clash.body.message.includes("₹777"));
  const ok = await api("RSA", "POST", url(), entry({ fromDate: from, toDate: from, paymentDate: from, foodAmount: "5", sourceDetails: "", submit: true })); // same day, other amount
  assert.equal(ok.status, 201, ok.body.message);
});

test("a non-rejected Final Settlement blocks adding and correcting; a rejected one does not", async () => {
  tv = spare[0];
  assert.ok(tv, "a third empty project vehicle is needed");
  const a: any = await mongoose.connection.collection("vehicleallotments").findOne({ trackingVehicle: new mongoose.Types.ObjectId(tv), status: { $in: ["ACTIVE", "RELEASED"] } });
  const raw = mongoose.connection.collection(SettlementPayment.collection.name);
  await raw.insertOne({ trackingVehicle: a.trackingVehicle, driver: a.driver, project: a.project, category: "FINAL", paymentNumber: "DSE-T", idempotencyKey: "final-t", status: "PENDING" });
  const refused = await api("RSA", "POST", url(), entry({ submit: true }));
  assert.equal(refused.status, 409);
  assert.match(refused.body.message, /DSE-T \(pending\)/);
  await raw.updateOne({ paymentNumber: "DSE-T" }, { $set: { status: "REJECTED" } });
  assert.equal((await api("RSA", "POST", url(), entry({ submit: true }))).status, 201);
});
