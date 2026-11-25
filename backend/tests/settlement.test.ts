/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_settlement";
process.env.JWT_SECRET = "test-secret";
for (const [r, p] of [["RSOP", "p1"], ["RBP", "p2"], ["RSOM", "p3"], ["RSA", "p4"], ["RSO", "p5"]]) {
  process.env[`${r}_USERNAME`] = r;
  process.env[`${r}_PASSWORD`] = p;
}
process.env.STORAGE_TYPE = "local";

import test, { after, before, describe } from "node:test";
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
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-settlement-test-"));
cfg.storage.localDir = storageDir;
const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { seedDevData } = await import("../src/seed/devSeed.js");
const { SettlementPayment, SettlementPaymentEvent } = await import("../src/models/SettlementPayment.js");
const { calculateFinal, validateFinalInput, validateDailyInput, dailyData } = await import("../src/utils/settlement.js");
const { validateCompletion } = await import("../src/services/settlement.service.js");
const { seal, unseal, maskTail } = await import("../src/utils/secureField.js");

let server: Server;
let base = "";
const tok: Record<string, string> = {};
const pw: Record<string, string> = { RSOP: "p1", RBP: "p2", RSOM: "p3", RSA: "p4", RSO: "p5" };

async function api(role: string, method: string, url: string, body?: unknown) {
  const res = await fetch(`${base}${url}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok[role]}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("json")) return { status: res.status, body: (await res.json()) as any, buf: null as Buffer | null, type };
  return { status: res.status, body: null as any, buf: Buffer.from(await res.arrayBuffer()), type };
}
const key = () => `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

before(async () => {
  await connectDB();
  assert.match(mongoose.connection.name, /_test_/);
  await mongoose.connection.dropDatabase();
  await seedUsers();
  await seedDevData();
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  for (const role of Object.keys(pw)) {
    const r = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, username: role, password: pw[role] }) });
    tok[role] = ((await r.json()) as any).data.token;
    assert.ok(tok[role], `${role} can log in`);
  }
});
after(async () => {
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  fs.rmSync(storageDir, { recursive: true, force: true });
});

// ------------------------------------------------------------------------------------------------ calculations

describe("calculations", () => {
  test("daily total payable reuses the RSA payment rule and requires a valid period", () => {
    const v = validateDailyInput({ fromDate: "2026-11-01", toDate: "2026-11-03", foodAmount: "450", salaryAdvance: "1000", dieselEntries: [{ amount: "2500.50" }], expenses: [{ optionKey: "TOLL", amount: "120" }, { optionKey: "OTHERS", description: "Fine", amount: "200", deduct: true }], idempotencyKey: "abcdefgh1" });
    assert.deepEqual(v.errors, []);
    const d = dailyData(v.data!);
    assert.equal(d.totalPayable, 2500.5 + 450 + 1000 + 120 - 200);
    assert.equal(d.total, 2500.5 + 450 + 1000 + 120);
    assert.match(validateDailyInput({ fromDate: "2026-11-05", toDate: "2026-11-01", foodAmount: "1", idempotencyKey: "abcdefgh1" }).errors.join(), /before From Date/);
    assert.match(validateDailyInput({ fromDate: "2026-11-01", toDate: "2026-11-01", idempotencyKey: "abcdefgh1" }).errors.join(), /at least one amount/);
  });

  test("final settlement: fuel, earnings, expenses, deductions, gross and net", () => {
    const v = validateFinalInput({
      fixedMileage: "8", openingKm: "10000", closingKm: "10800", dieselCost: "95.50", ioclLitres: "110", perDaySalary: "800", perDayFood: "250", haltDayPay: "300", travelPay: "1500",
      overtimeRate: "100", onRoadDays: "20", onRoadSundays: "3", haltDays: "2", overtimeHours: "5.5", suspenseAmount: "2000",
      expenses: [{ category: "TOLL", quantity: "4", cost: "150" }, { category: "SERVICE", description: "Oil", quantity: "1", cost: "1200", approved: "1000" }],
      deductions: { mileageShort: "500", vehicleDamage: "250", other: "100", otherRemark: "Late reporting" }, idempotencyKey: "abcdefgh2",
    }, { totalDays: 30 });
    assert.deepEqual(v.errors, []);
    const c = calculateFinal(v.data!);
    assert.equal(c.resultKm, 800);
    assert.equal(c.expectedLitres, 100);
    assert.equal(c.variationLitres, 10);
    assert.equal(c.mileageShortSuggestedP, 95500); // 10 l x 95.50
    const earnings = 20 * 800 + 3 * 800 + 23 * 250 + 2 * 300 + 1500 + 5.5 * 100;
    assert.equal(c.earningsP, earnings * 100);
    assert.equal(c.claimedP, (600 + 1200) * 100);
    assert.equal(c.approvedP, (600 + 1000) * 100);
    assert.equal(c.rejectedP, 200 * 100);
    assert.equal(c.grossP, (earnings + 1600) * 100);
    assert.equal(c.totalDeductionP, 850 * 100);
    assert.equal(c.netP, (earnings + 1600 - 850 - 2000) * 100);
  });

  test("final settlement validation rejects bad amounts", () => {
    const errs = (b: any, days: number | null = 10) => validateFinalInput({ fixedMileage: "8", onRoadDays: "5", idempotencyKey: "abcdefgh3", ...b }, { totalDays: days }).errors.join(" | ");
    assert.match(errs({ openingKm: "500", closingKm: "100" }), /Closing KM cannot be less/);
    assert.match(errs({ onRoadDays: "8", haltDays: "5" }), /cannot exceed the campaign's 10 days/);
    assert.match(errs({ onRoadDays: "2.5" }), /whole number/);
    assert.match(errs({ perDaySalary: "-5" }), /cannot be negative/);
    assert.match(errs({ expenses: [{ category: "TOLL", quantity: "1", cost: "100", approved: "150" }] }), /cannot be more than the claimed/);
    assert.match(errs({ expenses: [{ category: "NOPE", quantity: "1", cost: "1" }] }), /listed categories/);
    assert.match(errs({ perDaySalary: "100", suspenseAmount: "1000" }), /more than the gross/);
    assert.match(errs({ deductions: { other: "10" } }), /Other deduction remark is required/);
    assert.match(errs({ fixedMileage: "" }), /Fixed Mileage must be greater than zero/);
  });

  test("bank and transaction details are encrypted at rest", () => {
    const s = seal("123456789012")!;
    assert.ok(!JSON.stringify(s).includes("123456789012"));
    assert.equal(unseal(s), "123456789012");
    assert.equal(unseal({ ...s, data: Buffer.from("tampered").toString("base64") }), null);
    assert.equal(maskTail("123456789012"), "XXXXXXXX9012");
  });

  test("completion details are validated", () => {
    const now = new Date("2026-11-24T06:00:00Z");
    assert.deepEqual(validateCompletion({ referenceNumber: "UTR123", paymentDate: "2026-11-24", paymentMode: "EPAYMENT", bankName: "HDFC", transactionDetails: "UTR123 HDFC0001" }, new Date("2026-11-20T00:00:00Z"), now).errors, []);
    const e = validateCompletion({ referenceNumber: "", paymentDate: "2026-12-30", paymentMode: "BITCOIN", bankName: "" }, null, now).errors.join(" | ");
    for (const m of [/reference number is required/, /cannot be in the future/, /Payment mode is required/, /Bank name is required/]) assert.match(e, m);
    assert.match(validateCompletion({ referenceNumber: "R1", paymentDate: "2026-11-10", paymentMode: "CASH", bankName: "Cash" }, new Date("2026-11-20T00:00:00Z"), now).errors.join(), /before the approval date/);
  });

  test("payment Entry popup: modes Cash / Cheque / DD / ePayment, mandatory reference, bank except for cash", () => {
    const now = new Date("2026-11-24T06:00:00Z");
    const approved = new Date("2026-11-20T00:00:00Z");
    const ok = { paymentMode: "CHEQUE", paymentDate: "2026-11-24", bankName: "SBI", referenceNumber: "CHQ-004512", referenceDate: "2026-11-23" };
    for (const m of ["CASH", "CHEQUE", "DD", "EPAYMENT"]) assert.deepEqual(validateCompletion({ ...ok, paymentMode: m }, approved, now).errors, [], m);
    assert.match(validateCompletion({ ...ok, paymentMode: "NEFT" }, approved, now).errors.join(), /Payment mode is required \(Cash, Cheque, DD, ePayment\)/, "older modes are no longer offered");
    for (const r of [undefined, "", "    ", "\t \n"]) assert.match(validateCompletion({ ...ok, referenceNumber: r }, approved, now).errors.join(), /Payment reference number is required/, JSON.stringify(r));
    assert.match(validateCompletion({ ...ok, referenceNumber: "CHQ 12" }, approved, now).errors.join(), /letters, digits/);
    assert.match(validateCompletion({ ...ok, bankName: " " }, approved, now).errors.join(), /Bank name is required/);
    assert.deepEqual(validateCompletion({ ...ok, paymentMode: "CASH", bankName: "" }, approved, now).errors, [], "no bank needed for cash");
    assert.match(validateCompletion({ ...ok, referenceDate: "2026-12-01" }, approved, now).errors.join(), /Reference date cannot be in the future/);
    assert.match(validateCompletion({ ...ok, referenceDate: "2026-13-01" }, approved, now).errors.join(), /Reference date must be a valid date/);
    assert.equal(validateCompletion({ ...ok, transactionDetails: "" }, approved, now).errors.length, 0, "transaction details are optional");
  });
});

// ------------------------------------------------------------------------------------------------ end-to-end workflow

describe("workflow across RBP, RSOM, RSO and RSA", () => {
  let tvA = "";
  let tvB = "";
  let dailyId = "";
  let finalId = "";

  test("RBP sees eligible projects with their prefilled settlement context; other roles cannot", async () => {
    const r = await api("RBP", "GET", "/settlements/projects?limit=50");
    assert.equal(r.status, 200);
    assert.ok(r.body.data.items.length >= 2, "the dev seed provides approved projects with drivers");
    const used = new Set((await SettlementPayment.distinct("trackingVehicle")).map(String)); // the dev seed's own settlement examples
    [tvA, tvB] = r.body.data.items.map((x: any) => x.trackingVehicle).filter((id: string) => !used.has(id));
    assert.ok(tvA && tvB, "two project vehicles without seeded settlements");
    const c = await api("RBP", "GET", `/settlements/projects/${tvA}`);
    assert.equal(c.status, 200);
    assert.ok(c.body.data.campaign.fromDate && c.body.data.prefill.fixedMileage > 0);
    assert.ok(!JSON.stringify(c.body.data).match(/"accountNumber"/), "full account number is never returned");
    for (const role of ["RSOM", "RSO", "RSOP"]) assert.equal((await api(role, "GET", "/settlements/projects")).status, 403, `${role} cannot use the driver payment picker`);
    assert.equal((await api("RSA", "GET", "/settlements/projects")).status, 200, "RSA shares the Driver Payments module with RBP");
    for (const role of ["RSOM", "RSO"]) assert.equal((await api(role, "POST", `/settlements/projects/${tvA}/daily`, {})).status, 403, `${role} cannot create payments`);
    assert.equal((await api("RSOP", "GET", "/settlements")).status, 403, "RSOP has no access to payments");
  });

  test("RBP submits a daily payment; duplicates and overlapping periods are refused", async () => {
    const c = (await api("RBP", "GET", `/settlements/projects/${tvA}`)).body.data;
    const k = key();
    const body = { paymentFor: c.projectType, fromDate: c.campaign.fromDate, toDate: c.campaign.fromDate, foodAmount: "450", dieselEntries: [{ amount: "2000", mode: "Cash" }], salaryAdvance: "500", expenses: [{ optionKey: "TOLL", amount: "150" }], idempotencyKey: k };
    const r = await api("RBP", "POST", `/settlements/projects/${tvA}/daily`, body);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.status, "PENDING");
    assert.equal(r.body.data.amount, 3100);
    assert.match(r.body.data.paymentNumber, /^DVP-\d{6}\/\d{4}-\d{2}$/);
    dailyId = r.body.data._id;
    const again = await api("RBP", "POST", `/settlements/projects/${tvA}/daily`, body);
    assert.equal(again.status, 200, "double click returns the saved entry");
    assert.equal(again.body.data._id, dailyId);
    const overlap = await api("RBP", "POST", `/settlements/projects/${tvA}/daily`, { ...body, idempotencyKey: key() });
    assert.equal(overlap.status, 409);
    assert.match(overlap.body.message, /already covers/);
    const wrongType = await api("RBP", "POST", `/settlements/projects/${tvA}/daily`, { ...body, paymentFor: c.projectType === "ROADSHOW" ? "SIGNAGE" : "ROADSHOW", idempotencyKey: key() });
    assert.equal(wrongType.status, 400);
  });

  test("only RSOM decides daily payments; the decision is atomic and final", async () => {
    assert.equal((await api("RSO", "POST", `/settlements/${dailyId}/approve`, {})).status, 403, "RSO cannot approve a daily payment");
    assert.equal((await api("RSA", "POST", `/settlements/${dailyId}/approve`, {})).status, 403);
    assert.equal((await api("RBP", "POST", `/settlements/${dailyId}/approve`, {})).status, 403);
    assert.equal((await api("RSA", "POST", `/settlements/${dailyId}/complete`, { referenceNumber: "X1", paymentDate: "2026-01-01", paymentMode: "EPAYMENT", bankName: "SBI", transactionDetails: "x" })).status, 409, "cannot complete a pending payment");
    const [a, b] = await Promise.all([api("RSOM", "POST", `/settlements/${dailyId}/approve`, { version: 1 }), api("RSOM", "POST", `/settlements/${dailyId}/reject`, { reason: "Wrong toll", version: 1 })]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], "two simultaneous decisions: exactly one wins");
    const p = (await api("RSOM", "GET", `/settlements/${dailyId}`)).body.data;
    if (p.status === "REJECTED") {
      // exercise the correction path, then approve
      const c = (await api("RBP", "GET", `/settlements/projects/${tvA}`)).body.data;
      const re = await api("RBP", "POST", `/settlements/${dailyId}/resubmit`, { paymentFor: c.projectType, fromDate: p.fromDate, toDate: p.toDate, foodAmount: "450", dieselEntries: [{ amount: "2000" }], salaryAdvance: "500", expenses: [{ optionKey: "TOLL", amount: "150" }], comment: "Toll corrected" });
      assert.equal(re.status, 200);
      assert.equal(re.body.data.version, 2);
      assert.equal((await api("RSOM", "POST", `/settlements/${dailyId}/approve`, { version: 2 })).status, 200);
    }
    const done = (await api("RBP", "GET", `/settlements/${dailyId}`)).body.data;
    assert.equal(done.status, "APPROVED");
    assert.equal(done.reviewedRole, "RSOM");
    assert.ok(done.history.some((h: any) => h.action === "APPROVED"));
    assert.equal((await api("RSOM", "POST", `/settlements/${dailyId}/reject`, { reason: "late change" })).status, 409, "an approved payment cannot be rejected afterwards");
  });

  test("rejection needs a reason, and RBP can resubmit a new version keeping the history", async () => {
    const c = (await api("RBP", "GET", `/settlements/projects/${tvB}`)).body.data;
    const r = await api("RBP", "POST", `/settlements/projects/${tvB}/daily`, { fromDate: c.campaign.fromDate, toDate: c.campaign.fromDate, foodAmount: "300", idempotencyKey: key() });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const id = r.body.data._id;
    assert.equal((await api("RSOM", "POST", `/settlements/${id}/reject`, { reason: "" })).status, 400);
    assert.equal((await api("RSOM", "POST", `/settlements/${id}/reject`, { reason: "Food bill missing" })).status, 200);
    assert.equal((await api("RSA", "GET", `/settlements/${id}`)).status, 200, "the shared record (rejected too) is visible to RSA in Driver Payments");
    assert.ok(!(await api("RSA", "GET", "/settlements?limit=100")).body.data.items.some((x: any) => x._id === id), "but not in RSA's accounts queue (pending + approved)");
    const re = await api("RBP", "POST", `/settlements/${id}/resubmit`, { fromDate: c.campaign.fromDate, toDate: c.campaign.fromDate, foodAmount: "350", comment: "Bill attached" });
    assert.equal(re.status, 200);
    assert.equal(re.body.data.status, "PENDING");
    assert.equal(re.body.data.version, 2);
    assert.equal(re.body.data.amount, 350);
    assert.deepEqual(re.body.data.history.map((h: any) => h.action), ["SUBMITTED", "REJECTED", "RESUBMITTED"]);
    const events = await SettlementPaymentEvent.find({ payment: id }).lean();
    assert.equal((events[0] as any).snapshot.foodAmount, 300, "version 1 data is kept in the history");
    assert.equal((await api("RBP", "POST", `/settlements/${id}/resubmit`, { foodAmount: "1" })).status, 409, "only rejected entries can be resubmitted");
  });

  test("RBP submits a final settlement; a second one for the same driver is refused", async () => {
    const c = (await api("RBP", "GET", `/settlements/projects/${tvA}`)).body.data;
    const pre = c.prefill;
    const body = {
      jsNumber: pre.jsNumber, location: pre.location ?? "Pune", reportingDate: c.campaign.fromDate, estimatedKmPerDay: pre.estimatedKmPerDay, fixedMileage: pre.fixedMileage || 8,
      openingKm: "12000", closingKm: "12900", dieselCost: "94.20", ioclLitres: "120", ioclKms: "880", estimatedBudget: pre.estimatedBudget, estimatedKm: pre.estimatedKm, estimatedFuel: pre.estimatedFuel,
      perDaySalary: "900", perDayFood: "250", haltDayPay: "300", travelPay: "1000", onRoadDays: "3", onRoadSundays: "0", haltDays: "1", suspenseAmount: "500",
      expenses: [{ category: "TOLL", quantity: "2", cost: "180" }, { category: "OTHERS", description: "Parking", quantity: "1", cost: "100", approved: "60" }],
      deductions: { mileageShort: "200", driverChangeTravel: "0", vehicleDamage: "0", previousSalary: "0", other: "0" }, idempotencyKey: key(),
    };
    const r = await api("RBP", "POST", `/settlements/projects/${tvA}/final`, body);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    finalId = r.body.data._id;
    assert.match(r.body.data.paymentNumber, /^DSE-/);
    const expectedNet = 3 * 900 + 3 * 250 + 300 + 1000 + 360 + 60 - 200 - 500;
    assert.equal(r.body.data.amount, expectedNet);
    assert.equal(r.body.data.data.netAmount, expectedNet);
    const dup = await api("RBP", "POST", `/settlements/projects/${tvA}/final`, { ...body, idempotencyKey: key() });
    assert.equal(dup.status, 409);
    assert.match(dup.body.message, /already exists/);
    const stored: any = await SettlementPayment.findById(finalId).lean();
    assert.ok(stored.bank.account?.data, "account number is stored encrypted");
  });

  test("the salary PDF exists only after RSO approval; RSOM cannot approve finals", async () => {
    assert.equal((await api("RSO", "GET", `/settlements/${finalId}/salary-pdf`)).status, 409, "no PDF before approval");
    assert.equal((await api("RSOM", "POST", `/settlements/${finalId}/approve`, {})).status, 403, "RSOM cannot approve a final settlement");
    const ok = await api("RSO", "POST", `/settlements/${finalId}/approve`, { comment: "Verified" });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.reviewedRole, "RSO");
    const pdf = await api("RSO", "GET", `/settlements/${finalId}/salary-pdf`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.type, "application/pdf");
    assert.equal(pdf.buf!.subarray(0, 5).toString(), "%PDF-");
    const dse = ((await SettlementPayment.findById(finalId).lean()) as any).dseNumber;
    assert.ok(Number.isInteger(dse) && dse > 0, "DSE No. is assigned from the database counter at approval");
    const all = (await SettlementPayment.find({ dseNumber: { $type: "number" } }).lean()).map((x: any) => x.dseNumber);
    assert.equal(new Set(all).size, all.length, "DSE numbers are unique");
    assert.equal(Math.max(...all), dse, "this approval got the next number in sequence");
    const again = await api("RSO", "GET", `/settlements/${finalId}/salary-pdf`);
    assert.equal(again.buf!.length > 2000, true);
    assert.equal(((await SettlementPayment.findById(finalId).lean()) as any).dseNumber, dse, "re-downloading never changes the DSE No.");
    assert.ok(pdf.buf!.length > 2000);
    assert.equal((await api("RSO", "GET", `/settlements/${dailyId}/salary-pdf`)).status, 404, "daily payments have no salary statement");
    assert.equal((await api("RBP", "GET", `/settlements/${finalId}/salary-pdf`)).status, 403);
  });

  test("approval queue filters: category, status, completed table", async () => {
    const all = (await api("RSA", "GET", "/settlements?limit=100")).body.data;
    assert.ok(all.items.every((p: any) => ["PENDING", "APPROVED"].includes(p.status)), "RSA queue has pending and approved only");
    const daily = (await api("RSO", "GET", "/settlements?category=DAILY&limit=100")).body.data.items;
    assert.ok(daily.length && daily.every((p: any) => p.category === "DAILY"));
    const approved = (await api("RSOM", "GET", "/settlements?status=APPROVED&limit=100")).body.data.items;
    assert.deepEqual(new Set(approved.map((p: any) => p.status)), new Set(["APPROVED"]));
  });

  test("RSA exports approved payments only, then completes them; completed entries move to their own table", async () => {
    const x = await api("RSA", "GET", "/settlements/export/approved");
    assert.equal(x.status, 200);
    assert.match(x.type, /spreadsheetml/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.buf! as any);
    const ws = wb.worksheets[0];
    const header = (ws.getRow(1).values as any[]).slice(1);
    assert.ok(header.includes("Payment No") && header.includes("Account Number"));
    const numbers = new Set<string>();
    ws.eachRow((row, i) => {
      if (i > 1 && row.getCell(1).value !== "TOTAL") numbers.add(String(row.getCell(1).value));
    });
    const approvedNow: any[] = await SettlementPayment.find({ status: "APPROVED" }).lean();
    assert.deepEqual(numbers, new Set(approvedNow.map((p) => p.paymentNumber)), "exactly the approved entries");
    assert.ok(approvedNow.some((p) => p.category === "DAILY") && approvedNow.some((p) => p.category === "FINAL"));
    for (const role of ["RSOP", "RBP", "RSOM", "RSO"]) assert.equal((await api(role, "GET", "/settlements/export/approved")).status, 403, `${role} cannot export`);
    assert.deepEqual(header, ["Payment No", "Category", "Status", "Trackup No", "JS No", "Client", "Project Type", "Vehicle No", "Driver Code", "Driver Name", "From", "To", "Amount (INR)", "Account Name", "Bank", "IFSC", "Account Number", "Submitted By", "Approved By", "Approved On"], "the accounts export keeps its columns");

    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const bad = await api("RSA", "POST", `/settlements/${dailyId}/complete`, { referenceNumber: "", paymentDate: today, paymentMode: "EPAYMENT", bankName: "SBI" });
    assert.equal(bad.status, 400);
    const c = await api("RSA", "POST", `/settlements/${dailyId}/complete`, { referenceNumber: "UTR-998877", paymentDate: today, paymentMode: "EPAYMENT", bankName: "State Bank of India", transactionDetails: "UTR998877 SBIN0001234" });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal(c.body.data.status, "COMPLETED");
    assert.equal(c.body.data.completion.transactionMasked.endsWith("1234"), true);
    assert.ok(!JSON.stringify(c.body).includes("UTR998877 SBIN0001234"), "transaction details are not echoed back in full");
    assert.equal((await api("RSA", "POST", `/settlements/${dailyId}/complete`, { referenceNumber: "UTR-1", paymentDate: today, paymentMode: "EPAYMENT", bankName: "SBI", transactionDetails: "x" })).status, 409, "cannot complete twice");
    const again = await api("RSA", "GET", "/settlements/export/approved");
    if (again.status === 200) {
      const wb2 = new ExcelJS.Workbook();
      await wb2.xlsx.load(again.buf! as any);
      const nos: string[] = [];
      wb2.worksheets[0].eachRow((row, i) => { if (i > 1) nos.push(String(row.getCell(1).value)); });
      const paidNo = ((await SettlementPayment.findById(dailyId).lean()) as any).paymentNumber;
      assert.ok(!nos.includes(paidNo), "a paid (completed) payment is no longer exported");
    } else assert.equal(again.status, 404, "nothing left to export");
    const dupRef = await api("RSA", "POST", `/settlements/${finalId}/complete`, { referenceNumber: "UTR-998877", paymentDate: today, paymentMode: "EPAYMENT", bankName: "SBI", transactionDetails: "x" });
    assert.equal(dupRef.status, 200, "a reference may repeat across categories (one bank batch)");
    const queue = (await api("RSA", "GET", "/settlements?limit=100")).body.data.items.map((p: any) => p._id);
    assert.ok(!queue.includes(dailyId), "completed entries leave the approval queue");
    const completed = (await api("RSA", "GET", "/settlements?status=COMPLETED")).body.data.items.map((p: any) => p._id);
    assert.ok(completed.includes(dailyId) && completed.includes(finalId));
    await assert.rejects(SettlementPayment.deleteOne({ _id: dailyId }), /cannot be deleted/);
    assert.equal((await api("RSO", "GET", `/settlements/${finalId}/salary-pdf`)).status, 200, "PDF still available after payment completion");
  });

  test("RSA payment Entry on approved daily and final payments: saved on the same record, moved to Payment Completed, no duplicates", async () => {
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    // approved payments of both categories (inserted copies: the duplicate-final lock allows one real final per driver + allotment)
    const copy = async (srcId: string, n: number) => {
      const src: any = await SettlementPayment.findById(srcId).lean();
      const { _id, completion, finalLock, dseNumber, createdAt, updatedAt, __v, ...rest } = src;
      void [_id, completion, finalLock, dseNumber, createdAt, updatedAt, __v];
      const [doc]: any[] = await SettlementPayment.create([{ ...rest, status: "APPROVED", paymentNumber: `${src.paymentNumber}-E${n}-${Date.now()}`, idempotencyKey: `entry-test-${n}-${Date.now()}` }]);
      await SettlementPaymentEvent.create([{ payment: doc._id, paymentNumber: doc.paymentNumber, category: doc.category, version: doc.version, action: "APPROVED", fromStatus: "PENDING", toStatus: "APPROVED", username: "rsom", role: "RSOM", amount: doc.amount }]);
      return String(doc._id);
    };
    const [daily, final, finalB, finalC] = [await copy(dailyId, 1), await copy(finalId, 2), await copy(finalId, 3), await copy(finalId, 4)];
    const before: any = await SettlementPayment.findById(daily).lean();
    const count = await SettlementPayment.countDocuments();
    const entry = (referenceNumber: unknown, extra: Record<string, unknown> = {}) => ({ paymentMode: "EPAYMENT", paymentDate: today, bankName: "Axis Bank", referenceNumber, referenceDate: today, ...extra });

    // listed with an Entry action in Driver Payments (approved)
    const inDriverPayments = async (id: string) => (await api("RSA", "GET", "/settlements?scope=all&limit=100")).body.data.items.some((x: any) => x._id === id);
    assert.ok(await inDriverPayments(daily) && await inDriverPayments(final));

    // validation: nothing is saved while the required fields are missing
    for (const blank of [undefined, "", "     "]) {
      const r = await api("RSA", "POST", `/settlements/${daily}/complete`, entry(blank));
      assert.equal(r.status, 400, `reference ${JSON.stringify(blank)} refused`);
      assert.match(r.body.message, /Payment reference number is required/);
    }
    assert.match((await api("RSA", "POST", `/settlements/${daily}/complete`, entry("EP-1", { paymentMode: "" }))).body.message, /Payment mode is required/);
    assert.match((await api("RSA", "POST", `/settlements/${daily}/complete`, entry("EP-1", { bankName: "" }))).body.message, /Bank name is required/);
    assert.match((await api("RSA", "POST", `/settlements/${daily}/complete`, entry("EP-1", { paymentDate: "" }))).body.message, /Payment date must be a valid date/);
    assert.equal(((await SettlementPayment.findById(daily).lean()) as any).status, "APPROVED", "refused entries leave the payment approved");

    // duplicate reference within the category (any case)
    const dupDaily = await api("RSA", "POST", `/settlements/${daily}/complete`, entry("utr-998877"));
    assert.equal(dupDaily.status, 409);
    assert.match(dupDaily.body.message, /already recorded on DVP-/);

    // save (double click: the second request is refused, one completion only)
    const [s1, s2] = await Promise.all([api("RSA", "POST", `/settlements/${daily}/complete`, entry("  EP-DAILY-0001  ")), api("RSA", "POST", `/settlements/${daily}/complete`, entry("EP-DAILY-0001"))]);
    assert.deepEqual([s1.status, s2.status].sort(), [200, 409], [s1.body?.message, s2.body?.message].join(" | "));
    const after: any = await SettlementPayment.findById(daily).lean();
    assert.equal(after.status, "COMPLETED");
    assert.equal(after.completion.referenceNumber, "EP-DAILY-0001", "trimmed reference saved on the same approved record");
    assert.equal(after.completion.paymentMode, "EPAYMENT");
    assert.equal(after.completion.bankName, "Axis Bank");
    assert.equal(after.completion.referenceDate, today);
    assert.equal(after.amount, before.amount, "approved amount unchanged");
    assert.equal(after.category, before.category);
    assert.deepEqual(after.data, before.data, "approved figures unchanged");
    assert.equal(after.version, before.version);
    const hist = (await api("RSA", "GET", `/settlements/${daily}`)).body.data.history.map((h: any) => h.action);
    assert.deepEqual(hist.slice(-2), ["APPROVED", "COMPLETED"], "approval history kept, completion appended");

    // final settlement, cash (no bank), then visible in Payment Completed only
    const fc = await api("RSA", "POST", `/settlements/${final}/complete`, entry("CASH-VCH-77", { paymentMode: "CASH", bankName: "" }));
    assert.equal(fc.status, 200, JSON.stringify(fc.body));
    assert.equal(fc.body.data.completion.bankName, null);
    const shared = (await api("RSA", "GET", "/settlements?scope=all&limit=100")).body.data.items;
    for (const id of [daily, final]) assert.equal(shared.find((x: any) => x._id === id)?.status, "COMPLETED", "paid entries stay in Driver Payments with their saved (completed) status");
    const rbpView = (await api("RBP", "GET", "/settlements?scope=all&limit=100")).body.data.items.find((x: any) => x._id === daily);
    assert.equal(rbpView?.completion?.referenceNumber, "EP-DAILY-0001", "RBP sees the same paid entry");
    assert.ok(!(await api("RSA", "GET", "/settlements?limit=100")).body.data.items.some((x: any) => x._id === daily), "but not in RSA's accounts queue");
    assert.equal((await api("RSA", "POST", `/settlements/${daily}/complete`, entry("EP-DAILY-0002"))).status, 409, "a completed entry cannot be entered again");
    const completed = (await api("RSA", "GET", "/settlements?status=COMPLETED&limit=100")).body.data.items;
    const row = completed.find((x: any) => x._id === daily);
    assert.deepEqual({ ref: row.completion.referenceNumber, mode: row.completion.paymentMode, bank: row.completion.bankName, paid: row.completion.paymentDate, refDate: row.completion.referenceDate }, { ref: "EP-DAILY-0001", mode: "EPAYMENT", bank: "Axis Bank", paid: today, refDate: today });
    assert.ok(completed.some((x: any) => x._id === final), "final settlement in Payment Completed");
    assert.ok((await api("RSA", "GET", "/settlements?status=COMPLETED&q=ep-daily-0001")).body.data.items.some((x: any) => x._id === daily), "searchable by reference");
    const report = (await api("RSO", "GET", "/settlements/reports/approved-payments")).body.data.find((r: any) => r._id === daily);
    assert.deepEqual([report.referenceNumber, report.paymentMode, report.paymentBank], ["EP-DAILY-0001", "ePayment", "Axis Bank"], "reference details in the report / Excel rows");

    // two RSA users saving the same reference at the same moment on two final payments: exactly one wins
    const race = await Promise.all([api("RSA", "POST", `/settlements/${finalB}/complete`, entry("DD-555")), api("RSA", "POST", `/settlements/${finalC}/complete`, entry("dd-555", { paymentMode: "DD" }))]);
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409], race.map((r) => r.body?.message).join(" | "));
    assert.equal(await SettlementPayment.countDocuments(), count, "no payment record was created by the entries");
  });

  test("RSO reports: in-app data and an Excel file per report", async () => {
    for (const kind of ["approved-payments", "vehicle-mis", "driver-list", "driver-salary"]) {
      const j = await api("RSO", "GET", `/settlements/reports/${kind}`);
      assert.equal(j.status, 200, kind);
      assert.ok(Array.isArray(j.body.data) && j.body.data.length > 0, `${kind} has rows`);
      assert.ok(!JSON.stringify(j.body.data).match(/"account":\{/), "no encrypted blobs in report JSON");
      const x = await api("RSO", "GET", `/settlements/reports/${kind}/export`);
      assert.equal(x.status, 200);
      assert.equal(x.buf!.subarray(0, 2).toString(), "PK", `${kind} is an xlsx (zip) file`);
      assert.equal((await api("RSA", "GET", `/settlements/reports/${kind}`)).status, 403);
    }
    const salary = (await api("RSO", "GET", "/settlements/reports/driver-salary")).body.data;
    assert.ok(salary.every((r: any) => r.paymentNumber.startsWith("DSE-")), "driver salary report lists final settlements only");
    assert.equal((await api("RSO", "GET", "/settlements/reports/nope")).status, 404);
  });

  test("the new RSO role appears in the login roles and existing roles keep their access", async () => {
    const roles = (await (await fetch(`${base}/auth/roles`)).json()) as any;
    assert.ok(roles.data.RSO && roles.data.RSOM, "RSO and RSOM are separate logins");
    assert.equal((await api("RSO", "GET", "/budgets")).status === 200, false, "RSO has no budget access");
    assert.equal((await api("RSA", "GET", "/rsa/payments")).status, 200, "the existing RSA payment entries still work");
  });
});

// ------------------------------------------------------------------------------------------------ shared Driver Payments (RBP + RSA)

describe("Driver Payments is one shared module for RBP and RSA", () => {
  const free = async () => {
    const used = new Set((await SettlementPayment.distinct("trackingVehicle")).map(String));
    const items = (await api("RSA", "GET", "/settlements/projects?limit=50")).body.data.items;
    return items.map((x: any) => x.trackingVehicle).filter((id: string) => !used.has(id));
  };

  test("an RSA entry appears in RBP's list (and the other way round), as the same record with the same details", async () => {
    const [tv] = await free();
    assert.ok(tv, "a project vehicle without payments");
    const c = (await api("RSA", "GET", `/settlements/projects/${tv}`)).body.data;
    const r = await api("RSA", "POST", `/settlements/projects/${tv}/daily`, { fromDate: c.campaign.fromDate, toDate: c.campaign.fromDate, foodAmount: "250", idempotencyKey: key() });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.submittedRole, "RSA");
    const rbpList = (await api("RBP", "GET", "/settlements?scope=all&limit=100")).body.data.items;
    const rsaList = (await api("RSA", "GET", "/settlements?scope=all&limit=100")).body.data.items;
    assert.deepEqual(rbpList.map((x: any) => x._id), rsaList.map((x: any) => x._id), "both roles list exactly the same records");
    const inRbp = rbpList.find((x: any) => x._id === r.body.data._id);
    assert.ok(inRbp, "RSA's entry is in RBP's list immediately");
    const [a, b] = await Promise.all([api("RBP", "GET", `/settlements/${inRbp._id}`), api("RSA", "GET", `/settlements/${inRbp._id}`)]);
    assert.deepEqual(a.body.data, b.body.data, "identical details, status, amounts and history from both logins");
    assert.equal(await SettlementPayment.countDocuments({ _id: inRbp._id }), 1);

    // RSOM rejects it; RBP corrects the RSA entry: still one record, history shows both roles
    assert.equal((await api("RSOM", "POST", `/settlements/${inRbp._id}/reject`, { reason: "Food bill missing" })).status, 200);
    const re = await api("RBP", "POST", `/settlements/${inRbp._id}/resubmit`, { fromDate: c.campaign.fromDate, toDate: c.campaign.fromDate, foodAmount: "300", comment: "Bill added" });
    assert.equal(re.status, 200, JSON.stringify(re.body));
    assert.deepEqual(re.body.data.history.map((h: any) => `${h.action}:${h.role}`), ["SUBMITTED:RSA", "REJECTED:RSOM", "RESUBMITTED:RBP"]);
    const seenByRsa = (await api("RSA", "GET", `/settlements/${inRbp._id}`)).body.data;
    assert.equal(seenByRsa.amount, 300, "RBP's update is what RSA sees");
    assert.equal(seenByRsa.version, 2);
  });

  test("simultaneous submissions from RBP and RSA for the same period create exactly one payment", async () => {
    const [, tv] = await free();
    assert.ok(tv);
    const c = (await api("RBP", "GET", `/settlements/projects/${tv}`)).body.data;
    const body = () => ({ fromDate: c.campaign.fromDate, toDate: c.campaign.fromDate, foodAmount: "200", idempotencyKey: key() });
    const results = await Promise.all([api("RBP", "POST", `/settlements/projects/${tv}/daily`, body()), api("RSA", "POST", `/settlements/projects/${tv}/daily`, body()), api("RBP", "POST", `/settlements/projects/${tv}/daily`, body())]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409], results.map((r) => r.body?.message).join(" | "));
    assert.equal(await SettlementPayment.countDocuments({ trackingVehicle: tv, category: "DAILY" }), 1);

    // a retry with the same key (double click / network retry) from either role returns the saved record
    const k = key();
    const d2 = { fromDate: c.campaign.toDate, toDate: c.campaign.toDate, foodAmount: "150", idempotencyKey: k };
    const [x, y] = await Promise.all([api("RSA", "POST", `/settlements/projects/${tv}/daily`, d2), api("RSA", "POST", `/settlements/projects/${tv}/daily`, d2)]);
    assert.deepEqual([x.status, y.status].sort(), [200, 201]);
    assert.equal(x.body.data._id, y.body.data._id);
    assert.equal(await SettlementPayment.countDocuments({ idempotencyKey: k }), 1);
  });

  test("role permissions on the shared records: entry by RBP / RSA, approval by RSOM / RSO, completion by RSA", async () => {
    const p: any = await SettlementPayment.findOne({ status: "PENDING", category: "DAILY" }).lean();
    for (const role of ["RBP", "RSA", "RSO"]) assert.equal((await api(role, "POST", `/settlements/${p._id}/approve`, {})).status, 403, `${role} cannot approve a daily payment`);
    assert.equal((await api("RBP", "POST", `/settlements/${p._id}/complete`, {})).status, 403, "only RSA completes payments");
    assert.equal((await api("RSOM", "POST", `/settlements/${p._id}/resubmit`, {})).status, 403, "approvers cannot enter or correct payments");
  });
});