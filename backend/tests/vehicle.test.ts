/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_vehicle";
process.env.JWT_SECRET = "test-secret";
process.env.RSOP_USERNAME = "RSOP";
process.env.RSOP_PASSWORD = "pass2";
process.env.RBP_USERNAME = "RBP";
process.env.RBP_PASSWORD = "123123";
process.env.RSOM_USERNAME = "RSOM";
process.env.RSOM_PASSWORD = "pass3";
process.env.STORAGE_TYPE = "local";
process.env.PUBLIC_BASE_URL = "http://localhost:5000";
process.env.STORAGE_LOCAL_DIR = `${tmpdir()}/ds-vehicle-test-${process.pid}`;

import test from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import mongoose from "mongoose";
import { tmpdir } from "node:os";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { normalizeVehicleNo } from "../src/utils/vehicleNo.js";
import { addDays, docStatus, isRealDate, latestExpiry, todayYmd, validateVehicle } from "../src/validators/vehicle.validator.js";

const today = todayYmd();
const att = (name: string) => ({ storage: "local", key: `driver_settlement/vehicles/2026/123e4567-e89b-12d3-a456-426614174000-${name}`, name, size: 1234, mimeType: "application/pdf" });
const full = (over: Record<string, unknown> = {}) => ({
  vehicleNo: "TN58BM6554", make: "Tata", model: "Ace", type: "Dynamic", yearOfManufacture: 2022, purchaseDate: "2022-06-15",
  currentRunning: 1200, totalRunning: 45000, stepneyStatus: "Good", batteryStatus: "Good",
  oilTopUpOn: "2026-10-01", greasePackingOn: "2026-10-02", generalCheckUpOn: "2026-10-03",
  fc: [{ nextRenewalDate: addDays(today, 200) }],
  insurance: [{ nextRenewalDate: addDays(today, 10), attachment: att("policy.pdf") }],
  rtoPermission: [], policePermission: [], permit: [{ nextRenewalDate: addDays(today, 400) }],
  condition: "Good", specification: "LED van 2 sided", ...over,
});

test("vehicle number: normalised, validated, no special characters", () => {
  assert.equal(normalizeVehicleNo("tn 58 bm 6554"), "TN58BM6554");
  assert.equal(normalizeVehicleNo("TN-58-BM-6554"), "TN58BM6554");
  assert.equal(normalizeVehicleNo("TN9A1234"), "TN9A1234");
  assert.equal(normalizeVehicleNo("22BH1234AA"), "22BH1234AA");
  for (const bad of ["", "ABC", "TN58BM65@4", "1234", "TN58BM", "TN58BM65541", "T58BM6554", "TN58BM6554!", null, 12, undefined])
    assert.equal(normalizeVehicleNo(bad), null, String(bad));
});

test("validator: final needs every mandatory field, draft needs none", () => {
  const f = validateVehicle({}, false);
  for (const label of ["Vehicle number", "Make", "Model", "Type", "Year of manufacture", "Purchase date", "Current running", "Total running"])
    assert.ok(f.errors.some((e) => e.startsWith(label)), label);
  assert.deepEqual(validateVehicle({}, true).errors, []);
  assert.deepEqual(validateVehicle(full(), false).errors, []);
  assert.equal(validateVehicle(full({ vehicleNo: "tn 58 bm 6554" }), false).data.vehicleNo, "TN58BM6554");
  assert.ok(validateVehicle({ vehicleNo: "bad!" }, true).errors.length > 0); // drafts still reject malformed values
});

test("validator: numeric fields, year, dates, dropdown", () => {
  for (const k of ["currentRunning", "totalRunning"]) {
    assert.ok(validateVehicle(full({ [k]: -1 }), false).errors.length > 0, `${k} negative`);
    assert.ok(validateVehicle(full({ [k]: "12ab" }), false).errors.length > 0, `${k} letters`);
  }
  assert.ok(validateVehicle(full({ yearOfManufacture: 1900 }), false).errors.length > 0);
  assert.ok(validateVehicle(full({ yearOfManufacture: 2999 }), false).errors.length > 0);
  assert.ok(validateVehicle(full({ yearOfManufacture: "20x2" }), false).errors.length > 0);
  assert.ok(validateVehicle(full({ purchaseDate: addDays(today, 5) }), false).errors.some((e) => /future/.test(e)));
  assert.ok(validateVehicle(full({ purchaseDate: "2026-02-31" }), false).errors.length > 0);
  assert.ok(validateVehicle(full({ purchaseDate: "2021-01-01" }), false).errors.some((e) => /year of manufacture/.test(e)));
  assert.ok(validateVehicle(full({ oilTopUpOn: "2022-01-01" }), false).errors.some((e) => /before the purchase date/.test(e)));
  assert.ok(validateVehicle(full({ greasePackingOn: "13/13/2026" }), false).errors.length > 0);
  assert.ok(validateVehicle(full({ type: "Rocket" }), false).errors.some((e) => /Type must be/.test(e)));
  for (const t of ["Dynamic", "Static", "Utility", "Ladder Vehicle", "Event"]) assert.deepEqual(validateVehicle(full({ type: t }), false).errors, [], t);
  assert.equal(isRealDate("2026-02-28"), true);
  assert.equal(isRealDate("2026-02-30"), false);
});

test("validator: text trimmed, bad characters rejected, document entries validated", () => {
  const t = validateVehicle(full({ make: "  Tata   Motors ", condition: "" }), false);
  assert.equal(t.data.make, "Tata Motors");
  assert.equal(t.data.condition, null);
  assert.ok(validateVehicle(full({ make: "<script>" }), false).errors.length > 0);
  assert.ok(validateVehicle(full({ make: "x".repeat(81) }), false).errors.length > 0);
  const d = validateVehicle(full({ fc: [{ nextRenewalDate: "2026-12-01", attachment: att("a.pdf") }, { nextRenewalDate: "", attachment: null }, { nextRenewalDate: "2027-01-05" }] }), false);
  assert.deepEqual(d.errors, []);
  assert.deepEqual(d.data.fc.map((e) => [e.nextRenewalDate, e.attachment?.name ?? null]), [["2026-12-01", "a.pdf"], ["2027-01-05", null]]); // empty row dropped, order kept
  assert.ok(validateVehicle(full({ fc: [{ attachment: att("a.pdf") }] }), false).errors.some((e) => /next renewal date is required/.test(e)));
  assert.ok(validateVehicle(full({ fc: [{ nextRenewalDate: "2026-02-31" }] }), false).errors.length > 0);
  const badAtt = (over: Record<string, unknown>) => validateVehicle(full({ fc: [{ nextRenewalDate: "2026-12-01", attachment: { ...att("a.pdf"), ...over } }] }), false).errors.length > 0;
  assert.ok(badAtt({ key: "../../etc/passwd" }));
  assert.ok(badAtt({ key: "other_folder/vehicles/2026/123e4567-e89b-12d3-a456-426614174000-a.pdf" }));
  assert.ok(badAtt({ storage: "ftp" }));
  assert.ok(badAtt({ mimeType: "text/html" }));
  assert.ok(badAtt({ size: 0 }));
  assert.ok(badAtt({ name: "" }));
  assert.ok(validateVehicle(full({ permit: "x" }), false).errors.length > 0);
  assert.equal(validateVehicle(full({ insurance: Array.from({ length: 21 }, () => ({ nextRenewalDate: "2026-12-01" })) }), false).errors.length > 0, true);
});

test("document status helpers: latest expiry, valid / expiring / expired / none", () => {
  assert.equal(latestExpiry([{ nextRenewalDate: "2026-01-01", attachment: null }, { nextRenewalDate: "2027-01-01", attachment: null }]), "2027-01-01");
  assert.equal(latestExpiry([]), null);
  assert.equal(docStatus(null), "NONE");
  assert.equal(docStatus(addDays(today, -1)), "EXPIRED");
  assert.equal(docStatus(today), "EXPIRING_SOON");
  assert.equal(docStatus(addDays(today, 30)), "EXPIRING_SOON");
  assert.equal(docStatus(addDays(today, 31)), "VALID");
});

// config is already loaded by the static imports above, so point it at the temp folder before the app is created
const { config: cfg } = await import("../src/config/index.js");
// SAFETY: static imports above already loaded config (with the real .env MONGO_URI) before the env lines ran,
// so force the throw-away test database here. Tests drop their database, so refuse to run against anything else.
const TEST_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_vehicle";
cfg.mongoUri = TEST_URI;
cfg.storage.type = "local";
cfg.storage.localDir = process.env.STORAGE_LOCAL_DIR!;
cfg.storage.publicBaseUrl = "http://localhost:5000";
const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { User } = await import("../src/models/User.js");
const { Vehicle, VehicleHistory } = await import("../src/models/Vehicle.js");

let server: Server;
let base = "";
{
  await connectDB();
  assert.match(mongoose.connection.name, /_test_/, "refusing to drop a non-test database");
  await mongoose.connection.dropDatabase();
  await Promise.all([User.init(), Vehicle.init(), VehicleHistory.init()]);
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

test("access: RBP only; unauthenticated 401; RSOP/RSOM 403; every response uses the standard envelope", async () => {
  const t = await T();
  assert.equal((await call("/vehicles")).status, 401);
  for (const tok of [t.rsop, t.rsom]) {
    const r = await call("/vehicles", "GET", undefined, tok);
    assert.equal(r.status, 403);
    assert.deepEqual(Object.keys(r.body).sort(), ["data", "message", "success"]);
    assert.equal((await call("/vehicles", "POST", full(), tok)).status, 403);
  }
  const ok = await call("/vehicles", "GET", undefined, t.rbp);
  assert.equal(ok.status, 200);
  assert.deepEqual(Object.keys(ok.body).sort(), ["data", "message", "success"]);
  const bad = await call("/vehicles", "POST", {}, t.rbp);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.data, null);
  assert.equal((await call("/vehicles/not-an-id", "GET", undefined, t.rbp)).status, 400);
  assert.equal((await call("/vehicles/000000000000000000000000", "GET", undefined, t.rbp)).status, 404);
});

test("create final vehicle: normalised number, ACTIVE, history row, duplicates blocked (any spacing/case)", async () => {
  const t = await T();
  const r = await call("/vehicles", "POST", full({ vehicleNo: "tn 58 bm 6554" }), t.rbp);
  assert.equal(r.status, 201);
  assert.equal(r.body.data.vehicleNo, "TN58BM6554");
  assert.equal(r.body.data.status, "ACTIVE");
  assert.equal(r.body.data.createdBy, "RBP");
  assert.equal(r.body.data.insuranceStatus, "EXPIRING_SOON");
  assert.equal(r.body.data.fcStatus, "VALID");
  assert.equal(r.body.data.fc.length, 1);
  const dup = await call("/vehicles", "POST", full({ vehicleNo: "TN-58-bm-6554" }), t.rbp);
  assert.equal(dup.status, 409);
  assert.equal(dup.body.data, null);
  const h = (await call(`/vehicles/${r.body.data._id}/history`, "GET", undefined, t.rbp)).body.data;
  assert.equal(h.length, 1);
  assert.equal(h[0].action, "CREATED");
  assert.equal(h[0].username, "RBP");
  assert.ok(h[0].createdAt);
  assert.ok(h[0].changes.some((c: any) => c.field === "vehicleNo" && c.from === null && c.to === "TN58BM6554"));
});

test("draft flow: partial save, listed as DRAFT, reopen, update, convert to final without duplicating", async () => {
  const t = await T();
  const noNumber = await call("/vehicles", "POST", { saveAs: "DRAFT", make: "Mahindra" }, t.rbp); // nothing mandatory
  assert.equal(noNumber.status, 201);
  assert.equal(noNumber.body.data.status, "DRAFT");
  assert.equal(noNumber.body.message, "Vehicle draft saved successfully");
  const second = await call("/vehicles", "POST", { saveAs: "DRAFT", make: "Eicher" }, t.rbp); // two number-less drafts are fine
  assert.equal(second.status, 201);

  const d = await call("/vehicles", "POST", { saveAs: "DRAFT", vehicleNo: "KA01AB1234", make: "Ashok Leyland", fc: [{ nextRenewalDate: addDays(today, 90), attachment: att("fc.pdf") }] }, t.rbp);
  assert.equal(d.status, 201);
  const id = d.body.data._id;
  assert.equal((await call("/vehicles", "POST", full({ vehicleNo: "KA01AB1234" }), t.rbp)).status, 409); // draft reserves the number
  assert.equal((await call("/vehicles", "POST", { saveAs: "DRAFT", vehicleNo: "KA01AB1234" }, t.rbp)).status, 409);

  const listed = (await call("/vehicles?status=DRAFT&limit=100", "GET", undefined, t.rbp)).body.data;
  assert.ok(listed.items.some((v: any) => v._id === id && v.status === "DRAFT"));
  const reopened = (await call(`/vehicles/${id}`, "GET", undefined, t.rbp)).body.data;
  assert.equal(reopened.make, "Ashok Leyland");
  assert.equal(reopened.fc[0].attachment.name, "fc.pdf"); // everything entered is preserved
  assert.equal(reopened.fc[0].attachment.url, `http://localhost:5000/files/${att("fc.pdf").key}`); // url is computed on read

  const upd = await call(`/vehicles/${id}`, "PUT", { saveAs: "DRAFT", vehicleNo: "KA01AB1234", make: "Ashok Leyland", model: "Dost" }, t.rbp);
  assert.equal(upd.status, 200);
  assert.equal(upd.body.data.status, "DRAFT");
  assert.equal((await call(`/vehicles/${id}`, "PUT", { saveAs: "DRAFT", vehicleNo: "KA01AB1234", make: "Ashok Leyland", model: "Dost" }, t.rbp)).status, 400); // no changes

  const incomplete = await call(`/vehicles/${id}`, "PUT", { saveAs: "FINAL", vehicleNo: "KA01AB1234", make: "Ashok Leyland", model: "Dost" }, t.rbp);
  assert.equal(incomplete.status, 400); // final needs all mandatory fields
  assert.equal(incomplete.body.data, null);
  assert.equal((await call(`/vehicles/${id}`, "GET", undefined, t.rbp)).body.data.status, "DRAFT");

  const before = await Vehicle.countDocuments();
  const fin = await call(`/vehicles/${id}`, "PUT", full({ vehicleNo: "KA01AB1234", make: "Ashok Leyland", model: "Dost" }), t.rbp);
  assert.equal(fin.status, 200);
  assert.equal(fin.body.data.status, "ACTIVE");
  assert.equal(fin.body.data._id, id); // same record, converted in place
  assert.equal(await Vehicle.countDocuments(), before); // no second record
  assert.equal(await Vehicle.countDocuments({ vehicleNo: "KA01AB1234" }), 1);
  const acts = (await call(`/vehicles/${id}/history`, "GET", undefined, t.rbp)).body.data.map((h: any) => h.action);
  assert.ok(acts.includes("DRAFT_CONVERTED") && acts.includes("DRAFT_SAVED"));
  assert.equal(acts[acts.length - 1], "DRAFT_SAVED"); // first action is last in latest-first order
  // an active vehicle cannot go back to draft
  assert.equal((await call(`/vehicles/${id}`, "PUT", { saveAs: "DRAFT", make: "X" }, t.rbp)).status, 400);
});

test("delete: only drafts can be deleted; history survives", async () => {
  const t = await T();
  const d = (await call("/vehicles", "POST", { saveAs: "DRAFT", vehicleNo: "MH12AB9999" }, t.rbp)).body.data;
  const a = (await call("/vehicles", "POST", full({ vehicleNo: "MH12AB1111" }), t.rbp)).body.data;
  assert.equal((await call(`/vehicles/${a._id}`, "DELETE", undefined, t.rbp)).status, 409);
  assert.equal((await call(`/vehicles/${d._id}`, "DELETE", undefined, t.rbp)).status, 200);
  assert.equal((await call(`/vehicles/${d._id}`, "GET", undefined, t.rbp)).status, 404);
  assert.equal((await call("/vehicles", "POST", full({ vehicleNo: "MH12AB9999" }), t.rbp)).status, 201); // number is free again
  const h = (await call(`/vehicles/${d._id}/history`, "GET", undefined, t.rbp)).body.data;
  assert.equal(h[0].action, "DRAFT_DELETED");
  assert.equal(h.length >= 2, true);
});

test("edit: restores values, documents/maintenance/status each get their own history row with previous and updated values", async () => {
  const t = await T();
  const v = (await call("/vehicles", "POST", full({ vehicleNo: "TN01AA0001" }), t.rbp)).body.data;
  const id = v._id;
  assert.equal((await call(`/vehicles/${id}`, "PUT", full({ vehicleNo: "TN01AA0001" }), t.rbp)).status, 400); // nothing changed

  const next = full({
    vehicleNo: "TN01AA0001", model: "Ace Gold", oilTopUpOn: "2026-10-20",
    insurance: [...(full().insurance as any[]), { nextRenewalDate: addDays(today, 365) }],
    permit: [], status: "INACTIVE",
  });
  await new Promise((r) => setTimeout(r, 15));
  const e = await call(`/vehicles/${id}`, "PUT", next, t.rbp);
  assert.equal(e.status, 200);
  assert.equal(e.body.data.status, "INACTIVE");
  assert.equal(e.body.data.insuranceStatus, "VALID"); // latest expiry now a year away
  assert.equal(e.body.data.insurance.length, 2);

  const h = (await call(`/vehicles/${id}/history`, "GET", undefined, t.rbp)).body.data;
  const by = (a: string) => h.find((x: any) => x.action === a);
  assert.deepEqual(by("UPDATED").changes, [{ field: "model", from: "Ace", to: "Ace Gold" }]);
  assert.deepEqual(by("MAINTENANCE_UPDATED").changes, [{ field: "oilTopUpOn", from: "2026-10-01", to: "2026-10-20" }]);
  assert.equal(by("INSURANCE_UPDATED").changes[0].from.length, 1);
  assert.equal(by("INSURANCE_UPDATED").changes[0].to.length, 2);
  assert.equal(by("PERMIT_UPDATED").changes[0].to, null);
  assert.deepEqual(by("STATUS_CHANGED").changes, [{ field: "status", from: "ACTIVE", to: "INACTIVE" }]);
  assert.equal(by("FC_UPDATED"), undefined); // untouched sections stay quiet
  assert.ok(h.every((x: any) => x.username === "RBP" && x.createdAt));
  for (let i = 1; i < h.length; i++) assert.ok(new Date(h[i - 1].createdAt) >= new Date(h[i].createdAt)); // latest first
  assert.equal(h[h.length - 1].action, "CREATED"); // original record untouched at the end
  assert.equal(h.filter((x: any) => x.action === "CREATED").length, 1);
  const asc = (await call(`/vehicles/${id}/history?order=asc`, "GET", undefined, t.rbp)).body.data;
  assert.equal(asc[0].action, "CREATED");
  await assert.rejects(VehicleHistory.updateOne({ vehicle: id }, { username: "x" })); // immutable
  await assert.rejects(VehicleHistory.deleteMany({ vehicle: id }));
  assert.equal((await call(`/vehicles/${id}`, "PUT", { ...next, status: "WEIRD" }, t.rbp)).status, 400);
  assert.equal((await call(`/vehicles/${id}`, "PUT", { ...next, vehicleNo: "TN58BM6554" }, t.rbp)).status, 409); // cannot steal another vehicle's number
});

test("concurrent edits: one wins, the other gets 409, no duplicate history", async () => {
  const t = await T();
  const v = (await call("/vehicles", "POST", full({ vehicleNo: "TN02AA0002" }), t.rbp)).body.data;
  const rs = await Promise.all([1, 2, 3, 4].map((n) => call(`/vehicles/${v._id}`, "PUT", full({ vehicleNo: "TN02AA0002", currentRunning: 2000 + n }), t.rbp)));
  assert.ok(rs.every((r) => r.status === 200 || r.status === 409));
  assert.ok(rs.filter((r) => r.status === 200).length >= 1);
  const h = (await call(`/vehicles/${v._id}/history`, "GET", undefined, t.rbp)).body.data;
  assert.equal(h.length, 1 + rs.filter((r) => r.status === 200).length);
});

test("listing: mass search, combined filters, clear, pagination, empty, facets, expiry filters", async () => {
  const t = await T();
  await Vehicle.deleteMany({});
  const seed = [
    { vehicleNo: "TN10AA0001", make: "Tata", model: "Ace", year: 2020, bat: "Good", ins: addDays(today, -5) },
    { vehicleNo: "TN10AA0002", make: "Tata", model: "Intra", year: 2021, bat: "Weak", ins: addDays(today, 10) },
    { vehicleNo: "KA05BB0003", make: "Mahindra", model: "Jeeto", year: 2021, bat: "Good", ins: addDays(today, 100) },
    { vehicleNo: "KA05BB0004", make: "Ashok Leyland", model: "Dost", year: 2022, bat: "Good", ins: null },
  ];
  for (const s of seed)
    assert.equal((await call("/vehicles", "POST", full({
      vehicleNo: s.vehicleNo, make: s.make, model: s.model, yearOfManufacture: s.year, purchaseDate: `${s.year}-06-01`, batteryStatus: s.bat,
      insurance: s.ins ? [{ nextRenewalDate: s.ins }] : [], oilTopUpOn: null, greasePackingOn: null, generalCheckUpOn: null,
    }), t.rbp)).status, 201);
  await call("/vehicles", "POST", { saveAs: "DRAFT", make: "Tata", vehicleNo: "TN10AA0005" }, t.rbp);

  const L = async (qs: string) => (await call("/vehicles?" + qs, "GET", undefined, t.rbp)).body.data;
  assert.equal((await L("")).total, 5);
  assert.deepEqual((await L("q=tn10aa0001")).items.map((v: any) => v.vehicleNo), ["TN10AA0001"]); // case-insensitive
  assert.equal((await L("q=" + encodeURIComponent("tn 10 aa"))).total, 3); // spaced search still finds compact numbers
  assert.equal((await L("q=tata")).total, 3); // make
  assert.equal((await L("q=jeeto")).total, 1); // model
  assert.equal((await L("q=dynamic")).total, 4); // type
  assert.equal((await L("q=zzzz")).total, 0);
  assert.deepEqual((await L("q=zzzz")).items, []);
  assert.equal((await L("make=TATA&year=2021")).total, 1); // combined
  assert.equal((await L("make=tata&status=ACTIVE&batteryStatus=good")).total, 1);
  assert.equal((await L("status=DRAFT")).total, 1);
  assert.equal((await L("model=ace")).total, 1);
  assert.equal((await L("insuranceStatus=EXPIRED")).total, 1);
  assert.equal((await L("insuranceStatus=EXPIRING_SOON")).total, 1);
  assert.equal((await L("insuranceStatus=VALID")).total, 1);
  assert.equal((await L("insuranceStatus=NONE")).total, 2); // one active without insurance + the draft
  assert.equal((await L("fcStatus=VALID")).total, 4);
  assert.equal((await L(`from=${today}&to=${today}`)).total, 5);
  assert.equal((await L("from=2999-01-01")).total, 0);
  assert.equal((await L("q=tata&make=Mahindra")).total, 0); // filters really intersect
  assert.equal((await L("")).total, 5); // "clear filters" = no params

  const p1 = await L("limit=2&page=1");
  const p3 = await L("limit=2&page=3");
  assert.equal(p1.items.length, 2);
  assert.equal(p3.items.length, 1);
  assert.equal(p1.total, 5);
  assert.equal(p1.limit, 2);
  const ids = [...(await L("limit=2&page=1")).items, ...(await L("limit=2&page=2")).items, ...p3.items].map((v: any) => v._id);
  assert.equal(new Set(ids).size, 5); // pages never overlap
  assert.ok(new Date(p1.items[0].createdAt) >= new Date(p1.items[1].createdAt)); // newest first
  assert.equal((await L("limit=1000")).limit, 100); // page size is capped

  const f = (await call("/vehicles/filters", "GET", undefined, t.rbp)).body.data;
  assert.deepEqual(f.makes, ["Ashok Leyland", "Mahindra", "Tata"]);
  assert.deepEqual(f.years, [2022, 2021, 2020]);
  assert.deepEqual(f.types, ["Dynamic", "Static", "Utility", "Ladder Vehicle", "Event"]);
  assert.deepEqual(f.batteryStatuses, ["Good", "Weak"]);
});

test("summary cards use real counts", async () => {
  const t = await T();
  const s = (await call("/vehicles/summary", "GET", undefined, t.rbp)).body.data;
  assert.equal(s.total, 5);
  assert.equal(s.active, 4);
  assert.equal(s.draft, 1);
  assert.equal(s.expiringSoon, 2); // expired + expiring in 10 days (both active)
  assert.equal(s.maintenanceDue, 0); // no maintenance date recorded in this data set
  await Vehicle.updateOne({ vehicleNo: "KA05BB0003" }, { oilTopUpOn: addDays(today, -120) });
  await Vehicle.updateOne({ vehicleNo: "KA05BB0004" }, { greasePackingOn: addDays(today, -10) });
  assert.equal((await call("/vehicles/summary", "GET", undefined, t.rbp)).body.data.maintenanceDue, 1); // only the overdue one
});

test("large data set: 600 vehicles paged and searched on the server", async () => {
  const t = await T();
  const rows = Array.from({ length: 600 }, (_, i) => ({
    vehicleNo: `TN99ZZ${String(i).padStart(4, "0")}`, make: i % 2 ? "Bulk Make" : "Other Make", model: `M${i % 7}`, type: "Dynamic",
    yearOfManufacture: 2020 + (i % 5), status: "ACTIVE", createdBy: "seed", updatedBy: "seed", insuranceExpiry: null, fcExpiry: null,
  }));
  await Vehicle.insertMany(rows);
  const r = (await call("/vehicles?q=bulk&limit=100&page=3", "GET", undefined, t.rbp)).body.data;
  assert.equal(r.total, 300);
  assert.equal(r.items.length, 100);
  assert.equal((await call("/vehicles?q=TN99ZZ0599", "GET", undefined, t.rbp)).body.data.total, 1);
  assert.equal((await call("/vehicles?make=Bulk%20Make&year=2021", "GET", undefined, t.rbp)).body.data.total >= 1, true);
});

test("storage: file names, validation, keys, local driver and cloud (space) driver", async () => {
  const st = await import("../src/services/storage.service.js");
  const { config } = await import("../src/config/index.js");
  assert.equal(st.sanitizeFileName("my RC copy (1).PDF"), "my_RC_copy_1.pdf");
  assert.equal(st.sanitizeFileName("../../etc/passwd.png"), "passwd.png");
  assert.equal(st.sanitizeFileName("C:\\evil\\x.jpg"), "x.jpg");
  assert.equal(st.sanitizeFileName("???.pdf"), "file.pdf");
  const pdf = Buffer.from("%PDF-1.4 test");
  const f = (over: Record<string, unknown> = {}) => ({ originalname: "a.pdf", mimetype: "application/pdf", size: pdf.length, buffer: pdf, ...over });
  assert.deepEqual(st.validateUpload(f()), { name: "a.pdf", mimeType: "application/pdf" });
  assert.throws(() => st.validateUpload(undefined), /Choose a file/);
  assert.throws(() => st.validateUpload(f({ originalname: "a.exe" })), /allowed/);
  assert.throws(() => st.validateUpload(f({ originalname: ".pdf" })), /allowed/); // no real extension
  assert.throws(() => st.validateUpload(f({ originalname: "a.html", mimetype: "text/html" })), /allowed/);
  assert.throws(() => st.validateUpload(f({ mimetype: "image/png" })), /does not match/);
  assert.throws(() => st.validateUpload(f({ buffer: Buffer.from("<script>") })), /does not match/);
  assert.throws(() => st.validateUpload(f({ size: 0 })), /empty/);
  assert.throws(() => st.validateUpload(f({ size: st.MAX_UPLOAD_BYTES + 1 })), /too large/);
  const png = Buffer.concat([Buffer.from([0x89]), Buffer.from("PNG\r\n"), Buffer.alloc(8)]);
  assert.equal(st.validateUpload({ originalname: "x.PNG", mimetype: "image/png", size: png.length, buffer: png }).mimeType, "image/png");

  const key = st.makeKey("a.pdf");
  assert.match(key, st.KEY_PATTERN);
  assert.ok(key.startsWith("driver_settlement/vehicles/"));
  assert.notEqual(key, st.makeKey("a.pdf")); // never overwrites an earlier upload

  // local driver: writes under the root only
  const root = path.join(tmpdir(), `ds-driver-${process.pid}`);
  const local = st.createLocalDriver(root);
  await local.save(pdf, key, "application/pdf");
  assert.equal(readFileSync(path.join(root, key)).toString(), pdf.toString());
  await assert.rejects(local.save(pdf, "../outside.pdf", "application/pdf"), /Invalid storage path/);
  rmSync(root, { recursive: true, force: true });

  // cloud driver: bucket + driver_settlement folder, public-read, content type
  const sent: any[] = [];
  const space = st.createSpaceDriver({ send: async (c: any) => { sent.push(c.input); return {}; } }, "my-bucket");
  const att = await st.storeUpload(f(), space);
  assert.equal(att.storage, "space");
  assert.equal(sent[0].Bucket, "my-bucket");
  assert.ok(sent[0].Key.startsWith("driver_settlement/vehicles/"));
  assert.equal(sent[0].ContentType, "application/pdf");
  assert.equal(sent[0].ACL, "public-read");

  // urls + driver selection by STORAGE_TYPE
  assert.equal(st.attachmentUrl({ storage: "local", key }), `http://localhost:5000/files/${key}`);
  const keep = { ...config.storage.space };
  config.storage.space.cdnBase = "https://cdn.example.com/";
  assert.equal(st.attachmentUrl({ storage: "space", key }), `https://cdn.example.com/${key}`);
  assert.equal(st.getStorage().kind, "local");
  config.storage.type = "space";
  Object.assign(config.storage.space, { key: "", secret: "", endpoint: "", region: "", bucket: "" });
  assert.throws(() => st.getStorage(), /not configured/);
  Object.assign(config.storage.space, { key: "k", secret: "s", endpoint: "https://sgp1.digitaloceanspaces.com", region: "sgp1", bucket: "b" });
  assert.equal(st.getStorage().kind, "space");
  config.storage.type = "ftp";
  assert.throws(() => st.getStorage(), /Unsupported STORAGE_TYPE/);
  config.storage.type = "local";
  Object.assign(config.storage.space, keep);
});

test("upload API: RBP only, validates type / content / size, stores under driver_settlement, file is served", async () => {
  const t = await T();
  const send = async (token: string | undefined, name: string, data: Buffer, type: string) => {
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array(data)], { type }), name);
    const res = await fetch(base + "/vehicles/attachments", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
    return { status: res.status, body: (await res.json()) as { success: boolean; message: string; data: any } };
  };
  const pdf = Buffer.from("%PDF-1.4 sample document");
  assert.equal((await send(undefined, "a.pdf", pdf, "application/pdf")).status, 401);
  assert.equal((await send(t.rsop, "a.pdf", pdf, "application/pdf")).status, 403);
  assert.equal((await send(t.rsom, "a.pdf", pdf, "application/pdf")).status, 403);

  const ok = await send(t.rbp, "RC copy.pdf", pdf, "application/pdf");
  assert.equal(ok.status, 201);
  assert.deepEqual(Object.keys(ok.body).sort(), ["data", "message", "success"]);
  const a = ok.body.data;
  assert.equal(a.storage, "local");
  assert.equal(a.name, "RC_copy.pdf");
  assert.ok(a.key.startsWith("driver_settlement/vehicles/"));
  assert.ok(existsSync(path.join(process.env.STORAGE_LOCAL_DIR!, a.key))); // physically in the backend public folder
  const served = await fetch(a.url.replace("http://localhost:5000", base.replace("/api", "")));
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("x-content-type-options"), "nosniff");
  assert.equal(Buffer.from(await served.arrayBuffer()).toString(), pdf.toString());
  assert.notEqual((await fetch(base.replace("/api", "") + "/files/../.env")).status, 200); // no traversal

  for (const [label, name, data, type, status] of [
    ["exe", "a.exe", pdf, "application/octet-stream", 400],
    ["html", "a.html", Buffer.from("<script>alert(1)</script>"), "text/html", 400],
    ["renamed", "a.pdf", Buffer.from("<script>alert(1)</script>"), "application/pdf", 400],
    ["wrong mime", "a.pdf", pdf, "image/png", 400],
    ["empty", "a.pdf", Buffer.alloc(0), "application/pdf", 400],
    ["too big", "a.pdf", Buffer.concat([pdf, Buffer.alloc(10 * 1024 * 1024)]), "application/pdf", 413],
  ] as [string, string, Buffer, string, number][]) {
    const r = await send(t.rbp, name, data, type);
    assert.equal(r.status, status, label);
    assert.equal(r.body.success, false);
    assert.equal(r.body.data, null);
  }
  const none = await fetch(base + "/vehicles/attachments", { method: "POST", headers: { Authorization: `Bearer ${t.rbp}` }, body: new FormData() });
  assert.equal(none.status, 400);

  // the uploaded file is attached to a vehicle, restored on read and tracked in history
  const stored = { storage: a.storage, key: a.key, name: a.name, size: a.size, mimeType: a.mimeType };
  const v = await call("/vehicles", "POST", full({ vehicleNo: "TN07UP0001", fc: [{ nextRenewalDate: addDays(today, 60), attachment: stored }] }), t.rbp);
  assert.equal(v.status, 201);
  assert.equal(v.body.data.fc[0].attachment.url, a.url);
  assert.equal(v.body.data.fc[0].attachment.name, "RC_copy.pdf");
  assert.equal((await call(`/vehicles/${v.body.data._id}`, "GET", undefined, t.rbp)).body.data.fc[0].attachment.key, a.key);
  const h = (await call(`/vehicles/${v.body.data._id}/history`, "GET", undefined, t.rbp)).body.data;
  assert.ok(h[0].changes.some((c: any) => c.field === "fc" && c.to[0].attachment.name === "RC_copy.pdf"));
  const forged = await call(`/vehicles/${v.body.data._id}`, "PUT", full({ vehicleNo: "TN07UP0001", fc: [{ nextRenewalDate: addDays(today, 60), attachment: { ...stored, key: "../../secret.pdf" } }] }), t.rbp);
  assert.equal(forged.status, 400);
  assert.equal(forged.body.data, null);
  rmSync(process.env.STORAGE_LOCAL_DIR!, { recursive: true, force: true });
});

test("regression: existing endpoints unaffected", async () => {
  const t = await T();
  assert.equal((await call("/health")).status, 200);
  assert.equal((await call("/auth/roles")).body.data.RBP.defaultUsername, "RBP");
  assert.equal((await call("/approvals/stats", "GET", undefined, t.rsom)).status, 200);
  assert.equal((await call("/tracking", "GET", undefined, t.rsop)).status, 200);
  assert.equal((await call("/notifications", "GET", undefined, t.rbp)).status, 200);
  assert.equal((await call("/budgets/vehicle/abc", "GET", undefined, t.rbp)).status, 400);
});

test("cleanup", async () => {
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
