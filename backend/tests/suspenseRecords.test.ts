/* eslint-disable @typescript-eslint/no-explicit-any */
// Suspense = Daily Payments with a recorded Reference No. / UTR (whole Total Payable), in the popup, its total and the PDF.
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_suspense";
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
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-suspense-test-"));
cfg.storage.localDir = storageDir;
const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { seedDevData } = await import("../src/seed/devSeed.js");
const { SettlementPayment } = await import("../src/models/SettlementPayment.js");
const { suspenseFor } = await import("../src/services/paymentDetailsPdf.service.js");

let server: Server;
let base = "";
const tok: Record<string, string> = {};
let tv = "";

const call = (role: string, method: string, url: string, body?: unknown) =>
  fetch(`${base}${url}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok[role]}` }, body: body === undefined ? undefined : JSON.stringify(body) });
const api = async (role: string, method: string, url: string, body?: unknown) => {
  const res = await call(role, method, url, body);
  return { status: res.status, body: (await res.json()) as any };
};
const context = async () => (await api("RBP", "GET", `/settlements/projects/${tv}`)).body.data;

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
  const free = (await api("RBP", "GET", "/settlements/projects?limit=100&kind=final")).body.data.items.map((x: any) => x.trackingVehicle).filter((x: string) => !used.has(x));
  for (const candidate of free) { // a driver with no seeded advances or payments
    tv = candidate;
    if (!(await context()).suspense.rows.length) break;
  }
});
after(async () => {
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  fs.rmSync(storageDir, { recursive: true, force: true });
});

test("only daily payments with a Reference No. / UTR count, once, for their Total Payable", async () => {
  const c = await context();
  assert.deepEqual([c.suspense.rows.length, c.suspense.total, c.prefill.suspenseAmount], [0, 0, 0]);
  const day = (n: number) => new Date(Date.parse(c.campaign.fromDate) + n * 86_400_000).toISOString().slice(0, 10);
  const pay = async (n: number, body: object) => {
    const r = await api("RBP", "POST", `/settlements/projects/${tv}/daily`, { fromDate: day(n), toDate: day(n), idempotencyKey: `suspense-key-${n}`, ...body });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.data._id as string;
  };
  const expense = (optionKey: string, amount: string, deduct = false) => ({ optionKey, amount, deduct, ...(optionKey === "OTHERS" ? { description: "Parking" } : {}) });
  const approve = async (id: string) => assert.equal((await api("RSOM", "POST", `/settlements/${id}/approve`, { version: 1 })).status, 200);
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const enter = async (id: string, referenceNumber: string) =>
    assert.equal((await api("RSA", "POST", `/settlements/${id}/complete`, { referenceNumber, paymentDate: today, paymentMode: "CASH" })).status, 200);

  // many lines in one payment, with a deduction
  const withLines = await pay(0, { salaryAdvance: "1000", foodAmount: "300", dieselEntries: [{ amount: "200" }], expenses: [expense("SERVICE", "10"), expense("TOLL", "11"), expense("PERMIT", "12"), expense("OTHERS", "5", true)] });
  const second = await pay(1, { foodAmount: "400" });
  const noReference = await pay(2, { salaryAdvance: "7000", dieselEntries: [{ amount: "100", reference: "bunk name is not a UTR" }] }); // approved, no UTR
  await pay(3, { foodAmount: "999" }); // pending
  const rejected = await pay(4, { foodAmount: "888" });
  for (const id of [withLines, second, noReference]) await approve(id);
  assert.equal((await api("RSOM", "POST", `/settlements/${rejected}/reject`, { reason: "Wrong" })).status, 200);
  assert.equal((await context()).suspense.total, 0, "approved without a UTR is excluded");
  await enter(withLines, "UTR-1");
  await enter(second, "UTR-2");

  const total = (1000 + 300 + 200 + 10 + 11 + 12 - 5) + 400;
  const after = await context();
  assert.deepEqual([after.suspense.total, after.prefill.suspenseAmount], [total, total]);
  assert.equal(after.suspense.rows.length, 7 + 1);
  const saved: any[] = await SettlementPayment.find({ _id: { $in: [withLines, second] } }).lean();
  assert.equal(saved.reduce((s, p) => s + p.amount, 0), total, "exactly the Total Payable of the two, nothing counted twice");
  for (const p of saved) assert.equal(after.suspense.rows.filter((r: any) => r.source === p.paymentNumber).reduce((s: number, r: any) => s + r.amount, 0), p.amount);
  // a blank reference stored by any other route does not count either
  await SettlementPayment.collection.updateOne({ _id: new mongoose.Types.ObjectId(noReference) }, { $set: { completion: { referenceNumber: "   " } } });
  assert.equal((await context()).suspense.total, total);

  const driver = String(saved[0].driver);
  const same = await suspenseFor(tv, driver, c.campaign.fromDate); // what the PDF renders
  assert.deepEqual(same.rows, after.suspense.rows);
  assert.equal(same.groups.reduce((s, g) => s + g.paise, 0), total * 100);
  assert.equal((await suspenseFor(tv, String(new mongoose.Types.ObjectId()), c.campaign.fromDate)).total, 0, "another driver gets none");
  const pdf = await call("RSA", "GET", `/settlements/projects/${tv}/payments-pdf`);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), "%PDF");
});

const finalBody = (c: any, key: string, more: object = {}) => ({
  fixedMileage: "8", onRoadDays: "5", perDaySalary: "9000", suspenseAmount: String(c.prefill.suspenseAmount), driverChangeAmount: c.prefill.driverChangeAmount,
  deductions: { previousSalary: String(c.prefill.driverChangeAmount), vehicleDamage: "100", mileageShort: "50" }, idempotencyKey: key, ...more,
});

test("the eligible total reduces Net once, is the server's figure, and RSA / RSO see the same", async () => {
  const c = await context();
  const due = c.prefill.suspenseAmount;
  assert.ok(due > 0);
  const url = `/settlements/projects/${tv}/final`;
  for (const [key, wrong] of [["zero", "0"], ["less", String(due - 1)], ["more", String(due + 1)]]) {
    const r = await api("RBP", "POST", url, finalBody(c, `suspense-${key}-key`, { suspenseAmount: wrong }));
    assert.equal(r.status, 409, key);
  }
  const negative = await api("RBP", "POST", url, finalBody(c, "suspense-negative", { perDaySalary: "10" }));
  assert.equal(negative.status, 400);
  assert.match(negative.body.message, /more than the gross/);

  const r = await api("RBP", "POST", url, finalBody(c, "suspense-final-1", { netAmount: 999999, totalDeduction: 0 }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const d = r.body.data.data;
  const other = 50 + 100 + c.prefill.driverChangeAmount;
  assert.deepEqual([d.suspenseAmount, d.totalDeduction, d.netAmount, d.totalDeductionIncludesSuspense], [due, other + due, d.gross - other - due, true]);
  assert.equal(r.body.data.amount, d.netAmount);

  const id = r.body.data._id;
  const [rsa, rso] = [(await api("RSA", "GET", `/settlements/${id}`)).body.data.data, (await api("RSO", "GET", `/settlements/${id}`)).body.data.data];
  const figures = (x: any) => [x.gross, x.suspenseAmount, x.totalDeduction, x.netAmount];
  assert.deepEqual(figures(rsa), figures(rso));
  const [a, b] = [(await api("RSA", "GET", `/settlements/${id}/suspense`)).body.data, (await api("RSO", "GET", `/settlements/${id}/suspense`)).body.data];
  assert.deepEqual(a, b);
  assert.deepEqual([b.rows, b.total, b.saved], [c.suspense.rows, due, due]);
  for (const role of ["RSA", "RSO"]) assert.equal((await call(role, "GET", `/settlements/${id}/suspense-pdf`)).status, 200);
  for (const role of ["RBP", "RSOM"]) assert.equal((await call(role, "GET", `/settlements/${id}/suspense`)).status, 403);

  // rejected, then corrected: the stored figures are untouched until the resubmission, which must carry the current suspense
  assert.equal((await api("RSO", "POST", `/settlements/${id}/reject`, { reason: "Check days" })).status, 200);
  await SettlementPayment.collection.updateOne({ trackingVehicle: new mongoose.Types.ObjectId(tv), category: "DAILY", "completion.referenceNumber": "UTR-2" }, { $set: { "completion.referenceNumber": "" } });
  assert.deepEqual(figures((await api("RSO", "GET", `/settlements/${id}`)).body.data.data), figures(d), "not recalculated by itself");
  assert.equal((await api("RBP", "POST", `/settlements/${id}/resubmit`, finalBody(c, "ignored-key-1"))).status, 409);
  const now = await context();
  assert.equal(now.prefill.suspenseAmount, due - 400);
  const re = await api("RBP", "POST", `/settlements/${id}/resubmit`, finalBody(now, "ignored-key-2"));
  assert.equal(re.status, 200, JSON.stringify(re.body));
  assert.deepEqual(figures(re.body.data.data), [d.gross, due - 400, other + due - 400, d.netAmount + 400]);
});
