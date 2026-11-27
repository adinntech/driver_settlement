/* eslint-disable @typescript-eslint/no-explicit-any */
// The two RSA exports: all approved payments, and whatever the list is filtered to (any status), across pages. Own test database.
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_export_filters";
process.env.JWT_SECRET = "test-secret";
process.env.RSA_USERNAME = "RSA";
process.env.RSA_PASSWORD = "p4";

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import mongoose from "mongoose";
import ExcelJS from "exceljs";

const { config: cfg } = await import("../src/config/index.js");
cfg.mongoUri = process.env.MONGO_URI!;
cfg.env = "test";
const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { SettlementPayment } = await import("../src/models/SettlementPayment.js");

let server: Server;
let base = "";
let token = "";
const get = (url: string) => fetch(`${base}${url}`, { headers: { Authorization: `Bearer ${token}` } });

before(async () => {
  await connectDB();
  assert.match(mongoose.connection.name, /_test_/);
  await mongoose.connection.dropDatabase();
  await seedUsers();
  const id = () => new mongoose.Types.ObjectId();
  // 12 approved daily (more than one page of 10), 2 approved final, and one of each other status
  const specs = [
    ...Array.from({ length: 12 }, (_, i) => ["DAILY", "APPROVED", i < 3 ? "KFC" : "Pothys", `2026-11-${String(i + 1).padStart(2, "0")}`] as const),
    ["FINAL", "APPROVED", "KFC", "2026-11-05"] as const, ["FINAL", "APPROVED", "Dalmia", "2026-10-01"] as const,
    ["DAILY", "PENDING", "KFC", "2026-11-02"] as const, ["DAILY", "REJECTED", "KFC", "2026-11-02"] as const, ["FINAL", "COMPLETED", "KFC", "2026-11-02"] as const,
  ];
  await SettlementPayment.collection.insertMany(specs.map(([category, status, clientName, day], i) => ({
    paymentNumber: `T-${String(i + 1).padStart(3, "0")}`, category, status, version: 1, project: id(), trackingVehicle: id(), allotment: id(), budget: id(), vehicle: id(), driver: id(),
    trackupNumber: "JS-1", pifNumber: `PIF-${i}`, clientName, projectType: "SIGNAGE", vehicleNo: `TN58AA${1000 + i}`, driverName: "Driver", fromDate: day, toDate: day, amount: 100 + i,
    data: {}, submittedBy: "RBP", submittedAt: new Date(), reviewedAt: new Date(), idempotencyKey: `export-${i}`,
  })));
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const r = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "RSA", username: "RSA", password: "p4" }) });
  token = ((await r.json()) as any).data.token;
});
after(async () => {
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

/** Payment numbers found anywhere in the workbook. */
async function exported(query: string, kind = "filtered"): Promise<string[]> {
  const res = await get(`/settlements/export/${kind}?${query}`);
  assert.equal(res.status, 200, query);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await res.arrayBuffer()) as any);
  const found = new Set<string>();
  wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => { if (/^T-\d{3}$/.test(String(c.value))) found.add(String(c.value)); })));
  return [...found].sort();
}
/** The same filters on the list, every page. */
async function listed(query: string): Promise<string[]> {
  const all: any[] = [];
  for (let page = 1; ; page++) {
    const d = ((await (await get(`/settlements?scope=all&limit=10&page=${page}&${query}`)).json()) as any).data;
    all.push(...d.items);
    if (page * 10 >= d.total) break;
  }
  return all.map((x) => x.paymentNumber).sort();
}

const events = (action = "EXPORTED") => mongoose.connection.db!.collection("settlementpaymentevents").countDocuments({ action });
const exportCount = async (paymentNumber: string) => ((await SettlementPayment.findOne({ paymentNumber }).lean()) as any).exportCount ?? 0;

test("Export Approved takes every approved payment and ignores any filter", async () => {
  const expected = await listed("status=APPROVED");
  assert.equal(expected.length, 14);
  for (const query of ["", "category=DAILY&q=KFC&status=PENDING&from=2027-01-01"]) assert.deepEqual(await exported(query, "approved"), expected, query);
});

test("Export Filtered holds exactly what the list shows, for every filter and status, across pages", async () => {
  const cases: [string, number][] = [
    ["", 17], ["category=DAILY", 14], ["category=FINAL", 3], ["status=APPROVED", 14], ["status=PENDING", 1], ["status=REJECTED", 1], ["status=COMPLETED", 1],
    ["from=2026-11-04&to=2026-11-06", 4], ["q=pif-13", 1], ["category=DAILY&q=KFC&from=2026-11-02&to=2026-11-30&status=APPROVED", 2],
  ];
  for (const [query, count] of cases) {
    const rows = await exported(query);
    assert.equal(rows.length, count, query);
    assert.deepEqual(rows, await listed(query), query);
  }
});

test("only approved rows are stamped; other statuses are read only", async () => {
  const before = await events();
  const stamped = await exportCount("T-015");
  await exported("status=PENDING");
  await exported("status=REJECTED");
  assert.deepEqual([await events(), await exportCount("T-015"), stamped], [before, 0, 0]);
  const count = await exportCount("T-001");
  await exported("q=T-001");
  assert.deepEqual([await exportCount("T-001"), await events()], [count + 1, before + 1]);
});

test("nothing to export gives a message instead of a file", async () => {
  for (const query of ["q=nobody", "category=FINAL&from=2027-01-01", "status=REJECTED&category=FINAL"]) {
    const res = await get(`/settlements/export/filtered?${query}`);
    assert.equal(res.status, 404, query);
    assert.match(((await res.json()) as any).message, /no payments matching/);
  }
  await SettlementPayment.collection.updateMany({ status: "APPROVED" }, { $set: { status: "COMPLETED" } });
  const res = await get("/settlements/export/approved");
  assert.equal(res.status, 404);
  assert.match(((await res.json()) as any).message, /no approved payments/);
});
