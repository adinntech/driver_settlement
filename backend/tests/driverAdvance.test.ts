/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_driver_advance";
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
cfg.mongoUri = "mongodb://127.0.0.1:27017/driver_settlement_test_driver_advance";
cfg.storage.type = "local";
const { calculateAdvance, isValidWorkingDays } = await import("../src/utils/advance.js");
const { validateAdvanceInput } = await import("../src/services/advance.service.js");
const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { User } = await import("../src/models/User.js");
const { Driver, DriverHistory } = await import("../src/models/Driver.js");
const { DriverAdvance } = await import("../src/models/DriverAdvance.js");

let server: Server;
let base = "";
{
  await connectDB();
  assert.match(mongoose.connection.name, /_test_/, "refusing to drop a non-test database");
  await mongoose.connection.dropDatabase();
  await Promise.all([User.init(), Driver.init(), DriverHistory.init(), DriverAdvance.init()]);
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
const keys = (b: any) => Object.keys(b).sort();

let phone = 9100000000;
const mkDriver = async (over: Record<string, unknown> = {}) => {
  const r = await call("/drivers", "POST", {
    driverName: "Advance Driver", driverType: "COMPANY_DRIVER", mobileNumber: String(phone++), salary: 370, accountName: "Advance Driver", accountNumber: "123456789012", ifscCode: "SBIN0001234", bankName: "SBI", ...over,
  }, (await T()).rbp);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data as any;
};
let kseq = 0;
const key = () => `adv-key-${Date.now()}-${kseq++}`;
const submit = async (driverId: string, body: Record<string, unknown>) => call(`/drivers/${driverId}/advances`, "POST", { idempotencyKey: key(), ...body }, (await T()).rbp);
const list = async (driverId: string, qs = "") => (await call(`/drivers/${driverId}/advances${qs}`, "GET", undefined, (await T()).rbp)).body;

// ================================================================== calculation (pure)
test("calculation: working days x per day salary, half, rounded DOWN to the nearest 500", () => {
  const table: [number, number, number, number, number][] = [ // workingDays, salary, eligible, half, final
    [10, 370, 3700, 1850, 1500],
    [10, 400, 4000, 2000, 2000],
    [10, 490, 4900, 2450, 2000],
    [10, 500, 5000, 2500, 2500],
    [10, 620, 6200, 3100, 3000],
  ];
  for (const [d, s, e, h, f] of table) {
    const c = calculateAdvance(d, s);
    assert.deepEqual([c.eligibleAdvanceAmount, c.calculatedHalfAmount, c.finalAdvanceAmount], [e, h, f], `${e}`);
    assert.equal(c.finalAdvanceAmount, Math.floor(e / 2 / 500) * 500); // the specified formula
  }
  assert.equal(calculateAdvance(1, 999).finalAdvanceAmount, 0); // 499.50 -> 0, never rounded up
  assert.equal(calculateAdvance(2, 999).finalAdvanceAmount, 500); // 999 -> 500
  assert.equal(calculateAdvance(1, 1000).finalAdvanceAmount, 500);
  assert.equal(calculateAdvance(7, 360).finalAdvanceAmount, 1000); // 2520/2 = 1260 -> 1000 (nearest would be 1500)
  assert.equal(calculateAdvance(30, 1000).finalAdvanceAmount, 15000);
});

test("calculation: decimal salaries keep exact currency precision (no floating-point drift)", () => {
  const c = calculateAdvance(3, 370.55);
  assert.equal(c.eligibleAdvanceAmount, 1111.65);
  assert.equal(c.calculatedHalfAmount, 555.83); // 555.825 shown to 2 places
  assert.equal(c.finalAdvanceAmount, 500);
  assert.equal(calculateAdvance(3, 0.1).eligibleAdvanceAmount, 0.3); // 3 x 0.1 is 0.30000000000000004 in floating point
  assert.equal(calculateAdvance(100, 19.99).eligibleAdvanceAmount, 1999);
  assert.equal(calculateAdvance(10, 99.99).eligibleAdvanceAmount, 999.9);
  assert.equal(calculateAdvance(20, 100.05).finalAdvanceAmount, 1000); // 2001 / 2 = 1000.5 -> 1000
  assert.equal(calculateAdvance(20, 99.95).finalAdvanceAmount, 500); // 1999 / 2 = 999.5 -> 500 (a naive round would give 1000)
  assert.equal(calculateAdvance(10, 100).perDaySalary, 100);
});

test("input validation: positive whole working days only; only the days and the key are read from the request", () => {
  for (const ok of [1, 10, 31, 366, "10", " 15 "]) assert.deepEqual(validateAdvanceInput({ workingDays: ok, idempotencyKey: "abcdefgh1234" }).errors, [], String(ok));
  for (const bad of [0, -1, -10, 1.5, "1.5", "abc", "1e2", "", null, undefined, 367, NaN, "0", [], {}, true]) {
    assert.ok(validateAdvanceInput({ workingDays: bad, idempotencyKey: "abcdefgh1234" }).errors.length > 0, JSON.stringify(bad));
  }
  assert.ok(validateAdvanceInput({ workingDays: 5 }).errors.some((e) => /submission key/.test(e)));
  assert.ok(validateAdvanceInput({ workingDays: 5, idempotencyKey: "short" }).errors.length > 0);
  assert.ok(validateAdvanceInput({ workingDays: 5, idempotencyKey: "has space in it!" }).errors.length > 0);
  const v = validateAdvanceInput({ workingDays: "12", idempotencyKey: "abcdefgh1234", finalAdvanceAmount: 99999, perDaySalary: 1 });
  assert.deepEqual(v.data, { workingDays: 12, idempotencyKey: "abcdefgh1234" }); // client amounts are not even read
  assert.equal(isValidWorkingDays(0), false);
  assert.equal(isValidWorkingDays(2.5), false);
});

// ================================================================== submission
test("submit: backend recalculates from the saved salary, records the driver, the RBP user and the exact time; standard envelope", async () => {
  const d = await mkDriver({ salary: 370 });
  const t0 = Date.now();
  const r = await submit(d._id, { workingDays: 10 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(keys(r.body), ["data", "message", "success"]);
  assert.equal(r.body.message, "Advance submitted successfully");
  const a = r.body.data;
  assert.deepEqual([a.workingDays, a.perDaySalary, a.eligibleAdvanceAmount, a.calculatedHalfAmount, a.finalAdvanceAmount, a.roundingUnit, a.roundingMethod],
    [10, 370, 3700, 1850, 1500, 500, "FLOOR_TO_UNIT"]);
  assert.deepEqual([a.driver, a.driverNumber, a.driverName, a.submittedBy], [d._id, d.driverNumber, "Advance Driver", "RBP"]); // correct driver mapping + user
  const at = new Date(a.submittedAt).getTime();
  assert.ok(at >= t0 - 1000 && at <= Date.now() + 1000); // server time, not client supplied
  const saved: any = await DriverAdvance.findById(a._id).lean();
  assert.equal(saved.finalAdvanceAmount, 1500);
  assert.equal(String(saved.driver), d._id);
});

test("submit: frontend manipulation cannot change any amount; only working days and the key matter", async () => {
  const d = await mkDriver({ salary: 370 });
  const r = await submit(d._id, { workingDays: 10, perDaySalary: 9999, eligibleAdvanceAmount: 99999, calculatedHalfAmount: 1, finalAdvanceAmount: 50000, roundingUnit: 1, submittedBy: "someone-else", submittedAt: "2000-01-01T00:00:00Z", driverNumber: "DR-0000", driver: "0".repeat(24) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual([r.body.data.perDaySalary, r.body.data.eligibleAdvanceAmount, r.body.data.finalAdvanceAmount, r.body.data.roundingUnit, r.body.data.submittedBy, r.body.data.driverNumber, r.body.data.driver],
    [370, 3700, 1500, 500, "RBP", d.driverNumber, d._id]);
  assert.ok(new Date(r.body.data.submittedAt).getFullYear() >= 2026);
});

test("submit: examples from the specification through the API (3700 / 4000 / 4900 / 5000 / 6200)", async () => {
  const cases: [number, number, number][] = [[370, 10, 1500], [400, 10, 2000], [490, 10, 2000], [500, 10, 2500], [620, 10, 3000]];
  for (const [salary, days, expected] of cases) {
    const d = await mkDriver({ salary });
    const r = await submit(d._id, { workingDays: days });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.finalAdvanceAmount, expected, `${salary * days}`);
  }
  const dec = await mkDriver({ salary: 370.55 });
  const r = await submit(dec._id, { workingDays: 3 });
  assert.deepEqual([r.body.data.eligibleAdvanceAmount, r.body.data.finalAdvanceAmount], [1111.65, 500]);
});

test("submit: missing salary, zero / negative / invalid working days, unknown driver and a too small amount are refused; nothing is saved", async () => {
  const none = await mkDriver({ salary: undefined }); // salary defaults to 0 = not set
  const before = await DriverAdvance.countDocuments();
  const noSalary = await submit(none._id, { workingDays: 10 });
  assert.equal(noSalary.status, 400);
  assert.match(noSalary.body.message, /Driver salary is unavailable/);
  assert.equal(noSalary.body.data, null);
  assert.equal(noSalary.body.success, false);
  const d = await mkDriver({ salary: 370 });
  for (const bad of [0, -3, 1.5, "abc", "", null, 400, "1e2"]) {
    const r = await submit(d._id, { workingDays: bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.body.data, null);
  }
  assert.equal((await call(`/drivers/${d._id}/advances`, "POST", { workingDays: 5 }, (await T()).rbp)).status, 400); // no key
  assert.equal((await submit("0".repeat(24), { workingDays: 5 })).status, 404);
  assert.equal((await submit("zzz", { workingDays: 5 })).status, 400);
  const low = await mkDriver({ salary: 100 });
  const l = await submit(low._id, { workingDays: 9 }); // 900 / 2 = 450 -> 0
  assert.equal(l.status, 400);
  assert.match(l.body.message, /too low/);
  assert.equal(await DriverAdvance.countDocuments(), before);
});

test("access: RBP only; unauthenticated 401, RSOP / RSOM 403", async () => {
  const t = await T();
  const d = await mkDriver();
  for (const [m, p] of [["GET", `/drivers/${d._id}/advances`], ["POST", `/drivers/${d._id}/advances`], ["GET", `/drivers/${d._id}/advances/${"a".repeat(24)}`]] as const) {
    assert.equal((await call(p, m, m === "POST" ? { workingDays: 5, idempotencyKey: "abcdefgh1234" } : undefined)).status, 401, p);
    for (const tok of [t.rsop, t.rsom]) {
      const r = await call(p, m, m === "POST" ? { workingDays: 5, idempotencyKey: "abcdefgh1234" } : undefined, tok);
      assert.equal(r.status, 403, p);
      assert.deepEqual(keys(r.body), ["data", "message", "success"]);
    }
  }
  assert.equal(await DriverAdvance.countDocuments({ driver: d._id }), 0);
});

// ================================================================== idempotency
test("duplicate submissions: the same key (double-click / retry) returns the saved advance and never creates a second one", async () => {
  const d = await mkDriver();
  const k = key();
  const first = await call(`/drivers/${d._id}/advances`, "POST", { workingDays: 10, idempotencyKey: k }, (await T()).rbp);
  assert.equal(first.status, 201);
  const again = await call(`/drivers/${d._id}/advances`, "POST", { workingDays: 10, idempotencyKey: k }, (await T()).rbp);
  assert.equal(again.status, 200);
  assert.equal(again.body.message, "Advance was already submitted");
  assert.equal(again.body.data._id, first.body.data._id);
  assert.equal(again.body.data.submittedAt, first.body.data.submittedAt);
  assert.equal(await DriverAdvance.countDocuments({ driver: d._id }), 1);
  const clash = await call(`/drivers/${d._id}/advances`, "POST", { workingDays: 12, idempotencyKey: k }, (await T()).rbp); // same key, different days
  assert.equal(clash.status, 409);
  assert.equal(await DriverAdvance.countDocuments({ driver: d._id }), 1);
  // a salary change between the retry and the original does not create or alter anything either
  await Driver.updateOne({ _id: d._id }, { $set: { salary: 999 } });
  const retry = await call(`/drivers/${d._id}/advances`, "POST", { workingDays: 10, idempotencyKey: k }, (await T()).rbp);
  assert.equal(retry.body.data.perDaySalary, 370);
  assert.equal(await DriverAdvance.countDocuments({ driver: d._id }), 1);
});

test("simultaneous double submit: 8 parallel requests with one key produce exactly one record", async () => {
  const d = await mkDriver();
  const k = key();
  const t = (await T()).rbp;
  const rs = await Promise.all(Array.from({ length: 8 }, () => call(`/drivers/${d._id}/advances`, "POST", { workingDays: 10, idempotencyKey: k }, t)));
  assert.ok(rs.every((r) => r.status === 201 || r.status === 200), JSON.stringify(rs.map((r) => r.status)));
  assert.equal(rs.filter((r) => r.status === 201).length, 1);
  assert.equal(new Set(rs.map((r) => r.body.data._id)).size, 1);
  assert.equal(await DriverAdvance.countDocuments({ driver: d._id }), 1);
  const other = await mkDriver(); // the same key on another driver is a different submission
  assert.equal((await call(`/drivers/${other._id}/advances`, "POST", { workingDays: 10, idempotencyKey: k }, t)).status, 201);
});

// ================================================================== history
test("history: every advance is its own record, latest first, previous records untouched, salary changes never alter them", async () => {
  const t = (await T()).rbp;
  const d = await mkDriver({ salary: 370 });
  const a1 = (await submit(d._id, { workingDays: 10 })).body.data;
  await new Promise((r) => setTimeout(r, 15));
  await Driver.updateOne({ _id: d._id }, { $set: { salary: 400 } }); // salary raised afterwards
  const a2 = (await submit(d._id, { workingDays: 10 })).body.data;
  await new Promise((r) => setTimeout(r, 15));
  const a3 = (await submit(d._id, { workingDays: 5 })).body.data;
  assert.equal(new Set([a1._id, a2._id, a3._id]).size, 3);
  const h = await list(d._id);
  assert.deepEqual(keys(h), ["data", "message", "success"]);
  assert.deepEqual(h.data.items.map((x: any) => x._id), [a3._id, a2._id, a1._id]); // latest first
  assert.equal(h.data.total, 3);
  const by = Object.fromEntries(h.data.items.map((x: any) => [x._id, x]));
  assert.deepEqual([by[a1._id].perDaySalary, by[a1._id].eligibleAdvanceAmount, by[a1._id].finalAdvanceAmount], [370, 3700, 1500]); // old calculation unchanged
  assert.deepEqual([by[a2._id].perDaySalary, by[a2._id].eligibleAdvanceAmount, by[a2._id].finalAdvanceAmount], [400, 4000, 2000]);
  assert.deepEqual([by[a3._id].workingDays, by[a3._id].eligibleAdvanceAmount, by[a3._id].finalAdvanceAmount], [5, 2000, 1000]);
  assert.ok(h.data.items.every((x: any) => x.submittedBy === "RBP" && x.submittedAt));
  assert.ok(new Date(h.data.items[0].submittedAt) > new Date(h.data.items[2].submittedAt));
  const d1 = await call(`/drivers/${d._id}/advances/${a1._id}`, "GET", undefined, t);
  assert.equal(d1.status, 200);
  assert.deepEqual([d1.body.data.workingDays, d1.body.data.perDaySalary, d1.body.data.calculatedHalfAmount, d1.body.data.roundingUnit, d1.body.data.roundingMethod, d1.body.data.idempotencyKey.length > 0], [10, 370, 1850, 500, "FLOOR_TO_UNIT", true]);
  assert.equal((await Driver.findById(d._id).lean() as any).salary, 400); // advances never touch the driver's salary
});

test("history: records are immutable; another driver's advances are never shown or returned", async () => {
  const t = (await T()).rbp;
  const d1 = await mkDriver();
  const d2 = await mkDriver();
  const a1 = (await submit(d1._id, { workingDays: 10 })).body.data;
  await submit(d2._id, { workingDays: 10 });
  assert.equal((await list(d1._id)).data.total, 1);
  assert.equal((await list(d2._id)).data.items.every((x: any) => x.driver === d2._id), true);
  assert.equal((await call(`/drivers/${d2._id}/advances/${a1._id}`, "GET", undefined, t)).status, 404); // wrong driver
  assert.equal((await call(`/drivers/${d1._id}/advances/${"0".repeat(24)}`, "GET", undefined, t)).status, 404);
  assert.equal((await call(`/drivers/${d1._id}/advances/zzz`, "GET", undefined, t)).status, 400);
  assert.equal((await call(`/drivers/${"0".repeat(24)}/advances`, "GET", undefined, t)).status, 404);
  assert.equal((await call(`/drivers/zzz/advances`, "GET", undefined, t)).status, 400);
  await assert.rejects(() => DriverAdvance.updateOne({ _id: a1._id }, { $set: { finalAdvanceAmount: 1 } }), /immutable/);
  await assert.rejects(() => DriverAdvance.deleteOne({ _id: a1._id }), /immutable/);
  await assert.rejects(() => DriverAdvance.findOneAndUpdate({ _id: a1._id }, { $set: { workingDays: 1 } }), /immutable/);
  assert.equal(((await DriverAdvance.findById(a1._id).lean()) as any).finalAdvanceAmount, 1500);
  const empty = await mkDriver();
  const e = await list(empty._id);
  assert.deepEqual([e.data.items.length, e.data.total, e.success], [0, 0, true]); // empty history is a normal result
});

test("history: server-side pagination with totals, page size cap, no overlap between pages", async () => {
  const d = await mkDriver();
  for (let i = 0; i < 7; i++) {
    await submit(d._id, { workingDays: 10 + i });
    await new Promise((r) => setTimeout(r, 4));
  }
  const p1 = (await list(d._id, "?limit=3&page=1")).data;
  const p2 = (await list(d._id, "?limit=3&page=2")).data;
  const p3 = (await list(d._id, "?limit=3&page=3")).data;
  assert.deepEqual([p1.items.length, p2.items.length, p3.items.length, p1.total, p2.page], [3, 3, 1, 7, 2]);
  const all = [...p1.items, ...p2.items, ...p3.items];
  assert.equal(new Set(all.map((x: any) => x._id)).size, 7);
  assert.deepEqual(all.map((x: any) => x.workingDays), [16, 15, 14, 13, 12, 11, 10]); // newest first across pages
  assert.equal((await list(d._id, "?limit=9999")).data.limit, 100);
  assert.equal((await list(d._id, "?page=0&limit=0")).data.page, 1);
  assert.equal((await list(d._id, "?page=99")).data.items.length, 0);
  assert.equal((await list(d._id)).data.limit, 10); // default
});

// ================================================================== regression
test("regression: Driver Management CRUD, Driver Number, Company / Acting type, bank details and salary are untouched by advances", async () => {
  const t = (await T()).rbp;
  const d = await mkDriver({ driverType: "ACTING_DRIVER", salary: 450.5 });
  await submit(d._id, { workingDays: 12 });
  await submit(d._id, { workingDays: 20 });
  const g = (await call(`/drivers/${d._id}`, "GET", undefined, t)).body.data;
  assert.deepEqual([g.driverNumber, g.driverType, g.salary, g.accountName, g.accountNumber, g.ifscCode, g.bankName, g.status], [d.driverNumber, "ACTING_DRIVER", 450.5, "Advance Driver", "123456789012", "SBIN0001234", "SBI", "ACTIVE"]);
  assert.match(g.driverNumber, /^DR-\d{4,5}$/);
  // the salary is locked in Driver Management once saved, so the revision is applied to the record directly here
  const locked = await call(`/drivers/${d._id}`, "PUT", { driverName: d.driverName, driverType: "ACTING_DRIVER", mobileNumber: d.mobileNumber, salary: 500 }, t);
  assert.equal(locked.status, 403, JSON.stringify(locked.body));
  await mongoose.connection.collection("drivers").updateOne({ _id: new mongoose.Types.ObjectId(String(d._id)) }, { $set: { salary: 500 } });
  const hist = await list(d._id);
  assert.equal(hist.data.total, 2);
  assert.ok(hist.data.items.every((x: any) => x.perDaySalary === 450.5)); // the edit to 500 did not touch past advances
  const next = (await submit(d._id, { workingDays: 10 })).body.data;
  assert.equal(next.perDaySalary, 500); // new advances use the new saved salary
  assert.equal((await DriverHistory.find({ driver: d._id }).lean()).every((x: any) => x.action !== "BANK_UPDATED"), true);
  for (const p of ["/drivers", "/vehicles", "/vehicle-allotments", "/vehicle-allotments/drivers", "/health"]) {
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
