/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.ROADSHOW = "on";
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_rsa_history";
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
cfg.mongoUri = "mongodb://127.0.0.1:27017/driver_settlement_test_rsa_history";
cfg.storage.type = "local";
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
const T = async () => (tk ??= { rbp: await login("RBP", "RBP", "123123"), rsop: await login("RSOP", "RSOP", "pass2"), rsom: await login("RSOM", "RSOM", "pass3"), rsa: await login("RSA", "RSA", "pass4") });
const keys = (b: any) => Object.keys(b).sort();
const rsa = async (path: string, method = "GET", body?: unknown) => call(`/rsa${path}`, method, body, (await T()).rsa);

// ---- fixtures
let seq = 0;
const mkVehicle = async () => {
  const r = await call("/vehicles", "POST", {
    vehicleNo: `TN${30 + (seq % 60)}RS${3000 + seq++}`, make: "Tata", model: "Ace", type: "Dynamic", yearOfManufacture: 2022, purchaseDate: "2022-06-15", currentRunning: 1, totalRunning: 2,
    fc: [], insurance: [], rtoPermission: [], policePermission: [], permit: [], availability: { status: "AVAILABLE" },
  }, (await T()).rbp);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data as any;
};
let phone = 9300000000;
let dn = 0;
const mkDriver = async (over: Record<string, unknown> = {}) => {
  const r = await call("/drivers", "POST", {
    driverName: `Rsa Driver ${String.fromCharCode(65 + (dn++ % 26))}${String.fromCharCode(65 + (dn % 7))}`, driverType: "COMPANY_DRIVER", mobileNumber: String(phone++), salary: 370, accountName: "Rsa Driver",
    accountNumber: "123456789012", ifscCode: "SBIN0001234", bankName: "SBI", availability: { status: "AVAILABLE" }, ...over,
  }, (await T()).rbp);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data as any;
};
const bn = (() => { let n = 0; return () => `BUD-RSA-${++n}`; })();
const mkBudget = (tv: any, proj: any, state: Record<string, unknown> = { approvalStatus: "APPROVED", approvedVersion: 1 }) =>
  Budget.create({ budgetNumber: bn(), vehicle: tv._id, project: proj._id, data: { foodAmount: 100 }, total: 125000.5, currentVersion: 1, createdBy: "RBP", updatedBy: "RBP", reviewedBy: "RSOM", reviewedAt: new Date(), ...state });
const mkProject = async (body: unknown) => {
  const r = await call("/tracking", "POST", body, (await T()).rsop);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return perVehicleTrackups<any>(r.body.data);
};
const sched = { expectedReleaseDate: d(3), expectedReleaseTime: "20:00", nextAvailableDate: d(4), nextAvailableTime: "09:00" };
/** Allots a vehicle (and optionally a driver) to a project vehicle through the real allotment API. */
const allotTo = async (tv: any, driver?: any) => {
  const v = await mkVehicle();
  const r = await call("/vehicle-allotments", "POST", { vehicleId: v._id, pifNumber: tv.pifNumber, ...sched, ...(driver ? { driverId: driver._id } : {}) }, (await T()).rbp);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { vehicle: v, allotment: r.body.data };
};

let sig: any; // signage project, 10 vehicles
let road: any; // roadshow project, 2 vehicles
{
  sig = await mkProject({ projectType: "SIGNAGE", details: { projectCode: "15000001", client: "Kensign Lifestyles", jobSheetNumber: "ZZRSA-1", location: "Coimbatore", date: d(0), fromDate: d(0), toDate: d(9), numberOfVehicles: 10, vehicleTypes: [{ code: "CENTRE_NO_ROOF", quantity: 10 }] } });
  road = await mkProject({ projectType: "ROADSHOW", details: { projectCode: "15000002", billingName: "Ken Roadshow Pvt", stateCode: "33", startDate: d(0), endDate: d(8), reportingDate: d(3), sundayHalt: "NO", numberOfVans: 2, vehicleTypes: [{ code: "CENTRE_NO_ROOF", quantity: 2 }], reportingLocations: ["Chennai", "Trichy"] } });
}
// fixtures: a signage project and a roadshow project, each with approved budget + vehicle + driver
const A = sig.vehicles[0];
const A2 = sig.vehicles[1];
const B = road.vehicles[0];
await mkBudget(A, sig);
await mkBudget(A2, sig);
await mkBudget(B, road);
const drvA = await mkDriver({ driverName: "Sampath Madhu" });
const drvA2 = await mkDriver({ driverName: "Ilango Kumar" });
const drvB = await mkDriver({ driverName: "Karthik Raja" });
const alA = await allotTo(A, drvA);
await allotTo(A2, drvA2);
const alB = await allotTo(B, drvB);
const tv = (x: any) => String(x._id);
const savePay = async (x: any, over: Record<string, unknown> = {}) =>
  rsa(`/projects/${tv(x)}/payments`, "POST", { idempotencyKey: `hist-key-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, foodAmount: "100", ...over });
const hist = async (qs = "") => (await rsa(`/payments${qs}`)).body.data;
const nums = (r: any) => r.items.map((p: any) => p.paymentNumber);
const wait = () => new Promise((r) => setTimeout(r, 12));

// ================================================================== empty state
test("empty history: a normal result with zero totals and a null recent date; no error", async () => {
  const r = await rsa("/payments");
  assert.equal(r.status, 200);
  assert.deepEqual(keys(r.body), ["data", "message", "success"]);
  assert.deepEqual([r.body.data.items.length, r.body.data.total, r.body.data.page, r.body.data.limit], [0, 0, 1, 10]);
  const s = (await rsa("/payments/summary")).body.data;
  assert.deepEqual([s.totalEntries, s.totalAmount, s.roadshowCount, s.signageCount, s.roadshowAmount, s.signageAmount, s.recentPaymentAt, s.createdByOptions], [0, 0, 0, 0, 0, 0, null, []]);
});

// ================================================================== data
let p1: any, p2: any, p3: any, p4: any, p5: any;
test("setup: five payments across projects and verticals, saved through the existing save API", async () => {
  p1 = (await savePay(A, { foodAmount: "100", expenses: [{ optionKey: "TOLL", description: "Salem highway toll", amount: "50.25" }] })).body.data; await wait();
  p2 = (await savePay(B, { cashInHand: true, dieselEntries: [{ amount: "900", mode: "ePayment", reference: "AXIS IMPS" }] })).body.data; await wait();
  p3 = (await savePay(A2, { foodAmount: "300.10" })).body.data; await wait();
  p4 = (await savePay(A, { foodAmount: "400", salaryAdvance: "1500" })).body.data; await wait();
  p5 = (await savePay(B, { foodAmount: "55.55" })).body.data;
  for (const p of [p1, p2, p3, p4, p5]) assert.match(p.paymentNumber, /^PAY-\d{6}\/\d{4}-\d{2}$/);
  assert.equal(new Set([p1, p2, p3, p4, p5].map((p) => p.paymentNumber)).size, 5);
});

test("history by default: every project's payments, latest first, with the table's columns; the full record per row", async () => {
  const r = await hist();
  assert.equal(r.total, 5);
  assert.deepEqual(r.items.map((p: any) => p._id), [p5._id, p4._id, p3._id, p2._id, p1._id]); // latest entries first
  const x = r.items.find((p: any) => p._id === p4._id);
  for (const k of ["paymentNumber", "trackupNumber", "paymentFor", "clientName", "vehicleNo", "driverName", "driverNumber", "campaignFromDate", "campaignToDate", "totalPayable", "entryDateTime", "createdBy", "paymentStatus", "pifNumber", "billNumber"]) assert.ok(k in x, k);
  assert.deepEqual([x.trackupNumber, x.paymentFor, x.clientName, x.vehicleNo, x.driverName, x.campaignFromDate, x.campaignToDate, x.totalPayable, x.createdBy, x.paymentStatus],
    [A.trackupNumber, "SIGNAGE", "Kensign Lifestyles", alA.vehicle.vehicleNo, "Sampath Madhu", d(0), d(9), 1900, "RSA", "ENTERED"]);
  const rb = r.items.find((p: any) => p._id === p5._id);
  assert.deepEqual([rb.paymentFor, rb.campaignFromDate, rb.campaignToDate, rb.clientName], ["ROADSHOW", d(0), d(8), "Ken Roadshow Pvt"]);
  assert.ok(!JSON.stringify(r).includes("undefined"));
  assert.ok(r.items.every((p: any) => new Date(p.entryDateTime).getTime() > Date.now() - 60_000)); // server stamped
});

test("mass search: payment number, JS number, PIF, bill, client, vehicle, driver number / name, expense description", async () => {
  const by = async (q: string) => nums(await hist(`?q=${encodeURIComponent(q)}`)).sort();
  assert.deepEqual(await by(p3.paymentNumber), [p3.paymentNumber]);
  assert.deepEqual(await by(p3.paymentNumber.slice(0, 10)), [p3.paymentNumber]); // partial number
  assert.deepEqual(await by(A2.trackupNumber), [p3.paymentNumber]); // JS / Trackup number
  assert.deepEqual(await by(A.pifNumber), [p1.paymentNumber, p4.paymentNumber].sort());
  assert.deepEqual(await by("kensign"), [p1.paymentNumber, p3.paymentNumber, p4.paymentNumber].sort()); // client / billing name
  assert.deepEqual(await by("ken roadshow"), [p2.paymentNumber, p5.paymentNumber].sort());
  assert.deepEqual(await by(alB.vehicle.vehicleNo), [p2.paymentNumber, p5.paymentNumber].sort()); // vehicle number
  assert.deepEqual(await by(alB.vehicle.vehicleNo.toLowerCase()), [p2.paymentNumber, p5.paymentNumber].sort());
  assert.deepEqual(await by(drvA2.driverNumber), [p3.paymentNumber]); // driver number
  assert.deepEqual(await by("karthik"), [p2.paymentNumber, p5.paymentNumber].sort()); // driver name
  assert.deepEqual(await by("highway toll"), [p1.paymentNumber]); // expense description
  assert.deepEqual(await by("axis imps"), [p2.paymentNumber]); // fuel reference
  assert.deepEqual(await by("no-such-thing-zz"), []);
  assert.equal((await rsa(`/payments?q=${encodeURIComponent("%.*[")}`)).status, 200); // regex characters are escaped
  assert.equal((await hist("?q=%20%20")).total, 5); // blank search = no filter
  assert.deepEqual((await hist("?q=ILANGO")).items.length, 1); // case-insensitive
});

test("filters: Payment For, date range (IST), Created By, status; unknown values are ignored; all of them combine", async () => {
  const today = todayYmd();
  assert.deepEqual(nums(await hist("?paymentFor=ROADSHOW")).sort(), [p2.paymentNumber, p5.paymentNumber].sort());
  assert.deepEqual(nums(await hist("?paymentFor=SIGNAGE")).sort(), [p1.paymentNumber, p3.paymentNumber, p4.paymentNumber].sort());
  assert.equal((await hist("?paymentFor=BOGUS")).total, 5);
  assert.equal((await hist(`?from=${today}&to=${today}`)).total, 5); // everything was entered today (IST)
  assert.equal((await hist(`?from=${d(1)}`)).total, 0);
  assert.equal((await hist(`?to=${d(-1)}`)).total, 0);
  assert.equal((await hist(`?from=${d(-1)}&to=${d(1)}`)).total, 5);
  assert.equal((await hist("?from=not-a-date")).total, 5); // invalid dates are ignored, not an error
  assert.equal((await hist("?createdBy=RSA")).total, 5);
  assert.equal((await hist("?createdBy=SOMEONE")).total, 0);
  assert.equal((await hist("?paymentStatus=ENTERED")).total, 5);
  assert.equal((await hist("?paymentStatus=TRANSFERRED")).total, 5); // not a known status: ignored
  // combined
  assert.deepEqual(nums(await hist(`?paymentFor=SIGNAGE&q=kensign&from=${today}&createdBy=RSA`)).sort(), [p1.paymentNumber, p3.paymentNumber, p4.paymentNumber].sort());
  assert.deepEqual(nums(await hist("?paymentFor=ROADSHOW&q=kensign")), []); // narrows together
  assert.deepEqual(nums(await hist(`?paymentFor=SIGNAGE&q=${encodeURIComponent(A.pifNumber)}`)).sort(), [p1.paymentNumber, p4.paymentNumber].sort());
  assert.equal((await hist("?paymentFor=")).total, 5); // cleared filters = everything again
  assert.equal((await hist()).total, 5);
});

test("pagination: server-side pages, totals, size cap, no overlap, order kept across pages", async () => {
  const a = await hist("?limit=2&page=1");
  const b = await hist("?limit=2&page=2");
  const c = await hist("?limit=2&page=3");
  assert.deepEqual([a.items.length, b.items.length, c.items.length, a.total, b.page, a.limit], [2, 2, 1, 5, 2, 2]);
  assert.deepEqual([...nums(a), ...nums(b), ...nums(c)], [p5, p4, p3, p2, p1].map((p) => p.paymentNumber));
  assert.equal((await hist("?limit=2&page=9")).items.length, 0);
  assert.equal((await hist("?limit=9999")).limit, 100);
  assert.equal((await hist("?limit=0&page=0")).page, 1);
  const f = await hist("?paymentFor=SIGNAGE&limit=2&page=2"); // pagination respects filters
  assert.deepEqual([f.items.length, f.total], [1, 3]);
});

test("summary cards: real totals per vertical, recent payment date, created-by options", async () => {
  const s = (await rsa("/payments/summary")).body.data;
  const signage = 100 + 50.25 + 300.1 + 1900; // p1 + p3 + p4
  const roadshow = 100 + 900 + 55.55; // note: p2 = default food 100 + diesel 900, p5 = 55.55
  assert.deepEqual([s.totalEntries, s.roadshowCount, s.signageCount], [5, 2, 3]);
  assert.equal(s.signageAmount, Math.round((100 + 50.25 + 300.1 + (400 + 1500)) * 100) / 100);
  assert.equal(s.roadshowAmount, Math.round((100 + 900 + 55.55) * 100) / 100);
  assert.equal(s.totalAmount, Math.round((s.signageAmount + s.roadshowAmount) * 100) / 100);
  assert.ok(signage > 0 && roadshow > 0);
  assert.equal(new Date(s.recentPaymentAt).getTime(), new Date(p5.entryDateTime).getTime());
  assert.deepEqual(s.createdByOptions, ["RSA"]);
  assert.deepEqual(keys((await rsa("/payments/summary")).body), ["data", "message", "success"]);
});

test("View Details: the complete saved payment by id, unchanged; numbers are never regenerated", async () => {
  const r = await rsa(`/payments/${p1._id}`);
  assert.equal(r.status, 200);
  const x = r.body.data;
  assert.equal(x.paymentNumber, p1.paymentNumber);
  assert.deepEqual([x.trackupNumber, x.pifNumber, x.clientName, x.vehicleNo, x.driverNumber, x.driverName, x.campaignFromDate, x.campaignToDate, x.foodAmount, x.createdBy, x.paymentStatus],
    [A.trackupNumber, A.pifNumber, "Kensign Lifestyles", alA.vehicle.vehicleNo, drvA.driverNumber, "Sampath Madhu", d(0), d(9), 100, "RSA", "ENTERED"]);
  assert.deepEqual(x.expenses.map((e: any) => [e.optionLabel, e.description, e.amount, e.deduct]), [["Toll", "Salem highway toll", 50.25, false]]);
  assert.equal(x.totalPayable, 150.25);
  const x2 = (await rsa(`/payments/${p2._id}`)).body.data;
  assert.deepEqual([x2.dieselEntries[0].amount, x2.dieselEntries[0].reference, x2.cashInHand, x2.mode], [900, "AXIS IMPS", true, "Cash in Hand"]);
  assert.equal((await rsa(`/payments/${p1._id}`)).body.data.paymentNumber, p1.paymentNumber); // re-reading never changes the number
  assert.equal((await rsa("/payments/summary")).status, 200); // "summary" is not mistaken for an id
  assert.equal((await rsa("/payments/zzz")).status, 400);
  assert.equal((await rsa(`/payments/${"0".repeat(24)}`)).status, 404);
});

test("a new payment saved afterwards appears first in the history; repeated clicks do not duplicate it", async () => {
  const key = "hist-dup-key-12345";
  const body = { idempotencyKey: key, foodAmount: "77" };
  const first = await rsa(`/projects/${tv(A2)}/payments`, "POST", body);
  const again = await rsa(`/projects/${tv(A2)}/payments`, "POST", body);
  assert.equal(first.status, 201);
  assert.equal(again.status, 200);
  const r = await hist();
  assert.equal(r.total, 6);
  assert.equal(r.items[0]._id, first.body.data._id); // on top
  assert.equal(r.items.filter((p: any) => p._id === first.body.data._id).length, 1);
  assert.deepEqual(nums(await hist("?limit=1")), [first.body.data.paymentNumber]);
  assert.equal(await RsaPayment.countDocuments({ idempotencyKey: key }), 1);
});

// ================================================================== access + regression
test("access: RSA only; other roles and anonymous users cannot read the history or the summary", async () => {
  const t = await T();
  for (const p of ["/rsa/payments", "/rsa/payments/summary", `/rsa/payments/${p1._id}`]) {
    assert.equal((await call(p)).status, 401, p);
    for (const tok of [t.rbp, t.rsop, t.rsom]) {
      const r = await call(p, "GET", undefined, tok);
      assert.equal(r.status, 403, p);
      assert.deepEqual(keys(r.body), ["data", "message", "success"]);
    }
  }
});

test("regression: the earlier per-project history, eligibility list and payment calculation are unchanged; reading history changes nothing", async () => {
  const snap = async () => JSON.stringify({ pay: await RsaPayment.find().sort({ _id: 1 }).lean(), b: await Budget.find().sort({ _id: 1 }).lean(), al: await VehicleAllotment.find().sort({ _id: 1 }).lean(), dr: await Driver.find().sort({ _id: 1 }).lean(), tp: await TrackingProject.find().sort({ _id: 1 }).lean() });
  const before = await snap();
  await hist("?q=kensign&paymentFor=SIGNAGE&limit=2");
  await rsa("/payments/summary");
  await rsa(`/payments/${p4._id}`);
  assert.equal(await snap(), before);
  const per = (await rsa(`/projects/${tv(A)}/payments`)).body.data; // the earlier endpoint still works and is still scoped to one project
  assert.equal(per.total, 2);
  assert.deepEqual(per.items.map((p: any) => p._id), [p4._id, p1._id]);
  const el = (await rsa("/projects?limit=100")).body.data;
  assert.equal(el.total, 3);
  assert.ok(el.items.every((x: any) => x.paymentCount >= 1));
  const calc = (await savePay(B, { dieselEntries: [{ amount: "1000.50" }, { amount: "199.99" }], foodAmount: "50", salaryAdvance: "1500", expenses: [{ optionKey: "TOLL", amount: "333.33" }, { optionKey: "OTHERS", description: "refund", amount: "100", deduct: true }] })).body.data;
  assert.equal(calc.totalPayable, 2983.82); // the formula is untouched: 2983.82
  for (const [p, tok] of [["/tracking", (await T()).rsop], ["/approvals", (await T()).rsom], ["/vehicles", (await T()).rbp], ["/vehicle-allotments", (await T()).rbp], ["/drivers", (await T()).rbp]] as const) {
    const r = await call(p, "GET", undefined, tok);
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
