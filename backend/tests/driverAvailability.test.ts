/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_driver_availability";
process.env.JWT_SECRET = "test-secret";
process.env.RSOP_USERNAME = "RSOP";
process.env.RSOP_PASSWORD = "pass2";
process.env.RBP_USERNAME = "RBP";
process.env.RBP_PASSWORD = "123123";
process.env.RSOM_USERNAME = "RSOM";
process.env.RSOM_PASSWORD = "pass3";
process.env.STORAGE_TYPE = "local";

import { perVehicleTrackups } from "./legacyNumbers.js";
import test from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import mongoose from "mongoose";

// SAFETY: modules are imported dynamically after the config points at the throw-away test database.
const { config: cfg } = await import("../src/config/index.js");
cfg.mongoUri = "mongodb://127.0.0.1:27017/driver_settlement_test_driver_availability";
cfg.storage.type = "local";
const { validateDriverAvailability, istToday, nextDay } = await import("../src/validators/driverAvailability.validator.js");
const { addDays, todayYmd } = await import("../src/validators/vehicle.validator.js");
const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { User } = await import("../src/models/User.js");
const { Driver, DriverHistory } = await import("../src/models/Driver.js");
const { TrackingProject } = await import("../src/models/TrackingProject.js");
const { TrackingVehicle } = await import("../src/models/TrackingVehicle.js");
const { Budget } = await import("../src/models/Budget.js");
const { Vehicle } = await import("../src/models/Vehicle.js");
const { releaseDueDrivers } = await import("../src/services/driverAvailability.service.js");
const { runDriverAvailabilityJob, runAvailabilityJob } = await import("../src/jobs/availabilityScheduler.js");

const today = todayYmd();
const d = (n: number) => addDays(today, n);
const NOW = new Date("2026-11-24T06:30:00Z"); // 24-Nov-2026 12:00 IST

let server: Server;
let base = "";
{
  await connectDB();
  assert.match(mongoose.connection.name, /_test_/, "refusing to drop a non-test database");
  await mongoose.connection.dropDatabase();
  await Promise.all([User.init(), Driver.init(), DriverHistory.init(), TrackingProject.init(), TrackingVehicle.init(), Budget.init(), Vehicle.init()]);
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
let tk: { rbp: string; rsop: string } | undefined;
const T = async () => (tk ??= { rbp: await login("RBP", "RBP", "123123"), rsop: await login("RSOP", "RSOP", "pass2") });

let phone = 7000000000;
const mk = (over: Record<string, unknown> = {}) => ({ driverName: "Avail Driver", driverType: "COMPANY_DRIVER", mobileNumber: String(phone++), ...over });

// ---- fixtures: one Signage project (6 vehicles): 0..3 approved budgets, 4 pending, 5 none
let proj: any;
const budgetNo = (() => { let n = 0; return () => `BUD-D-${++n}`; })();
{
  const t = await T();
  const r = await call("/tracking", "POST", {
    projectType: "SIGNAGE",
    details: { projectCode: "14000001", client: "Pepsi India", jobSheetNumber: "ZZDRV-77", location: "Coimbatore", date: d(0), fromDate: d(0), toDate: d(9), numberOfVehicles: 6, vehicleTypes: [{ code: "CENTRE_NO_ROOF", quantity: 6 }] },
  }, t.rsop);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  proj = await perVehicleTrackups<any>(r.body.data);
  const mkB = (i: number, state: Record<string, unknown>) =>
    Budget.create({ budgetNumber: budgetNo(), vehicle: proj.vehicles[i]._id, project: proj._id, data: {}, total: 0, currentVersion: 1, createdBy: "RBP", updatedBy: "RBP", ...state });
  for (let i = 0; i < 4; i++) await mkB(i, { approvalStatus: "APPROVED", approvedVersion: 1 });
  await mkB(4, { approvalStatus: "PENDING", submittedVersion: 1 });
}
const trk: string[] = proj.vehicles.map((x: any) => x.trackupNumber);
const pif: string[] = proj.vehicles.map((x: any) => x.pifNumber);

const inUse = (i: number, from = d(0), to = d(5), over: Record<string, unknown> = {}) => ({ status: "IN_USE", project: { trackupNumber: trk[i], startDate: from, endDate: to, remarks: "peak season" }, ...over });
const notAvail = (over: Record<string, unknown> = {}) => ({ status: "NOT_AVAILABLE", notAvailable: { reason: "Family function", category: "Personal Leave", fromDate: d(0), ...over } });
const create = async (availability?: unknown, over: Record<string, unknown> = {}) =>
  call("/drivers", "POST", mk({ ...(availability === undefined ? {} : { availability }), ...over }), (await T()).rbp);
const history = async (id: string) => (await call(`/drivers/${id}/history`, "GET", undefined, (await T()).rbp)).body.data as any[];
const put = async (id: string, existing: any, availability: unknown, over: Record<string, unknown> = {}) =>
  call(`/drivers/${id}`, "PUT", {
    driverName: existing.driverName, driverType: existing.driverType, mobileNumber: existing.mobileNumber, ...(availability === undefined ? {} : { availability }), ...over,
  }, (await T()).rbp);

// ================================================================== validator (pure)
const v = (input: unknown, prev?: any) => validateDriverAvailability(input, NOW, prev);
const linked = (over: Record<string, unknown> = {}) => ({
  status: "IN_USE",
  project: { trackingProject: "a".repeat(24), trackingVehicle: "b".repeat(24), projectType: "ROADSHOW", projectName: "KFC Roadshow", clientName: "KFC", trackupNumber: "TRK-1", pifNumber: "PIF-1", startDate: "2026-11-24", endDate: "2026-11-30", ...over },
});

test("status selection: exactly Available Now / In Use / Not Available; others and a blank status are rejected; absent = untouched", () => {
  assert.equal(v({ status: "AVAILABLE" }).data?.status, "AVAILABLE");
  assert.equal(v(linked()).data?.status, "IN_USE");
  assert.equal(v({ status: "NOT_AVAILABLE", notAvailable: { reason: "Leave", category: "Personal Leave" } }).data?.status, "NOT_AVAILABLE");
  assert.ok(v({ status: "BUSY" }).errors.some((e) => /Driver status must be one of/.test(e)));
  assert.ok(v({ status: "ISSUE" }).errors.length > 0); // the vehicle-only status is not a driver status
  assert.deepEqual(v({}).errors, ["Driver status is required"]);
  assert.equal(v(undefined).data, undefined);
  assert.equal(v(null).data, undefined);
  assert.deepEqual(v(undefined).errors, []);
  assert.ok(v([]).errors.length > 0);
});

test("Available Now: defaults to the current IST date & time; hides (does not keep) project and reason fields", () => {
  const r = v({ status: "AVAILABLE", project: { projectName: "stale" }, notAvailable: { reason: "stale" } });
  assert.deepEqual(r.errors, []);
  assert.equal(r.data?.availableFromDate, "2026-11-24");
  assert.equal(r.data?.availableFromTime, "12:00");
  assert.equal(r.data?.project, null);
  assert.equal(r.data?.notAvailable, null);
  assert.equal(v({ status: "AVAILABLE", availableFromDate: "2026-12-01", availableFromTime: "08:30" }).data?.availableFromTime, "08:30");
  assert.ok(v({ status: "AVAILABLE", availableFromDate: "2026-12-01" }).errors.some((e) => /both date and time/.test(e)));
  assert.ok(v({ status: "AVAILABLE", availableFromDate: "2026-13-45", availableFromTime: "08:30" }).errors.length > 0);
});

test("In Use: project, From and To dates are mandatory; To cannot be earlier than From; a new past To is rejected", () => {
  const ok = v(linked());
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.data?.project?.endDate, "2026-11-30");
  assert.equal(ok.data?.notAvailable, null); // reason fields are hidden for this status
  assert.ok(v({ status: "IN_USE", project: {} }).errors.some((e) => /Select an approved project/.test(e)));
  assert.ok(v(linked({ startDate: null })).errors.includes("Project from date is required"));
  assert.ok(v(linked({ endDate: null })).errors.includes("Project to date is required"));
  assert.ok(v(linked({ startDate: "2026-11-30", endDate: "2026-11-25" })).errors.includes("Project to date cannot be earlier than the from date"));
  assert.deepEqual(v(linked({ startDate: "2026-11-24", endDate: "2026-11-24" })).errors, []); // same day is fine
  assert.ok(v(linked({ startDate: "2026-11-01", endDate: "2026-11-10" })).errors.includes("Project to date cannot be in the past"));
  assert.deepEqual(v(linked({ startDate: "2026-11-01", endDate: "2026-11-10" }), { status: "IN_USE", project: { endDate: "2026-11-10" } }).errors, []); // unchanged overdue stays editable
  assert.ok(v(linked({ endDate: "2026-02-31" })).errors.some((e) => /valid date/.test(e)));
  assert.ok(v(linked({ remarks: "<script>" })).errors.some((e) => /invalid characters/.test(e)));
});

test("Not Available: a proper reason and category are mandatory; Other allows a custom reason; expected date is optional", () => {
  const n = (o: Record<string, unknown>) => v({ status: "NOT_AVAILABLE", notAvailable: o });
  assert.ok(n({ category: "Personal Leave" }).errors.includes("Unavailable reason is required"));
  assert.ok(n({ reason: "   ", category: "Personal Leave" }).errors.includes("Unavailable reason is required"));
  assert.ok(n({ reason: "Leave" }).errors.includes("Reason category is required"));
  assert.ok(n({ reason: "Leave", category: "Holiday" }).errors.some((e) => /Reason category must be one of/.test(e)));
  assert.ok(v({ status: "NOT_AVAILABLE" }).errors.includes("Unavailable reason is required"));
  for (const c of ["Personal Leave", "Medical Leave", "License Issue", "Vehicle/Project Related", "Other"]) assert.deepEqual(n({ reason: "Reason text", category: c }).errors, [], c);
  assert.equal(n({ reason: "Gone to native for harvest", category: "Other" }).data?.notAvailable?.reason, "Gone to native for harvest");
  const r = n({ reason: "Leave", category: "Medical Leave" });
  assert.equal(r.data?.notAvailable?.fromDate, "2026-11-24"); // defaults to today (IST)
  assert.equal(r.data?.notAvailable?.expectedAvailableDate, null);
  assert.ok(n({ reason: "Leave", category: "Medical Leave", fromDate: "2026-11-24", expectedAvailableDate: "2026-11-20" }).errors.some((e) => /before the unavailable from date/.test(e)));
  assert.equal(r.data?.project, null);
});

test("IST helpers: today and next day", () => {
  assert.equal(istToday(new Date("2026-11-24T19:00:00Z")), "2026-11-25"); // 00:30 IST next day
  assert.equal(istToday(new Date("2026-11-24T18:29:00Z")), "2026-11-24");
  assert.equal(nextDay("2026-11-30"), "2026-12-01");
  assert.equal(nextDay("2026-12-31"), "2027-01-01");
});

// ================================================================== API: statuses persist and restore
test("create: each of the three statuses is saved and restored; no availability => Available Now; blank status rejected", async () => {
  const a = await create({ status: "AVAILABLE" });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.data.availability.status, "AVAILABLE");
  assert.equal(a.body.data.availability.availableFromDate, todayYmd());
  const u = await create(inUse(0));
  assert.equal(u.status, 201, JSON.stringify(u.body));
  const p = u.body.data.availability.project;
  assert.equal(u.body.data.availability.status, "IN_USE");
  assert.equal(p.trackupNumber, trk[0]);
  assert.equal(p.pifNumber, pif[0]); // PIF auto-populated from the Trackup number
  assert.equal(p.clientName, "Pepsi India");
  assert.equal(p.projectType, "SIGNAGE");
  assert.match(p.projectName, /Pepsi India Signage/);
  assert.equal(p.startDate, d(0));
  assert.equal(p.endDate, d(5));
  assert.equal(p.remarks, "peak season");
  assert.ok(p.trackingProject && p.budget); // the project association is preserved
  assert.equal(u.body.data.availability.notAvailable, null); // reason fields hidden for this status are not stored
  const n = await create(notAvail({ expectedAvailableDate: d(7), remarks: "call before assigning" }));
  assert.equal(n.status, 201, JSON.stringify(n.body));
  assert.equal(n.body.data.availability.notAvailable.reason, "Family function");
  assert.equal(n.body.data.availability.notAvailable.category, "Personal Leave");
  assert.equal(n.body.data.availability.notAvailable.expectedAvailableDate, d(7));
  const legacyClient = await create(undefined);
  assert.equal(legacyClient.status, 201);
  assert.equal(legacyClient.body.data.availability.status, "AVAILABLE");
  const bad = await create({ status: "" });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.success, false);
  assert.equal(bad.body.data, null);
  const t = await T();
  for (const r of [a, u, n]) {
    const g = (await call(`/drivers/${r.body.data._id}`, "GET", undefined, t.rbp)).body.data;
    assert.equal(g.availability.status, r.body.data.availability.status);
    assert.equal(g.availability.lastStatusUpdatedBy, "RBP");
  }
});

test("create: invalid availability is rejected and nothing is saved", async () => {
  const before = await Driver.countDocuments();
  const cases: [unknown, RegExp][] = [
    [{ status: "IN_USE", project: {} }, /Select an approved project/],
    [{ status: "IN_USE", project: { trackupNumber: trk[4], startDate: d(0), endDate: d(3) } }, /approved/i], // pending budget
    [{ status: "IN_USE", project: { trackupNumber: trk[5], startDate: d(0), endDate: d(3) } }, /approved/i], // no budget
    [{ status: "IN_USE", project: { trackupNumber: "NOPE-1", startDate: d(0), endDate: d(3) } }, /not found/],
    [{ status: "IN_USE", project: { trackupNumber: trk[0], pifNumber: pif[1], startDate: d(0), endDate: d(3) } }, /do not belong to the same project/],
    [{ status: "IN_USE", project: { trackupNumber: trk[0], startDate: d(4), endDate: d(1) } }, /cannot be earlier than the from date/],
    [{ status: "IN_USE", project: { trackupNumber: trk[0], startDate: d(-5), endDate: d(-2) } }, /cannot be in the past/],
    [notAvail({ reason: "" }), /Unavailable reason is required/],
    [notAvail({ category: "Nope" }), /Reason category must be one of/],
    [{ status: "FLYING" }, /Driver status must be one of/],
  ];
  for (const [av, re] of cases) {
    const r = await create(av);
    assert.equal(r.status, 400, JSON.stringify(av));
    assert.match(r.body.message, re);
    assert.equal(r.body.data, null);
  }
  assert.equal(await Driver.countDocuments(), before);
});

test("In Use: dates default to the project's own dates when left blank, and the PIF number alone finds the project", async () => {
  const r = await create({ status: "IN_USE", project: { pifNumber: pif[1] } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.availability.project.trackupNumber, trk[1]); // PIF gives the Trackup number
  assert.equal(r.body.data.availability.project.startDate, d(0));
  assert.equal(r.body.data.availability.project.endDate, d(9));
});

// ================================================================== edit behaviour and history
test("edit: In Use -> Not Available keeps the previous project in history; Not Available -> Available is a recorded manual confirmation", async () => {
  const c = (await create(inUse(2))).body.data;
  const n = await put(c._id, c, notAvail({ reason: "Licence suspended", category: "License Issue" }));
  assert.equal(n.status, 200, JSON.stringify(n.body));
  assert.equal(n.body.data.availability.status, "NOT_AVAILABLE");
  assert.equal(n.body.data.availability.project, null); // the active allocation is cleared
  assert.equal(n.body.data.driverNumber, c.driverNumber); // number never regenerated
  const a = await put(c._id, n.body.data, { status: "AVAILABLE" });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.data.availability.status, "AVAILABLE");
  assert.equal(await Driver.countDocuments({ mobileDigits: c.mobileNumber.replace(/\D/g, "").slice(2) }), 1); // no duplicate record
  const h = await history(c._id);
  assert.deepEqual(h.map((x) => x.action), ["AVAILABILITY_CONFIRMED", "MARKED_NOT_AVAILABLE", "PROJECT_ASSIGNED", "CREATED"]); // latest first
  const marked = h[1];
  assert.equal(marked.previousStatus, "IN_USE");
  assert.equal(marked.newStatus, "NOT_AVAILABLE");
  assert.equal(marked.project.trackupNumber, trk[2]); // previous allocation preserved
  assert.equal(marked.reason, "Licence suspended");
  assert.equal(marked.username, "RBP");
  assert.ok(marked.changes.some((x: any) => x.field === "projectName" && x.from && x.to === null));
  assert.ok(marked.changes.some((x: any) => x.field === "unavailableReason" && x.to === "Licence suspended"));
  const confirmed = h[0];
  assert.equal(confirmed.previousStatus, "NOT_AVAILABLE");
  assert.equal(confirmed.newStatus, "AVAILABLE");
  assert.ok(h[0].createdAt);
  assert.deepEqual(Object.keys((await call(`/drivers/${c._id}/history`, "GET", undefined, (await T()).rbp)).body).sort(), ["data", "message", "success"]);
});

test("edit: extending the To date records PROJECT_EXTENDED; a new project is PROJECT_ASSIGNED; an unchanged save is refused", async () => {
  const c = (await create(inUse(0, d(0), d(3)))).body.data;
  const same = await put(c._id, c, inUse(0, d(0), d(3)));
  assert.equal(same.status, 400);
  assert.equal(same.body.message, "No changes to save");
  const ext = await put(c._id, c, inUse(0, d(0), d(8)));
  assert.equal(ext.status, 200, JSON.stringify(ext.body));
  assert.equal(ext.body.data.availability.project.endDate, d(8));
  const swap = await put(c._id, ext.body.data, inUse(1, d(0), d(8)));
  assert.equal(swap.status, 200, JSON.stringify(swap.body));
  const h = await history(c._id);
  assert.deepEqual(h.map((x) => x.action), ["PROJECT_ASSIGNED", "PROJECT_EXTENDED", "CREATED"].length ? ["PROJECT_ASSIGNED", "PROJECT_EXTENDED", "PROJECT_ASSIGNED", "CREATED"] : []);
  assert.deepEqual(h[1].changes.map((x: any) => x.field), ["projectToDate"]);
  assert.equal(h[1].changes[0].from, d(3));
  assert.equal(h[1].changes[0].to, d(8));
});

test("edit: a detail-only change records UPDATED with previous and new values and leaves the availability untouched", async () => {
  const c = (await create(notAvail())).body.data;
  // saved details are locked (a rename is refused); a bank-detail change is the detail-only edit that remains
  assert.equal((await put(c._id, c, undefined, { driverName: "Renamed Driver" })).status, 403);
  const r = await put(c._id, c, undefined, { bankName: "Indian Bank" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.availability.status, "NOT_AVAILABLE"); // availability not sent => stored value stays
  const h = await history(c._id);
  assert.equal(h[0].action, "UPDATED");
  assert.deepEqual(h[0].changes, [{ field: "bankName", from: null, to: "Indian Bank" }]);
});

test("legacy driver (created before availability existed): listed, editable once a status is chosen, status filters never match it", async () => {
  const t = await T();
  const legacy: any = await Driver.collection.insertOne({
    driverNumber: "DR-9001", driverName: "Old Timer", driverType: "ACTING_DRIVER", mobileNumber: "+91 7999900001", mobileDigits: "7999900001", salary: 0,
    status: "ACTIVE", createdBy: "RBP", updatedBy: "RBP", createdAt: new Date(), updatedAt: new Date(),
  });
  const id = String(legacy.insertedId);
  const g = await call(`/drivers/${id}`, "GET", undefined, t.rbp);
  assert.equal(g.status, 200);
  assert.equal(g.body.data.availability, undefined);
  assert.equal((await call("/drivers?availabilityStatus=AVAILABLE&q=Old%20Timer", "GET", undefined, t.rbp)).body.data.total, 0);
  assert.equal((await call("/drivers?q=Old%20Timer", "GET", undefined, t.rbp)).body.data.total, 1);
  const noStatus = await put(id, g.body.data, { status: "" });
  assert.equal(noStatus.status, 400);
  const ok = await put(id, g.body.data, { status: "AVAILABLE" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.availability.status, "AVAILABLE");
  assert.equal(ok.body.data.driverNumber, "DR-9001");
  assert.equal((await history(id))[0].action, "AVAILABILITY_CONFIRMED");
  await Driver.collection.insertOne({
    driverNumber: "DR-9002", driverName: "Old Busy", driverType: "ACTING_DRIVER", mobileNumber: "+91 7999900002", mobileDigits: "7999900002", salary: 0, status: "ACTIVE",
    createdBy: "RBP", updatedBy: "RBP", createdAt: new Date(), updatedAt: new Date(),
    availability: { status: "IN_USE", project: { trackupNumber: "OLD-1", endDate: d(-3), startDate: d(-9) } }, // in use without a revision field
  });
  const rel = await releaseDueDrivers(new Date()); // legacy shaped rows are released too
  assert.equal(rel.released, 1);
  assert.equal(((await Driver.findOne({ driverNumber: "DR-9002" }).lean()) as any).availability.status, "AVAILABLE");
});

// ================================================================== listing: filter, search, pagination
test("listing: status filter, mass search over project name / trackup / PIF, combined filters and pagination", async () => {
  const t = await T();
  await Driver.deleteMany({});
  await create({ status: "AVAILABLE" }, { driverName: "Alpha One" });
  const B = (await create(inUse(0), { driverName: "Bravo Two" })).body.data;
  await create(inUse(1), { driverName: "Charlie Three" });
  await create(notAvail(), { driverName: "Delta Four" });
  await create(notAvail({ reason: "Medical rest" }), { driverName: "Echo Five" });
  const list = async (qs: string) => (await call(`/drivers${qs}`, "GET", undefined, t.rbp)).body.data;
  const names = (r: any) => r.items.map((x: any) => x.driverName).sort();
  assert.equal((await list("")).total, 5);
  assert.deepEqual(names(await list("?availabilityStatus=AVAILABLE")), ["Alpha One"]);
  assert.deepEqual(names(await list("?availabilityStatus=IN_USE")), ["Bravo Two", "Charlie Three"]);
  assert.deepEqual(names(await list("?availabilityStatus=NOT_AVAILABLE")), ["Delta Four", "Echo Five"]);
  assert.equal((await list("?availabilityStatus=BOGUS")).total, 5); // unknown value is ignored, not an error
  assert.deepEqual(names(await list(`?q=${encodeURIComponent(trk[0])}`)), ["Bravo Two"]);
  assert.deepEqual(names(await list(`?q=${encodeURIComponent(pif[1])}`)), ["Charlie Three"]);
  assert.deepEqual(names(await list("?q=pepsi")), ["Bravo Two", "Charlie Three"]); // project name
  assert.deepEqual(names(await list("?q=pepsi&availabilityStatus=IN_USE")), ["Bravo Two", "Charlie Three"]);
  assert.deepEqual(names(await list("?q=pepsi&availabilityStatus=NOT_AVAILABLE")), []); // combined filters narrow together
  assert.deepEqual(names(await list(`?q=${encodeURIComponent(B.driverNumber)}&availabilityStatus=IN_USE`)), ["Bravo Two"]);
  assert.deepEqual(names(await list(`?q=${encodeURIComponent(B.driverNumber)}&availabilityStatus=AVAILABLE`)), []);
  assert.deepEqual(names(await list("?q=alpha")), ["Alpha One"]); // existing search still works
  const p1 = await list("?limit=2&page=1");
  const p2 = await list("?limit=2&page=2");
  const p3 = await list("?limit=2&page=3");
  assert.deepEqual([p1.items.length, p2.items.length, p3.items.length, p1.total], [2, 2, 1, 5]);
  assert.equal(new Set([...p1.items, ...p2.items, ...p3.items].map((x: any) => x._id)).size, 5);
  const f = await list("?limit=1&page=2&availabilityStatus=IN_USE");
  assert.deepEqual([f.items.length, f.total, f.page], [1, 2, 2]); // pagination respects the filter
});

// ================================================================== automatic availability
const at = (ymd: string, hhmm = "10:00") => new Date(`${ymd}T${hhmm}:00+05:30`);

test("scheduler: a future To date keeps the driver In Use; the exact To date still keeps it; the next IST day releases it", async () => {
  const c = (await create(inUse(0, d(0), d(5)))).body.data;
  const st = async () => ((await Driver.findById(c._id).lean()) as any).availability.status;
  for (const when of [at(d(0)), at(d(4), "23:59"), at(d(5), "00:00"), at(d(5), "23:59")]) { // the last two: the To date itself, in IST
    await releaseDueDrivers(when);
    assert.equal(await st(), "IN_USE", when.toISOString());
  }
  await releaseDueDrivers(at(d(6), "00:00")); // first minute after the To date
  assert.equal(await st(), "AVAILABLE");
  const after: any = await Driver.findById(c._id).lean();
  assert.equal(after.availability.status, "AVAILABLE");
  assert.equal(after.availability.availableFromDate, d(6));
  assert.equal(after.availability.availableFromTime, "00:00");
  assert.equal(after.availability.project, null); // active association cleared
  assert.equal(after.availability.lastStatusUpdatedBy, "SYSTEM");
  assert.ok(after.availability.autoReleasedAt);
  assert.equal(after.driverName, "Avail Driver"); // nothing else touched
  assert.equal(after.updatedBy, "RBP");
  assert.equal(after.mobileNumber, c.mobileNumber);
});

test("scheduler: history has one AUTO_AVAILABILITY_UPDATE row carrying the previous project; running again creates no duplicate", async () => {
  const c = (await create(inUse(3, d(0), d(2)))).body.data;
  const later = at(d(3));
  const [a, b] = await Promise.all([releaseDueDrivers(later), releaseDueDrivers(later)]); // two simultaneous executions
  assert.equal(a.released + b.released, 1);
  assert.equal((await releaseDueDrivers(later)).released, 0);
  assert.equal((await runDriverAvailabilityJob(later))?.released, 0);
  const rows = (await history(c._id)).filter((x) => x.action === "AUTO_AVAILABILITY_UPDATE");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].username, "SYSTEM");
  assert.equal(rows[0].previousStatus, "IN_USE");
  assert.equal(rows[0].newStatus, "AVAILABLE");
  assert.equal(rows[0].project.trackupNumber, trk[3]);
  assert.equal(rows[0].project.endDate, d(2));
  assert.ok(rows[0].reason);
  assert.ok(rows[0].changes.some((x: any) => x.field === "projectToDate" && x.from === d(2) && x.to === null));
  assert.equal((await history(c._id))[0].action, "AUTO_AVAILABILITY_UPDATE"); // newest first
  assert.equal(await DriverHistory.countDocuments({ driver: c._id, action: "PROJECT_ASSIGNED" }), 1); // the old allocation row is untouched
});

test("scheduler: extending the To date prevents the old-date release; the extended date releases later", async () => {
  const c = (await create(inUse(0, d(0), d(2)))).body.data;
  await put(c._id, c, inUse(0, d(0), d(9)));
  assert.equal((await releaseDueDrivers(at(d(4)))).released, 0);
  assert.equal(((await Driver.findById(c._id).lean()) as any).availability.status, "IN_USE");
  assert.ok((await releaseDueDrivers(at(d(10)))).released >= 1);
  assert.equal(((await Driver.findById(c._id).lean()) as any).availability.status, "AVAILABLE");
});

test("scheduler: Not Available drivers are never released, even past their expected available date; a manual change is respected", async () => {
  const n = (await create(notAvail({ expectedAvailableDate: d(1) }))).body.data;
  const m = (await create(inUse(0, d(0), d(1)))).body.data;
  await put(m._id, m, notAvail({ reason: "Accident recovery", category: "Medical Leave" })); // RBP changed it by hand before the date
  const m2 = (await create(inUse(0, d(0), d(1)))).body.data;
  assert.equal((await put(m2._id, m2, { status: "AVAILABLE" })).status, 200); // manual release
  await releaseDueDrivers(at(d(60)));
  await runDriverAvailabilityJob(at(d(60)));
  const get = async (id: string) => (await Driver.findById(id).lean()) as any;
  assert.equal((await get(n._id)).availability.status, "NOT_AVAILABLE");
  assert.equal((await get(n._id)).availability.notAvailable.reason, "Family function");
  assert.equal((await get(m._id)).availability.status, "NOT_AVAILABLE");
  assert.equal((await get(m2._id)).availability.status, "AVAILABLE");
  assert.equal(await DriverHistory.countDocuments({ driver: { $in: [n._id, m._id, m2._id] }, action: "AUTO_AVAILABILITY_UPDATE" }), 0);
});

test("scheduler: a newer allocation made between the scheduler's read and write is skipped (conditional update)", async () => {
  const c = (await create(inUse(0, d(0), d(2)))).body.data;
  const orig = Driver.findOneAndUpdate.bind(Driver);
  let hijacked = false;
  // simulate RBP re-allocating the driver in the instant between the scheduler's read and its write
  (Driver as any).findOneAndUpdate = (filter: any, ...rest: any[]) => ({
    lean: async () => {
      if (!hijacked && filter._id && String(filter._id) === c._id) {
        hijacked = true;
        await Driver.collection.updateOne({ _id: new mongoose.Types.ObjectId(c._id) }, { $set: { "availability.project.endDate": d(12), "availability.revision": 99 } });
      }
      return orig(filter, ...rest).lean();
    },
  });
  try {
    const r = await releaseDueDrivers(at(d(3)));
    assert.ok(r.skipped >= 1);
  } finally {
    (Driver as any).findOneAndUpdate = orig;
  }
  const after: any = await Driver.findById(c._id).lean();
  assert.equal(after.availability.status, "IN_USE");
  assert.equal(after.availability.project.endDate, d(12));
  assert.equal(await DriverHistory.countDocuments({ driver: c._id, action: "AUTO_AVAILABILITY_UPDATE" }), 0);
});

test("scheduler: an edit racing the scheduler is refused instead of overwriting the automatic release", async () => {
  const c = (await create(inUse(0, d(0), d(2)))).body.data;
  const orig = Driver.findOneAndUpdate.bind(Driver);
  // the scheduler releases the driver in the instant between the edit's read and its write
  (Driver as any).findOneAndUpdate = (filter: any, ...rest: any[]) => ({
    lean: async () => {
      (Driver as any).findOneAndUpdate = orig;
      await releaseDueDrivers(at(d(3)));
      return orig(filter, ...rest).lean();
    },
  });
  let stale: any;
  try {
    stale = await put(c._id, c, inUse(0, d(0), d(8)));
  } finally {
    (Driver as any).findOneAndUpdate = orig;
  }
  assert.equal(stale.status, 409, JSON.stringify(stale.body));
  assert.match(stale.body.message, /changed by someone else/);
  assert.equal(((await Driver.findById(c._id).lean()) as any).availability.status, "AVAILABLE"); // the release was not overwritten
  assert.equal(await DriverHistory.countDocuments({ driver: c._id, action: "PROJECT_EXTENDED" }), 0); // and no history for the refused edit
  const fresh = await put(c._id, (await call(`/drivers/${c._id}`, "GET", undefined, (await T()).rbp)).body.data, inUse(0, d(3), d(8))); // re-opened form saves fine
  assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
});

test("scheduler restart: overdue drivers are caught up in one run; the vehicle job keeps working independently", async () => {
  await Driver.deleteMany({});
  for (let i = 0; i < 4; i++) await create(inUse(i, d(0), d(1 + i)));
  await create(notAvail());
  const r = await runDriverAvailabilityJob(at(d(30))); // server was down for weeks: everything overdue is processed
  assert.equal(r?.released, 4);
  assert.equal(await Driver.countDocuments({ "availability.status": "IN_USE" }), 0);
  assert.equal(await Driver.countDocuments({ "availability.status": "NOT_AVAILABLE" }), 1);
  assert.deepEqual(await runAvailabilityJob(at(d(30))), { released: 0, skipped: 0 }); // vehicle scheduler unchanged
});

// ================================================================== regression
test("regression: vehicle availability still works and driver endpoints keep the sendResponse envelope", async () => {
  const t = await T();
  const veh = await call("/vehicles", "POST", { vehicleNo: "TN10AB2001", make: "Tata", model: "Ace", type: "Dynamic", yearOfManufacture: 2022, purchaseDate: "2022-06-15", currentRunning: 1, totalRunning: 2, fc: [], insurance: [], rtoPermission: [], policePermission: [], permit: [], availability: { status: "AVAILABLE" } }, t.rbp);
  assert.equal(veh.status, 201, JSON.stringify(veh.body));
  assert.equal(veh.body.data.availability.status, "AVAILABLE");
  for (const path of ["/drivers", "/drivers/" + "0".repeat(24) + "/history", "/drivers/zzz/history"]) {
    const r = await call(path, "GET", undefined, t.rbp);
    assert.deepEqual(Object.keys(r.body).sort(), ["data", "message", "success"], path);
  }
  assert.equal((await call("/drivers/zzz/history", "GET", undefined, t.rbp)).status, 400);
  assert.equal((await call(`/drivers/${"a".repeat(24)}/history`)).status, 401);
  assert.equal((await call(`/drivers/${"a".repeat(24)}/history`, "GET", undefined, t.rsop)).status, 403);
});

test("cleanup", async () => {
  assert.match(mongoose.connection.name, /_test_/);
  await mongoose.connection.dropDatabase();
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
});
