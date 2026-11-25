/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_driver_bank";
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

// SAFETY: modules are imported dynamically after the config points at the throw-away test database.
const { config: cfg } = await import("../src/config/index.js");
cfg.mongoUri = "mongodb://127.0.0.1:27017/driver_settlement_test_driver_bank";
cfg.storage.type = "local";
const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { User } = await import("../src/models/User.js");
const { Vehicle, VehicleHistory } = await import("../src/models/Vehicle.js");
const { Driver, DriverHistory } = await import("../src/models/Driver.js");
const { TrackingProject } = await import("../src/models/TrackingProject.js");
const { TrackingVehicle } = await import("../src/models/TrackingVehicle.js");
const { Budget } = await import("../src/models/Budget.js");
const { VehicleAllotment, AllotmentEvent } = await import("../src/models/VehicleAllotment.js");
const { validateChangeDriver } = await import("../src/services/allotmentDriver.service.js");
const { parseTravelDeduction, validateBank, maskAccount } = await import("../src/validators/driverBank.validator.js");
const { addDays, todayYmd } = await import("../src/validators/vehicle.validator.js");

const today = todayYmd();
const d = (n: number) => addDays(today, n);

let server: Server;
let base = "";
{
  await connectDB();
  assert.match(mongoose.connection.name, /_test_/, "refusing to drop a non-test database");
  await mongoose.connection.dropDatabase();
  await Promise.all([User.init(), Vehicle.init(), VehicleHistory.init(), Driver.init(), DriverHistory.init(), TrackingProject.init(), TrackingVehicle.init(), Budget.init(), VehicleAllotment.init(), AllotmentEvent.init()]);
  await seedUsers();
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
}
const call = async (path: string, method = "GET", body?: unknown, token?: string) => {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as { success: boolean; message: string; data: any } };
};
const login = async (role: string, u: string, p: string) => (await call("/auth/login", "POST", { role, username: u, password: p })).body.data.token as string;
let tk: { rbp: string; rsop: string; rsom: string } | undefined;
const T = async () => (tk ??= { rbp: await login("RBP", "RBP", "123123"), rsop: await login("RSOP", "RSOP", "pass2"), rsom: await login("RSOM", "RSOM", "pass3") });
const rbp = async () => (await T()).rbp;

// ---- fixtures
let seq = 0;
const mkVehicle = async () => {
  const r = await call("/vehicles", "POST", {
    vehicleNo: `TN${20 + (seq % 70)}ZD${2000 + seq++}`, make: "Tata", model: "Ace", type: "Dynamic", yearOfManufacture: 2022, purchaseDate: "2022-06-15", currentRunning: 1, totalRunning: 2,
    fc: [], insurance: [], rtoPermission: [], policePermission: [], permit: [], availability: { status: "AVAILABLE" },
  }, await rbp());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data as any;
};
let phone = 8000000000;
let dseq = 0;
const NAMES = ["Arun", "Balu", "Chandru", "Dinesh", "Elango", "Fazil", "Gopi", "Hari", "Imran", "Jeeva", "Karthi", "Lokesh", "Manoj", "Naveen", "Om", "Prakash", "Qadir", "Ravi", "Siva", "Tamil", "Uday", "Vijay", "Wasim", "Xavier", "Yogi", "Zakir"];
const mkDriver = async (availability: unknown = { status: "AVAILABLE" }, over: Record<string, unknown> = {}) => {
  const r = await call("/drivers", "POST", { driverName: `${NAMES[dseq % 26]} ${NAMES[(dseq++ * 7 + 3) % 26]}`.replace(/\d/g, ""), driverType: dseq % 2 ? "COMPANY_DRIVER" : "ACTING_DRIVER", mobileNumber: String(phone++), availability, ...over }, await rbp());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data as any;
};
const budgetNo = (() => { let n = 0; return () => `BUD-AD-${++n}`; })();
// several approved projects: the pool of project vehicles (trackup numbers) the tests draw from
const pool: any[] = [];
const projects: any[] = [];
for (let k = 0; k < 4; k++) {
  const t = await T();
  const r = await call("/tracking", "POST", { projectType: "SIGNAGE", details: { client: "Delta Foods", jobSheetNumber: "ZZAD-" + k, location: "Salem", date: d(0), fromDate: d(2), toDate: d(20), numberOfVehicles: 20 } }, t.rsop);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const proj = r.body.data;
  projects.push(proj);
  pool.push(...proj.vehicles);
  for (const tv of proj.vehicles) await Budget.create({ budgetNumber: budgetNo(), vehicle: tv._id, project: proj._id, data: {}, total: 1000, currentVersion: 1, approvalStatus: "APPROVED", approvedVersion: 1, createdBy: "RBP", updatedBy: "RBP" });
}
const proj = { vehicles: pool };
let pn = 0;
const nextTrk = () => proj.vehicles[pn++].trackupNumber as string;
const sched = (over: Record<string, unknown> = {}) => ({ expectedReleaseDate: d(3), expectedReleaseTime: "20:00", nextAvailableDate: d(4), nextAvailableTime: "09:00", ...over });
const allot = async (vehicleId: string, driverId?: string | null, over: Record<string, unknown> = {}) =>
  call("/vehicle-allotments", "POST", { vehicleId, trackupNumber: nextTrk(), ...sched(), ...(driverId === undefined ? {} : { driverId }), ...over }, await rbp());
const drv = async (id: string) => (await Driver.findById(id).lean()) as any;
const alt = async (id: string) => (await VehicleAllotment.findById(id).lean()) as any;
const events = async (id: string) => (await AllotmentEvent.find({ allotment: id }).sort({ createdAt: 1, _id: 1 }).lean()) as any[];
const dHist = async (id: string) => (await DriverHistory.find({ driver: id }).sort({ createdAt: 1, _id: 1 }).lean()) as any[];
const att = (name: string) => ({ storage: "local", key: `driver_settlement/vehicles/2026/123e4567-e89b-12d3-a456-426614174000-${name}`, name, size: 1234, mimeType: "application/pdf" });
const keys = (b: any) => Object.keys(b).sort();


const BANK = { accountName: "Murugan K", bankName: "State Bank of India", accountNumber: "123456789012", ifscCode: "SBIN0001234" };
const bankDriver = (over: Record<string, unknown> = {}) => mkDriver({ status: "AVAILABLE" }, { ...BANK, ...over });
const bankOf = async (id: string) => { const x = await drv(id); return { accountName: x.accountName ?? null, bankName: x.bankName ?? null, accountNumber: x.accountNumber ?? null, ifscCode: x.ifscCode ?? null }; };
const bankPath = (a: string, d: string) => `/vehicle-allotments/${a}/drivers/${d}/bank`;
const newAllotment = async () => (await allot((await mkVehicle())._id)).body.data;

// ================================================================== pure
test("travel amount deduction: digits with up to 2 decimals; empty = 0; letters, signs, separators, negatives rejected", () => {
  for (const [raw, v] of [[undefined, 0], [null, 0], ["", 0], ["  ", 0], ["0", 0], [0, 0], ["500", 500], [500, 500], ["500.5", 500.5], ["250.50", 250.5], [12.34, 12.34], ["0.01", 0.01], ["9999999.99", 9999999.99]] as const) {
    assert.deepEqual(parseTravelDeduction(raw), { error: null, value: v }, String(raw));
  }
  for (const bad of ["abc", "5a", "a5", "₹500", "1,000", "5e2", "0x10", "--5", "5.", ".5", "5..5", " 5 5", "NaN", "Infinity", "1.234", "10000000", {}, [], true]) assert.notEqual(parseTravelDeduction(bad).error, null, JSON.stringify(bad));
  assert.match(parseTravelDeduction("-5").error!, /cannot be negative/);
  assert.match(parseTravelDeduction(-5).error!, /cannot be negative/);
  assert.match(parseTravelDeduction(Number.NaN).error!, /must be a number/);
  assert.match(parseTravelDeduction(1.234).error!, /2 decimal/);
  assert.match(parseTravelDeduction("abc").error!, /digits only/);
});

test("bank validation: every field optional, same rules as Driver Management; account number masked", () => {
  assert.deepEqual(validateBank({}).errors, []);
  assert.deepEqual(validateBank(BANK).data, BANK);
  assert.deepEqual(validateBank({ accountName: "  ", bankName: "", accountNumber: "", ifscCode: "" }).data, { accountName: null, bankName: null, accountNumber: null, ifscCode: null });
  assert.equal(validateBank({ ifscCode: "sbin0001234" }).data?.ifscCode, "SBIN0001234");
  assert.ok(validateBank({ accountNumber: "12345" }).errors.some((e) => /6 to 20 digits/.test(e)));
  assert.ok(validateBank({ accountNumber: "12ab56789" }).errors.length > 0);
  assert.ok(validateBank({ ifscCode: "SBIN1234" }).errors.some((e) => /IFSC/.test(e)));
  assert.ok(validateBank({ accountName: "<b>x</b>" }).errors.some((e) => /invalid characters/.test(e)));
  assert.ok(validateBank({ bankName: "x".repeat(81) }).errors.some((e) => /too long/.test(e)));
  assert.equal(maskAccount("123456789012"), "XXXXXXXX9012");
  assert.equal(maskAccount("1234"), "XXXX");
  assert.equal(maskAccount(null), null);
  const v = validateChangeDriver({ driverId: "b".repeat(24), reason: "ill", travelAmountDeduction: "500" });
  assert.equal(v.data?.travelAmountDeduction, 500);
  assert.equal(validateChangeDriver({ driverId: "b".repeat(24), reason: "ill" }).data?.travelAmountDeduction, 0); // existing requests keep working
  assert.ok(validateChangeDriver({ driverId: "b".repeat(24), reason: "ill", travelAmountDeduction: "abc" }).errors.some((e) => /digits only/.test(e)));
  assert.ok(validateChangeDriver({ driverId: "b".repeat(24), travelAmountDeduction: "5" }).errors.includes("Change reason is required"));
});

// ================================================================== fetch bank details
test("fetch: the selected driver's saved bank details load (full for editing, masked for display); missing bank handled; RBP only", async () => {
  const t = await rbp();
  const d = await bankDriver();
  const r = await call(`/vehicle-allotments/drivers/${d._id}/bank`, "GET", undefined, t);
  assert.equal(r.status, 200);
  assert.deepEqual(keys(r.body), ["data", "message", "success"]);
  assert.deepEqual([r.body.data.accountName, r.body.data.bankName, r.body.data.accountNumber, r.body.data.ifscCode], ["Murugan K", "State Bank of India", "123456789012", "SBIN0001234"]);
  assert.equal(r.body.data.accountNumberMasked, "XXXXXXXX9012");
  assert.equal(r.body.data.hasBankDetails, true);
  assert.equal(r.body.data.driverId, d._id);
  assert.equal(r.body.data.driverNumber, d.driverNumber);
  const none = await mkDriver();
  const n = await call(`/vehicle-allotments/drivers/${none._id}/bank`, "GET", undefined, t);
  assert.equal(n.status, 200);
  assert.deepEqual([n.body.data.accountName, n.body.data.bankName, n.body.data.accountNumber, n.body.data.ifscCode, n.body.data.hasBankDetails, n.body.data.accountNumberMasked], [null, null, null, null, false, null]);
  assert.equal((await call("/vehicle-allotments/drivers/zzz/bank", "GET", undefined, t)).status, 400);
  const nf = await call(`/vehicle-allotments/drivers/${"0".repeat(24)}/bank`, "GET", undefined, t);
  assert.equal(nf.status, 404);
  assert.equal(nf.body.data, null);
  const tk2 = await T();
  assert.equal((await call(`/vehicle-allotments/drivers/${d._id}/bank`)).status, 401);
  assert.equal((await call(`/vehicle-allotments/drivers/${d._id}/bank`, "GET", undefined, tk2.rsop)).status, 403);
  assert.equal((await call(bankPath("a".repeat(24), d._id), "PUT", BANK, tk2.rsom)).status, 403);
  const search = await call(`/vehicle-allotments/drivers?q=${d.driverNumber}`, "GET", undefined, t);
  assert.ok(!JSON.stringify(search.body).includes("123456789012")); // suggestions never carry bank details
});

// ================================================================== edit during assignment
test("edit during assignment: updates only the selected driver, records masked history, leaves everything else on the driver untouched", async () => {
  const t = await rbp();
  const a = await newAllotment();
  const d = await bankDriver();
  const other = await bankDriver({ accountName: "Other Person", accountNumber: "999988887777" });
  const before = await drv(d._id);
  const r = await call(bankPath(a._id, d._id), "PUT", { ...BANK, accountNumber: "555566667777", ifscCode: "hdfc0004321", bankName: "HDFC Bank" }, t);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(keys(r.body), ["data", "message", "success"]);
  assert.equal(r.body.message, "Driver bank details updated successfully");
  assert.deepEqual([r.body.data.bankName, r.body.data.accountNumber, r.body.data.ifscCode, r.body.data.accountNumberMasked], ["HDFC Bank", "555566667777", "HDFC0004321", "XXXXXXXX7777"]);
  const after = await drv(d._id);
  assert.deepEqual(await bankOf(d._id), { accountName: "Murugan K", bankName: "HDFC Bank", accountNumber: "555566667777", ifscCode: "HDFC0004321" });
  assert.deepEqual([after.driverName, after.driverNumber, after.mobileNumber, after.driverType, after.availability.status, after.licenceNumber ?? null], [before.driverName, before.driverNumber, before.mobileNumber, before.driverType, "AVAILABLE", before.licenceNumber ?? null]);
  assert.equal(after.updatedBy, "RBP");
  assert.deepEqual(await bankOf(other._id), { accountName: "Other Person", bankName: "State Bank of India", accountNumber: "999988887777", ifscCode: "SBIN0001234" }); // another driver is never touched
  const h = (await dHist(d._id)).filter((x) => x.action === "BANK_UPDATED");
  assert.equal(h.length, 1);
  const byField = Object.fromEntries(h[0].changes.map((c: any) => [c.field, c]));
  assert.deepEqual([byField.bankName.from, byField.bankName.to], ["State Bank of India", "HDFC Bank"]); // previous values preserved
  assert.deepEqual([byField.accountNumber.from, byField.accountNumber.to], ["XXXXXXXX9012", "XXXXXXXX7777"]); // masked in history
  assert.deepEqual([byField.ifscCode.from, byField.ifscCode.to], ["SBIN0001234", "HDFC0004321"]);
  assert.ok(!byField.accountName); // unchanged fields are not listed
  assert.equal(h[0].username, "RBP");
  assert.match(h[0].reason, /during driver assignment/);
  assert.ok(!JSON.stringify(h).includes("123456789012") && !JSON.stringify(h).includes("555566667777"));
  assert.equal((await dHist(other._id)).filter((x) => x.action === "BANK_UPDATED").length, 0);
  const ev = (await events(a._id)).filter((e) => e.action === "DRIVER_BANK_UPDATED");
  assert.equal(ev.length, 1);
  assert.equal(ev[0].details.driverNumber, d.driverNumber);
  assert.ok(!JSON.stringify(ev).includes("555566667777"));
  const same = await call(bankPath(a._id, d._id), "PUT", { ...BANK, accountNumber: "555566667777", ifscCode: "HDFC0004321", bankName: "HDFC Bank" }, t);
  assert.equal(same.status, 400);
  assert.equal(same.body.message, "No changes to save");
  assert.equal((await dHist(d._id)).filter((x) => x.action === "BANK_UPDATED").length, 1); // nothing logged for a no-op
});

test("edit: missing bank details can be entered; clearing a field is possible; invalid input is rejected and nothing is saved", async () => {
  const t = await rbp();
  const a = await newAllotment();
  const d = await mkDriver(); // no bank details
  const add = await call(bankPath(a._id, d._id), "PUT", BANK, t);
  assert.equal(add.status, 200, JSON.stringify(add.body));
  assert.deepEqual(await bankOf(d._id), BANK);
  const h = (await dHist(d._id)).filter((x) => x.action === "BANK_UPDATED")[0];
  assert.ok(h.changes.every((c: any) => c.from === null)); // previously empty
  const clear = await call(bankPath(a._id, d._id), "PUT", { ...BANK, accountNumber: "", ifscCode: "" }, t);
  assert.equal(clear.status, 200);
  assert.deepEqual(await bankOf(d._id), { ...BANK, accountNumber: null, ifscCode: null });
  const snap = await bankOf(d._id);
  for (const bad of [{ accountNumber: "12" }, { accountNumber: "12ab5678" }, { ifscCode: "BAD" }, { accountName: "<x>" }, { bankName: "y".repeat(81) }, { accountNumber: 5 as any, ifscCode: ["x"] as any }]) {
    const r = await call(bankPath(a._id, d._id), "PUT", { ...BANK, ...bad }, t);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.body.data, null);
  }
  assert.deepEqual(await bankOf(d._id), snap);
});

test("edit: only the allotment's current driver or an assignable driver; closed allotment, in-use / unknown driver refused", async () => {
  const t = await rbp();
  const a = await newAllotment();
  const busyAllot = await newAllotment();
  const busy = await bankDriver();
  await call(`/vehicle-allotments/${busyAllot._id}/assign-driver`, "POST", { driverId: busy._id }, t);
  const r = await call(bankPath(a._id, busy._id), "PUT", { ...BANK, bankName: "Other Bank" }, t); // busy on ANOTHER allotment
  assert.equal(r.status, 409);
  assert.match(r.body.message, /already in use/);
  assert.equal((await bankOf(busy._id)).bankName, "State Bank of India");
  const own = await call(bankPath(busyAllot._id, busy._id), "PUT", { ...BANK, bankName: "Own Bank" }, t); // the current driver of that allotment: editable
  assert.equal(own.status, 200, JSON.stringify(own.body));
  const na = await mkDriver({ status: "NOT_AVAILABLE", notAvailable: { reason: "Leave", category: "Personal Leave" } });
  assert.equal((await call(bankPath(a._id, na._id), "PUT", BANK, t)).status, 409);
  assert.equal((await call(bankPath(a._id, "0".repeat(24)), "PUT", BANK, t)).status, 404);
  assert.equal((await call(bankPath("0".repeat(24), busy._id), "PUT", BANK, t)).status, 404);
  assert.equal((await call(bankPath("zzz", busy._id), "PUT", BANK, t)).status, 400);
  await call(`/vehicle-allotments/${a._id}/release`, "POST", {}, t);
  const free = await bankDriver();
  assert.equal((await call(bankPath(a._id, free._id), "PUT", { ...BANK, bankName: "Late Bank" }, t)).status, 409); // closed allotment
});

test("assign driver: with or without bank details; the assignment records a masked bank snapshot that later edits never change", async () => {
  const t = await rbp();
  const a = await newAllotment();
  const d = await bankDriver();
  await call(bankPath(a._id, d._id), "PUT", { ...BANK, bankName: "Edited Bank" }, t); // edited during the assignment
  const r = await call(`/vehicle-allotments/${a._id}/assign-driver`, "POST", { driverId: d._id }, t);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const ev = (await events(a._id)).find((e) => e.action === "DRIVER_ASSIGNED");
  assert.deepEqual(ev.details.bank, { accountName: "Murugan K", bankName: "Edited Bank", accountNumberMasked: "XXXXXXXX9012", ifscCode: "SBIN0001234", hasBankDetails: true });
  await call(bankPath(a._id, d._id), "PUT", { ...BANK, bankName: "Changed Later" }, t); // current driver: a later edit
  const ev2 = (await events(a._id)).find((e) => e.action === "DRIVER_ASSIGNED");
  assert.equal(ev2.details.bank.bankName, "Edited Bank"); // history snapshot is immutable
  assert.ok(!JSON.stringify(await events(a._id)).includes("123456789012"));
  const b = await newAllotment();
  const nobank = await mkDriver();
  assert.equal((await call(`/vehicle-allotments/${b._id}/assign-driver`, "POST", { driverId: nobank._id }, t)).status, 200); // bank is not required
  const ev3 = (await events(b._id)).find((e) => e.action === "DRIVER_ASSIGNED");
  assert.equal(ev3.details.bank.hasBankDetails, false);
  assert.equal(ev3.details.bank.accountNumberMasked, null);
});

// ================================================================== change driver
test("change driver: replacement's own bank details, never the previous driver's; edit saved against the replacement only; snapshots in history", async () => {
  const t = await rbp();
  const d1 = await bankDriver({ accountName: "First Fazil", accountNumber: "111122223333", ifscCode: "SBIN0001111", bankName: "SBI" });
  const d2 = await bankDriver({ accountName: "Second Siva", accountNumber: "444455556666", ifscCode: "ICIC0002222", bankName: "ICICI" });
  const a = (await allot((await mkVehicle())._id, d1._id)).body.data;
  assert.equal((await call(`/vehicle-allotments/drivers/${d2._id}/bank`, "GET", undefined, t)).body.data.bankName, "ICICI"); // replacement's saved bank loads
  const edit = await call(bankPath(a._id, d2._id), "PUT", { accountName: "Second Siva", bankName: "ICICI Bank", accountNumber: "444455556666", ifscCode: "ICIC0002222" }, t);
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  const r = await call(`/vehicle-allotments/${a._id}/change-driver`, "POST", { driverId: d2._id, reason: "Driver fell ill", travelAmountDeduction: "500" }, t);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(await bankOf(d1._id), { accountName: "First Fazil", bankName: "SBI", accountNumber: "111122223333", ifscCode: "SBIN0001111" }); // previous driver's record intact
  assert.deepEqual(await bankOf(d2._id), { accountName: "Second Siva", bankName: "ICICI Bank", accountNumber: "444455556666", ifscCode: "ICIC0002222" }); // replacement keeps its own
  const ev = (await events(a._id)).find((e) => e.action === "DRIVER_CHANGED");
  assert.equal(ev.details.travelAmountDeduction, 500);
  assert.deepEqual(ev.details.fromBank, { accountName: "First Fazil", bankName: "SBI", accountNumberMasked: "XXXXXXXX3333", ifscCode: "SBIN0001111", hasBankDetails: true });
  assert.deepEqual(ev.details.toBank, { accountName: "Second Siva", bankName: "ICICI Bank", accountNumberMasked: "XXXXXXXX6666", ifscCode: "ICIC0002222", hasBankDetails: true });
  assert.equal(ev.details.reason, "Driver fell ill");
  assert.equal(ev.details.from.driverNumber, d1.driverNumber);
  assert.equal(ev.details.to.driverNumber, d2.driverNumber);
  assert.equal(ev.username, "RBP");
  assert.ok(ev.createdAt);
  assert.ok(!JSON.stringify(await events(a._id)).match(/111122223333|444455556666/));
  const rel = (await dHist(d1._id)).filter((x) => x.action === "STATUS_CHANGED").pop();
  assert.match(rel.reason, /travel amount deduction 500/);
  await call(bankPath(a._id, d2._id), "PUT", { accountName: "Second Siva", bankName: "Another", accountNumber: "444455556666", ifscCode: "ICIC0002222" }, t); // later edit
  assert.equal((await events(a._id)).find((e) => e.action === "DRIVER_CHANGED").details.toBank.bankName, "ICICI Bank"); // history unchanged
  assert.equal((await dHist(d1._id)).filter((x) => x.action === "BANK_UPDATED").length, 0);
  const detail = (await call(`/vehicle-allotments/${a._id}`, "GET", undefined, t)).body.data;
  assert.equal(detail.events.find((e: any) => e.action === "DRIVER_CHANGED").details.travelAmountDeduction, 500);
});

test("change driver: deduction defaults to 0, accepts decimals, zero and plain numbers; reason still mandatory; attachment still optional", async () => {
  const t = await rbp();
  const mk = async () => { const d = await bankDriver(); return (await allot((await mkVehicle())._id, d._id)).body.data; };
  const cases: [any, number][] = [[undefined, 0], ["", 0], ["0", 0], [0, 0], ["250.50", 250.5], [1200, 1200], ["75", 75]];
  for (const [val, expected] of cases) {
    const a = await mk();
    const next = await bankDriver();
    const body: any = { driverId: next._id, reason: "swap" };
    if (val !== undefined) body.travelAmountDeduction = val;
    const r = await call(`/vehicle-allotments/${a._id}/change-driver`, "POST", body, t);
    assert.equal(r.status, 200, JSON.stringify([val, r.body]));
    assert.equal((await events(a._id)).find((e) => e.action === "DRIVER_CHANGED").details.travelAmountDeduction, expected, String(val));
  }
  const a = await mk();
  const next = await bankDriver();
  const noReason = await call(`/vehicle-allotments/${a._id}/change-driver`, "POST", { driverId: next._id, travelAmountDeduction: "100" }, t);
  assert.equal(noReason.status, 400);
  assert.match(noReason.body.message, /Change reason is required/);
  const withAtt = await call(`/vehicle-allotments/${a._id}/change-driver`, "POST", { driverId: next._id, reason: "swap", travelAmountDeduction: "100", attachments: [att("proof.pdf")] }, t);
  assert.equal(withAtt.status, 200, JSON.stringify(withAtt.body));
  const ev = (await events(a._id)).find((e) => e.action === "DRIVER_CHANGED");
  assert.equal(ev.details.attachments[0].name, "proof.pdf");
  assert.equal(ev.details.travelAmountDeduction, 100);
});

test("change driver: letters, symbols and negative deductions are rejected and nothing changes", async () => {
  const t = await rbp();
  const d1 = await bankDriver();
  const d2 = await bankDriver();
  const a = (await allot((await mkVehicle())._id, d1._id)).body.data;
  for (const bad of ["abc", "5a", "₹500", "1,000", "-5", -5, "5e2", "1.234", "99999999", "  x "]) {
    const r = await call(`/vehicle-allotments/${a._id}/change-driver`, "POST", { driverId: d2._id, reason: "swap", travelAmountDeduction: bad }, t);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.body.success, false);
    assert.equal(r.body.data, null);
  }
  assert.equal(String((await alt(a._id)).activeDriver), d1._id);
  assert.equal((await drv(d2._id)).availability.status, "AVAILABLE");
  assert.equal((await events(a._id)).filter((e) => e.action === "DRIVER_CHANGED").length, 0);
});

test("change driver: a failed replacement keeps the allocation and records no deduction", async () => {
  const t = await rbp();
  const d1 = await bankDriver();
  const a = (await allot((await mkVehicle())._id, d1._id)).body.data;
  const busy = await bankDriver();
  await allot((await mkVehicle())._id, busy._id);
  const r = await call(`/vehicle-allotments/${a._id}/change-driver`, "POST", { driverId: busy._id, reason: "swap", travelAmountDeduction: "500" }, t);
  assert.equal(r.status, 409);
  assert.equal(String((await alt(a._id)).activeDriver), d1._id);
  assert.equal((await drv(d1._id)).availability.status, "IN_USE");
  assert.deepEqual(await bankOf(d1._id), BANK);
  assert.equal((await events(a._id)).filter((e) => e.action === "DRIVER_CHANGED").length, 0);
  // a race lost at the allotment switch: replacement restored, deduction not recorded
  const d2 = await bankDriver();
  const orig = VehicleAllotment.findOneAndUpdate.bind(VehicleAllotment);
  (VehicleAllotment as any).findOneAndUpdate = () => ({ lean: async () => { (VehicleAllotment as any).findOneAndUpdate = orig; return null; } });
  let r2: any;
  try {
    r2 = await call(`/vehicle-allotments/${a._id}/change-driver`, "POST", { driverId: d2._id, reason: "swap", travelAmountDeduction: "300" }, t);
  } finally {
    (VehicleAllotment as any).findOneAndUpdate = orig;
  }
  assert.equal(r2.status, 409);
  assert.equal((await drv(d2._id)).availability.status, "AVAILABLE");
  assert.equal((await events(a._id)).filter((e) => e.action === "DRIVER_CHANGED").length, 0);
});

// ================================================================== regression
test("regression: vehicle-only, vehicle + driver, assign later, change driver (old request shape) and driver availability still work", async () => {
  const t = await rbp();
  const v1 = await allot((await mkVehicle())._id);
  assert.equal(v1.status, 201);
  assert.equal(v1.body.data.driver, undefined);
  const d1 = await mkDriver(); // a driver with no bank details at all
  const both = await allot((await mkVehicle())._id, d1._id);
  assert.equal(both.status, 201, JSON.stringify(both.body));
  assert.equal((await drv(d1._id)).availability.status, "IN_USE");
  const later = await call(`/vehicle-allotments/${v1.body.data._id}/assign-driver`, "POST", { driverId: (await mkDriver())._id }, t);
  assert.equal(later.status, 200);
  const d3 = await mkDriver();
  const chg = await call(`/vehicle-allotments/${both.body.data._id}/change-driver`, "POST", { driverId: d3._id, reason: "swap" }, t); // no deduction field: exactly the old request
  assert.equal(chg.status, 200, JSON.stringify(chg.body));
  assert.equal((await drv(d1._id)).availability.status, "AVAILABLE");
  assert.equal((await drv(d3._id)).availability.status, "IN_USE");
  assert.equal((await events(both.body.data._id)).find((e) => e.action === "DRIVER_CHANGED").details.travelAmountDeduction, 0);
  // Driver Management bank data of untouched drivers stays intact, and its own CRUD still saves bank details
  const keep = await bankDriver();
  const cur = (await call(`/drivers/${keep._id}`, "GET", undefined, t)).body.data;
  assert.deepEqual([cur.accountName, cur.accountNumber, cur.ifscCode, cur.bankName], [BANK.accountName, BANK.accountNumber, BANK.ifscCode, BANK.bankName]);
  const up = await call(`/drivers/${keep._id}`, "PUT", { driverName: cur.driverName, driverType: cur.driverType, mobileNumber: cur.mobileNumber, bankName: "Via Driver Management" }, t);
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal((await drv(keep._id)).bankName, "Via Driver Management");
  for (const p of ["/vehicle-allotments", "/vehicle-allotments/projects", "/vehicle-allotments/drivers", "/drivers", "/vehicles"]) {
    const r = await call(p, "GET", undefined, t);
    assert.equal(r.status, 200, p);
    assert.deepEqual(keys(r.body), ["data", "message", "success"], p);
  }
});

test("cleanup", async () => {
  assert.match(mongoose.connection.name, /_test_/);
  await mongoose.connection.dropDatabase();
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
});
