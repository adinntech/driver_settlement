/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_vehicle_mis";
process.env.JWT_SECRET = "test-secret";
for (const [r, p] of [["RSOP", "p1"], ["RBP", "p2"], ["RSOM", "p3"], ["RSA", "p4"], ["RSO", "p5"]]) {
  process.env[`${r}_USERNAME`] = r;
  process.env[`${r}_PASSWORD`] = p;
}

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import mongoose from "mongoose";
import ExcelJS from "exceljs";

const { config: cfg } = await import("../src/config/index.js");
cfg.mongoUri = process.env.MONGO_URI!;
const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { vehicleMisRows, vehicleMisWorkbook, VEHICLE_MIS_COLUMNS } = await import("../src/services/settlementReports.service.js");

const HEADERS = ["Vehicle No", "Make", "Model", "Y.O.M", "Purchase Date", "Vehicle Type", "Stepney Status", "Battery Status", "Oil Top Up On", "Grease Packing On",
  "General Check Up On", "Current Running", "Total Running", "Fc", "Insurance", "State Permit", "Rto Permission", "Police Permission", "Condition", "Specification"];
let server: Server;
let base = "";
const col = (h: string) => HEADERS.indexOf(h) + 2; // data starts in column B
const load = async (buf: Buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any); return wb.worksheets[0]; };
const token = async (role: string, pw: string) => ((await (await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, username: role, password: pw }) })).json()) as any).data.token;

before(async () => {
  await connectDB();
  assert.match(mongoose.connection.name, /_test_/);
  await mongoose.connection.dropDatabase();
  await seedUsers();
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});
after(async () => {
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test("no vehicles: the workbook still has the title and the 20 reference headers, and no data rows", async () => {
  const ws = await load(await vehicleMisWorkbook(await vehicleMisRows({})));
  assert.equal(ws.getCell("A1").value, "Vehicle MIS");
  assert.deepEqual((ws.getRow(3).values as any[]).slice(2), HEADERS);
  assert.equal(ws.actualRowCount, 2, "title + header only");
});

test("complete, partial and legacy-bad records: exact values, real dates, blanks never become 01-Jan-1900; drafts excluded", async () => {
  const v = mongoose.connection.collection("vehicles");
  const now = new Date();
  const docs = (d: string) => [{ nextRenewalDate: d }, { nextRenewalDate: "2025-01-01" }];
  await v.insertMany([
    { vehicleNo: "TN58AA3735", make: "TATA", model: "ACE", type: "Dynamic", yearOfManufacture: 2011, purchaseDate: "2011-03-10", stepneyStatus: "YES", batteryStatus: "GOOD",
      oilTopUpOn: "2019-08-17", greasePackingOn: "2019-05-22", generalCheckUpOn: "2019-08-16", currentRunning: 0, totalRunning: 1250, fc: docs("2026-11-05"), insurance: docs("2026-11-06"),
      permit: docs("2026-12-23"), rtoPermission: docs("2026-11-03"), policePermission: docs("2026-09-12"), condition: "GOOD", specification: "Bharat Stage IV", status: "ACTIVE", createdBy: "t", updatedBy: "t", createdAt: now, updatedAt: now },
    { vehicleNo: "TN58W3204", make: "TATA", model: "ACE", type: "Dynamic", yearOfManufacture: 2010, status: "INACTIVE", createdBy: "t", updatedBy: "t", createdAt: now, updatedAt: now },
    { vehicleNo: "TN58AE1701", make: "TATA", model: "ACE", purchaseDate: "1905-07-02", oilTopUpOn: "1900-01-01", greasePackingOn: "", generalCheckUpOn: "not a date",
      fc: [{ nextRenewalDate: null }], currentRunning: 0, status: "ACTIVE", createdBy: "t", updatedBy: "t", createdAt: now, updatedAt: now },
    { make: "Draft only", status: "DRAFT", createdBy: "t", updatedBy: "t", createdAt: now, updatedAt: now },
  ]);
  const rows = await vehicleMisRows({});
  assert.deepEqual(rows.map((r) => r.vehicleNo), ["TN58AA3735", "TN58AE1701", "TN58W3204"], "all non-draft vehicles (active and inactive), sorted by number");
  const ws = await load(await vehicleMisWorkbook(rows));
  const full = ws.getRow(4);
  const ymd = (c: any) => (c instanceof Date ? c.toISOString().slice(0, 10) : c);
  assert.equal(full.getCell(col("Vehicle No")).value, "TN58AA3735");
  assert.equal(full.getCell(col("Y.O.M")).value, 2011);
  assert.equal(ymd(full.getCell(col("Purchase Date")).value), "2011-03-10");
  assert.equal(full.getCell(col("Purchase Date")).numFmt, "dd-mmm-yyyy");
  assert.equal(full.getCell(col("Current Running")).value, 0, "a real 0 stays 0");
  assert.equal(full.getCell(col("Total Running")).value, 1250);
  assert.equal(ymd(full.getCell(col("Fc")).value), "2026-11-05", "latest renewal date of the document");
  assert.equal(ymd(full.getCell(col("State Permit")).value), "2026-12-23", "State Permit = the vehicle's Permit document");
  assert.equal(ymd(full.getCell(col("Police Permission")).value), "2026-09-12");
  assert.equal(full.getCell(col("Specification")).value, "Bharat Stage IV");

  const legacy = ws.getRow(5);
  for (const h of ["Purchase Date", "Oil Top Up On", "Grease Packing On", "General Check Up On", "Fc"]) assert.equal(legacy.getCell(col(h)).value, null, `${h} is blank, not a 1900 / invalid date`);
  assert.equal(legacy.getCell(col("Current Running")).value, 0);
  assert.equal(legacy.getCell(col("Total Running")).value, null, "missing number stays blank");

  const partial = ws.getRow(6);
  assert.equal(partial.getCell(col("Vehicle No")).value, "TN58W3204");
  for (const h of ["Purchase Date", "Stepney Status", "Current Running", "Insurance", "Condition"]) assert.equal(partial.getCell(col(h)).value, null, `${h} blank on a partial record`);
  assert.equal(VEHICLE_MIS_COLUMNS.length, 20);
});

test("the Vehicle MIS export stays RSO-only and downloads as a valid .xlsx", async () => {
  const rso = await token("RSO", "p5");
  const r = await fetch(`${base}/settlements/reports/vehicle-mis/export`, { headers: { Authorization: `Bearer ${rso}` } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition") ?? "", /vehicle-mis-\d{4}-\d{2}-\d{2}\.xlsx/);
  const ws = await load(Buffer.from(await r.arrayBuffer()));
  assert.equal(ws.getCell("A1").value, "Vehicle MIS");
  for (const [role, pw] of [["RBP", "p2"], ["RSA", "p4"], ["RSOM", "p3"]]) {
    const x = await fetch(`${base}/settlements/reports/vehicle-mis/export`, { headers: { Authorization: `Bearer ${await token(role, pw)}` } });
    assert.equal(x.status, 403, `${role} cannot export`);
  }
});
