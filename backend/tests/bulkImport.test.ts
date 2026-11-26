/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_bulkimport";
process.env.JWT_SECRET = "test-secret";
process.env.RSOP_USERNAME = "RSOP";
process.env.RSOP_PASSWORD = "pass2";
process.env.RBP_USERNAME = "RBP";
process.env.RBP_PASSWORD = "123123";
process.env.RSOM_USERNAME = "RSOM";
process.env.RSOM_PASSWORD = "pass3";
process.env.STORAGE_TYPE = "local";

import test from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import mongoose from "mongoose";
import ExcelJS from "exceljs";

// SAFETY: modules are imported dynamically after the config points at the throw-away test database.
const { config: cfg } = await import("../src/config/index.js");
cfg.mongoUri = "mongodb://127.0.0.1:27017/driver_settlement_test_bulkimport";
cfg.storage.type = "local";
const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { User } = await import("../src/models/User.js");
const { Driver, DriverHistory } = await import("../src/models/Driver.js");
const { Vehicle } = await import("../src/models/Vehicle.js");
const { VEHICLE_COLUMNS, DRIVER_COLUMNS } = await import("../src/services/bulkImport.service.js");

let server: Server;
let base = "";
{
  await connectDB();
  assert.match(mongoose.connection.name, /_test_/, "refusing to drop a non-test database");
  await mongoose.connection.dropDatabase();
  await Promise.all([User.init(), Driver.init(), Vehicle.init()]);
  await seedUsers();
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
}
const login = async (role: string, u: string, p: string) => {
  const r = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, username: u, password: p }) });
  return ((await r.json()) as any).data.token as string;
};
let tk: { rbp: string; rsop: string } | undefined;
const T = async () => (tk ??= { rbp: await login("RBP", "RBP", "123123"), rsop: await login("RSOP", "RSOP", "pass2") });

/** Uploads a workbook buffer to an import endpoint. */
async function upload(path: string, buf: Buffer, token: string, name = "import.xlsx") {
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(buf)]), name);
  const res = await fetch(base + path, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
  return { status: res.status, body: (await res.json()) as { success: boolean; message: string; data: any } };
}

/** A workbook in the template's layout: header row (with the * markers) and the given rows (key -> value). */
async function book(sheet: string, columns: { header: string; key: string; required?: boolean }[], rows: Record<string, unknown>[], drop: string[] = []) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  const cols = columns.filter((c) => !drop.includes(c.key));
  ws.addRow(cols.map((c) => `${c.header}${c.required ? " *" : ""}`));
  for (const r of rows) ws.addRow(cols.map((c) => (r[c.key] ?? null) as ExcelJS.CellValue));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const vRow = (over: Record<string, unknown> = {}) => ({
  vehicleNo: "TN58BM6554", make: "Tata", model: "Ace Gold", type: "Dynamic", yearOfManufacture: 2021, purchaseDate: "2021-06-15",
  currentRunning: 48210, totalRunning: 48210, "doc:insurance": "2027-03-31", ...over,
});
const dRow = (over: Record<string, unknown> = {}) => ({
  driverName: "Murugan K", driverType: "Company Driver", mobileNumber: "9876543210", accountNumber: "123456789012", ifscCode: "SBIN0001234",
  licenceNumber: "TN0720110012345", licenceExpiryDate: "2030-05-20", salary: 18500, ...over,
});

test("templates: every column with required markers, two sample rows, an Instructions sheet; RBP only", async () => {
  const t = await T();
  for (const [kind, sheet, cols] of [["vehicles", "Vehicles", VEHICLE_COLUMNS], ["drivers", "Drivers", DRIVER_COLUMNS]] as const) {
    const res = await fetch(`${base}/${kind}/import/template`, { headers: { Authorization: `Bearer ${t.rbp}` } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /spreadsheetml/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as any);
    const ws = wb.getWorksheet(sheet)!;
    const headers = (ws.getRow(1).values as unknown[]).slice(1).map(String);
    assert.deepEqual(headers, cols.map((c) => `${c.header}${c.required ? " *" : ""}`));
    assert.equal(ws.actualRowCount, 3); // header + 2 sample rows
    const info = wb.getWorksheet("Instructions")!;
    assert.ok(info.actualRowCount > cols.length);
    // the template itself is a valid import (its samples pass every rule)
    const pre = await upload(`/${kind}/import/preview`, Buffer.from(await wb.xlsx.writeBuffer()), t.rbp);
    assert.equal(pre.status, 200, JSON.stringify(pre.body));
    assert.equal(pre.body.data.invalid, 0, JSON.stringify(pre.body.data.rows));
    // other roles cannot use it
    assert.equal((await fetch(`${base}/${kind}/import/template`, { headers: { Authorization: `Bearer ${t.rsop}` } })).status, 403);
    assert.equal((await fetch(`${base}/${kind}/import/template`)).status, 401);
  }
});

test("vehicle import: row-wise errors and duplicates (in the file and in the database) block the import; nothing is saved", async () => {
  const t = await T();
  await Vehicle.deleteMany({});
  const buf = await book("Vehicles", VEHICLE_COLUMNS, [
    vRow(),
    vRow({ vehicleNo: "TN-58-BM-6554" }), // same number as row 2 once normalised
    vRow({ vehicleNo: "KA01AB1234", type: "Rocket", purchaseDate: "2099-01-01", make: "" }),
    vRow({ vehicleNo: "MH12XY9999", yearOfManufacture: "abc" }),
  ]);
  const pre = await upload("/vehicles/import/preview", buf, t.rbp);
  assert.equal(pre.status, 200);
  const d = pre.body.data;
  assert.deepEqual([d.total, d.valid, d.invalid], [4, 1, 3]);
  const byRow = new Map(d.rows.map((r: any) => [r.row, r]));
  assert.equal((byRow.get(2) as any).status, "VALID");
  assert.match((byRow.get(3) as any).errors.join(";"), /repeated in the file \(row 2\)/);
  const r4 = (byRow.get(4) as any).errors.join(";");
  assert.match(r4, /Type must be one of/);
  assert.match(r4, /Purchase date cannot be in the future/);
  assert.match(r4, /Make is required/);
  assert.match((byRow.get(5) as any).errors.join(";"), /Year of manufacture/);
  const run = await upload("/vehicles/import", buf, t.rbp);
  assert.equal(run.status, 400);
  assert.equal(run.body.success, false);
  assert.match(run.body.message, /Nothing was imported/);
  assert.equal(run.body.data.invalid, 3); // the row-wise errors come back with the refusal
  assert.equal(await Vehicle.countDocuments(), 0);
});

test("vehicle import: valid file creates Active, Available Now vehicles with history; a second upload is refused as duplicate", async () => {
  const t = await T();
  await Vehicle.deleteMany({});
  const buf = await book("Vehicles", VEHICLE_COLUMNS, [vRow(), vRow({ vehicleNo: "KA01AB1234", type: "Static", "doc:insurance": null, "doc:fc": "2027-01-10" })]);
  const run = await upload("/vehicles/import", buf, t.rbp);
  assert.equal(run.status, 201, JSON.stringify(run.body));
  assert.equal(run.body.data.imported, 2);
  const list: any[] = await Vehicle.find().sort({ vehicleNo: 1 }).lean();
  assert.deepEqual(list.map((v) => v.vehicleNo), ["KA01AB1234", "TN58BM6554"]);
  assert.ok(list.every((v) => v.status === "ACTIVE" && v.availability?.status === "AVAILABLE" && v.createdBy === "RBP"));
  assert.equal(list[1].insurance[0].nextRenewalDate, "2027-03-31");
  assert.equal(list[0].fc[0].nextRenewalDate, "2027-01-10");
  const again = await upload("/vehicles/import/preview", buf, t.rbp);
  assert.equal(again.body.data.invalid, 2);
  assert.ok(again.body.data.rows.every((r: any) => r.errors.some((e: string) => /already exists/.test(e))));
});

test("driver import: readable driver type, duplicates by mobile / licence, Driver Numbers generated, history written", async () => {
  const t = await T();
  await Driver.deleteMany({});
  const bad = await book("Drivers", DRIVER_COLUMNS, [
    dRow(),
    dRow({ driverName: "Other One", mobileNumber: "+91 98765 43210", licenceNumber: "TN0920150067890" }), // same mobile
    dRow({ driverName: "Third", mobileNumber: "9123456780", licenceNumber: "tn07 2011 0012345" }), // same licence
    dRow({ driverName: "X1", mobileNumber: "12345", driverType: "Pilot", ifscCode: "BAD" }),
  ]);
  const pre = (await upload("/drivers/import/preview", bad, t.rbp)).body.data;
  assert.deepEqual([pre.total, pre.valid, pre.invalid], [4, 1, 3]);
  assert.match(pre.rows[1].errors.join(), /Mobile number .* repeated in the file \(row 2\)/);
  assert.match(pre.rows[2].errors.join(), /Licence number .* repeated in the file \(row 2\)/);
  assert.match(pre.rows[3].errors.join(), /Mobile number must be a valid/);
  assert.match(pre.rows[3].errors.join(), /Driver type must be/);
  assert.match(pre.rows[3].errors.join(), /IFSC code is not valid/);
  assert.equal((await upload("/drivers/import", bad, t.rbp)).status, 400);
  assert.equal(await Driver.countDocuments(), 0);

  const good = await book("Drivers", DRIVER_COLUMNS, [dRow(), dRow({ driverName: "Sampath M", driverType: "ACTING_DRIVER", mobileNumber: "9123456780", licenceNumber: "TN0920150067890", salary: 650 })]);
  const run = await upload("/drivers/import", good, t.rbp);
  assert.equal(run.status, 201, JSON.stringify(run.body));
  assert.equal(run.body.data.imported, 2);
  const ds: any[] = await Driver.find().sort({ driverName: 1 }).lean();
  assert.deepEqual(ds.map((x) => [x.driverName, x.driverType, x.salary]), [["Murugan K", "COMPANY_DRIVER", 18500], ["Sampath M", "ACTING_DRIVER", 650]]);
  assert.ok(ds.every((x) => /^DR-\d{4,5}$/.test(x.driverNumber) && x.availability?.status === "AVAILABLE"));
  assert.equal(await DriverHistory.countDocuments({ action: "CREATED" }), 2);
  // imported drivers are saved drivers: their details are locked like any other
  const r = await fetch(`${base}/drivers/${ds[0]._id}`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t.rbp}` }, body: JSON.stringify({ driverName: "Changed Name" }) });
  assert.equal(r.status, 403);
});

test("import file checks: not xlsx, missing required columns, empty sheet, oversized row count", async () => {
  const t = await T();
  const txt = await upload("/drivers/import/preview", Buffer.from("name,mobile\nA,1"), t.rbp, "drivers.csv");
  assert.equal(txt.status, 400);
  assert.match(txt.body.message, /Only Excel \.xlsx files/);
  const missing = await upload("/drivers/import/preview", await book("Drivers", DRIVER_COLUMNS, [dRow()], ["mobileNumber"]), t.rbp);
  assert.equal(missing.status, 400);
  assert.match(missing.body.message, /Missing required column: Mobile No/);
  const empty = await upload("/vehicles/import/preview", await book("Vehicles", VEHICLE_COLUMNS, []), t.rbp);
  assert.equal(empty.status, 400);
  assert.match(empty.body.message, /no data rows/);
  const many = await book("Drivers", DRIVER_COLUMNS, Array.from({ length: 501 }, (_, i) => dRow({ mobileNumber: String(7000000000 + i), licenceNumber: null })));
  const big = await upload("/drivers/import/preview", many, t.rbp);
  assert.equal(big.status, 400);
  assert.match(big.body.message, /at most 500/);
  const none = await fetch(`${base}/drivers/import/preview`, { method: "POST", headers: { Authorization: `Bearer ${t.rbp}` } });
  assert.equal(none.status, 400);
});

test("cleanup", async () => {
  await mongoose.connection.dropDatabase();
  await new Promise<void>((r) => server.close(() => r()));
  await mongoose.disconnect();
});
