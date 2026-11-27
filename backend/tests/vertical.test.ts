/* eslint-disable @typescript-eslint/no-explicit-any */
// The Vertical filter on the server: lists, pagination, summaries, reports and exports for both verticals. Own test database.
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_vertical";
process.env.JWT_SECRET = "test-secret";
for (const [r, p] of [["RSOP", "p1"], ["RBP", "p2"], ["RSOM", "p3"], ["RSA", "p4"], ["RSO", "p5"]]) {
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

const { config: cfg } = await import("../src/config/index.js");
cfg.mongoUri = process.env.MONGO_URI!;
cfg.env = "test";
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-vertical-test-"));
cfg.storage.localDir = storageDir;
const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { seedDevData } = await import("../src/seed/devSeed.js");
const { TrackingProject } = await import("../src/models/TrackingProject.js");

let server: Server;
let base = "";
const tok: Record<string, string> = {};
const call = (role: string, url: string) => fetch(`${base}${url}`, { headers: { Authorization: `Bearer ${tok[role]}` } });
const get = async (role: string, url: string) => {
  const res = await call(role, url);
  assert.equal(res.status, 200, url);
  return ((await res.json()) as any).data;
};
// RSA payment history has always called its vertical filter paymentFor
const q = (url: string, vertical: string) => `${url}${url.includes("?") ? "&" : "?"}${url.startsWith("/rsa/payments?") ? "paymentFor" : "projectType"}=${vertical}`;

before(async () => {
  await connectDB();
  assert.match(mongoose.connection.name, /_test_/);
  await mongoose.connection.dropDatabase();
  await seedUsers();
  await seedDevData();
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  for (const [role, password] of [["RSOP", "p1"], ["RBP", "p2"], ["RSOM", "p3"], ["RSA", "p4"], ["RSO", "p5"]]) {
    const r = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, username: role, password }) });
    tok[role] = ((await r.json()) as any).data.token;
  }
});
after(async () => {
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  fs.rmSync(storageDir, { recursive: true, force: true });
});

test("each list splits exactly into Roadshow and Signage, by the project's own type", async () => {
  const types = new Map((await TrackingProject.find().lean() as any[]).map((p) => [String(p._id), p.projectType]));
  assert.ok(new Set(types.values()).size === 2);
  const lists: [string, string, (x: any) => string][] = [
    ["RSA", "/settlements?scope=all&limit=100", (x) => x.projectType],
    ["RBP", "/settlements/projects?limit=100", (x) => x.projectType],
    ["RBP", "/settlements/on-road?limit=100", (x) => x.projectType],
    ["RSOM", "/approvals?limit=100", (x) => x.projectType],
    ["RSA", "/rsa-clearances?limit=100", (x) => x.projectType],
    ["RBP", "/on-road-vehicles?limit=100", (x) => x.projectType],
    ["RBP", "/vehicle-allotments?limit=100", (x) => x.projectType],
    ["RBP", "/vehicle-allotments/projects?limit=50", (x) => x.projectType],
    ["RSA", "/rsa/projects?limit=100", (x) => x.projectType],
    ["RSA", "/rsa/payments?limit=100", (x) => x.projectType ?? x.paymentFor],
    ["RBP", "/vehicles?limit=100", (x) => x.availability?.project?.projectType],
    ["RBP", "/drivers?limit=100", (x) => x.availability?.project?.projectType],
  ];
  for (const [role, url, typeOf] of lists) {
    const all = await get(role, url);
    const road = await get(role, q(url, "ROADSHOW"));
    const sign = await get(role, q(url, "SIGNAGE"));
    assert.ok(road.items.every((x: any) => typeOf(x) === "ROADSHOW"), `${url} roadshow`);
    assert.ok(sign.items.every((x: any) => typeOf(x) === "SIGNAGE"), `${url} signage`);
    const typed = all.items.filter((x: any) => typeOf(x)).length;
    if (all.total <= all.items.length) assert.equal(road.total + sign.total, typed, url);
  }
  const requests = await get("RSOP", "/tracking?projectType=SIGNAGE");
  assert.ok(requests.length && requests.every((p: any) => p.projectType === "SIGNAGE"));
});

test("works with pagination, status and search; summary cards follow it", async () => {
  const url = "/settlements?scope=all&status=APPROVED";
  const road = await get("RSA", q(`${url}&limit=100`, "ROADSHOW"));
  const first = await get("RSA", q(`${url}&limit=1&page=2`, "ROADSHOW"));
  assert.equal(first.total, road.total);
  assert.ok(first.items.every((x: any) => x.projectType === "ROADSHOW" && x.status === "APPROVED"));
  const sum = (d: any) => Object.values<any>(d.summary).reduce((s, x) => s + x.count, 0);
  const [a, r, s] = await Promise.all(["", "ROADSHOW", "SIGNAGE"].map((v) => get("RSA", q("/settlements?scope=all", v))));
  assert.equal(sum(r) + sum(s), sum(a));
  for (const [role, endpoint, key] of [["RSOM", "/approvals/stats", "total"], ["RSA", "/rsa-clearances/summary", "total"], ["RBP", "/on-road-vehicles/summary", "total"], ["RSA", "/rsa/payments/summary", "totalEntries"]] as const) {
    const [x, y, z] = await Promise.all(["", "ROADSHOW", "SIGNAGE"].map((v) => get(role, q(endpoint, v))));
    assert.equal(y[key] + z[key], x[key], endpoint);
  }
});

test("reports and exports carry the Vertical column and respect the filter", async () => {
  for (const kind of ["approved-payments", "driver-salary", "driver-list", "vehicle-mis"]) {
    const rows = await get("RSO", `/settlements/reports/${kind}?projectType=SIGNAGE`);
    assert.ok(rows.every((x: any) => x.projectType === "Signage"), kind);
    const res = await call("RSO", `/settlements/reports/${kind}/export?projectType=SIGNAGE`);
    assert.equal(res.status, 200, kind);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await res.arrayBuffer()) as any);
    let found = false;
    wb.worksheets[0].eachRow((row) => row.eachCell((c) => { if (c.value === "Vertical") found = true; }));
    assert.ok(found, `${kind} column`);
  }
  const res = await call("RSA", "/settlements/export/filtered?projectType=ROADSHOW");
  assert.equal(res.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await res.arrayBuffer()) as any);
  const ws = wb.worksheets[0];
  const values: unknown[] = [];
  let column = 0;
  ws.eachRow((row) => {
    if (!column) row.eachCell((c, i) => { if (c.value === "Vertical") column = i; });
    else values.push(row.getCell(column).value);
  });
  assert.ok(values.filter(Boolean).length && values.filter(Boolean).every((v) => v === "Roadshow"));
});
