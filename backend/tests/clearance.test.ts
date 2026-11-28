/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.ROADSHOW = "on";
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_clearance";
process.env.JWT_SECRET = "test-secret";
process.env.RSOP_USERNAME = "RSOP";
process.env.RSOP_PASSWORD = "pass2";
process.env.RBP_USERNAME = "RBP";
process.env.RBP_PASSWORD = "123123";
process.env.RSOM_USERNAME = "RSOM";
process.env.RSOM_PASSWORD = "pass3";
process.env.RSA_USERNAME = "RSA";
process.env.RSA_PASSWORD = "pass4";
process.env.STORAGE_TYPE = "local";

import { perVehicleTrackups } from "./legacyNumbers.js";
import test from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import mongoose from "mongoose";

// SAFETY: modules are imported dynamically after the config points at the throw-away test database.
const { config: cfg } = await import("../src/config/index.js");
cfg.mongoUri = "mongodb://127.0.0.1:27017/driver_settlement_test_clearance";
cfg.storage.type = "local";
// uploads of this test go to a throw-away folder, never into backend/public
cfg.storage.localDir = (await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(), "ds-clearance-test-"));
const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { User } = await import("../src/models/User.js");
const { Vehicle } = await import("../src/models/Vehicle.js");
const { Driver } = await import("../src/models/Driver.js");
const { DriverAdvance } = await import("../src/models/DriverAdvance.js");
const { TrackingProject } = await import("../src/models/TrackingProject.js");
const { TrackingVehicle } = await import("../src/models/TrackingVehicle.js");
const { Budget, BudgetVersion } = await import("../src/models/Budget.js");
const { VehicleAllotment, AllotmentEvent } = await import("../src/models/VehicleAllotment.js");
const { RsaPayment, Counter } = await import("../src/models/RsaPayment.js");
const { addDays, todayYmd } = await import("../src/validators/vehicle.validator.js");

const today = todayYmd();
const d = (n: number) => addDays(today, n);

let server: Server;
let base = "";
{
  await connectDB();
  assert.match(mongoose.connection.name, /_test_/, "refusing to drop a non-test database");
  await mongoose.connection.dropDatabase();
  await Promise.all([User.init(), Vehicle.init(), Driver.init(), DriverAdvance.init(), TrackingProject.init(), TrackingVehicle.init(), Budget.init(), BudgetVersion.init(), VehicleAllotment.init(), AllotmentEvent.init(), RsaPayment.init(), Counter.init()]);
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
let tk: Record<"rbp" | "rsop" | "rsom" | "rsa", string> | undefined;
const { verifyAdvances } = await import("../src/utils/advanceVerification.js");
const { Clearance, ClearanceEvent } = await import("../src/models/Clearance.js");
const { Notification } = await import("../src/models/Approval.js");
const { settlementSource, syncClearances } = await import("../src/services/clearance.service.js");
const T = async () => (tk ??= { rbp: await login("RBP", "RBP", "123123"), rsop: await login("RSOP", "RSOP", "pass2"), rsom: await login("RSOM", "RSOM", "pass3"), rsa: await login("RSA", "RSA", "pass4") });
const keys = (b: any) => Object.keys(b).sort();
const rsa = async (path: string, method = "GET", body?: unknown) => call(`/rsa-clearances${path}`, method, body, (await T()).rsa);
const rbp = async (path: string, method = "GET", body?: unknown) => call(`/on-road-vehicles${path}`, method, body, (await T()).rbp);

// ---- fixtures (all created through the real APIs / models)
let seq = 0;
const mkVehicle = async () => {
  const r = await call("/vehicles", "POST", {
    vehicleNo: `TN${30 + (seq % 60)}CL${4000 + seq++}`, make: "Tata", model: "Ace", type: "Dynamic", yearOfManufacture: 2022, purchaseDate: "2022-06-15", currentRunning: 1, totalRunning: 2,
    fc: [], insurance: [], rtoPermission: [], policePermission: [], permit: [], availability: { status: "AVAILABLE" },
  }, (await T()).rbp);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data as any;
};
let phone = 9400000000;
const mkDriver = async (name: string) => {
  const r = await call("/drivers", "POST", {
    driverName: name, driverType: "COMPANY_DRIVER", mobileNumber: String(phone++), salary: 400, accountName: name, accountNumber: "123456789012", ifscCode: "SBIN0001234", bankName: "SBI", availability: { status: "AVAILABLE" },
  }, (await T()).rbp);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data as any;
};
const bn = (() => { let n = 0; return () => `BUD-CL-${++n}`; })();
const mkBudget = (tv: any, proj: any, state: Record<string, unknown> = { approvalStatus: "APPROVED", approvedVersion: 1 }) =>
  Budget.create({ budgetNumber: bn(), vehicle: tv._id, project: proj._id, data: { foodAmount: 100 }, total: 90000, currentVersion: 1, createdBy: "RBP", updatedBy: "RBP", reviewedBy: "RSOM", reviewedAt: new Date(), ...state });
const mkProject = async (body: unknown) => {
  const r = await call("/tracking", "POST", body, (await T()).rsop);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return perVehicleTrackups<any>(r.body.data);
};
const sched = { expectedReleaseDate: d(3), expectedReleaseTime: "20:00", nextAvailableDate: d(4), nextAvailableTime: "09:00" };
const allotTo = async (tvx: any, driver?: any) => {
  const v = await mkVehicle();
  const r = await call("/vehicle-allotments", "POST", { vehicleId: v._id, pifNumber: tvx.pifNumber, ...sched, ...(driver ? { driverId: driver._id } : {}) }, (await T()).rbp);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { vehicle: v, allotment: r.body.data };
};
const addAdvance = (drv: any, amount = 5000) =>
  DriverAdvance.create({ driver: drv._id, driverNumber: drv.driverNumber, driverName: drv.driverName, workingDays: 25, perDaySalary: 400, eligibleAdvanceAmount: 10000, calculatedHalfAmount: 5000, finalAdvanceAmount: amount, roundingUnit: 100, roundingMethod: "ROUND", submittedBy: "RBP", submittedAt: new Date(), idempotencyKey: `k-${Math.random().toString(36).slice(2, 12)}` });
const clr = async (tvx: any) => (await Clearance.findOne({ trackingVehicle: tvx._id }).lean()) as any;
const rsaUser: any = await User.findOne({ role: "RSA" }).lean();
const rbpUser: any = await User.findOne({ role: "RBP" }).lean();
const notes = (user: any, type: string) => Notification.find({ recipient: user._id, type }).lean() as Promise<any[]>;

const sig = await mkProject({ projectType: "SIGNAGE", details: { projectCode: "15000001", client: "Kensign Lifestyles", jobSheetNumber: "ZZCL-1", location: "Coimbatore", date: d(0), fromDate: d(0), toDate: d(9), numberOfVehicles: 10, vehicleTypes: [{ code: "CENTRE_NO_ROOF", quantity: 10 }] } });
const road = await mkProject({ projectType: "ROADSHOW", details: { projectCode: "15000002", billingName: "Ken Roadshow Pvt", stateCode: "33", startDate: d(0), endDate: d(8), reportingDate: d(3), sundayHalt: "NO", numberOfVans: 2, vehicleTypes: [{ code: "CENTRE_NO_ROOF", quantity: 2 }], reportingLocations: ["Chennai", "Trichy"] } });
const [A, C, D, E, F, G] = sig.vehicles.slice(0, 6);
void D; void G;
const B = road.vehicles[0];
for (const x of [A, C, D, E, F, G]) await mkBudget(x, sig);
await mkBudget(B, road);
const drvA = await mkDriver("Sampath Madhu"); // clean driver (no advance)
const drvB = await mkDriver("Karthik Raja");
await addAdvance(drvB, 5000); // advance on record, no settlement source
const alA = await allotTo(A, drvA); // eligible
const alB = await allotTo(B, drvB); // eligible, driver has an advance
const alC = await allotTo(C); // vehicle only: not eligible
await allotTo(E, await mkDriver("Pending Budget Driver"));
await Budget.updateOne({ vehicle: E._id }, { $set: { approvalStatus: "PENDING" } }); // budget no longer approved
await allotTo(F, await mkDriver("Rejected Budget Driver"));
await Budget.updateOne({ vehicle: F._id }, { $set: { approvalStatus: "REJECTED" } });
// E / F were cleared while their budget was still approved; drop those rows so the test can show that unapproved budgets are never picked up by a sync
await Clearance.deleteMany({ trackingVehicle: { $in: [E._id, F._id] } });
await Notification.deleteMany({ "meta.trackupNumber": { $in: [E.trackupNumber, F.trackupNumber] } });
const alAClearance = await clr(A);
assert.ok(alAClearance, "clearance created when the driver was assigned");

// ================================================================== financial verification (pure)
test("verifyAdvances: no advance, settled, partly settled, outstanding, multiple transactions, unavailable data", () => {
  assert.deepEqual(verifyAdvances([], null), { status: "NO_ADVANCE", totalAdvance: 0, totalSettled: 0, outstanding: 0, canApprove: true, message: "No Outstanding Advance (no advance on record)" });
  const full = verifyAdvances([{ finalAdvanceAmount: 5000 }], [{ amount: 5000 }]);
  assert.deepEqual([full.status, full.outstanding, full.canApprove], ["NO_OUTSTANDING", 0, true]); // a settled advance is not outstanding
  const part = verifyAdvances([{ finalAdvanceAmount: 5000 }], [{ amount: 3000 }]);
  assert.deepEqual([part.status, part.totalAdvance, part.totalSettled, part.outstanding, part.canApprove], ["OUTSTANDING", 5000, 3000, 2000, false]);
  const multi = verifyAdvances([{ finalAdvanceAmount: 1000.1 }, { finalAdvanceAmount: 2000.2 }, { finalAdvanceAmount: 500 }], [{ amount: 1000.1 }, { amount: 700 }]);
  assert.deepEqual([multi.totalAdvance, multi.totalSettled, multi.outstanding], [3500.3, 1700.1, 1800.2]); // paise arithmetic: no float drift
  const none = verifyAdvances([{ finalAdvanceAmount: 5000 }], []); // a settlement source exists, nothing repaid
  assert.deepEqual([none.status, none.outstanding], ["OUTSTANDING", 5000]);
  const over = verifyAdvances([{ finalAdvanceAmount: 1000 }], [{ amount: 1500 }]);
  assert.deepEqual([over.status, over.outstanding], ["NO_OUTSTANDING", 0]);
  for (const bad of [verifyAdvances([{ finalAdvanceAmount: 5000 }], null), verifyAdvances([{ finalAdvanceAmount: NaN }], []), verifyAdvances([{ finalAdvanceAmount: 100 }], [{ amount: -5 }])]) {
    assert.deepEqual([bad.status, bad.outstanding, bad.canApprove], ["UNAVAILABLE", null, false]); // never assumed zero
  }
});

// ================================================================== listing + eligibility
test("an approved clearance whose budget later stops being approved cannot be approved by RSA", async () => {
  const tvx = sig.vehicles[7];
  await mkBudget(tvx, sig);
  await allotTo(tvx, await mkDriver("Budget Flip Driver"));
  const c = await clr(tvx);
  await Budget.updateOne({ vehicle: tvx._id }, { $set: { approvalStatus: "PENDING" } });
  const r = await rsa(`/${c._id}/approve`, "POST", {});
  assert.equal(r.status, 409);
  assert.match(r.body.message, /not approved by RSOM/);
  assert.equal((await rsa(`/${c._id}`)).body.data.canApprove, false);
  await Clearance.deleteOne({ _id: c._id });
  await Notification.deleteMany({ "meta.trackupNumber": tvx.trackupNumber });
});

test("eligible allocations appear as YET_TO_APPROVE; incomplete / unapproved ones are excluded; RSA is notified once", async () => {
  const r = await rsa("?limit=100");
  assert.equal(r.status, 200);
  assert.deepEqual(keys(r.body), ["data", "message", "success"]);
  const tn = r.body.data.items.map((x: any) => x.trackupNumber).sort();
  assert.deepEqual(tn, [A.trackupNumber, B.trackupNumber].sort());
  assert.ok(r.body.data.items.every((x: any) => x.status === "YET_TO_APPROVE" && x.version === 1));
  assert.equal(r.body.data.total, 2);
  for (const x of [C, D, E, F]) assert.equal(await clr(x), null, x.trackupNumber);
  const n = await notes(rsaUser, "CLEARANCE_SUBMITTED");
  assert.equal(n.length, 2); // one per submission, written when the driver was assigned
  assert.match(n[0].message, /waiting for RSA clearance/);
  assert.ok(n.some((x) => x.meta.trackupNumber === A.trackupNumber && x.meta.vehicleNo === alA.vehicle.vehicleNo && x.meta.driverName === "Sampath Madhu" && x.link.startsWith("/rsa/clearance/review?id=")));
  await syncClearances();
  await syncClearances();
  assert.equal((await notes(rsaUser, "CLEARANCE_SUBMITTED")).length, 2); // repeated syncs never duplicate
  assert.equal(await Clearance.countDocuments(), 2);
  const ev = (await ClearanceEvent.find({ clearance: alAClearance._id }).sort({ at: 1, _id: 1 }).lean()) as any[];
  assert.deepEqual(ev.map((e) => [e.version, e.action]), [[1, "ALLOCATED"], [1, "SUBMITTED"]]);
});

test("vehicle-only allotment later gets a driver -> clearance is created at assignment", async () => {
  const drv = await mkDriver("Later Driver");
  const r = await call(`/vehicle-allotments/${alC.allotment._id}/assign-driver`, "POST", { driverId: drv._id }, (await T()).rbp);
  assert.equal(r.status, 200);
  assert.deepEqual(keys(r.body), ["data", "message", "success"]);
  const c = await clr(C);
  assert.equal(c.status, "YET_TO_APPROVE");
  assert.equal(c.driverName, "Later Driver");
  assert.equal(c.submittedBy, "RBP");
});

test("mass search, filters, combined filters, pagination, summary, latest first (RSA and RBP)", async () => {
  const q = async (qs: string) => (await rsa(`?${qs}`)).body.data;
  for (const term of [A.trackupNumber, A.pifNumber, "kensign", alA.vehicle.vehicleNo.toLowerCase(), "sampath", drvA.driverNumber]) {
    const r = await q(`q=${encodeURIComponent(term)}`);
    assert.ok(r.items.some((x: any) => x.trackupNumber === A.trackupNumber), term);
  }
  assert.equal((await q("q=zzz-nothing")).total, 0);
  assert.equal((await q("projectType=ROADSHOW")).items.every((x: any) => x.projectType === "ROADSHOW"), true);
  assert.equal((await q("projectType=ROADSHOW&q=kensign")).total, 0); // filters work together
  assert.equal((await q(`q=${B.trackupNumber}&status=YET_TO_APPROVE&projectType=ROADSHOW`)).total, 1);
  assert.equal((await q(`from=${d(0)}&to=${d(0)}`)).total, 3); // all submitted today (IST)
  assert.equal((await q(`from=${d(1)}`)).total, 0);
  assert.equal((await q(`to=${d(-1)}`)).total, 0);
  const p1 = await q("limit=2&page=1"), p2 = await q("limit=2&page=2");
  assert.equal(p1.items.length, 2);
  assert.equal(p2.items.length, 1);
  assert.equal(p1.total, 3);
  const all = await q("limit=100");
  const times = all.items.map((x: any) => +new Date(x.submittedAt));
  assert.deepEqual(times, [...times].sort((a, b) => b - a)); // latest first
  const s = await rsa("/summary");
  assert.deepEqual(s.body.data, { total: 3, yetToApprove: 3, approved: 0, rejected: 0 });
  const rb = await rbp("?limit=100"); // RBP sees the same submissions
  assert.equal(rb.body.data.total, 3);
  assert.equal((await rbp("/summary")).body.data.total, 3);
});

test("access control: RSA-only review routes, RBP-only On-Road routes, authentication required", async () => {
  const t = await T();
  const cid = String(alAClearance._id);
  assert.equal((await call("/rsa-clearances", "GET")).status, 401);
  assert.equal((await call("/on-road-vehicles", "GET")).status, 401);
  for (const [path, method, tok] of [
    ["/rsa-clearances", "GET", t.rbp], ["/rsa-clearances", "GET", t.rsom], [`/rsa-clearances/${cid}/approve`, "POST", t.rbp], [`/rsa-clearances/${cid}/reject`, "POST", t.rbp],
    ["/on-road-vehicles", "GET", t.rsa], [`/on-road-vehicles/${cid}/resubmit`, "POST", t.rsa], [`/on-road-vehicles/${cid}/resubmit`, "POST", t.rsop],
  ] as const) {
    const r = await call(path, method, method === "POST" ? {} : undefined, tok);
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.deepEqual(keys(r.body), ["data", "message", "success"]);
    assert.equal(r.body.data, null);
  }
  assert.equal((await rsa("/not-an-id")).status, 400);
  assert.equal((await rsa("/aaaaaaaaaaaaaaaaaaaaaaaa")).status, 404);
});

// ================================================================== review details
test("review details: project, vehicle, driver (bank masked), live driver advance verification", async () => {
  const cid = String(alAClearance._id);
  const r = await rsa(`/${cid}`);
  assert.equal(r.status, 200);
  const x = r.body.data;
  assert.equal(x.project.trackupNumber, A.trackupNumber);
  assert.equal(x.project.pifNumber, A.pifNumber);
  assert.equal(x.project.projectType, "SIGNAGE");
  assert.equal(x.project.clientName, "Kensign Lifestyles");
  assert.equal(x.project.location, "Coimbatore");
  assert.equal(x.project.approvedBudgetAmount, 90000);
  assert.equal(x.project.rsomStatus, "APPROVED");
  assert.equal(x.vehicle.vehicleNo, alA.vehicle.vehicleNo);
  assert.equal(x.vehicle.make, "Tata");
  assert.ok(x.vehicle.allottedAt && x.vehicle.expectedReleaseAt && x.vehicle.nextAvailableAt);
  assert.equal(x.driver.driverNumber, drvA.driverNumber);
  assert.equal(x.driver.bank.accountNumberMasked.endsWith("9012"), true);
  assert.equal(x.driver.bank.accountNumber, undefined);
  assert.ok(!JSON.stringify(x).includes("123456789012")); // the full account number never leaves the server
  assert.deepEqual([x.financial.status, x.financial.outstanding, x.canApprove], ["NO_ADVANCE", 0, true]);
  const b = (await rsa(`/${String((await clr(B))._id)}`)).body.data;
  assert.deepEqual([b.financial.status, b.financial.outstanding, b.financial.totalAdvance, b.canApprove], ["UNAVAILABLE", null, 5000, false]);
  assert.equal(b.financial.advances.length, 1);
  assert.match(b.approveBlockedReason, /Verification Data Unavailable/);
});

// ================================================================== approve / reject
test("advance on record but no settlement data: approval blocked; outstanding blocks; settled allows", async () => {
  const cid = String((await clr(B))._id);
  const before = await DriverAdvance.countDocuments();
  let r = await rsa(`/${cid}/approve`, "POST", {});
  assert.equal(r.status, 409);
  assert.match(r.body.message, /Verification Data Unavailable/);
  assert.equal(r.body.data, null);
  settlementSource.load = async () => [{ amount: 3000 }]; // partly repaid -> outstanding 2000
  try {
    r = await rsa(`/${cid}/approve`, "POST", {});
    assert.equal(r.status, 400);
    assert.equal(r.body.message, "Outstanding driver advance exists");
    assert.equal((await rsa(`/${cid}`)).body.data.financial.outstanding, 2000);
    assert.equal((await clr(B)).status, "YET_TO_APPROVE");
    settlementSource.load = async () => [{ amount: 3000 }, { amount: 2000 }]; // fully settled
    assert.equal((await rsa(`/${cid}`)).body.data.canApprove, true);
  } finally {
    settlementSource.load = async () => null;
  }
  assert.equal(await DriverAdvance.countDocuments(), before); // verification never creates / changes advances
});

test("rejection needs a valid reason; Other needs an explanation; invalid input changes nothing", async () => {
  const cid = String((await clr(B))._id);
  for (const body of [{}, { reason: "" }, { reason: "Because" }, { reason: "Other" }, { reason: "Other", remarks: "x" }, { reason: "Missing Documents", remarks: "x".repeat(501) }, { reason: "Missing Documents", attachments: "no" }]) {
    const r = await rsa(`/${cid}/reject`, "POST", body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.data, null);
  }
  assert.equal((await clr(B)).status, "YET_TO_APPROVE");
  assert.equal(await ClearanceEvent.countDocuments({ clearance: cid, action: "REJECTED" }), 0);
});

test("RSA rejects: status, reason, snapshot, reviewer + time, allocation preserved, RBP notified", async () => {
  const cid = String((await clr(B))._id);
  const allotBefore = JSON.stringify(await VehicleAllotment.findById(alB.allotment._id).lean());
  const drvBefore = JSON.stringify(await Driver.findById(drvB._id).lean());
  const t0 = Date.now();
  const r = await rsa(`/${cid}/reject`, "POST", { reason: "Outstanding Driver Advance", remarks: "Advance not repaid", version: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.status, "REJECTED");
  const c = await clr(B);
  assert.deepEqual([c.status, c.rejectionReason, c.reviewedBy, c.financialStatus, c.outstandingAdvance], ["REJECTED", "Outstanding Driver Advance", "RSA", "UNAVAILABLE", null]);
  assert.ok(+new Date(c.reviewedAt) >= t0 - 1000 && +new Date(c.reviewedAt) <= Date.now() + 1000);
  assert.equal(JSON.stringify(await VehicleAllotment.findById(alB.allotment._id).lean()), allotBefore); // vehicle + driver stay allotted
  assert.equal(JSON.stringify(await Driver.findById(drvB._id).lean()), drvBefore);
  const ev: any = await ClearanceEvent.findOne({ clearance: cid, action: "REJECTED" }).lean();
  assert.equal(ev.username, "RSA");
  assert.equal(ev.details.reason, "Outstanding Driver Advance");
  assert.equal(ev.details.financial.totalAdvance, 5000);
  const n = await notes(rbpUser, "CLEARANCE_REJECTED");
  assert.equal(n.length, 1);
  assert.match(n[0].message, /rejected by RSA\. Please review the rejection details/);
  assert.deepEqual([n[0].meta.rejectionReason, n[0].meta.reviewedBy, n[0].meta.driverNumber], ["Outstanding Driver Advance", "RSA", drvB.driverNumber]);
  assert.equal(n[0].link, `/rbp/on-road/view?id=${cid}`);
  // a decided submission cannot be decided again
  assert.equal((await rsa(`/${cid}/reject`, "POST", { reason: "Other", remarks: "second try" })).status, 409);
  assert.equal((await rsa(`/${cid}/approve`, "POST", {})).status, 409);
});

test("RSA approves a clean driver; duplicate and concurrent reviews are blocked", async () => {
  const cid = String(alAClearance._id);
  const t0 = Date.now();
  // concurrent approve + reject + approve: exactly one wins
  const [x, y, z] = await Promise.all([rsa(`/${cid}/approve`, "POST", {}), rsa(`/${cid}/reject`, "POST", { reason: "Missing Documents" }), rsa(`/${cid}/approve`, "POST", {})]);
  const codes = [x.status, y.status, z.status].sort();
  assert.equal(codes.filter((s) => s === 200).length, 1, JSON.stringify([x.body, y.body, z.body]));
  assert.equal(codes.filter((s) => s === 409).length, 2);
  const c = await clr(A);
  assert.ok(["APPROVED", "REJECTED"].includes(c.status));
  assert.equal(c.reviewedBy, "RSA");
  assert.ok(+new Date(c.reviewedAt) >= t0 - 1000);
  assert.equal(await ClearanceEvent.countDocuments({ clearance: cid, action: { $in: ["APPROVED", "REJECTED"] } }), 1);
  assert.equal(await Notification.countDocuments({ recipient: rbpUser._id, "meta.trackupNumber": A.trackupNumber, type: { $in: ["CLEARANCE_APPROVED", "CLEARANCE_REJECTED"] } }), 1);
});

test("a clean approval is recorded and notified (fresh allocation)", async () => {
  const drv = await mkDriver("Approve Me");
  const tvx = sig.vehicles[6];
  await mkBudget(tvx, sig);
  const al = await allotTo(tvx, drv);
  const cid = String((await clr(tvx))._id);
  assert.equal((await rsa(`/${cid}/approve`, "POST", { version: 9 })).status, 409); // stale version
  const r = await rsa(`/${cid}/approve`, "POST", { version: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.status, "APPROVED");
  const c = await clr(tvx);
  assert.deepEqual([c.status, c.reviewedBy, c.financialStatus, c.outstandingAdvance, String(c.allotment), String(c.driver)], ["APPROVED", "RSA", "NO_ADVANCE", 0, String(al.allotment._id), String(drv._id)]);
  const n = (await notes(rbpUser, "CLEARANCE_APPROVED")).filter((x) => x.meta.trackupNumber === tvx.trackupNumber);
  assert.equal(n.length, 1);
  assert.match(n[0].message, /approved by RSA/);
  const rb = await rbp(`?status=APPROVED&q=${tvx.trackupNumber}`);
  assert.equal(rb.body.data.total, 1);
  assert.equal((await rbp(`/${cid}`)).body.data.history[0].action, "APPROVED"); // latest first
  // the allotment / driver availability are untouched by the approval
  assert.equal(((await VehicleAllotment.findById(al.allotment._id).lean()) as any).status, "ACTIVE");
  assert.equal(((await Driver.findById(drv._id).lean()) as any).availability.status, "IN_USE");
});

// ================================================================== RBP: correction + resubmission
test("rejected allocation stays visible; replacing the driver does not touch the rejected version; resubmit creates version 2", async () => {
  const cid = String((await clr(B))._id);
  const rejectedView = (await rbp(`/${cid}`)).body.data;
  assert.equal(rejectedView.status, "REJECTED");
  assert.equal(rejectedView.rejection.reason, "Outstanding Driver Advance");
  assert.equal(rejectedView.rejection.rejectedBy, "RSA");
  assert.equal(rejectedView.canResubmit, true);
  assert.equal((await rbp("?status=REJECTED")).body.data.total >= 1, true);

  const newDrv = await mkDriver("Replacement Driver");
  const ch = await call(`/vehicle-allotments/${alB.allotment._id}/change-driver`, "POST", { driverId: newDrv._id, reason: "Outstanding advance" }, (await T()).rbp);
  assert.equal(ch.status, 200, JSON.stringify(ch.body));
  const stillRejected = await clr(B);
  assert.deepEqual([stillRejected.status, stillRejected.currentVersion, stillRejected.driverName, stillRejected.rejectionReason], ["REJECTED", 1, "Karthik Raja", "Outstanding Driver Advance"]); // not silently overwritten
  const v = (await rbp(`/${cid}`)).body.data;
  assert.equal(v.changedSinceSubmission, true);
  assert.equal(v.current.driverName, "Replacement Driver");
  assert.equal((await rsa(`/${cid}/approve`, "POST", {})).status, 409); // RSA cannot approve a rejected version

  const rs = await rbp(`/${cid}/resubmit`, "POST", { remarks: "Driver replaced" });
  assert.equal(rs.status, 200, JSON.stringify(rs.body));
  assert.deepEqual([rs.body.data.status, rs.body.data.version, rs.body.data.driverName], ["YET_TO_APPROVE", 2, "Replacement Driver"]);
  const c = await clr(B);
  assert.deepEqual([c.status, c.currentVersion, c.submittedBy, String(c.driver), c.reviewedBy ?? null, c.rejectionReason ?? null], ["YET_TO_APPROVE", 2, "RBP", String(newDrv._id), null, null]);
  // the new driver's OWN advance history is used (none), not the previous driver's
  assert.deepEqual([c.financialStatus, c.outstandingAdvance], ["NO_ADVANCE", 0]);
  const ev = (await ClearanceEvent.find({ clearance: cid }).sort({ at: 1, _id: 1 }).lean()) as any[];
  const seqs = ev.map((e) => `V${e.version} ${e.action}`);
  assert.deepEqual(seqs.slice(0, 3), ["V1 ALLOCATED", "V1 SUBMITTED", "V1 REJECTED"]);
  assert.ok(seqs.includes("V2 DRIVER_CHANGED") && seqs.includes("V2 RESUBMITTED"));
  const rej: any = ev.find((e) => e.action === "REJECTED");
  assert.equal(rej.details.reason, "Outstanding Driver Advance"); // the old rejection is intact
  const dc: any = ev.find((e) => e.action === "DRIVER_CHANGED");
  assert.equal(dc.details.from.driverName, "Karthik Raja");
  assert.equal(dc.details.to.driverName, "Replacement Driver");
  const hist = (await rbp(`/${cid}`)).body.data.history;
  assert.equal(hist[0].action, "RESUBMITTED"); // latest first
  assert.equal(hist.at(-1).action, "ALLOCATED");
  const n = (await notes(rsaUser, "CLEARANCE_RESUBMITTED")).filter((x) => x.meta.version === 2);
  assert.equal(n.length, 1);
  assert.match(n[0].message, /resubmitted/);
  // a pending submission cannot be resubmitted again; RSA reviews the latest version only
  assert.equal((await rbp(`/${cid}/resubmit`, "POST", {})).status, 409);
  assert.equal((await rsa(`/${cid}/approve`, "POST", { version: 1 })).status, 409);
  const ok = await rsa(`/${cid}/approve`, "POST", { version: 2 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(await ClearanceEvent.countDocuments({ clearance: cid, version: 1, action: "REJECTED" }), 1); // still there
  assert.equal((await notes(rbpUser, "CLEARANCE_APPROVED")).filter((x) => x.meta.version === 2 && x.meta.trackupNumber === B.trackupNumber).length, 1);
});

test("resubmit is refused for non-rejected / unknown / inactive allocations; an approved allocation changed later opens a new version", async () => {
  const approvedCid = String((await clr(sig.vehicles[6]))._id);
  assert.equal((await rbp(`/${approvedCid}/resubmit`, "POST", {})).status, 409);
  assert.equal((await rbp("/aaaaaaaaaaaaaaaaaaaaaaaa/resubmit", "POST", {})).status, 404);
  assert.equal((await rbp("/bad/resubmit", "POST", {})).status, 400);
  // change the driver of an APPROVED allocation -> new version waiting for RSA
  const al: any = await VehicleAllotment.findOne({ trackingVehicle: sig.vehicles[6]._id, status: "ACTIVE" }).lean();
  const other = await mkDriver("Post Approval Driver");
  assert.equal((await call(`/vehicle-allotments/${al._id}/change-driver`, "POST", { driverId: other._id, reason: "Swap" }, (await T()).rbp)).status, 200);
  const c = await clr(sig.vehicles[6]);
  assert.deepEqual([c.status, c.currentVersion, c.driverName], ["YET_TO_APPROVE", 2, "Post Approval Driver"]);
  const ev = (await ClearanceEvent.find({ clearance: c._id }).lean()) as any[];
  assert.ok(ev.some((e) => e.version === 1 && e.action === "APPROVED")); // the approval of v1 is preserved
  assert.ok(ev.some((e) => e.version === 2 && e.action === "SUBMITTED"));
  // a rejected allocation whose vehicle was released cannot be resubmitted
  const cid = String((await clr(B))._id);
  await Clearance.updateOne({ _id: cid }, { $set: { status: "REJECTED" } });
  await call(`/vehicle-allotments/${alB.allotment._id}/release`, "POST", {}, (await T()).rbp);
  const r = await rbp(`/${cid}/resubmit`, "POST", {});
  assert.equal(r.status, 409);
  assert.match(r.body.message, /No active vehicle and driver allocation/);
});

test("history is immutable", async () => {
  const ev: any = await ClearanceEvent.findOne().lean();
  await assert.rejects(ClearanceEvent.updateOne({ _id: ev._id }, { $set: { username: "x" } }), /immutable/);
  await assert.rejects(ClearanceEvent.deleteMany({}), /immutable/);
});

// ================================================================== regression
test("regression: existing modules unchanged, every response uses the sendResponse envelope, existing records untouched by reviews", async () => {
  const t = await T();
  for (const [p, tok] of [["/tracking", t.rsop], ["/tracking", t.rbp], ["/approvals", t.rsom], ["/vehicles", t.rbp], ["/vehicle-allotments", t.rbp], ["/drivers", t.rbp], ["/rsa/projects", t.rsa], ["/rsa/payments", t.rsa], ["/health", t.rbp], ["/notifications", t.rsa]] as const) {
    const r = await call(p, "GET", undefined, tok);
    assert.equal(r.status, 200, p);
    assert.deepEqual(keys(r.body), ["data", "message", "success"], p);
  }
  const cid = String(((await Clearance.findOne().lean()) as any)._id);
  const reqs: [string, string, string | undefined, unknown?][] = [
    ["/rsa-clearances", "GET", t.rsa], ["/rsa-clearances/summary", "GET", t.rsa], [`/rsa-clearances/${cid}`, "GET", t.rsa], [`/rsa-clearances/${cid}/approve`, "POST", t.rsa, {}], [`/rsa-clearances/${cid}/reject`, "POST", t.rsa, {}],
    ["/on-road-vehicles", "GET", t.rbp], ["/on-road-vehicles/summary", "GET", t.rbp], [`/on-road-vehicles/${cid}`, "GET", t.rbp], [`/on-road-vehicles/${cid}/resubmit`, "POST", t.rbp, {}], ["/rsa-clearances", "GET", undefined], ["/rsa-clearances/x", "GET", t.rsa],
  ];
  for (const [p, m, tok, body] of reqs) {
    const r = await call(p, m, body, tok);
    assert.deepEqual(keys(r.body), ["data", "message", "success"], `${m} ${p}`);
    assert.equal(typeof r.body.success, "boolean");
    assert.equal(typeof r.body.message, "string");
    if (!r.body.success) assert.equal(r.body.data, null);
  }
  const snap = async () => JSON.stringify({ b: await Budget.find().sort({ _id: 1 }).lean(), a: await DriverAdvance.find().sort({ _id: 1 }).lean(), tp: await TrackingProject.find().sort({ _id: 1 }).lean(), pay: await RsaPayment.countDocuments() });
  const before = await snap();
  await rsa("?limit=100");
  await rbp("?limit=100");
  await rsa("/summary");
  await rsa(`/${cid}`);
  assert.equal(await snap(), before);
});

test("supporting attachment: RSA uploads and the rejection keeps it; other roles, bad files and failures change nothing", async () => {
  const t = await T();
  const upload = async (token: string | undefined, name: string, type: string, bytes: Buffer, path = "/rsa-clearances/attachments") => {
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array(bytes)], { type }), name);
    const res = await fetch(base + path, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
    return { status: res.status, body: (await res.json()) as any };
  };
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const pdf = Buffer.from("%PDF-1.4 test");

  assert.equal((await upload(undefined, "a.png", "image/png", png)).status, 401);
  for (const role of [t.rbp, t.rsop, t.rsom]) assert.equal((await upload(role, "a.png", "image/png", png)).status, 403);
  assert.equal((await upload(t.rsa, "a.png", "image/png", png, "/vehicles/attachments")).status, 403, "the RBP upload route is unchanged"); // the old failure
  assert.equal((await upload(t.rsa, "a.exe", "application/octet-stream", png)).status, 400);
  assert.equal((await upload(t.rsa, "fake.png", "image/png", Buffer.from("not a picture"))).status, 400);
  assert.equal((await upload(t.rsa, "big.pdf", "application/pdf", Buffer.concat([pdf, Buffer.alloc(10 * 1024 * 1024)]))).status, 413);

  const image = await upload(t.rsa, "evidence.png", "image/png", png);
  assert.equal(image.status, 201, image.body.message);
  const doc = await upload(t.rsa, "note.pdf", "application/pdf", pdf);
  assert.equal(doc.status, 201, doc.body.message);

  const pending: any = await Clearance.findOne({ status: "YET_TO_APPROVE" }).lean();
  assert.ok(pending, "a pending clearance is needed");
  const id = String(pending._id);
  const body = { version: pending.currentVersion, reason: "Missing Documents", remarks: "see attached" };
  assert.equal((await rsa(`/${id}/reject`, "POST", { ...body, attachments: [{ storage: "local", key: "../x", name: "x", size: 1, mimeType: "image/png" }] })).status, 400);
  assert.equal(((await Clearance.findById(id).lean()) as any).status, "YET_TO_APPROVE", "a refused attachment leaves nothing half done");

  const done = await rsa(`/${id}/reject`, "POST", { ...body, attachments: [image.body.data, doc.body.data] }); // retry with the uploaded files
  assert.equal(done.status, 200, done.body.message);
  const detail = (await rsa(`/${id}`)).body.data;
  const event = detail.history.find((h: any) => h.action === "REJECTED" && h.version === pending.currentVersion);
  assert.deepEqual([event.details.reason, event.details.remarks, event.username], ["Missing Documents", "see attached", "RSA"]);
  assert.deepEqual(event.details.attachments.map((a: any) => a.name), ["evidence.png", "note.pdf"]);
  assert.ok(event.details.pifNumber ?? detail.pifNumber);
  for (const a of event.details.attachments) assert.ok(a.url.includes(a.key), a.url);
  const seenByRbp = (await rbp(`/${id}`)).body.data.history.find((h: any) => h._id === event._id);
  assert.equal(seenByRbp.details.attachments.length, 2);
});

test("unread rejections: counted for RBP only, cleared one by one on opening, kept across logins, new again after another rejection", async () => {
  const t = await T();
  await Clearance.collection.updateMany({}, { $unset: { rejectionViewedVersion: 1 } });
  const count = async (token = t.rbp) => (await call("/on-road-vehicles/rejections/unviewed", "GET", undefined, token)).body.data.count as number;
  for (const token of [t.rsa, t.rsom, t.rsop]) {
    assert.equal((await call("/on-road-vehicles/rejections/unviewed", "GET", undefined, token)).status, 403);
    assert.equal((await call("/on-road-vehicles/aaaaaaaaaaaaaaaaaaaaaaaa/rejection-viewed", "POST", { version: 1 }, token)).status, 403);
  }
  const rejected: any[] = await Clearance.find({ status: "REJECTED" }).lean();
  const start = await count();
  assert.equal(start, rejected.length);
  assert.ok(start >= 1, "a rejected allocation is needed");
  await rbp("?limit=100"); // opening the list marks nothing
  assert.equal(await count(), start);

  const one = rejected[0];
  const id = String(one._id);
  assert.equal((await rbp(`/${id}`)).body.data.unviewedRejection, true);
  assert.equal(await count(), start, "reading alone marks nothing");
  assert.equal((await rbp(`/${id}/rejection-viewed`, "POST", { version: one.currentVersion + 1 })).body.data.count, start, "a stale version marks nothing");
  for (let i = 0; i < 2; i++) assert.equal((await rbp(`/${id}/rejection-viewed`, "POST", { version: one.currentVersion })).body.data.count, start - 1);
  const after1: any = await Clearance.findById(id).lean();
  assert.deepEqual([after1.status, after1.currentVersion, after1.updatedAt.getTime()], ["REJECTED", one.currentVersion, one.updatedAt.getTime()]);
  assert.equal((await rbp(`/${id}`)).body.data.unviewedRejection, false);
  assert.equal(await count(await login("RBP", "RBP", "123123")), start - 1, "still viewed after signing in again");

  // another rejection of a later review cycle is unread again (the version moves on)
  await Clearance.collection.updateOne({ _id: one._id }, { $set: { currentVersion: one.currentVersion + 1 } });
  assert.equal(await count(), start);
  // approved, pending and delivered allocations never count
  await Clearance.collection.updateMany({ status: "REJECTED" }, { $set: { status: "APPROVED" } });
  assert.equal(await count(), 0);
  await Clearance.collection.updateMany({ _id: { $in: rejected.map((r) => r._id) } }, { $set: { status: "REJECTED" } });
});

test("cleanup", async () => {
  assert.match(mongoose.connection.name, /_test_/);
  await mongoose.connection.dropDatabase();
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
});
