/* eslint-disable @typescript-eslint/no-explicit-any */
// RSO mileage edit, highlighted expense export. Own test database.
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_final_review";
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
import ExcelJS from "exceljs";
import { recalcMileage as preview, isHighlightedExpense as screenRule } from "../../frontend/src/utils/settlement.js";

const { config: cfg } = await import("../src/config/index.js");
cfg.mongoUri = process.env.MONGO_URI!;
cfg.env = "test";
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-final-review-test-"));
cfg.storage.localDir = storageDir;
const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { seedDevData } = await import("../src/seed/devSeed.js");
const { SettlementPayment } = await import("../src/models/SettlementPayment.js");
const { recalcMileage, isHighlightedExpense } = await import("../src/utils/settlement.js");

let server: Server;
let base = "";
const tok: Record<string, string> = {};
let id = "";
let saved: any;

const call = (role: string, method: string, url: string, body?: unknown) =>
  fetch(`${base}${url}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok[role]}` }, body: body === undefined ? undefined : JSON.stringify(body) });
async function api(role: string, method: string, url: string, body?: unknown) {
  const res = await call(role, method, url, body);
  return { status: res.status, body: (await res.json()) as any };
}

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
  let tv = "";
  for (const x of (await api("RBP", "GET", "/settlements/projects?limit=100&kind=final")).body.data.items) {
    if (used.has(x.trackingVehicle)) continue;
    tv = x.trackingVehicle;
    if (!(await api("RBP", "GET", `/settlements/projects/${tv}`)).body.data.prefill.suspenseAmount) break;
  }
  const c = (await api("RBP", "GET", `/settlements/projects/${tv}`)).body.data;
  const claim = (category: string, description: string) => ({ category, description, quantity: "1", cost: "100" });
  const r = await api("RBP", "POST", `/settlements/projects/${tv}/final`, {
    fixedMileage: "10", openingKm: "1000", closingKm: "1800", dieselCost: "100", ioclLitres: "90", estimatedKm: "900", onRoadDays: "5", perDaySalary: "2000",
    driverChangeAmount: c.prefill.driverChangeAmount, deductions: { previousSalary: String(c.prefill.driverChangeAmount), mileageShort: "250", vehicleDamage: "100" },
    expenses: [claim("TOLL", "gate"), claim("FOOD_ALLOWANCE", "meal"), claim("FUEL", "pump"), claim("OTHERS", "IOCL card"), claim("SERVICE", "oil")], idempotencyKey: "final-review-1",
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  saved = r.body.data;
  id = saved._id;
});
after(async () => {
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  fs.rmSync(storageDir, { recursive: true, force: true });
});

test("Payment Details PDF downloads for RBP and RSA only", async () => {
  const tv = saved.trackingVehicle;
  for (const role of ["RBP", "RSA"]) {
    const res = await call(role, "GET", `/settlements/projects/${tv}/payments-pdf`);
    assert.equal(res.status, 200, role);
    assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString(), "%PDF");
  }
  for (const role of ["RSO", "RSOM"]) assert.equal((await call(role, "GET", `/settlements/projects/${tv}/payments-pdf`)).status, 403, role);
});

test("only RSO edits the mileage of a pending final, with a valid value and the current version", async () => {
  for (const role of ["RBP", "RSA", "RSOM"]) assert.equal((await api(role, "POST", `/settlements/${id}/mileage`, { fixedMileage: "8", version: 1 })).status, 403, role);
  for (const [value, status] of [["0", 400], ["-2", 400], ["abc", 400], ["10", 400]] as const) assert.equal((await api("RSO", "POST", `/settlements/${id}/mileage`, { fixedMileage: value, version: 1 })).status, status, value);
  assert.equal((await api("RSO", "POST", `/settlements/${id}/mileage`, { fixedMileage: "8", version: 7 })).status, 409);
});

test("dependent figures are recalculated, saved and recorded; nothing else changes", async () => {
  const r = await api("RSO", "POST", `/settlements/${id}/mileage`, { fixedMileage: "16", version: 1, netAmount: 999999, deductions: { vehicleDamage: 0 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = (await api("RSO", "GET", `/settlements/${id}`)).body.data; // read again, as after a refresh
  const d = after.data, b = saved.data;
  // 800 km / 16 = 50 l; 90 - 50 = 40 l extra x 100 = 4000
  assert.deepEqual([d.fuel.fixedMileage, d.fuel.resultKm, d.fuel.expectedLitres, d.fuel.variationLitres, d.deductions.mileageShort, d.estimate.estimatedFuel], [16, 800, 50, 40, 4000, 56.25]);
  assert.equal(d.totalDeduction, b.totalDeduction - 250 + 4000);
  assert.equal(d.netAmount, b.netAmount + 250 - 4000);
  assert.deepEqual([after.amount, after.version, after.status, d.gross], [d.netAmount, 2, "PENDING", b.gross]);
  assert.deepEqual([d.earnings, d.expenses, d.days, d.rates, d.suspenseAmount, d.deductions.vehicleDamage], [b.earnings, b.expenses, b.days, b.rates, b.suspenseAmount, 100]);
  const h = after.history.at(-1);
  assert.deepEqual([h.action, h.username, h.role], ["MILEAGE_EDITED", "RSO", "RSO"]);
  assert.match(h.comment, /Mileage 10 → 16 km\/l/);
  assert.ok(h.createdAt);
  assert.deepEqual(preview(b, 16), recalcMileage(b, 16), "the screen preview matches the server");
  assert.equal((await api("RSO", "POST", `/settlements/${id}/approve`, { version: 1 })).status, 409, "a decision on the old figures");
});

test("detail Excel highlights the same rows as the screen, for RSA and RSO", async () => {
  assert.equal((await call("RBP", "GET", `/settlements/${id}/detail-export`)).status, 403);
  for (const role of ["RSA", "RSO"]) {
    const res = await call(role, "GET", `/settlements/${id}/detail-export`);
    assert.equal(res.status, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await res.arrayBuffer()) as any);
    const marked: string[] = [];
    wb.worksheets[0].eachRow((row) => {
      if ((row.getCell(1).fill as any)?.fgColor?.argb !== "FFFFF2CC") return;
      for (let c = 2; c <= 6; c++) assert.equal((row.getCell(c).fill as any)?.fgColor?.argb, "FFFFF2CC", "the complete row");
      marked.push(String(row.getCell(2).value || row.getCell(1).value));
    });
    assert.deepEqual(marked, ["On Road Days Salary", "gate", "oil"], role);
  }
  for (const e of [...saved.data.earnings, ...saved.data.expenses]) assert.equal(screenRule(e), isHighlightedExpense(e));
  assert.equal((await api("RSO", "POST", `/settlements/${id}/approve`, { version: 2 })).status, 200);
  assert.equal((await api("RSO", "POST", `/settlements/${id}/mileage`, { fixedMileage: "9", version: 2 })).status, 409, "no edit after approval");
});
