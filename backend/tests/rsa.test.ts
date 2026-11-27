/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_rsa";
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
cfg.mongoUri = "mongodb://127.0.0.1:27017/driver_settlement_test_rsa";
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
const { calculatePayable, parseAmountPaise, validatePaymentInput } = await import("../src/utils/rsaPayment.js");
const { EXPENSE_OPTIONS } = await import("../src/config/rsaOptions.js");
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
// A = signage + vehicle + driver (eligible); B = roadshow + vehicle + driver (eligible)
const A = sig.vehicles[0];
const B = road.vehicles[0];
await mkBudget(A, sig);
await mkBudget(B, road);
const drvA = await mkDriver({ driverName: "Sampath Madhu", salary: 370 });
const drvB = await mkDriver({ driverName: "Karthik Raja", salary: 500 });
const alA = await allotTo(A, drvA);
const alB = await allotTo(B, drvB);
// C: approved + vehicle but NO driver
const C = sig.vehicles[1];
await mkBudget(C, sig);
const alC = await allotTo(C);
// D: approved but no vehicle at all
const D = sig.vehicles[2];
await mkBudget(D, sig);
// E: vehicle + driver allotted, then the budget is back to PENDING (not eligible)
const E = sig.vehicles[3];
await mkBudget(E, sig);
const alE = await allotTo(E, await mkDriver());
await Budget.updateOne({ vehicle: E._id }, { $set: { approvalStatus: "PENDING" } });
// F: rejected
const F = sig.vehicles[4];
await mkBudget(F, sig);
await allotTo(F, await mkDriver());
await Budget.updateOne({ vehicle: F._id }, { $set: { approvalStatus: "REJECTED", rejectedVersion: 1 } });
// G: approved v1 but a newer unapproved version 2 exists
const G = sig.vehicles[5];
await mkBudget(G, sig);
await allotTo(G, await mkDriver());
await Budget.updateOne({ vehicle: G._id }, { $set: { currentVersion: 2 } });
// H: draft budget (no approval status), no allotment possible: only the budget exists
const H = sig.vehicles[6];
await mkBudget(H, sig, { approvalStatus: "DRAFT" });
// I: eligible but its allotment was released afterwards (campaign over, payment still due)
const I = sig.vehicles[7];
await mkBudget(I, sig);
const alI = await allotTo(I, await mkDriver({ driverName: "Released Rajan" }));
await call(`/vehicle-allotments/${alI.allotment._id}/release`, "POST", {}, (await T()).rbp);

const tv = (x: any) => String(x._id);
const pay = (over: Record<string, unknown> = {}) => ({ idempotencyKey: `rsa-key-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, foodAmount: "100", ...over });
const savePay = async (x: any, over: Record<string, unknown> = {}) => rsa(`/projects/${tv(x)}/payments`, "POST", pay(over));

// ================================================================== authentication
test("RSA login: seeded from configuration, password hashed, role description shown; bad credentials rejected", async () => {
  const ok = await call("/auth/login", "POST", { role: "RSA", username: "RSA", password: "pass4" });
  assert.equal(ok.status, 200);
  assert.deepEqual(keys(ok.body), ["data", "message", "success"]);
  assert.deepEqual([ok.body.data.user.username, ok.body.data.user.role], ["RSA", "RSA"]);
  assert.ok(ok.body.data.token);
  const u: any = await User.findOne({ username: "RSA" }).select("+passwordHash").lean();
  assert.equal(u.role, "RSA");
  assert.ok(u.passwordHash.startsWith("$2")); // bcrypt, never the plain password
  assert.ok(!JSON.stringify(u).includes("pass4"));
  for (const [role, user, pass] of [["RSA", "RSA", "wrong"], ["RSA", "NOPE", "pass4"], ["RBP", "RSA", "pass4"], ["RSA", "RBP", "123123"], ["RSA", "RSA", ""]] as const) {
    const r = await call("/auth/login", "POST", { role, username: user, password: pass });
    assert.ok(r.status === 401 || r.status === 400, `${role}/${user}`);
    assert.equal(r.body.data, null);
  }
  assert.equal((await call("/auth/login", "POST", { role: "RSAX", username: "RSA", password: "pass4" })).status, 400);
  const roles = await call("/auth/roles");
  assert.equal(roles.body.data.RSA.description, "Manage approved Roadshow and Signage project payments, vehicle expenses, and driver payment records.");
  assert.equal(roles.body.data.RSA.defaultUsername, "RSA");
  assert.ok(roles.body.data.RSOP && roles.body.data.RBP && roles.body.data.RSOM); // the other three logins are unchanged
  assert.equal((await call("/auth/login", "POST", { role: "RSOM", username: "RSOM", password: "pass3" })).status, 200);
});

test("authorization: RSA reaches only /rsa; every other module refuses RSA; other roles cannot use /rsa", async () => {
  const t = await T();
  const id = "a".repeat(24);
  const denied: [string, string][] = [
    ["GET", "/vehicles"], ["POST", "/vehicles"], ["GET", "/vehicle-allotments"], ["POST", "/vehicle-allotments"], ["POST", `/vehicle-allotments/${id}/assign-driver`], ["GET", "/drivers"], ["POST", "/drivers"],
    ["PUT", `/drivers/${id}`], ["POST", `/drivers/${id}/advances`], ["GET", `/drivers/${id}/advances`], ["POST", "/tracking"], ["GET", "/tracking"], ["POST", "/budgets"], ["PUT", `/budgets/${id}`],
    ["GET", `/budgets/vehicle/${id}`], ["GET", "/approvals"], ["POST", `/approvals/${id}/approve`], ["POST", `/approvals/${id}/reject`],
  ];
  for (const [m, p] of denied) {
    const r = await call(p, m, m === "GET" ? undefined : {}, t.rsa);
    assert.equal(r.status, 403, `${m} ${p}`);
    assert.deepEqual(keys(r.body), ["data", "message", "success"]);
  }
  for (const [m, p] of [["GET", "/rsa/projects"], ["GET", "/rsa/options"], ["GET", `/rsa/projects/${id}`], ["POST", `/rsa/projects/${id}/payments`], ["GET", `/rsa/payments/${id}`], ["GET", `/rsa/projects/${id}/budget`]] as const) {
    assert.equal((await call(p, m, m === "POST" ? {} : undefined)).status, 401, p);
    for (const tok of [t.rbp, t.rsop, t.rsom]) assert.equal((await call(p, m, m === "POST" ? {} : undefined, tok)).status, 403, `${m} ${p}`);
  }
});

// ================================================================== eligibility
const list = async (qs = "") => (await rsa(`/projects${qs}`)).body.data;
const trackups = (r: any) => r.items.map((x: any) => x.trackupNumber);

test("eligibility: only RSOM-approved (current version) projects with a vehicle AND a driver appear; everything else is excluded", async () => {
  const r = await list("?limit=100");
  const got = new Set(trackups(r));
  for (const x of [A, B, I]) assert.ok(got.has(x.trackupNumber), `eligible ${x.trackupNumber}`); // I: released allotment still payable
  for (const [name, x] of [["no driver", C], ["no vehicle", D], ["pending", E], ["rejected", F], ["newer unapproved version", G], ["draft", H]] as const) assert.ok(!got.has(x.trackupNumber), name);
  assert.equal(r.total, 3);
  assert.equal(alC.allotment.driver, undefined);
  assert.ok(alE.allotment._id);
});

test("eligibility: each row carries the real project, vehicle and driver details with the approved budget amount", async () => {
  const r = await list(`?q=${encodeURIComponent(A.trackupNumber)}`);
  assert.equal(r.items.length, 1);
  const x = r.items[0];
  assert.deepEqual(keys(x), ["allotment", "allotmentStatus", "approvedBudgetAmount", "budgetVersion", "campaignFromDate", "campaignToDate", "clientName", "driverAssignedAt", "driverName", "driverNumber", "lastPaymentAt", "paymentCount", "paymentStatus", "pifNumber", "projectName", "projectType", "requestedVehicleType", "trackingVehicle", "trackupNumber", "vehicleAllottedAt", "vehicleNo"]);
  assert.deepEqual([x.trackupNumber, x.pifNumber, x.projectType, x.clientName, x.vehicleNo, x.driverNumber, x.driverName], [A.trackupNumber, A.pifNumber, "SIGNAGE", "Kensign Lifestyles", alA.vehicle.vehicleNo, drvA.driverNumber, "Sampath Madhu"]);
  assert.deepEqual([x.campaignFromDate, x.campaignToDate], [d(0), d(9)]); // Signage: From Date / To Date
  assert.equal(x.approvedBudgetAmount, 125000.5);
  assert.ok(x.vehicleAllottedAt && x.driverAssignedAt);
  assert.deepEqual([x.paymentStatus, x.paymentCount, x.lastPaymentAt], ["PENDING", 0, null]);
  const rb = (await list(`?q=${encodeURIComponent(B.trackupNumber)}`)).items[0];
  assert.deepEqual([rb.projectType, rb.campaignFromDate, rb.campaignToDate, rb.clientName], ["ROADSHOW", d(0), d(8), "Ken Roadshow Pvt"]); // Roadshow: Start Date / End Date
});

test("eligibility: mass search, specific searches, type filter, payment status, date range and server-side pagination", async () => {
  const names = async (qs: string) => trackups(await list(qs)).sort();
  assert.deepEqual(await names(`?q=${encodeURIComponent(A.trackupNumber)}`), [A.trackupNumber]);
  assert.deepEqual(await names(`?q=${encodeURIComponent(A.pifNumber)}`), [A.trackupNumber]);
  assert.deepEqual(await names("?q=kensign"), [A.trackupNumber, I.trackupNumber].sort()); // client / billing name
  assert.deepEqual(await names("?q=ken%20roadshow"), [B.trackupNumber]);
  assert.deepEqual(await names(`?q=${encodeURIComponent(alB.vehicle.vehicleNo)}`), [B.trackupNumber]); // vehicle number
  assert.deepEqual(await names("?q=karthik"), [B.trackupNumber]); // driver name
  assert.deepEqual(await names(`?q=${drvA.driverNumber}`), [A.trackupNumber]); // driver number
  assert.deepEqual(await names("?q=%25.*%5B"), []); // regex characters are escaped
  assert.deepEqual(await names("?projectType=ROADSHOW"), [B.trackupNumber]);
  assert.deepEqual(await names("?projectType=SIGNAGE"), [A.trackupNumber, I.trackupNumber].sort());
  assert.deepEqual(await names("?paymentStatus=PENDING"), [A.trackupNumber, B.trackupNumber, I.trackupNumber].sort());
  assert.deepEqual(await names("?paymentStatus=ENTERED"), []);
  assert.deepEqual(await names(`?from=${d(10)}`), []); // every campaign ended before d(10)
  assert.deepEqual(await names(`?to=${d(-1)}`), []); // every campaign starts today (start dates: today back to 7 days)
  assert.deepEqual(await names(`?from=${d(8)}&to=${d(8)}`), [A.trackupNumber, B.trackupNumber, I.trackupNumber].sort()); // overlapping
  assert.deepEqual(await names(`?from=${d(9)}&to=${d(9)}`), [A.trackupNumber, I.trackupNumber].sort()); // only the signage runs to d(9)
  assert.deepEqual(await names(`?from=${d(9)}&to=${d(9)}&projectType=ROADSHOW`), []); // filters combine
  const p1 = await list("?limit=2&page=1");
  const p2 = await list("?limit=2&page=2");
  assert.deepEqual([p1.items.length, p2.items.length, p1.total], [2, 1, 3]);
  assert.equal(new Set([...trackups(p1), ...trackups(p2)]).size, 3);
  assert.equal((await list("?limit=9999")).limit, 100);
});

// ================================================================== project context (auto-population)
test("payment screen details are read from the database: client, type, vehicle, driver, campaign dates, server entry time", async () => {
  const before = Date.now();
  const r = await rsa(`/projects/${tv(A)}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(keys(r.body), ["data", "message", "success"]);
  const x = r.body.data;
  assert.ok(!("_raw" in x)); // internal ids never leak
  assert.deepEqual([x.trackupNumber, x.pifNumber, x.clientName, x.projectType, x.paymentFor], [A.trackupNumber, A.pifNumber, "Kensign Lifestyles", "SIGNAGE", "SIGNAGE"]);
  assert.deepEqual([x.vehicle.vehicleNo, x.vehicle.make, x.vehicle.model], [alA.vehicle.vehicleNo, "Tata", "Ace"]);
  assert.deepEqual([x.driver.driverNumber, x.driver.driverName, x.driver.driverType, x.driver.mobileNumber], [drvA.driverNumber, "Sampath Madhu", "COMPANY_DRIVER", drvA.mobileNumber]);
  assert.deepEqual([x.campaignFromDate, x.campaignToDate], [d(0), d(9)]);
  assert.ok(Math.abs(new Date(x.entryDateTime).getTime() - before) < 5000); // server clock
  const rb = (await rsa(`/projects/${tv(B)}`)).body.data;
  assert.deepEqual([rb.projectType, rb.paymentFor, rb.campaignFromDate, rb.campaignToDate], ["ROADSHOW", "ROADSHOW", d(0), d(8)]);
  const nf = await rsa(`/projects/${"0".repeat(24)}`);
  assert.equal(nf.status, 404);
  assert.equal(nf.body.data, null);
  assert.equal((await rsa("/projects/zzz")).status, 400);
  for (const [x2, re] of [[C, /No driver is allotted/], [D, /No vehicle is allotted/], [E, /not approved/], [F, /not approved/], [G, /not approved/], [H, /not approved/]] as const) {
    const bad = await rsa(`/projects/${tv(x2)}`);
    assert.equal(bad.status, 409);
    assert.match(bad.body.message, re);
    assert.equal(bad.body.data, null);
  }
  assert.equal((await rsa(`/projects/${tv(C)}/payments`, "POST", pay())).status, 409); // no payment against an ineligible project
  assert.equal(await RsaPayment.countDocuments({ trackingVehicle: C._id }), 0);
});

test("options: the eight expense categories and Payment For come from configuration", async () => {
  const r = await rsa("/options");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data.expenseOptions.map((o: any) => o.label), ["Others", "Fuel", "Fleet Balance", "Toll", "Food Allowance", "Travel", "Permit", "Service"]);
  assert.deepEqual(r.body.data.expenseOptions.map((o: any) => o.key), EXPENSE_OPTIONS.map((o) => o.key));
  assert.deepEqual(r.body.data.paymentFor, [{ key: "ROADSHOW", label: "Roadshow" }, { key: "SIGNAGE", label: "Signage" }]);
  assert.ok(Array.isArray(r.body.data.dieselPaymentModes));
});

// ================================================================== calculation + validation (pure)
test("decimal-safe amounts: digits with up to 2 decimals; letters, symbols, negatives and exponents rejected", () => {
  for (const [raw, p] of [["0", 0], ["", 0], [undefined, 0], ["100", 10000], [100, 10000], ["100.5", 10050], ["0.07", 7], [19.99, 1999], ["1234567.89", 123456789]] as const) assert.equal(parseAmountPaise(raw).paise, p, String(raw));
  for (const bad of ["abc", "5a", "₹5", "1,000", "-1", -1, "1e3", "1.234", ".5", "5.", NaN, "99999999999", {}, []]) assert.notEqual(parseAmountPaise(bad).error, null, JSON.stringify(bad));
  assert.equal(parseAmountPaise(0.1 + 0.2).error, "can have at most 2 decimal places"); // 0.30000000000000004 is not a currency value
});

test("total payable = diesel + food + salary advance + expenses - expenses marked Deduct, exactly", () => {
  const input = {
    diesel: [{ amountPaise: 100050, mode: null, reference: null }, { amountPaise: 19999, mode: "Cash", reference: null }], foodPaise: 5000, salaryAdvancePaise: 150000,
    expenses: [
      { optionKey: "TOLL", optionLabel: "Toll", description: null, amountPaise: 33333, deduct: false, isDefault: false },
      { optionKey: "OTHERS", optionLabel: "Others", description: "x", amountPaise: 10000, deduct: true, isDefault: false },
    ],
  };
  const t = calculatePayable(input);
  assert.deepEqual([t.dieselP, t.expenseAddP, t.expenseDeductP, t.totalP], [120049, 33333, 10000, 120049 + 5000 + 150000 + 33333 - 10000]);
  assert.equal(calculatePayable({ diesel: [], foodPaise: 0, salaryAdvancePaise: 0, expenses: [] }).totalP, 0);
});

test("payment validation: all eight categories accepted, Others needs a description, duplicates / negatives / letters / empty / deductions above the total rejected", () => {
  const key = "abcdefgh1234";
  const ok = (over: Record<string, unknown>) => validatePaymentInput({ idempotencyKey: key, ...over });
  for (const o of EXPENSE_OPTIONS) {
    const r = ok({ expenses: [{ optionKey: o.key, description: o.key === "OTHERS" ? "needed" : "", amount: "10.50" }] });
    assert.deepEqual(r.errors, [], o.key);
    assert.equal(r.data?.expenses[0].optionLabel, o.label);
  }
  assert.ok(ok({ expenses: [{ optionKey: "OTHERS", amount: "10" }] }).errors.some((e) => /description is required/.test(e)));
  assert.ok(ok({ expenses: [{ optionKey: "NOPE", amount: "10" }] }).errors.some((e) => /listed expense options/.test(e)));
  assert.ok(ok({ expenses: [{ optionKey: "TOLL", amount: "abc" }] }).errors.some((e) => /digits only/.test(e)));
  assert.ok(ok({ expenses: [{ optionKey: "TOLL", amount: "-5" }] }).errors.some((e) => /negative/.test(e)));
  assert.ok(ok({ expenses: [{ optionKey: "TOLL", amount: "0" }] }).errors.some((e) => /greater than zero/.test(e)));
  assert.ok(ok({ expenses: [{ optionKey: "TOLL", amount: "5" }, { optionKey: "TOLL", amount: "5" }] }).errors.some((e) => /duplicates/.test(e)));
  assert.deepEqual(ok({ expenses: [{ optionKey: "TOLL", amount: "5" }, { optionKey: "TOLL", amount: "5", description: "second toll" }] }).errors, []); // different content is fine
  assert.deepEqual(ok({ expenses: [{ optionKey: "TOLL", amount: "5" }, { optionKey: "TOLL", amount: "5", deduct: true }] }).errors, []);
  assert.ok(ok({}).errors.some((e) => /at least one amount/.test(e)));
  assert.ok(ok({ foodAmount: "abc" }).errors.some((e) => /Food amount/.test(e)));
  assert.ok(ok({ salaryAdvance: "-1" }).errors.some((e) => /Salary advance/.test(e)));
  assert.ok(ok({ expenses: [{ optionKey: "TOLL", amount: "50", deduct: true }], foodAmount: "10" }).errors.some((e) => /deductions are more/.test(e)));
  assert.ok(ok({ foodAmount: "10", cashInHand: "yes" }).errors.some((e) => /Cash in Hand/.test(e)));
  assert.ok(ok({ foodAmount: "10", paymentFor: "OTHER" }).errors.some((e) => /Roadshow or Signage/.test(e)));
  assert.ok(ok({ dieselEntries: [{ amount: "0" }] }).errors.some((e) => /greater than zero/.test(e)));
  assert.ok(ok({ dieselEntries: [{ amount: "5", mode: "Bitcoin" }] }).errors.some((e) => /payment mode/.test(e)));
  assert.ok(validatePaymentInput({ foodAmount: "10" }).errors.some((e) => /submission key/.test(e)));
  assert.ok(ok({ foodAmount: "10", expenses: [{ optionKey: "TOLL", amount: "5", description: "<b>" }] }).errors.some((e) => /invalid characters/.test(e)));
});

// ================================================================== saving payments
test("save: backend generates the payment number, stamps its own time and the RSA user, recalculates the total and snapshots the project", async () => {
  const before = Date.now();
  const r = await savePay(A, {
    cashInHand: true, dieselEntries: [{ amount: "1000.50", mode: "ePayment", reference: "AXIS IMPS" }, { amount: "200", mode: "Cash" }], foodAmount: "150.25", salaryAdvance: "500",
    expenses: [{ optionKey: "TOLL", description: "Salem toll", amount: "120.10" }, { optionKey: "OTHERS", description: "Parking refund", amount: "20", deduct: true }],
    // client attempts to dictate server-owned values; all ignored
    entryDateTime: "2000-01-01T00:00:00Z", createdBy: "someone", paymentNumber: "PAY-000001/2000-01", totalPayable: 1, projectType: "ROADSHOW", driverNumber: "DR-0000", vehicleNo: "FAKE",
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(keys(r.body), ["data", "message", "success"]);
  assert.equal(r.body.message, "Payment saved successfully");
  const p = r.body.data;
  assert.match(p.paymentNumber, /^PAY-\d{6}\/\d{4}-\d{2}$/);
  assert.notEqual(p.paymentNumber, "PAY-000001/2000-01");
  assert.equal(p.createdBy, "RSA");
  assert.ok(Math.abs(new Date(p.entryDateTime).getTime() - before) < 10_000); // server time, not the 2000 value
  assert.ok(p.dieselEntries.every((x: any) => Math.abs(new Date(x.entryAt).getTime() - before) < 10_000)); // every fuel entry stamped by the server
  assert.equal(p.totalPayable, 1000.5 + 200 + 150.25 + 500 + 120.1 - 20); // 1950.85
  assert.deepEqual([p.dieselTotal, p.expenseTotal, p.deductTotal], [1200.5, 120.1, 20]);
  assert.deepEqual([p.foodAmount, p.salaryAdvance, p.cashInHand, p.paymentFor, p.paymentStatus], [150.25, 500, true, "SIGNAGE", "ENTERED"]);
  assert.deepEqual([p.trackupNumber, p.pifNumber, p.clientName, p.vehicleNo, p.driverNumber, p.driverName, p.campaignFromDate, p.campaignToDate], [A.trackupNumber, A.pifNumber, "Kensign Lifestyles", alA.vehicle.vehicleNo, drvA.driverNumber, "Sampath Madhu", d(0), d(9)]);
  assert.deepEqual(p.expenses.map((e: any) => [e.optionLabel, e.description, e.amount, e.deduct]), [["Toll", "Salem toll", 120.1, false], ["Others", "Parking refund", 20, true]]);
  assert.deepEqual([p.dieselEntries[0].mode, p.dieselEntries[0].reference, p.mode], ["ePayment", "AXIS IMPS", "Cash in Hand"]);
  assert.deepEqual([p.bankName, p.chequeNo], [null, null]); // not captured: shown as empty, never "undefined"
  const saved: any = await RsaPayment.findById(p._id).lean();
  assert.equal(String(saved.trackingVehicle), tv(A));
  assert.equal(saved.totalPayable, 1950.85);
  assert.equal(saved.paymentStatus, "ENTERED"); // saving is not a bank transfer
});

test("save: Payment For must match the real project type (Roadshow / Signage); both are accepted for their own project", async () => {
  const bad = await savePay(A, { paymentFor: "ROADSHOW" });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /must be Signage/);
  const badB = await savePay(B, { paymentFor: "SIGNAGE" });
  assert.equal(badB.status, 400);
  assert.match(badB.body.message, /must be Roadshow/);
  assert.equal((await savePay(A, { paymentFor: "SIGNAGE" })).status, 201);
  const rb = await savePay(B, { paymentFor: "ROADSHOW", cashInHand: false });
  assert.equal(rb.status, 201, JSON.stringify(rb.body));
  assert.deepEqual([rb.body.data.paymentFor, rb.body.data.cashInHand, rb.body.data.campaignFromDate, rb.body.data.campaignToDate], ["ROADSHOW", false, d(0), d(8)]);
});

test("save: invalid amounts and entries are rejected with the standard envelope and nothing is stored", async () => {
  const before = await RsaPayment.countDocuments();
  for (const bad of [
    { foodAmount: "abc" }, { foodAmount: "-5" }, { salaryAdvance: "1e3" }, { foodAmount: "1.234" }, { foodAmount: undefined }, { foodAmount: "0" },
    { expenses: [{ optionKey: "Others #1", amount: "5" }] }, { expenses: [{ optionKey: "TOLL", amount: "x" }] }, { dieselEntries: [{ amount: "-1" }] }, { dieselEntries: "nope" },
    { foodAmount: "5", expenses: [{ optionKey: "TOLL", amount: "10", deduct: true }] },
  ]) {
    const r = await savePay(A, bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.body.success, false);
    assert.equal(r.body.data, null);
  }
  assert.equal((await rsa(`/projects/${tv(A)}/payments`, "POST", { foodAmount: "10" })).status, 400); // no submission key
  assert.equal(await RsaPayment.countDocuments(), before);
});

test("duplicate submissions: the same key returns the saved payment; simultaneous double-clicks create one entry; each new key is a new payment", async () => {
  const key = "dup-key-123456789";
  const body = { idempotencyKey: key, foodAmount: "77.70", expenses: [{ optionKey: "PERMIT", amount: "5" }] };
  const first = await rsa(`/projects/${tv(B)}/payments`, "POST", body);
  assert.equal(first.status, 201);
  const again = await rsa(`/projects/${tv(B)}/payments`, "POST", body);
  assert.equal(again.status, 200);
  assert.equal(again.body.message, "Payment was already saved");
  assert.equal(again.body.data._id, first.body.data._id);
  assert.equal(again.body.data.paymentNumber, first.body.data.paymentNumber);
  const k2 = "par-key-123456789";
  const rs = await Promise.all(Array.from({ length: 8 }, () => rsa(`/projects/${tv(B)}/payments`, "POST", { idempotencyKey: k2, foodAmount: "11" })));
  assert.ok(rs.every((r) => r.status === 201 || r.status === 200), JSON.stringify(rs.map((r) => r.status)));
  assert.equal(new Set(rs.map((r) => r.body.data._id)).size, 1);
  assert.equal(await RsaPayment.countDocuments({ trackingVehicle: B._id, idempotencyKey: k2 }), 1);
  const other = await rsa(`/projects/${tv(B)}/payments`, "POST", { idempotencyKey: "another-key-1234", foodAmount: "77.70", expenses: [{ optionKey: "PERMIT", amount: "5" }] }); // same content, new key: allowed
  assert.equal(other.status, 201);
  assert.notEqual(other.body.data.paymentNumber, first.body.data.paymentNumber);
});

test("payment numbers are unique under concurrent saves for different projects and keys", async () => {
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => savePay(i % 2 ? A : B, { foodAmount: String(10 + i) })));
  assert.ok(rs.every((r) => r.status === 201), JSON.stringify(rs.map((r) => r.status)));
  const nums = rs.map((r) => r.body.data.paymentNumber);
  assert.equal(new Set(nums).size, 20);
  const all = (await RsaPayment.find().select("paymentNumber").lean()).map((x: any) => x.paymentNumber);
  assert.equal(new Set(all).size, all.length);
  const seqs = nums.map((n: string) => Number(n.slice(4, 10))).sort((a: number, b: number) => a - b);
  assert.ok(seqs.every((s: number, i: number) => i === 0 || s > seqs[i - 1])); // strictly increasing counter
});

// ================================================================== history
test("history: every payment is its own record, latest first with number, time, user, mode; old entries never change", async () => {
  const first = (await savePay(I, { foodAmount: "100" })).body.data;
  await new Promise((r) => setTimeout(r, 15));
  const second = (await savePay(I, { cashInHand: true, foodAmount: "200" })).body.data;
  await new Promise((r) => setTimeout(r, 15));
  const third = (await savePay(I, { dieselEntries: [{ amount: "50", mode: "ePayment" }, { amount: "25", mode: "Fuel Card" }] })).body.data;
  const h = await rsa(`/projects/${tv(I)}/payments`);
  assert.equal(h.status, 200);
  assert.deepEqual(keys(h.body), ["data", "message", "success"]);
  assert.deepEqual(h.body.data.items.map((p: any) => p._id), [third._id, second._id, first._id]);
  assert.equal(h.body.data.total, 3);
  const [a, b, c] = h.body.data.items;
  assert.deepEqual([a.totalPayable, a.mode, b.mode, c.mode], [175, "ePayment, Fuel Card", "Cash in Hand", "—"]);
  assert.ok(h.body.data.items.every((p: any) => p.createdBy === "RSA" && p.paymentNumber && p.entryDateTime && p.paymentStatus === "ENTERED" && p.bankName === null && p.chequeNo === null));
  assert.ok(new Date(a.entryDateTime) > new Date(c.entryDateTime));
  assert.ok(!JSON.stringify(h.body).includes("undefined"));
  assert.deepEqual((await rsa(`/projects/${tv(I)}/payments`)).body.data.items.find((p: any) => p._id === first._id), c); // unchanged on re-read
  const detail = await rsa(`/payments/${second._id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.cashInHand, true);
  assert.equal(detail.body.data.foodAmount, 200);
  assert.equal((await rsa(`/payments/${"0".repeat(24)}`)).status, 404);
  assert.equal((await rsa("/payments/zzz")).status, 400);
  await assert.rejects(() => RsaPayment.updateOne({ _id: first._id }, { $set: { totalPayable: 1 } }), /immutable/);
  await assert.rejects(() => RsaPayment.deleteOne({ _id: first._id }), /immutable/);
  await assert.rejects(() => RsaPayment.findOneAndUpdate({ _id: first._id }, { $set: { foodAmount: 1 } }), /immutable/);
  assert.equal(((await RsaPayment.findById(first._id).lean()) as any).totalPayable, 100);
  // dashboard status follows
  const row = (await list(`?q=${encodeURIComponent(I.trackupNumber)}`)).items[0];
  assert.deepEqual([row.paymentStatus, row.paymentCount], ["ENTERED", 3]);
  assert.equal(new Date(row.lastPaymentAt).getTime(), new Date(third.entryDateTime).getTime());
  assert.ok((await list("?paymentStatus=ENTERED")).items.length >= 1);
});

test("history: pagination and per-project separation", async () => {
  const p1 = (await rsa(`/projects/${tv(A)}/payments?limit=2&page=1`)).body.data;
  const p2 = (await rsa(`/projects/${tv(A)}/payments?limit=2&page=2`)).body.data;
  assert.equal(p1.items.length, 2);
  assert.ok(p1.total > 2);
  assert.equal(new Set([...p1.items, ...p2.items].map((p: any) => p._id)).size, p1.items.length + p2.items.length);
  assert.ok(p1.items.every((p: any) => p.trackupNumber === A.trackupNumber)); // other projects' payments are never mixed in
  assert.equal((await rsa(`/projects/${"0".repeat(24)}/payments`)).status, 404);
  assert.equal((await rsa("/projects/zzz/payments")).status, 400);
});

// ================================================================== read-only side panels
test("View Budget: approved amount, approved version, version history and RSOM approval details; read-only", async () => {
  await BudgetVersion.create({ budget: (await Budget.findOne({ vehicle: A._id }).lean() as any)._id, version: 1, data: { foodAmount: 100 }, total: 125000.5, updatedBy: "RBP" });
  const r = await rsa(`/projects/${tv(A)}/budget`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(keys(r.body), ["data", "message", "success"]);
  const b = r.body.data;
  assert.deepEqual([b.approvedAmount, b.approvedVersion, b.currentVersion, b.approvedBy], [125000.5, 1, 1, "RSOM"]);
  assert.ok(b.approvedAt && b.budgetNumber);
  assert.deepEqual(b.versions.map((v: any) => [v.version, v.approved]), [[1, true]]);
  assert.equal(b.data.foodAmount, 100);
  for (const m of ["PUT", "POST", "DELETE"] as const) assert.ok([403, 404].includes((await rsa(`/projects/${tv(A)}/budget`, m, {})).status), m); // there is no write route for budgets
  assert.equal((await call(`/budgets/${b.budgetNumber}`, "PUT", {}, (await T()).rsa)).status, 403);
  assert.equal((await rsa(`/projects/${tv(E)}/budget`)).status, 409); // not approved: not viewable here
});

test("View Driver: read-only details with masked bank, availability, advance history and allotment; Check Advance Eligibility calculates only", async () => {
  const rbp = (await T()).rbp;
  const adv = await call(`/drivers/${drvA._id}/advances`, "POST", { workingDays: 10, idempotencyKey: "rsa-seed-advance-1" }, rbp);
  assert.equal(adv.status, 201, JSON.stringify(adv.body));
  const r = await rsa(`/projects/${tv(A)}/driver`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const x = r.body.data;
  assert.deepEqual([x.driverNumber, x.driverName, x.driverType, x.mobileNumber, x.perDaySalary], [drvA.driverNumber, "Sampath Madhu", "COMPANY_DRIVER", drvA.mobileNumber, 370]);
  assert.deepEqual(x.bank, { accountName: "Rsa Driver", bankName: "SBI", accountNumberMasked: "XXXXXXXX9012", ifscCode: "SBIN0001234" });
  assert.ok(!JSON.stringify(r.body).includes("123456789012")); // the full account number never reaches RSA
  assert.equal(x.availability.status, "IN_USE");
  assert.equal(x.availability.trackupNumber, A.trackupNumber);
  assert.equal(x.advances.length, 1);
  assert.deepEqual([x.advances[0].workingDays, x.advances[0].finalAdvanceAmount, x.advances[0].submittedBy], [10, 1500, "RBP"]);
  assert.deepEqual([x.allotment.vehicleNo, x.allotment.driverActive, x.allotment.driverAssignedBy], [alA.vehicle.vehicleNo, true, "RBP"]);
  assert.ok(x.allotment.allottedAt && x.allotment.driverAssignedAt);
  assert.ok([403, 404].includes((await rsa(`/projects/${tv(A)}/driver`, "PUT", {})).status));

  const advBefore = await DriverAdvance.countDocuments();
  const el = await rsa(`/projects/${tv(A)}/advance-eligibility?workingDays=10`);
  assert.equal(el.status, 200, JSON.stringify(el.body));
  assert.deepEqual([el.body.data.workingDays, el.body.data.perDaySalary, el.body.data.eligibleAdvanceAmount, el.body.data.halfEligibleAmount, el.body.data.finalAdvanceAmount], [10, 370, 3700, 1850, 1500]);
  const el2 = await rsa(`/projects/${tv(B)}/advance-eligibility?workingDays=7`); // 500 x 7 = 3500 -> 1750 -> 1500
  assert.deepEqual([el2.body.data.eligibleAdvanceAmount, el2.body.data.finalAdvanceAmount], [3500, 1500]);
  for (const bad of ["", "0", "-2", "abc", "1.5", "367"]) assert.equal((await rsa(`/projects/${tv(A)}/advance-eligibility?workingDays=${bad}`)).status, 400, bad);
  assert.equal((await rsa(`/projects/${tv(A)}/advance-eligibility`)).status, 400);
  assert.equal(await DriverAdvance.countDocuments(), advBefore); // checking never creates an advance
  assert.equal((await rsa(`/projects/${tv(A)}/advance-eligibility?workingDays=10`, "POST", {})).status, 404); // no write route
  const none = await mkDriver({ salary: undefined, driverName: "No Salary Man" });
  const nz = await allotTo(sig.vehicles[8], none).catch(() => null);
  void nz;
});

// ================================================================== regression
test("regression: RSA activity changes nothing in tracking, budgets, allotments, drivers or driver advances", async () => {
  const snap = async () => JSON.stringify({
    tp: await TrackingProject.find().sort({ _id: 1 }).lean(), tvs: await TrackingVehicle.find().sort({ _id: 1 }).lean(), b: await Budget.find().sort({ _id: 1 }).lean(),
    al: await VehicleAllotment.find().sort({ _id: 1 }).lean(), ev: await AllotmentEvent.find().sort({ _id: 1 }).lean(), dr: await Driver.find().sort({ _id: 1 }).lean(), adv: await DriverAdvance.find().sort({ _id: 1 }).lean(),
    veh: await Vehicle.find().sort({ _id: 1 }).lean(),
  });
  const before = await snap();
  await savePay(A, { foodAmount: "12.34", salaryAdvance: "100" });
  await savePay(B, { cashInHand: true, dieselEntries: [{ amount: "10" }] });
  await rsa(`/projects/${tv(A)}`);
  await rsa(`/projects/${tv(A)}/budget`);
  await rsa(`/projects/${tv(A)}/driver`);
  await rsa(`/projects/${tv(A)}/advance-eligibility?workingDays=12`);
  await list("?limit=100");
  assert.equal(await snap(), before);
  // the other roles still work as before
  const t = await T();
  for (const [p, tok] of [["/tracking", t.rsop], ["/tracking", t.rbp], ["/approvals", t.rsom], ["/vehicles", t.rbp], ["/vehicle-allotments", t.rbp], ["/drivers", t.rbp], ["/health", t.rbp]] as const) {
    const r = await call(p, "GET", undefined, tok);
    assert.equal(r.status, 200, p);
    assert.deepEqual(keys(r.body), ["data", "message", "success"], p);
  }
  for (const p of ["/rsa/projects", "/rsa/options", `/rsa/projects/${tv(A)}`, `/rsa/projects/${tv(A)}/payments`, `/rsa/projects/${tv(A)}/budget`, `/rsa/projects/${tv(A)}/driver`, `/rsa/projects/${tv(A)}/advance-eligibility?workingDays=5`, `/rsa/projects/${tv(E)}`]) {
    const r = await call(p, "GET", undefined, t.rsa);
    assert.deepEqual(keys(r.body), ["data", "message", "success"], p); // sendResponse envelope on success and on errors
  }
});

test("cleanup", async () => {
  assert.match(mongoose.connection.name, /_test_/);
  await mongoose.connection.dropDatabase();
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
});
