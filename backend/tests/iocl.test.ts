/* eslint-disable @typescript-eslint/no-explicit-any */
// IOCL Data: parsing, amount verification, duplicate-safe import, matching, export layout and access. Own test database.
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_iocl";
process.env.JWT_SECRET = "test-secret";
for (const [r, p] of [["RBP", "p2"], ["RSA", "p4"]]) {
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
cfg.env = "test";
const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { parseIoclCsv } = await import("../src/utils/iocl.js");
const { EXPORT_HEADERS } = await import("../src/services/iocl.service.js");
const { IoclTransaction } = await import("../src/models/IoclTransaction.js");

const HEADER = "SNo., Terminal ID, Merchant ID, Merchant Name , Merchant PAN, State, Location, Customer ID/Card PAN, Vehicle No. (Card), Txn ID, Txn Date, Settlement Date, Txn Type, Txn Mode, Txn Mode Value, Product, Currency, RSP, Quantity,Deduction, Amount, Balance, Odometer (User Entry), Status";
const line = (sno: number, vehicle: string, id: string, rsp: string, qty: string, amount: string, type = "Sale", date = "14/11/2026 23:50:53") =>
  `${sno},'400,'340,RICH AGENCY,PAN,TAMILNADU,DINDIGUL,'713,${vehicle},${id},${date}',15/11/2026 08:23:14',${type},CARD,'713,'DIESEL,CCMS,${rsp},${qty},-,${amount},1,'123,PT`;
const csv = (...lines: string[]) => ["Customer Transaction Details Report ,,,", "Period:14/11/2026 To 14/11/2026,,,", ",,,", HEADER, ...lines].join("\r\n");
// the Amount column sorted on its own, as in the supplied statement
const SORTED = csv(line(1, "TN 58 BH 5459", "'1000001", "100.47", "34.06", "200"), line(2, "TN58BB7093", "'1000002", "108.5", "1.84", "3422.01"), line(3, "-", "'1000003", "-", "-", "999", "Recharge"));

let server: Server;
let base = "";
const tok: Record<string, string> = {};
const get = (role: string, url: string) => fetch(`${base}${url}`, { headers: { Authorization: `Bearer ${tok[role]}` } });
async function upload(role: string, text: string, name = "FinancialTransactionStatement1.csv") {
  const fd = new FormData();
  fd.append("file", new Blob([text]), name);
  const res = await fetch(`${base}/iocl/import`, { method: "POST", headers: { Authorization: `Bearer ${tok[role]}` }, body: fd });
  return { status: res.status, body: (await res.json()) as any };
}

before(async () => {
  await connectDB();
  assert.match(mongoose.connection.name, /_test_/);
  await mongoose.connection.dropDatabase();
  await seedUsers();
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  for (const [role, password] of [["RBP", "p2"], ["RSA", "p4"]]) {
    const r = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, username: role, password }) });
    tok[role] = ((await r.json()) as any).data.token;
  }
});
after(async () => {
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test("parsing cleans the values; sorted amounts are re-paired and flagged", () => {
  const { rows, failed } = parseIoclCsv(SORTED);
  assert.deepEqual(failed, []);
  assert.deepEqual([rows[0].txnId, rows[0].txnDate, rows[0].txnTime, rows[0].vehicleNo, rows[0].product, rows[0].odometer], ["1000001", "2026-11-14", "23:50:53", "TN58BH5459", "DIESEL", "123"]);
  assert.deepEqual(rows.map((r) => [r.amount, r.fileAmount, r.amountCorrected]), [[3422.01, 200, true], [200, 3422.01, true], [null, 999, false]]);
  const fine = parseIoclCsv(csv(line(1, "TN58BH5459", "'1000001", "100", "2", "200"), line(2, "-", "'1000009", "-", "-", "500", "Recharge")));
  assert.deepEqual(fine.rows.map((r) => [r.amount, r.amountCorrected]), [[200, false], [500, false]]);
});

test("wrong files and bad rows are reported", () => {
  assert.throws(() => parseIoclCsv("a,b,c\n1,2,3"), /not an IOCL/);
  assert.throws(() => parseIoclCsv(csv()), /no transactions/);
  const { rows, failed } = parseIoclCsv(csv(line(1, "TN58BH5459", "", "100", "1", "100"), line(2, "TN58BH5459", "'1000002", "100", "1", "100", "Sale", "31/02/2026"), "3,short", line(4, "TN58BH5459", "'1000004", "100", "1", "100")));
  assert.equal(rows.length, 1);
  assert.deepEqual(failed.map((f) => f.row), ["1", "2", "3"]);
});

test("import is RSA only, never duplicates and never overwrites", async () => {
  assert.equal((await upload("RBP", SORTED)).status, 403);
  assert.equal((await get("RBP", "/iocl")).status, 403);
  assert.equal((await upload("RSA", SORTED, "statement.xlsx")).status, 400);
  const first = (await upload("RSA", SORTED)).body.data;
  assert.deepEqual([first.imported, first.duplicate, first.failed, first.corrected], [3, 0, 0, 2]);
  const again = (await upload("RSA", csv(line(1, "TN58BH5459", "'1000001", "1", "1", "1"), line(2, "TN58BH5459", "'1000010", "100", "1", "100", "Sale", "15/11/2026")))).body.data;
  assert.deepEqual([again.imported, again.duplicate], [1, 1]);
  assert.equal(((await IoclTransaction.findOne({ txnId: "1000001" }).lean()) as any).amount, 3422.01);
  assert.equal(await IoclTransaction.countDocuments(), 4);
});

test("filters, totals and matching from application records", async () => {
  const db = mongoose.connection.db!;
  const project = new mongoose.Types.ObjectId(), driver = new mongoose.Types.ObjectId();
  await db.collection("trackingprojects").insertOne({ _id: project, projectType: "SIGNAGE", projectCode: "22069284", clientName: "Adinn", details: { location: "Chennai" } });
  await db.collection("drivers").insertOne({ _id: driver, driverNumber: "DR-1779", driverName: "TEST DRIVER ONE", mobileDigits: "9000000001" });
  await db.collection("vehicleallotments").insertOne({ vehicleNo: "TN58BH5459", project, driver, status: "ACTIVE", allottedAt: new Date("2026-11-10T05:00:00Z") });
  const data = ((await (await get("RSA", "/iocl?from=2026-11-14&to=2026-11-14")).json()) as any).data;
  assert.equal(data.total, 3);
  assert.deepEqual(data.vehicleTotals.map((t: any) => [t.vehicleNo, t.amount, t.status]), [["TN58BB7093", 200, "UNKNOWN_VEHICLE"], ["TN58BH5459", 3422.01, "MATCHED"]]);
  assert.deepEqual([data.summary.sales, data.summary.amount, data.summary.unmatched], [2, 3622.01, 1]);
  assert.equal(((await (await get("RSA", "/iocl?vehicleNo=tn 58 bh")).json()) as any).data.total, 2);
  assert.equal(((await (await get("RSA", "/iocl?product=PETROL")).json()) as any).data.total, 0);
  assert.equal((await get("RSA", "/iocl?from=2026-11-15&to=2026-11-14")).status, 400);
});

test("export follows the sample layout; unmatched details stay blank", async () => {
  assert.equal((await get("RSA", "/iocl/export")).status, 400);
  assert.equal((await get("RSA", "/iocl/export?from=2020-01-01&to=2020-01-01")).status, 404);
  const res = await get("RSA", "/iocl/export?from=2026-11-14&to=2026-11-14");
  assert.match(res.headers.get("content-disposition")!, /IOCL STATEMENT 14\.11\.2026\.xlsx/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await res.arrayBuffer()) as any);
  const ws = wb.getWorksheet("Sheet1")!;
  const row = (n: number) => EXPORT_HEADERS.map((_, i) => ws.getRow(n).getCell(i + 1).value);
  assert.deepEqual(row(1), ["S.NO", "PAYMENT DATE", "PROJECT NO", "DEPARTMENT", "CLIENT NAME", "VEHICLE NO", "LOCATION", "DRIVER CODE", "DRIVER NAME", "DRIVER NO", "AMOUNT", "DESCRIBTIONS", "REMARK"]);
  assert.equal(ws.rowCount, 3, "sales only");
  const byVehicle = [row(2), row(3)].sort((a, b) => String(a[5]).localeCompare(String(b[5])));
  assert.deepEqual(byVehicle[1].slice(1), ["14.11.2026", 22069284, "SIGNAGE", "Adinn", "TN58BH5459", "Chennai", "DR-1779", "TEST DRIVER ONE", 9000000001, 3422.01, "IOCL", "NO"]);
  assert.deepEqual(byVehicle[0].slice(2, 10), [null, null, null, "TN58BB7093", null, null, null, null]);
  assert.equal(ws.getRow(1).getCell(1).font.name, "Times New Roman");
  assert.equal((ws.getRow(1).getCell(1).fill as any).fgColor.argb, "FFFFFF00");
});
