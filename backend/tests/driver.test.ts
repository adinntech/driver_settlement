/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_driver";
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
cfg.mongoUri = "mongodb://127.0.0.1:27017/driver_settlement_test_driver";
cfg.storage.type = "local";
const { createWithDriverNumber, generateDriverNumber, isDriverNumberClash } = await import("../src/utils/driverNumber.js");
const { validateDriver } = await import("../src/validators/driver.validator.js");
const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { User } = await import("../src/models/User.js");
const { Driver } = await import("../src/models/Driver.js");

// ================================================================== driver number (pure)
const clash = () => Object.assign(new Error("E11000 duplicate key"), { code: 11000, keyPattern: { driverNumber: 1 } });

test("driver number: DR- prefix, 4 digits normally, 5 digits when asked", () => {
  for (let i = 0; i < 300; i++) {
    assert.match(generateDriverNumber(), /^DR-[1-9]\d{3}$/);
    assert.match(generateDriverNumber(true), /^DR-[1-9]\d{4}$/);
  }
  assert.equal(isDriverNumberClash(clash()), true);
  assert.equal(isDriverNumberClash(Object.assign(new Error("x"), { code: 11000, keyPattern: { mobileDigits: 1 } })), false);
  assert.equal(isDriverNumberClash(new Error("x")), false);
});

test("driver number: an existing number is detected and a new one is tried", async () => {
  const taken = new Set(["DR-1111", "DR-2222"]);
  const seq = ["DR-1111", "DR-2222", "DR-3333"];
  let i = 0;
  const saved: string[] = [];
  const r = await createWithDriverNumber(
    { exists: async (n) => taken.has(n), insert: async (n) => (saved.push(n), n) },
    () => seq[i++],
  );
  assert.equal(r, "DR-3333");
  assert.equal(i, 3);
  assert.deepEqual(saved, ["DR-3333"]); // the duplicates were never inserted
});

test("driver number: a database-level clash (simultaneous request) retries with a new number", async () => {
  const seq = ["DR-4444", "DR-5555"];
  let i = 0;
  let inserts = 0;
  const r = await createWithDriverNumber(
    { exists: async () => false, insert: async (n) => { inserts++; if (inserts === 1) throw clash(); return n; } },
    () => seq[i++],
  );
  assert.equal(r, "DR-5555");
  assert.equal(inserts, 2);
});

test("driver number: other database errors are not swallowed", async () => {
  const dupMobile = Object.assign(new Error("dup"), { code: 11000, keyPattern: { mobileDigits: 1 } });
  await assert.rejects(createWithDriverNumber({ exists: async () => false, insert: async () => { throw dupMobile; } }, () => "DR-1234"), /dup/);
  await assert.rejects(createWithDriverNumber({ exists: async () => false, insert: async () => { throw new Error("boom"); } }, () => "DR-1234"), /boom/);
});

test("driver number: moves to 5 digits when the 4-digit numbers keep colliding; never reuses an existing 5-digit number", async () => {
  const used = new Set<string>();
  const flags: boolean[] = [];
  let n = 0;
  const five = ["DR-10000", "DR-10000", "DR-10001"]; // the first 5-digit number is already taken too
  const r = await createWithDriverNumber(
    { exists: async (x) => x.length === 7 || used.has(x) || (x === "DR-10000" && used.add(x) && false) /* every 4-digit number exists */, insert: async (x) => x },
    (fiveDigits) => {
      flags.push(fiveDigits);
      return fiveDigits ? five[Math.min(n++, 2)] : `DR-${1000 + flags.length}`;
    },
  );
  assert.match(r, /^DR-\d{5}$/);
  assert.ok(flags.slice(0, 12).every((f) => f === false)); // 4 digits are preferred first
  assert.ok(flags.slice(12).every((f) => f === true));
  // the 4-digit space completely used: still succeeds with 5 digits
  const taken4 = new Set<string>();
  for (let i = 1000; i <= 9999; i++) taken4.add(`DR-${i}`);
  const ok = await createWithDriverNumber({ exists: async (x) => taken4.has(x), insert: async (x) => x });
  assert.match(ok, /^DR-\d{5}$/);
  // a full number space ends in a clear error instead of looping forever
  await assert.rejects(createWithDriverNumber({ exists: async () => true, insert: async (x) => x }), /exhausted/);
});

// ================================================================== validator (pure)
const good = (over: Record<string, unknown> = {}) => ({
  driverName: "Murugan K", driverType: "COMPANY_DRIVER", address: "12, Anna Nagar, Chennai", mobileNumber: "9876543210", accountName: "Murugan K",
  accountNumber: "123456789012", ifscCode: "sbin0001234", bankName: "State Bank of India", licenceNumber: "tn07 2011 0012345", licenceType: "LMV",
  licenceExpiryDate: "2030-05-20", salary: "18500.5", ...over,
});

test("validator: required fields, driver type, phone, licence, IFSC, account, date, salary", () => {
  const ok = validateDriver(good());
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.data?.mobileNumber, "+91 9876543210");
  assert.equal(ok.data?.mobileDigits, "9876543210");
  assert.equal(ok.data?.ifscCode, "SBIN0001234");
  assert.equal(ok.data?.licenceNumber, "TN07 2011 0012345");
  assert.equal(ok.data?.licenceKey, "TN0720110012345");
  assert.equal(ok.data?.salary, 18500.5);
  const minimal = validateDriver({ driverName: "Ravi", driverType: "ACTING_DRIVER", mobileNumber: "+91 98765 43210" });
  assert.deepEqual(minimal.errors, []); // everything else is optional
  assert.equal(minimal.data?.salary, 0);
  assert.equal(minimal.data?.licenceKey, null);
  const e = validateDriver({}).errors;
  for (const m of ["Driver name is required", "Driver type is required", "Mobile number is required"]) assert.ok(e.includes(m), m);
  const v = (over: Record<string, unknown>) => validateDriver(good(over)).errors.join(";");
  assert.match(v({ driverType: "VISITOR" }), /Company Driver or Acting Driver/);
  assert.match(v({ driverType: "company driver" }), /Company Driver or Acting Driver/);
  for (const bad of ["98765", "abcdefghij", "5876543210", "+44 9876543210", "+91 +91 9876543210", "98765432101234"]) assert.match(v({ mobileNumber: bad }), /valid 10-digit Indian mobile/, bad);
  for (const okPhone of ["9876543210", "+91 9876543210", "+919876543210", "91 98765 43210", "09876543210"]) assert.equal(validateDriver(good({ mobileNumber: okPhone })).data?.mobileDigits, "9876543210", okPhone);
  assert.match(v({ driverName: "R2D2" }), /letters, spaces/);
  assert.match(v({ driverName: "<b>x</b>" }), /letters, spaces|invalid characters/);
  assert.match(v({ driverName: "x".repeat(81) }), /too long/);
  assert.match(v({ ifscCode: "SBIN1234" }), /IFSC code is not valid/);
  assert.match(v({ accountNumber: "12ab" }), /Account number must be 6 to 20 digits/);
  assert.match(v({ licenceNumber: "123" }), /Licence number is not valid/);
  assert.match(v({ licenceNumber: "ABCDEFGHIJ" }), /Licence number is not valid/);
  assert.match(v({ licenceExpiryDate: "2030-02-31" }), /valid date/);
  assert.match(v({ licenceExpiryDate: "20/05/2030" }), /valid date/);
  assert.match(v({ salary: "-5" }), /Salary must be a number/);
  assert.match(v({ salary: "abc" }), /Salary must be a number/);
  assert.match(v({ status: "BANNED" }), /Active or Inactive/);
  assert.match(v({ attachment: { name: "x" } }), /Attachment 1 is invalid/);
  assert.equal(validateDriver(good({ driverNumber: "DR-0001" })).data && Object.keys(validateDriver(good({ driverNumber: "DR-0001" })).data!).includes("driverNumber"), false); // never read from input
  assert.equal(validateDriver(good({ licenceExpiryDate: "2020-01-01" })).errors.length, 0); // an expired licence can still be recorded
});

// ================================================================== API
let server: Server;
let base = "";
{
  await connectDB();
  assert.match(mongoose.connection.name, /_test_/, "refusing to drop a non-test database");
  await mongoose.connection.dropDatabase();
  await Promise.all([User.init(), Driver.init()]);
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
let phone = 6000000000;
const mk = (over: Record<string, unknown> = {}) => ({ driverName: "Test Driver", driverType: "COMPANY_DRIVER", mobileNumber: String(phone++), ...over });
const att = (name: string) => ({ storage: "local", key: `driver_settlement/vehicles/2026/123e4567-e89b-12d3-a456-426614174000-${name}`, name, size: 1234, mimeType: "application/pdf" });

test("access: RBP only; unauthenticated 401, RSOP / RSOM 403; standard envelope", async () => {
  const t = await T();
  for (const [m, p] of [["GET", "/drivers"], ["POST", "/drivers"], ["GET", "/drivers/" + "a".repeat(24)], ["PUT", "/drivers/" + "a".repeat(24)]] as const) {
    assert.equal((await call(p, m)).status, 401, p);
    for (const tok of [t.rsop, t.rsom]) {
      const r = await call(p, m, m === "POST" || m === "PUT" ? {} : undefined, tok);
      assert.equal(r.status, 403, p);
      assert.deepEqual(Object.keys(r.body).sort(), ["data", "message", "success"]);
    }
  }
  const bad = await call("/drivers", "POST", {}, t.rbp);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.success, false);
  assert.equal(bad.body.data, null);
  assert.equal((await call("/drivers/not-an-id", "GET", undefined, t.rbp)).status, 400);
  assert.equal((await call("/drivers/" + "0".repeat(24), "GET", undefined, t.rbp)).status, 404);
  assert.equal((await call("/drivers/" + "0".repeat(24), "PUT", mk(), t.rbp)).status, 404);
});

test("create: server-generated DR- number, both driver types persisted, a client-supplied number is ignored", async () => {
  const t = await T();
  const r = await call("/drivers", "POST", { ...good({ mobileNumber: "9876500001", licenceNumber: "TN0720110000001" }), driverNumber: "DR-0000" }, t.rbp);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body).sort(), ["data", "message", "success"]);
  const d = r.body.data;
  assert.match(d.driverNumber, /^DR-\d{4,5}$/);
  assert.notEqual(d.driverNumber, "DR-0000");
  assert.equal(d.driverType, "COMPANY_DRIVER");
  assert.equal(d.mobileNumber, "+91 9876500001");
  assert.equal(d.status, "ACTIVE");
  assert.equal(d.createdBy, "RBP");
  assert.equal(d.salary, 18500.5);
  assert.equal(d.attachment, null);
  const a = await call("/drivers", "POST", mk({ driverType: "ACTING_DRIVER", attachment: att("licence.pdf") }), t.rbp);
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.data.driverType, "ACTING_DRIVER");
  assert.ok(a.body.data.attachment.url.includes("/files/")); // optional attachment stored with the existing storage
  assert.notEqual(a.body.data.driverNumber, d.driverNumber);
  const g = (await call(`/drivers/${a.body.data._id}`, "GET", undefined, t.rbp)).body.data;
  assert.equal(g.driverType, "ACTING_DRIVER"); // restored for Edit / View
  assert.equal(g.attachment.name, "licence.pdf");
});

test("create: invalid input is rejected with the standard envelope and nothing is saved", async () => {
  const t = await T();
  const before = await Driver.countDocuments();
  for (const [over, re] of [
    [{ driverName: "" }, /Driver name is required/],
    [{ driverType: "" }, /Driver type is required/],
    [{ driverType: "BOTH" }, /Company Driver or Acting Driver/],
    [{ mobileNumber: "12345" }, /valid 10-digit Indian mobile/],
    [{ mobileNumber: "98abc43210" }, /valid 10-digit Indian mobile/],
    [{ ifscCode: "XX" }, /IFSC/],
    [{ licenceExpiryDate: "2030-13-01" }, /valid date/],
    [{ salary: "x" }, /Salary/],
    [{ attachment: { storage: "local" } }, /Attachment 1 is invalid/],
  ] as const) {
    const r = await call("/drivers", "POST", mk(over), t.rbp);
    assert.equal(r.status, 400, JSON.stringify(over));
    assert.equal(r.body.data, null);
    assert.match(r.body.message, re);
  }
  assert.equal(await Driver.countDocuments(), before);
});

test("duplicates: same mobile (any format) or same licence number cannot be added twice", async () => {
  const t = await T();
  const first = await call("/drivers", "POST", mk({ mobileNumber: "9000000001", licenceNumber: "KA0120120099999" }), t.rbp);
  assert.equal(first.status, 201);
  for (const m of ["9000000001", "+91 9000000001", "91 90000 00001"]) {
    const r = await call("/drivers", "POST", mk({ mobileNumber: m }), t.rbp);
    assert.equal(r.status, 409, m);
    assert.match(r.body.message, /already exists/);
  }
  const lic = await call("/drivers", "POST", mk({ licenceNumber: "ka01-2012-0099999" }), t.rbp);
  assert.equal(lic.status, 409);
  assert.match(lic.body.message, /licence number/i);
});

test("simultaneous creation: 30 parallel requests all get different driver numbers", async () => {
  const t = await T();
  const before = await Driver.countDocuments();
  const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => call("/drivers", "POST", mk({ driverName: `Parallel ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`, mobileNumber: String(7100000000 + i) }), t.rbp)));
  assert.ok(rs.every((r) => r.status === 201), JSON.stringify(rs.filter((r) => r.status !== 201).map((r) => r.body)));
  const nums = rs.map((r) => r.body.data.driverNumber);
  assert.equal(new Set(nums).size, 30);
  assert.equal(await Driver.countDocuments(), before + 30);
  assert.ok(nums.every((n) => /^DR-\d{4,5}$/.test(n)));
  // the database itself refuses a repeated number
  const any: any = await Driver.findOne().lean();
  await assert.rejects(Driver.create({ ...any, _id: new mongoose.Types.ObjectId(), mobileDigits: "6999999999", licenceKey: undefined }));
});

test("edit: restores saved details, keeps the Driver Number, creates no duplicate, no-change is refused", async () => {
  const t = await T();
  const c = (await call("/drivers", "POST", good({ mobileNumber: "9111111111", licenceNumber: "TN0720110000111", driverType: "ACTING_DRIVER" }), t.rbp)).body.data;
  const body = { ...good({ mobileNumber: "9111111111", licenceNumber: "TN0720110000111", driverType: "ACTING_DRIVER" }), driverNumber: "DR-9999" };
  assert.equal((await call(`/drivers/${c._id}`, "PUT", body, t.rbp)).status, 400); // nothing changed
  const before = await Driver.countDocuments();
  const u = await call(`/drivers/${c._id}`, "PUT", { ...body, driverName: "Murugan Kumar", driverType: "COMPANY_DRIVER", salary: 20000, status: "INACTIVE" }, t.rbp);
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.equal(u.body.data.driverNumber, c.driverNumber); // never regenerated, never client-set
  assert.equal(u.body.data._id, c._id);
  assert.equal(u.body.data.driverName, "Murugan Kumar");
  assert.equal(u.body.data.driverType, "COMPANY_DRIVER");
  assert.equal(u.body.data.salary, 20000);
  assert.equal(u.body.data.status, "INACTIVE");
  assert.equal(u.body.data.updatedBy, "RBP");
  assert.equal(u.body.data.createdBy, "RBP");
  assert.equal(await Driver.countDocuments(), before); // update, not insert
  const g = (await call(`/drivers/${c._id}`, "GET", undefined, t.rbp)).body.data;
  for (const k of ["address", "accountName", "accountNumber", "ifscCode", "bankName", "licenceNumber", "licenceType", "licenceExpiryDate"]) assert.equal(g[k], c[k], k);
  assert.equal(g.driverNumber, c.driverNumber);
  // keeping the own mobile / licence is fine, taking another driver's is not
  const other = (await call("/drivers", "POST", mk({ mobileNumber: "9222222222", licenceNumber: "TN0720110000222" }), t.rbp)).body.data;
  assert.equal((await call(`/drivers/${c._id}`, "PUT", { ...body, driverName: "Murugan K", mobileNumber: "9222222222" }, t.rbp)).status, 409);
  assert.equal((await call(`/drivers/${c._id}`, "PUT", { ...body, driverName: "Murugan K", licenceNumber: "TN0720110000222" }, t.rbp)).status, 409);
  assert.equal((await call(`/drivers/${c._id}`, "PUT", { ...body, driverName: "Murugan K2", driverType: "NOPE" }, t.rbp)).status, 400);
  assert.ok(other);
});

test("listing: latest first, one mass search over number / name / mobile / licence / type, pagination and totals on the server", async () => {
  const t = await T();
  const mkd = async (over: Record<string, unknown>) => (await call("/drivers", "POST", over, t.rbp)).body.data;
  const a = await mkd(mk({ driverName: "Zebulon Searchable", mobileNumber: "9333344444", licenceNumber: "MH1220150055555", driverType: "ACTING_DRIVER" }));
  const b = await mkd(mk({ driverName: "Quentin Other", mobileNumber: "9333355555", licenceNumber: "MH1220150066666" }));
  const list = async (qs = "") => (await call(`/drivers?limit=100&${qs}`, "GET", undefined, t.rbp)).body.data;
  const all = await list();
  assert.ok(all.total >= 35);
  for (let i = 1; i < all.items.length; i++) assert.ok(new Date(all.items[i - 1].createdAt) >= new Date(all.items[i].createdAt)); // latest first
  assert.equal(all.items[0]._id, b._id);
  const ids = async (q: string) => (await list(`q=${encodeURIComponent(q)}`)).items.map((x: any) => x._id);
  assert.deepEqual(await ids(a.driverNumber), [a._id].concat((await ids(a.driverNumber)).filter((x: string) => x !== a._id))); // by driver number
  assert.ok((await ids(a.driverNumber.toLowerCase())).includes(a._id));
  assert.ok((await ids(a.driverNumber.slice(3))).includes(a._id)); // digits only
  assert.deepEqual(await ids("zebulon"), [a._id]); // by name
  assert.deepEqual(await ids("searchable"), [a._id]);
  for (const m of ["9333344444", "+91 9333344444", "93333 44444", "333344", "+919333344444"]) assert.deepEqual(await ids(m), [a._id], m); // by mobile
  for (const l of ["MH1220150055555", "mh12-2015-0055555", "MH12 2015 0055555", "0055555"]) assert.deepEqual(await ids(l), [a._id], l); // by licence
  assert.ok((await ids("acting")).includes(a._id) && !(await ids("acting")).includes(b._id)); // by driver type
  assert.ok((await ids("company driver")).includes(b._id) && !(await ids("company driver")).includes(a._id));
  assert.deepEqual(await ids("no-such-driver-zz"), []);
  assert.deepEqual(await ids("%.*["), []); // regex characters are escaped
  // server-side pagination
  const p1 = (await call("/drivers?limit=10&page=1", "GET", undefined, t.rbp)).body.data;
  const p2 = (await call("/drivers?limit=10&page=2", "GET", undefined, t.rbp)).body.data;
  assert.deepEqual([p1.items.length, p1.limit, p1.page, p2.page], [10, 10, 1, 2]);
  assert.equal(p1.total, all.total);
  assert.ok(p1.items.every((x: any) => !p2.items.some((y: any) => y._id === x._id)));
  assert.equal((await call("/drivers?limit=9999", "GET", undefined, t.rbp)).body.data.limit, 100); // capped
  assert.equal((await call("/drivers?q=zebulon&limit=5", "GET", undefined, t.rbp)).body.data.total, 1);
  assert.ok(all.items.every((x: any) => x.driverNumber && x.driverName && x.mobileNumber && x.driverType && x.createdAt && x.status));
});

test("regression: other modules and roles are unaffected", async () => {
  const t = await T();
  assert.equal((await call("/vehicles", "GET", undefined, t.rbp)).status, 200);
  assert.equal((await call("/vehicle-allotments", "GET", undefined, t.rbp)).status, 200);
  assert.equal((await call("/vehicle-allotments/projects", "GET", undefined, t.rbp)).status, 200);
  assert.equal((await call("/tracking", "GET", undefined, t.rsop)).status, 200);
  assert.equal((await call("/approvals/stats", "GET", undefined, t.rsom)).status, 200);
  assert.equal((await call("/vehicles", "GET", undefined, t.rsop)).status, 403); // role rules unchanged
  assert.equal((await call("/health")).status, 200);
});

test("cleanup", async () => {
  await mongoose.connection.dropDatabase();
  await new Promise<void>((r) => server.close(() => r()));
  await mongoose.disconnect();
});
