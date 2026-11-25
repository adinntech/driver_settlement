/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_availability";
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
import { allocatability, istNowAt, validateAvailability } from "../src/validators/availability.validator.js";
import { addDays, todayYmd } from "../src/validators/vehicle.validator.js";

const today = todayYmd();
const d = (n: number) => addDays(today, n);
const NOW = new Date("2026-11-24T06:30:00Z"); // 24-Nov-2026 12:00 IST

const inUse = (over: Record<string, unknown> = {}, project: Record<string, unknown> = {}) => ({
  status: "IN_USE",
  project: { trackingProject: "a".repeat(24), trackingVehicle: "b".repeat(24), projectType: "ROADSHOW", projectName: "KFC Roadshow", clientName: "KFC", ...project },
  expectedReleaseDate: "2026-11-25", expectedReleaseTime: "20:00", nextAvailableDate: "2026-11-26", nextAvailableTime: "09:00", ...over,
});
const issue = (over: Record<string, unknown> = {}) => ({
  status: "ISSUE", issue: { category: "Engine Problem", description: "Engine overheating", ...over },
});
const v = (input: unknown, draft = false, prev?: any) => validateAvailability(input, draft, NOW, prev);

// ---------------------------------------------------------------- validator (pure)
test("status selection: Available Now / In Use / Vehicle Issue accepted; others rejected; final needs a status", () => {
  assert.equal(v({ status: "AVAILABLE" }).data?.status, "AVAILABLE");
  assert.equal(v(inUse()).data?.status, "IN_USE");
  assert.equal(v(issue()).data?.status, "ISSUE");
  assert.ok(v({ status: "BUSY" }).errors.some((e) => /Vehicle status must be one of/.test(e)));
  assert.ok(v({}).errors.includes("Vehicle status is required"));
  assert.deepEqual(v({}, true).errors, []); // a draft may leave it open
  assert.equal(v(undefined).data, undefined); // not sent => stored value stays untouched
  assert.equal(v(null).data, undefined);
  assert.ok(v([]).errors.length > 0);
});

test("Available Now: defaults to the current IST date & time; only its own fields are kept", () => {
  const r = v({ status: "AVAILABLE", project: { projectName: "stale" }, issue: { description: "stale" }, nextAvailableDate: "2026-12-01" });
  assert.deepEqual(r.errors, []);
  assert.equal(r.data?.availableFromDate, "2026-11-24");
  assert.equal(r.data?.availableFromTime, "12:00");
  assert.equal(r.data?.project, null); // project / issue / next-available fields hidden for this status are not stored
  assert.equal(r.data?.issue, null);
  assert.equal(r.data?.nextAvailableDate, null);
  assert.equal(v({ status: "AVAILABLE", availableFromDate: "2026-12-01", availableFromTime: "08:30" }).data?.nextAvailableAt, "2026-12-01T08:30");
  assert.ok(v({ status: "AVAILABLE", availableFromDate: "2026-12-01" }).errors.some((e) => /both date and time/.test(e)));
  assert.deepEqual(v({ status: "AVAILABLE", availableFromDate: "2026-12-01" }, true).errors, []);
});

test("In Use: project details, release and next available date & time are validated", () => {
  const ok = v(inUse());
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.data?.nextAvailableAt, "2026-11-26T09:00");
  assert.equal(ok.data?.issue, null); // issue fields hidden for this status
  // mandatory next available date AND time
  assert.ok(v(inUse({ nextAvailableDate: "" })).errors.includes("Next available date is required"));
  assert.ok(v(inUse({ nextAvailableTime: undefined })).errors.includes("Next available time is required"));
  // missing project details
  assert.ok(v({ ...inUse(), project: {} }).errors.includes("Select an approved project by Trackup Number or PIF Number")); // only an approved, linked project can be allocated
  assert.ok(v({ ...inUse(), project: { projectName: "Manual", clientName: "Manual", projectType: "ROADSHOW" } }).errors.some((e) => /approved project/.test(e)));
  assert.ok(v({ ...inUse(), project: { ...inUse().project, budget: "zz" } }).errors.some((e) => /Linked budget is invalid/.test(e)));
  assert.ok(v(inUse({}, { projectType: "TAXI" })).errors.some((e) => /Roadshow or Signage/.test(e)));
  // release pair, ordering
  assert.ok(v(inUse({ expectedReleaseTime: "" })).errors.some((e) => /Expected release: both date and time/.test(e)));
  assert.ok(v(inUse({ nextAvailableDate: "2026-11-25", nextAvailableTime: "19:00" })).errors.some((e) => /before the expected release/.test(e)));
  assert.ok(v(inUse({}, { startDate: "2026-12-05", endDate: "2026-12-01" })).errors.some((e) => /end date cannot be before/.test(e)));
  assert.ok(v(inUse({}, { startDate: "2026-12-05" })).errors.some((e) => /before the project start date/.test(e)));
  assert.deepEqual(v({ status: "IN_USE" }, true).errors, []); // draft: nothing mandatory
  assert.ok(v({ status: "IN_USE", nextAvailableDate: "bad" }, true).errors.length > 0); // draft still checks formats
});

test("invalid dates / times are rejected (calendar, clock, formats, XSS-ish text)", () => {
  for (const bad of ["2026-02-31", "2026-13-01", "26-11-2026", "2026-11-26T09:00", "tomorrow"])
    assert.ok(v(inUse({ nextAvailableDate: bad })).errors.some((e) => /valid date/.test(e)), bad);
  for (const bad of ["25:00", "9:00", "09:60", "09:00 PM", "noon"])
    assert.ok(v(inUse({ nextAvailableTime: bad })).errors.some((e) => /valid time/.test(e)), bad);
  assert.ok(v(inUse({}, { projectName: "<script>alert(1)</script>" })).errors.some((e) => /invalid characters/.test(e)));
  assert.ok(v(inUse({}, { projectName: "x".repeat(121) })).errors.some((e) => /too long/.test(e)));
  assert.ok(v(inUse({}, { trackupNumber: "TR;DROP" })).errors.some((e) => /Trackup number is invalid/.test(e)));
  assert.ok(v(inUse({}, { trackingProject: "zzz" })).errors.some((e) => /Linked project is invalid/.test(e)));
});

test("a new next-available moment cannot be in the past, but an unchanged overdue one stays editable", () => {
  const past = inUse({ nextAvailableDate: "2026-11-23", nextAvailableTime: "10:00", expectedReleaseDate: "2026-11-22", expectedReleaseTime: "10:00" });
  assert.ok(v(past).errors.some((e) => /cannot be in the past/.test(e)));
  assert.deepEqual(v(past, false, { status: "IN_USE", nextAvailableAt: "2026-11-23T10:00" }).errors, []);
  assert.ok(v(past, false, { status: "IN_USE", nextAvailableAt: "2026-11-23T11:00" }).errors.some((e) => /cannot be in the past/.test(e)));
  assert.ok(v(past, false, { status: "AVAILABLE", nextAvailableAt: "2026-11-23T10:00" }).errors.some((e) => /cannot be in the past/.test(e)));
});

test("Vehicle Issue: reason mandatory, category list, repair date optional, ordering checks", () => {
  const ok = v(issue());
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.data?.issue?.issueStatus, "OPEN");
  assert.equal(ok.data?.issue?.reportedDate, "2026-11-24"); // defaults to now
  assert.equal(ok.data?.project, null); // project fields hidden for this status
  assert.equal(ok.data?.nextAvailableAt, null); // repair date unknown is fine
  assert.ok(v(issue({ description: "  " })).errors.includes("Issue description / reason is required"));
  assert.ok(v({ status: "ISSUE" }).errors.includes("Issue category is required"));
  assert.ok(v(issue({ category: "Gremlins" })).errors.some((e) => /Issue category must be one of/.test(e)));
  for (const c of ["Engine Problem", "Battery Problem", "Tyre / Stepney Problem", "Accident / Body Damage", "Electrical Problem", "Mechanical Problem", "Document / Permit Issue", "Other"])
    assert.deepEqual(v(issue({ category: c })).errors, [], c);
  assert.equal(v(issue({ description: "Custom: brake pad worn (front)" })).data?.issue?.description, "Custom: brake pad worn (front)");
  assert.equal(v(issue({ expectedRepairDate: "2026-12-02", expectedRepairTime: "17:30" })).data?.nextAvailableAt, "2026-12-02T17:30");
  assert.deepEqual(v(issue({ expectedRepairDate: "2026-12-02" })).errors, []); // time optional
  assert.ok(v(issue({ expectedRepairTime: "10:00" })).errors.some((e) => /date is required when a time/.test(e)));
  assert.ok(v(issue({ reportedDate: "2026-11-24", reportedTime: "10:00", expectedRepairDate: "2026-11-24", expectedRepairTime: "09:00" })).errors.some((e) => /before the issue was reported/.test(e)));
  assert.ok(v(issue({ reportedDate: "2026-11-25", reportedTime: "10:00" })).errors.some((e) => /cannot be in the future/.test(e)));
  assert.ok(v(issue({ expectedRepairDate: "2026-11-20", expectedRepairTime: "10:00" })).errors.some((e) => /cannot be in the past/.test(e)));
  assert.ok(v(issue({ issueStatus: "DONE" })).errors.some((e) => /Open or In Repair/.test(e)));
  assert.deepEqual(v({ status: "ISSUE" }, true).errors, []);
});

test("allocation rules: only Available Now; in use / issue blocked; an expired release never frees the vehicle", () => {
  assert.deepEqual(allocatability({ status: "AVAILABLE" }, NOW), { allocatable: true, reason: "Available now", releaseOverdue: false });
  assert.equal(allocatability({ status: "AVAILABLE", availableFromDate: "2026-11-24", availableFromTime: "11:00" }, NOW).allocatable, true);
  const later = allocatability({ status: "AVAILABLE", availableFromDate: "2026-11-30", availableFromTime: "09:00" }, NOW);
  assert.equal(later.allocatable, false);
  assert.match(later.reason, /Available from/);
  const busy = allocatability({ status: "IN_USE", nextAvailableAt: "2026-11-26T09:00" }, NOW);
  assert.equal(busy.allocatable, false);
  assert.equal(busy.releaseOverdue, false);
  const overdue = allocatability({ status: "IN_USE", nextAvailableAt: "2026-11-20T09:00" }, NOW); // release time passed
  assert.equal(overdue.allocatable, false); // still not allocatable: RBP must confirm
  assert.equal(overdue.releaseOverdue, true);
  const bad = allocatability({ status: "ISSUE", issue: { description: "Engine" }, nextAvailableAt: "2026-11-01T00:00" }, NOW);
  assert.equal(bad.allocatable, false);
  assert.match(bad.reason, /Engine/);
  assert.equal(allocatability(undefined, NOW).allocatable, false);
  assert.equal(allocatability({}, NOW).reason, "Availability not set");
  assert.match(istNowAt(NOW), /^2026-11-24T12:00$/);
});
// ---------------------------------------------------------------- API (own temp DB)
const { config: cfg } = await import("../src/config/index.js");
// SAFETY: static imports above already loaded config (with the real .env MONGO_URI) before the env lines ran,
// so force the throw-away test database here. Tests drop their database, so refuse to run against anything else.
const TEST_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_availability";
cfg.mongoUri = TEST_URI;
const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { User } = await import("../src/models/User.js");
const { Vehicle, VehicleHistory } = await import("../src/models/Vehicle.js");
const { TrackingProject } = await import("../src/models/TrackingProject.js");
const { TrackingVehicle } = await import("../src/models/TrackingVehicle.js");
const { Budget } = await import("../src/models/Budget.js");
const { releaseDueVehicles } = await import("../src/services/availability.service.js");
const { runAvailabilityJob, startAvailabilityScheduler } = await import("../src/jobs/availabilityScheduler.js");

let server: Server;
let base = "";
{
  await connectDB();
  assert.match(mongoose.connection.name, /_test_/, "refusing to drop a non-test database");
  await mongoose.connection.dropDatabase();
  await Promise.all([User.init(), Vehicle.init(), VehicleHistory.init(), TrackingProject.init(), TrackingVehicle.init(), Budget.init()]);
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

let seq = 0;
const full = (over: Record<string, unknown> = {}) => ({
  vehicleNo: `TN${10 + seq}AB${1000 + seq++}`, make: "Tata", model: "Ace", type: "Dynamic", yearOfManufacture: 2022, purchaseDate: "2022-06-15",
  currentRunning: 1200, totalRunning: 45000, fc: [], insurance: [], rtoPermission: [], policePermission: [], permit: [], ...over,
});
/** In Use on a project, identified only by its trackup / PIF number (everything else comes from the database). */
const use = (ref: { trackupNumber?: string; pifNumber?: string }, over: Record<string, unknown> = {}, project: Record<string, unknown> = {}) => ({
  status: "IN_USE", project: { ...ref, ...project },
  expectedReleaseDate: d(3), expectedReleaseTime: "20:00", nextAvailableDate: d(4), nextAvailableTime: "09:00", ...over,
});

// ---- fixtures: a Signage project with 14 vehicles and a Roadshow project with 2; budgets in every approval state
let proj: any;
let road: any;
let auto: any;
const budgetNo = (() => { let n = 0; return () => `BUD-T-${++n}`; })();
const mkBudget = (tv: any, projectId: string, state: Record<string, unknown>) =>
  Budget.create({ budgetNumber: budgetNo(), vehicle: tv._id, project: projectId, data: {}, total: 0, currentVersion: 1, createdBy: "RBP", updatedBy: "RBP", ...state });
{
  const t = await T();
  const r = await call("/tracking", "POST", {
    projectType: "SIGNAGE",
    details: { client: "Pepsi India", jobSheetNumber: "ZZPEP-77", location: "Coimbatore", date: d(0), fromDate: d(2), toDate: d(9), numberOfVehicles: 14 },
  }, t.rsop);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  proj = r.body.data;
  const rr = await call("/tracking", "POST", {
    projectType: "ROADSHOW",
    details: { billingName: "KFC", stateCode: "33", startDate: d(2), endDate: d(6), reportingDate: d(2), sundayHalt: "NO", numberOfVans: 2, reportingLocations: ["Chennai", "Trichy"] },
  }, t.rsop);
  assert.equal(rr.status, 201, JSON.stringify(rr.body));
  road = rr.body.data;
  const approved = { approvalStatus: "APPROVED", approvedVersion: 1 };
  for (let i = 0; i < 8; i++) await mkBudget(proj.vehicles[i], proj._id, approved); // 0..7: approved
  await mkBudget(proj.vehicles[8], proj._id, { approvalStatus: "PENDING", submittedVersion: 1 });
  await mkBudget(proj.vehicles[9], proj._id, { approvalStatus: "REJECTED", rejectedVersion: 1 });
  await mkBudget(proj.vehicles[10], proj._id, { approvalStatus: "DRAFT" });
  await mkBudget(proj.vehicles[11], proj._id, { approvalStatus: "PENDING", approvedVersion: 1, currentVersion: 2, submittedVersion: 2 }); // older approved version, newer pending
  await mkBudget(proj.vehicles[12], proj._id, { approvalStatus: "APPROVED", approvedVersion: 1, currentVersion: 2 }); // approved v1 but v2 not approved
  // vehicles[13]: no budget at all
  for (const tv of road.vehicles) await mkBudget(tv, road._id, approved);
  const ar = await call("/tracking", "POST", {
    projectType: "SIGNAGE", details: { client: "Auto Motors", jobSheetNumber: "ZZAUTO-1", location: "Salem", date: d(0), fromDate: d(2), toDate: d(9), numberOfVehicles: 12 },
  }, t.rsop);
  assert.equal(ar.status, 201, JSON.stringify(ar.body));
  auto = ar.body.data;
  for (const tv of auto.vehicles) await mkBudget(tv, auto._id, approved); // a pool of approved vehicles for the release tests
}
const trk: string[] = proj.vehicles.map((x: any) => x.trackupNumber);
const pif: string[] = proj.vehicles.map((x: any) => x.pifNumber);
const au: string[] = auto.vehicles.map((x: any) => x.trackupNumber);

// ------------------------------------------------------------------------ approved-project suggestions
test("suggestions: only projects with a currently approved budget; draft / pending / rejected / newer-pending / none are excluded", async () => {
  const t = await T();
  assert.equal((await call("/vehicles/projects")).status, 401);
  assert.equal((await call("/vehicles/projects", "GET", undefined, t.rsop)).status, 403);
  const r = await call("/vehicles/projects?limit=50", "GET", undefined, t.rbp);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ["data", "message", "success"]);
  const got = new Set(r.body.data.items.map((x: any) => x.trackupNumber));
  for (let i = 0; i < 8; i++) assert.ok(got.has(trk[i]), `approved ${i}`);
  for (const tv of road.vehicles) assert.ok(got.has(tv.trackupNumber));
  for (const i of [8, 9, 10, 11, 12, 13]) assert.ok(!got.has(trk[i]), `excluded ${i}`);
  assert.equal(r.body.data.total, 22);
  const row = r.body.data.items.find((x: any) => x.trackupNumber === trk[0]);
  assert.equal(row.pifNumber, pif[0]);
  assert.equal(row.clientName, "Pepsi India");
  assert.equal(row.projectType, "SIGNAGE");
  assert.match(row.projectName, /Pepsi India Signage – ZZPEP-77/);
  assert.equal(row.startDate, d(2));
  assert.equal(row.endDate, d(9));
  assert.equal(row.location, "Coimbatore");
  assert.equal(row.allocatedTo, null);
  assert.ok(row.budgetNumber && row.budgetVersion === 1);
  // a budget that stops being approved disappears from suggestions
  await Budget.updateOne({ vehicle: proj.vehicles[7]._id }, { $set: { approvalStatus: "PENDING" } });
  assert.ok(!(await call("/vehicles/projects?limit=50", "GET", undefined, t.rbp)).body.data.items.some((x: any) => x.trackupNumber === trk[7]));
  await Budget.updateOne({ vehicle: proj.vehicles[7]._id }, { $set: { approvalStatus: "APPROVED" } });
});

test("suggestions: search by trackup, PIF, client / billing name, job sheet, project type; paginated on the server", async () => {
  const t = await T();
  const s = async (q: string, extra = "") => (await call(`/vehicles/projects?q=${encodeURIComponent(q)}${extra}`, "GET", undefined, t.rbp)).body.data;
  assert.deepEqual((await s(trk[2])).items.map((x: any) => x.trackupNumber), [trk[2]]);
  assert.deepEqual((await s(pif[3].toLowerCase())).items.map((x: any) => x.pifNumber), [pif[3]]);
  assert.equal((await s("pepsi")).total, 8);
  assert.equal((await s("kfc")).total, 2);
  assert.equal((await s("KFC")).items[0].projectType, "ROADSHOW");
  assert.equal((await s("zzpep-77")).total, 8);
  assert.equal((await s("roadshow")).total, 2);
  assert.equal((await s("signage")).total, 20);
  assert.equal((await s(trk[8])).total, 0); // pending budget: not searchable either
  assert.equal((await s("nothing-matches-this")).total, 0);
  const p1 = await s("pepsi", "&limit=3&page=1");
  const p2 = await s("pepsi", "&limit=3&page=2");
  const p3 = await s("pepsi", "&limit=3&page=3");
  assert.deepEqual([p1.items.length, p2.items.length, p3.items.length, p1.total], [3, 3, 2, 8]);
  const all = [...p1.items, ...p2.items, ...p3.items].map((x: any) => x.trackupNumber);
  assert.equal(new Set(all).size, 8); // no overlap across pages
  assert.equal((await s("pepsi", "&limit=999")).limit, 50); // capped
  assert.equal((await s("%.*[")).total, 0); // regex characters are escaped
});

// ------------------------------------------------------------------------ trackup <-> PIF mapping
test("mapping: trackup gives its own PIF, PIF gives its own trackup (each vehicle of a project has its own pair)", async () => {
  const t = await T();
  const lk = (qs: string) => call(`/vehicles/projects/lookup?${qs}`, "GET", undefined, t.rbp);
  assert.equal((await call(`/vehicles/projects/lookup?trackup=${trk[0]}`)).status, 401);
  assert.equal((await call(`/vehicles/projects/lookup?trackup=${trk[0]}`, "GET", undefined, t.rsom)).status, 403);
  for (const i of [0, 1, 5]) {
    const a = await lk(`trackup=${encodeURIComponent(trk[i].toLowerCase())}`);
    assert.equal(a.status, 200);
    assert.deepEqual(Object.keys(a.body).sort(), ["data", "message", "success"]);
    assert.equal(a.body.data.pifNumber, pif[i]);
    assert.equal(a.body.data.clientName, "Pepsi India");
    const b = await lk(`pif=${encodeURIComponent(pif[i])}`);
    assert.equal(b.body.data.trackupNumber, trk[i]);
    assert.equal(b.body.data.projectName, a.body.data.projectName);
    assert.equal((await lk(`trackup=${trk[i]}&pif=${pif[i]}`)).status, 200); // matching pair
  }
  assert.notEqual(pif[0], pif[1]); // really distinct per vehicle
  const rs = await lk(`trackup=${road.vehicles[0].trackupNumber}`);
  assert.equal(rs.body.data.projectType, "ROADSHOW");
  assert.equal(rs.body.data.projectName, "KFC Roadshow");
  assert.equal(rs.body.data.location, "Chennai, Trichy");
  assert.equal(rs.body.data.startDate, d(2));
});

test("mapping: invalid trackup / PIF, mismatched pair and unapproved projects are rejected with the standard envelope", async () => {
  const t = await T();
  const lk = (qs: string) => call(`/vehicles/projects/lookup?${qs}`, "GET", undefined, t.rbp);
  for (const [qs, re] of [
    ["", /Enter a Trackup Number or PIF Number/],
    ["trackup=NOPE-1", /Trackup number NOPE-1 was not found/],
    ["pif=NOPE-1", /PIF number NOPE-1 was not found/],
    [`trackup=${trk[0]}&pif=${pif[1]}`, /do not belong to the same project vehicle/],
    [`trackup=${trk[8]}`, /Only approved projects can be allocated: the budget for .* is pending/],
    [`pif=${pif[9]}`, /rejected/],
    [`trackup=${trk[10]}`, /draft/],
    [`trackup=${trk[11]}`, /pending/], // newer pending version: the older approved one is not allocatable
    [`trackup=${trk[12]}`, /Only approved projects/], // approved v1 but v2 not approved
    [`trackup=${trk[13]}`, /not created/],
  ] as const) {
    const r = await lk(qs);
    assert.equal(r.status, 400, qs);
    assert.equal(r.body.success, false);
    assert.equal(r.body.data, null);
    assert.match(r.body.message, re, qs);
  }
});

// ------------------------------------------------------------------------ saving an allocation
test("create with each status; In Use fills the matching PIF from the trackup (or the trackup from the PIF) and records history", async () => {
  const t = await T();
  const a = await call("/vehicles", "POST", full({ availability: { status: "AVAILABLE" } }), t.rbp);
  assert.equal(a.status, 201);
  assert.equal(a.body.data.allocatable, true);

  const u = await call("/vehicles", "POST", full({ availability: use({ trackupNumber: trk[0].toLowerCase() }, {}, { projectName: "FAKE", clientName: "FAKE", pifNumber: "" }) }), t.rbp);
  assert.equal(u.status, 201, JSON.stringify(u.body));
  const p = u.body.data.availability.project;
  assert.equal(p.trackupNumber, trk[0]);
  assert.equal(p.pifNumber, pif[0]); // auto-mapped
  assert.equal(p.clientName, "Pepsi India"); // from the database, not the request
  assert.match(p.projectName, /Pepsi India Signage/);
  assert.equal(p.projectType, "SIGNAGE");
  assert.equal(p.startDate, d(2));
  assert.equal(p.trackingProject, proj._id);
  assert.equal(p.trackingVehicle, proj.vehicles[0]._id);
  assert.equal(p.budgetVersion, 1);
  assert.equal(u.body.data.availability.nextAvailableAt, `${d(4)}T09:00`);
  assert.equal(u.body.data.allocatable, false);

  const byPif = await call("/vehicles", "POST", full({ availability: use({ pifNumber: pif[1] }) }), t.rbp); // reverse direction
  assert.equal(byPif.status, 201, JSON.stringify(byPif.body));
  assert.equal(byPif.body.data.availability.project.trackupNumber, trk[1]);
  const both = await call("/vehicles", "POST", full({ availability: use({ trackupNumber: trk[2], pifNumber: pif[2] }) }), t.rbp);
  assert.equal(both.status, 201);

  const i = await call("/vehicles", "POST", full({ availability: { status: "ISSUE", issue: { category: "Engine Problem", description: "Engine overheating", garage: "Anna Garage" } } }), t.rbp);
  assert.equal(i.status, 201);
  assert.match(i.body.data.allocationNote, /Engine overheating/);

  const h = (await call(`/vehicles/${u.body.data._id}/history`, "GET", undefined, t.rbp)).body.data;
  const row = h.find((x: any) => x.action === "PROJECT_ASSIGNED");
  assert.equal(row.newStatus, "IN_USE");
  assert.equal(row.previousStatus, null);
  assert.equal(row.project.trackupNumber, trk[0]);
  assert.ok(row.changes.some((c: any) => c.field === "trackupNumber" && c.to === trk[0]));
  assert.ok(row.changes.some((c: any) => c.field === "pifNumber" && c.to === pif[0]));
  assert.ok(row.changes.some((c: any) => c.field === "nextAvailable" && c.to === `${d(4)} 09:00`));
  assert.ok(h.some((x: any) => x.action === "CREATED"));
});

test("allocation validation: needs an approved, matching project; invalid / mismatched / unapproved values are never saved", async () => {
  const t = await T();
  const before = await Vehicle.countDocuments();
  for (const [availability, re] of [
    [use({}), /Select an approved project by Trackup Number or PIF Number/],
    [{ status: "IN_USE", project: { projectName: "Walk-in promo", clientName: "Local shop", projectType: "ROADSHOW" }, nextAvailableDate: d(4), nextAvailableTime: "09:00" }, /Select an approved project/], // manual projects no longer allowed
    [use({ trackupNumber: "TRK-NOPE" }), /Trackup number TRK-NOPE was not found/],
    [use({ pifNumber: "PIF-NOPE" }), /PIF number PIF-NOPE was not found/],
    [use({ trackupNumber: trk[3], pifNumber: pif[4] }), /do not belong to the same project vehicle/],
    [use({ trackupNumber: trk[8] }), /Only approved projects can be allocated/],
    [use({ trackupNumber: trk[11] }), /Only approved projects can be allocated/],
    [use({ trackupNumber: trk[13] }), /Only approved projects can be allocated/],
    [use({ trackupNumber: trk[3] }, { nextAvailableTime: "" }), /Next available time is required/],
    [use({ trackupNumber: trk[3] }, { nextAvailableDate: "2026-02-31" }), /valid date/],
  ] as const) {
    const r = await call("/vehicles", "POST", full({ availability }), t.rbp);
    assert.equal(r.status, 400, JSON.stringify(availability));
    assert.equal(r.body.success, false);
    assert.equal(r.body.data, null);
    assert.match(r.body.message, re);
  }
  assert.equal(await Vehicle.countDocuments(), before); // nothing inconsistent was saved
  // a draft may be incomplete, but whatever trackup / PIF it holds must still be a real approved pair
  assert.equal((await call("/vehicles", "POST", { saveAs: "DRAFT", vehicleNo: "KA01DR0001", availability: { status: "IN_USE" } }, t.rbp)).status, 201);
  assert.equal((await call("/vehicles", "POST", { saveAs: "DRAFT", vehicleNo: "KA01DR0002", availability: { status: "IN_USE", project: { trackupNumber: trk[8] } } }, t.rbp)).status, 400);
});

test("a vehicle holds one allocation: same project vehicle on two vehicles is refused (also under concurrency); issue vehicles and re-targeting are refused", async () => {
  const t = await T();
  const mk = (n: string) => call("/vehicles", "POST", full({ availability: use({ trackupNumber: n }) }), t.rbp);
  const dup = await mk(trk[0]); // taken in an earlier test
  assert.equal(dup.status, 409);
  assert.match(dup.body.message, /already allocated to vehicle/);
  assert.equal(dup.body.data, null);
  const [x, y] = await Promise.all([mk(trk[5]), mk(trk[5])]);
  assert.deepEqual([x.status, y.status].sort(), [201, 409]);
  assert.equal(await Vehicle.countDocuments({ "availability.status": "IN_USE", "availability.project.trackupNumber": trk[5] }), 1);
  // search shows who holds it
  const s = (await call(`/vehicles/projects?q=${trk[5]}`, "GET", undefined, t.rbp)).body.data.items[0];
  assert.ok(s.allocatedTo);

  const free = (await call("/vehicles", "POST", full({ availability: { status: "AVAILABLE" } }), t.rbp)).body.data;
  const mv = await call(`/vehicles/${free._id}`, "PUT", { ...free, availability: use({ trackupNumber: trk[5] }) }, t.rbp);
  assert.equal(mv.status, 409); // someone else already holds it
  assert.equal((await Vehicle.findById(free._id).lean() as any).availability.status, "AVAILABLE");

  // an in-use vehicle cannot be pointed at another project without releasing it first
  const holder = (await call("/vehicles", "POST", full({ availability: use({ trackupNumber: trk[6] }) }), t.rbp)).body.data;
  const re = await call(`/vehicles/${holder._id}`, "PUT", { ...holder, availability: use({ trackupNumber: trk[7] }) }, t.rbp);
  assert.equal(re.status, 409);
  assert.match(re.body.message, /already allocated to trackup/);
  // ... but extending the same project is fine
  const ext = await call(`/vehicles/${holder._id}`, "PUT", { ...holder, availability: use({ trackupNumber: trk[6] }, { nextAvailableDate: d(8) }) }, t.rbp);
  assert.equal(ext.status, 200, JSON.stringify(ext.body));

  // a vehicle under an issue cannot go straight to a project
  const bad = (await call("/vehicles", "POST", full({ availability: { status: "ISSUE", issue: { category: "Other", description: "Brakes" } } }), t.rbp)).body.data;
  const to = await call(`/vehicles/${bad._id}`, "PUT", { ...bad, availability: use({ trackupNumber: trk[7] }) }, t.rbp);
  assert.equal(to.status, 409);
  assert.match(to.body.message, /open issue/);
});

test("lifecycle: extend project, issue reported, repair date moved, resolved (Available), history keeps every step newest first", async () => {
  const t = await T();
  const v0 = (await call("/vehicles", "POST", full({ availability: use({ trackupNumber: trk[4] }) }), t.rbp)).body.data;
  const id = v0._id;
  const put = (availability: unknown) => call(`/vehicles/${id}`, "PUT", { ...v0, availability }, t.rbp);
  await new Promise((r) => setTimeout(r, 15));

  let r = await put(use({ trackupNumber: trk[4] }, { expectedReleaseDate: d(6), expectedReleaseTime: "18:00", nextAvailableDate: d(7), nextAvailableTime: "10:00" }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.availability.nextAvailableAt, `${d(7)}T10:00`);
  let h = (await call(`/vehicles/${id}/history`, "GET", undefined, t.rbp)).body.data;
  const ext = h.find((x: any) => x.action === "RELEASE_CHANGED");
  assert.deepEqual(ext.changes.map((c: any) => [c.field, c.from, c.to]), [
    ["expectedRelease", `${d(3)} 20:00`, `${d(6)} 18:00`], ["nextAvailable", `${d(4)} 09:00`, `${d(7)} 10:00`],
  ]);
  assert.equal((await put(use({ trackupNumber: trk[4] }, { expectedReleaseDate: d(6), expectedReleaseTime: "18:00", nextAvailableDate: d(7), nextAvailableTime: "10:00" }))).status, 400); // unchanged

  await new Promise((r2) => setTimeout(r2, 15));
  r = await put({ status: "ISSUE", issue: { category: "Battery Problem", description: "Battery dead", expectedRepairDate: d(5), expectedRepairTime: "12:00", issueStatus: "IN_REPAIR", garage: "Amara Raja" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.availability.project ?? null, null); // allocation released while it is under repair; history keeps it
  assert.equal(await Vehicle.countDocuments({ _id: id, "availability.project.trackupNumber": { $type: "string" } }), 0);
  await new Promise((r2) => setTimeout(r2, 15));
  r = await put({ status: "ISSUE", issue: { category: "Battery Problem", description: "Battery dead, replaced cell", expectedRepairDate: d(6), expectedRepairTime: "12:00", issueStatus: "IN_REPAIR", garage: "Amara Raja" } });
  assert.equal(r.status, 200);
  assert.equal((await call(`/vehicles/${id}`, "GET", undefined, t.rbp)).body.data.allocatable, false); // stays unavailable until RBP resolves it
  await new Promise((r2) => setTimeout(r2, 15));
  r = await put({ status: "AVAILABLE" });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.allocatable, true);
  assert.ok(r.body.data.availability.issueResolvedAt);

  h = (await call(`/vehicles/${id}/history`, "GET", undefined, t.rbp)).body.data;
  const acts = h.map((x: any) => x.action);
  for (const a of ["CREATED", "PROJECT_ASSIGNED", "RELEASE_CHANGED", "ISSUE_REPORTED", "REPAIR_DATE_CHANGED", "ISSUE_UPDATED", "ISSUE_RESOLVED", "MARKED_AVAILABLE"]) assert.ok(acts.includes(a), a);
  for (let k = 1; k < h.length; k++) assert.ok(new Date(h[k - 1].createdAt) >= new Date(h[k].createdAt));
  assert.equal(acts[acts.length - 1], "CREATED");
  const reported = h.find((x: any) => x.action === "ISSUE_REPORTED");
  assert.equal(reported.previousStatus, "IN_USE");
  assert.equal(reported.project.trackupNumber, trk[4]); // the project it left is preserved
  assert.equal(reported.issueReason, "Battery dead");
  assert.equal(h.find((x: any) => x.action === "MARKED_AVAILABLE").previousStatus, "ISSUE");
  await assert.rejects(VehicleHistory.updateOne({ vehicle: id }, { newStatus: "x" })); // immutable
});

// ------------------------------------------------------------------------ automatic release
const fresh = async (ref: { trackupNumber: string }) => {
  const t = await T();
  const r = await call("/vehicles", "POST", full({ availability: use(ref) }), t.rbp);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data as any;
};
const setNext = (id: string, at: string) =>
  Vehicle.updateOne({ _id: id }, { $set: { "availability.nextAvailableAt": at, "availability.nextAvailableDate": at.slice(0, 10), "availability.nextAvailableTime": at.slice(11) } });
const autoRows = (id: string) => VehicleHistory.find({ vehicle: id, action: "AUTO_AVAILABILITY_UPDATE" }).lean() as Promise<any[]>;
const AUTO_NOW = new Date("2026-11-25T14:30:00Z"); // 25-Nov-2026, 20:00 IST

test("auto release: future date / later today stays In Use; due, and the exact boundary, becomes Available", async () => {
  const keepFuture = await fresh({ trackupNumber: au[0] });
  const laterToday = await fresh({ trackupNumber: au[1] });
  await setNext(keepFuture._id, "2026-11-30T09:00");
  await setNext(laterToday._id, "2026-11-25T20:01"); // one minute after "now"
  const r0 = await releaseDueVehicles(AUTO_NOW);
  assert.equal(r0.released, 0);
  for (const v of [keepFuture, laterToday]) assert.equal((await Vehicle.findById(v._id).lean() as any).availability.status, "IN_USE");
});

test("auto release: boundary (exactly the due minute) and past moments release; allocation cleared, history kept, reservation freed", async () => {
  const t = await T();
  const boundary = await fresh({ trackupNumber: au[2] });
  const past = await fresh({ trackupNumber: au[3] });
  await setNext(boundary._id, "2026-11-25T20:00"); // == now (IST)
  await setNext(past._id, "2026-11-20T09:15");
  const r = await releaseDueVehicles(AUTO_NOW);
  assert.ok(r.released >= 2);
  for (const [v, at] of [[boundary, "2026-11-25T20:00"], [past, "2026-11-20T09:15"]] as const) {
    const got: any = await Vehicle.findById(v._id).lean();
    assert.equal(got.availability.status, "AVAILABLE");
    assert.equal(got.availability.project ?? null, null); // active allocation cleared
    assert.equal(got.availability.nextAvailableAt, at);
    assert.ok(got.availability.autoReleasedAt);
    assert.equal(got.updatedBy, "SYSTEM");
    const api = (await call(`/vehicles/${v._id}`, "GET", undefined, t.rbp)).body.data;
    if (at < istNowAt(new Date())) assert.equal(api.allocatable, true); // free for a new project as soon as its moment is in the past
    const rows = await autoRows(v._id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].previousStatus, "IN_USE");
    assert.equal(rows[0].newStatus, "AVAILABLE");
    assert.equal(rows[0].username, "SYSTEM");
    assert.equal(rows[0].reason, "Vehicle automatically marked Available after the scheduled release time.");
    assert.equal(rows[0].project.trackupNumber, v.availability.project.trackupNumber); // historical allocation preserved
    assert.ok(rows[0].changes.some((c: any) => c.field === "availabilityStatus" && c.from === "IN_USE" && c.to === "AVAILABLE"));
    assert.ok(rows[0].changes.some((c: any) => c.field === "trackupNumber" && c.to === null));
    const hist = (await call(`/vehicles/${v._id}/history`, "GET", undefined, t.rbp)).body.data;
    assert.equal(hist[0].action, "AUTO_AVAILABILITY_UPDATE"); // newest first
    assert.ok(hist.some((x: any) => x.action === "PROJECT_ASSIGNED")); // earlier allocation record untouched
  }
  // the freed project vehicle can be allocated again
  const again = await call("/vehicles", "POST", full({ availability: use({ trackupNumber: au[3] }) }), t.rbp);
  assert.equal(again.status, 201, JSON.stringify(again.body));
});

test("auto release is idempotent: repeated runs and a later restart add no second history row", async () => {
  const v = await fresh({ trackupNumber: au[4] });
  await setNext(v._id, "2026-11-20T09:00");
  const first = await releaseDueVehicles(AUTO_NOW);
  assert.equal(first.released >= 1, true);
  for (let i = 0; i < 3; i++) assert.equal((await releaseDueVehicles(AUTO_NOW)).released, 0);
  assert.equal((await autoRows(v._id)).length, 1);
  const rev = (await Vehicle.findById(v._id).lean() as any).revision;
  await releaseDueVehicles(new Date("2027-01-01T00:00:00Z")); // "server restarted much later"
  assert.equal((await Vehicle.findById(v._id).lean() as any).revision, rev); // untouched
  // the idempotency key is unique even if two writers raced
  await assert.rejects(VehicleHistory.create({ vehicle: v._id, action: "AUTO_AVAILABILITY_UPDATE", username: "SYSTEM", autoKey: `${v._id}:2026-11-20T09:00` }));
});

test("auto release respects the current state: extended, Vehicle Issue, manual change and other statuses are not touched", async () => {
  const t = await T();
  const ext = await fresh({ trackupNumber: au[5] });
  // extended through the API: the old time no longer applies
  await setNext(ext._id, "2026-11-20T09:00");
  const e = await call(`/vehicles/${ext._id}`, "PUT", { ...ext, availability: use({ trackupNumber: ext.availability.project.trackupNumber }, { expectedReleaseDate: "2026-12-05", expectedReleaseTime: "10:00", nextAvailableDate: "2026-12-06", nextAvailableTime: "10:00" }) }, t.rbp);
  assert.equal(e.status, 200, JSON.stringify(e.body));
  await releaseDueVehicles(AUTO_NOW);
  assert.equal((await Vehicle.findById(ext._id).lean() as any).availability.status, "IN_USE");
  assert.equal((await autoRows(ext._id)).length, 0);

  // Vehicle Issue with a past repair date stays an issue; Available stays available; both keep their history clean
  const bad = (await call("/vehicles", "POST", full({ availability: { status: "ISSUE", issue: { category: "Other", description: "Gearbox" } } }), t.rbp)).body.data;
  await Vehicle.updateOne({ _id: bad._id }, { $set: { "availability.nextAvailableAt": "2026-11-01T00:00" } });
  const ok = (await call("/vehicles", "POST", full({ availability: { status: "AVAILABLE" } }), t.rbp)).body.data;
  await Vehicle.updateOne({ _id: ok._id }, { $set: { "availability.nextAvailableAt": "2026-11-01T00:00" } });
  const legacy = await Vehicle.create({ ...full(), status: "ACTIVE", createdBy: "RBP", updatedBy: "RBP" });
  await releaseDueVehicles(AUTO_NOW);
  assert.equal((await Vehicle.findById(bad._id).lean() as any).availability.status, "ISSUE");
  assert.equal((await Vehicle.findById(ok._id).lean() as any).availability.status, "AVAILABLE");
  assert.equal((await Vehicle.findById(legacy._id).lean() as any).availability, undefined);
  for (const id of [bad._id, ok._id, legacy._id]) assert.equal((await autoRows(id)).length, 0);

  // the conditional update loses to a concurrent change: simulated by changing the moment after it was read
  const raced = await fresh({ trackupNumber: au[6] });
  await setNext(raced._id, "2026-11-20T09:00");
  const orig = Vehicle.findOneAndUpdate.bind(Vehicle);
  (Vehicle as any).findOneAndUpdate = (...args: any[]) => ({ // someone extends the allocation between read and write
    lean: async () => {
      await setNext(raced._id, "2026-12-30T09:00");
      return (orig as any)(...args).lean();
    },
  });
  try {
    const res = await releaseDueVehicles(AUTO_NOW);
    assert.ok(res.skipped >= 1);
  } finally {
    (Vehicle as any).findOneAndUpdate = orig;
  }
  assert.equal((await Vehicle.findById(raced._id).lean() as any).availability.status, "IN_USE");
  assert.equal((await autoRows(raced._id)).length, 0);
});

test("scheduler: runs through the job wrapper, never overlaps itself, start-up catch-up releases overdue vehicles, can be stopped", async () => {
  const v = await fresh({ trackupNumber: au[7] });
  await setNext(v._id, "2026-01-01T09:00");
  const [a, b] = await Promise.all([runAvailabilityJob(), runAvailabilityJob()]);
  assert.equal([a, b].filter((x) => x === null).length, 1); // second concurrent run is skipped
  assert.equal((await Vehicle.findById(v._id).lean() as any).availability.status, "AVAILABLE");
  assert.equal((await autoRows(v._id)).length, 1);
  assert.deepEqual(await runAvailabilityJob(), { released: 0, skipped: 0 });
  // restart catch-up: start() processes overdue vehicles immediately, without waiting for the first tick
  const w = await Vehicle.create({
    ...full(), status: "ACTIVE", createdBy: "RBP", updatedBy: "RBP", revision: 1,
    availability: { status: "IN_USE", project: { trackupNumber: "TRK-CATCHUP", projectName: "x", clientName: "y" }, nextAvailableDate: "2026-01-02", nextAvailableTime: "09:00", nextAvailableAt: "2026-01-02T09:00" },
  });
  const stop = startAvailabilityScheduler(60_000);
  await new Promise((r) => setTimeout(r, 500));
  stop();
  assert.equal((await Vehicle.findById(w._id).lean() as any).availability.status, "AVAILABLE");
  assert.equal((await autoRows(w._id)).length, 1);
});

test("a budget that is no longer approved after allocation is flagged for review, the vehicle status is not changed", async () => {
  const t = await T();
  const keep = await fresh({ trackupNumber: au[8] });
  assert.equal((await call(`/vehicles/${keep._id}`, "GET", undefined, t.rbp)).body.data.allocationReview, undefined);
  await Budget.updateOne({ vehicle: auto.vehicles[8]._id }, { $set: { approvalStatus: "PENDING" } });
  const g = (await call(`/vehicles/${keep._id}`, "GET", undefined, t.rbp)).body.data;
  assert.equal(g.availability.status, "IN_USE");
  assert.match(g.allocationReview, /budget is now pending/);
  const listed = (await call(`/vehicles?availabilityStatus=IN_USE&limit=100`, "GET", undefined, t.rbp)).body.data.items.find((x: any) => x._id === keep._id);
  assert.match(listed.allocationReview, /Review needed/);
  await Budget.updateOne({ vehicle: auto.vehicles[8]._id }, { $set: { approvalStatus: "APPROVED" } });
  assert.equal((await call(`/vehicles/${keep._id}`, "GET", undefined, t.rbp)).body.data.allocationReview, undefined);
});

// ------------------------------------------------------------------------ draft / listing / regression
test("draft: partial availability saved and restored; final save validates it; switching status drops stale fields", async () => {
  const t = await T();
  const dr = await call("/vehicles", "POST", { saveAs: "DRAFT", vehicleNo: "KA05ZZ9911", availability: { status: "IN_USE", } }, t.rbp);
  assert.equal(dr.status, 201, JSON.stringify(dr.body));
  const id = dr.body.data._id;
  const got = (await call(`/vehicles/${id}`, "GET", undefined, t.rbp)).body.data;
  assert.equal(got.status, "DRAFT");
  assert.equal(got.availability.status, "IN_USE");
  assert.match(got.allocationNote, /In use/);
  const fin = await call(`/vehicles/${id}`, "PUT", { ...full({ vehicleNo: "KA05ZZ9911" }), saveAs: "FINAL", availability: got.availability }, t.rbp);
  assert.equal(fin.status, 400);
  assert.match(fin.body.message, /Select an approved project/);
  const done = await call(`/vehicles/${id}`, "PUT", { ...full({ vehicleNo: "KA05ZZ9911" }), saveAs: "FINAL", availability: { status: "ISSUE", issue: { category: "Other", description: "Engine overheating" }, project: { trackupNumber: trk[0] }, nextAvailableDate: d(5) } }, t.rbp);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.data.status, "ACTIVE");
  assert.equal(done.body.data.availability.project ?? null, null);
  assert.equal(done.body.data.availability.nextAvailableDate ?? null, null);
});

test("edit compatibility: records without availability keep working; omitting the block leaves it untouched", async () => {
  const t = await T();
  const legacy = (await Vehicle.create({ ...full({ vehicleNo: "TN99ZZ0001" }), status: "ACTIVE", createdBy: "RBP", updatedBy: "RBP" })).toObject() as any;
  const got = (await call(`/vehicles/${legacy._id}`, "GET", undefined, t.rbp)).body.data;
  assert.equal(got.availability, undefined);
  assert.equal(got.allocationNote, "Availability not set");
  const e = await call(`/vehicles/${legacy._id}`, "PUT", { ...full({ vehicleNo: "TN99ZZ0001" }), model: "Ace Gold" }, t.rbp);
  assert.equal(e.status, 200);
  assert.equal(e.body.data.availability, undefined);
  assert.equal((await call(`/vehicles/${legacy._id}`, "PUT", { ...full({ vehicleNo: "TN99ZZ0001" }), model: "Ace Gold" }, t.rbp)).status, 400);
  const a = await call(`/vehicles/${legacy._id}`, "PUT", { ...full({ vehicleNo: "TN99ZZ0001" }), model: "Ace Gold", availability: { status: "AVAILABLE" } }, t.rbp);
  assert.equal(a.status, 200);
  const keep = await call(`/vehicles/${legacy._id}`, "PUT", { ...full({ vehicleNo: "TN99ZZ0001" }), model: "Ace Plus" }, t.rbp);
  assert.equal(keep.body.data.availability.status, "AVAILABLE");
  const inactive = await call(`/vehicles/${legacy._id}`, "PUT", { ...full({ vehicleNo: "TN99ZZ0001" }), model: "Ace Plus", status: "INACTIVE" }, t.rbp);
  assert.match(inactive.body.data.allocationNote, /inactive/);
});

test("listing: availability filters, trackup / PIF / client / project mass search, next-available range, server-side paging, summary", async () => {
  const t = await T();
  const list = async (qs: string) => (await call(`/vehicles?limit=100&${qs}`, "GET", undefined, t.rbp)).body.data;
  await fresh({ trackupNumber: trk[3] }); // the "later restart" test above released earlier holders; create fresh ones to filter on
  await fresh({ trackupNumber: trk[7] });
  const all = await list("");
  for (const s of ["AVAILABLE", "IN_USE", "ISSUE"]) {
    const r = await list(`availabilityStatus=${s}`);
    assert.equal(r.total, all.items.filter((x: any) => x.availability?.status === s).length, s);
  }
  assert.equal((await list("availabilityStatus=BOGUS")).total, all.total);
  const sig = await list("projectType=SIGNAGE");
  assert.ok(sig.total >= 2 && sig.items.every((x: any) => x.availability.project.projectType === "SIGNAGE"));
  assert.ok((await list("clientName=pepsi")).total >= 2);
  assert.equal((await list("clientName=nobody-here")).total, 0);
  const holder = all.items.find((x: any) => x.availability?.status === "IN_USE");
  for (const q of ["Pepsi", holder.availability.project.trackupNumber, holder.availability.project.pifNumber, holder.availability.project.projectName])
    assert.ok((await list(`q=${encodeURIComponent(q)}`)).items.some((x: any) => x._id === holder._id), q);
  assert.ok((await list(`vehicleNo=${holder.vehicleNo.slice(0, 6)}`)).items.some((x: any) => x._id === holder._id));
  const inRange = await list(`nextAvailableFrom=${d(4)}&nextAvailableTo=${d(4)}`);
  assert.ok(inRange.total >= 1 && inRange.items.every((x: any) => x.availability.nextAvailableAt.startsWith(d(4))));
  assert.equal((await list(`nextAvailableFrom=${d(100)}`)).total, 0);
  const p1 = (await call("/vehicles?limit=3&page=1&availabilityStatus=AVAILABLE", "GET", undefined, t.rbp)).body.data;
  assert.equal(p1.items.length, Math.min(3, p1.total));
  const s = (await call("/vehicles/summary", "GET", undefined, t.rbp)).body.data;
  assert.equal(s.availableNow, await Vehicle.countDocuments({ status: "ACTIVE", "availability.status": "AVAILABLE" }));
  assert.equal(s.inUse, await Vehicle.countDocuments({ status: "ACTIVE", "availability.status": "IN_USE" }));
  assert.equal(s.withIssue, await Vehicle.countDocuments({ status: "ACTIVE", "availability.status": "ISSUE" }));
  assert.ok(typeof s.total === "number" && typeof s.expiringSoon === "number");
});

test("regression: existing vehicle CRUD, duplicates, roles and the rest of the API behave as before", async () => {
  const t = await T();
  const body = full({ vehicleNo: "TN77RG0001" });
  const c = await call("/vehicles", "POST", body, t.rbp); // no availability block at all
  assert.equal(c.status, 201);
  assert.equal(c.body.data.availability, undefined);
  assert.equal((await call("/vehicles", "POST", body, t.rbp)).status, 409);
  assert.match((await call("/vehicles", "POST", body, t.rbp)).body.message, /Vehicle number TN77RG0001 already exists/);
  assert.equal((await call("/vehicles", "POST", body, t.rsop)).status, 403);
  assert.equal((await call(`/vehicles/${c.body.data._id}`, "PUT", { ...body, model: "New" }, t.rbp)).status, 200);
  assert.equal((await call(`/vehicles/${c.body.data._id}`, "DELETE", undefined, t.rbp)).status, 409);
  assert.equal((await call("/vehicles/filters", "GET", undefined, t.rbp)).status, 200);
  assert.equal((await call("/tracking", "GET", undefined, t.rsop)).status, 200);
  assert.equal((await call("/approvals/stats", "GET", undefined, t.rsom)).status, 200);
  // RSOP project / budget records were only read
  assert.equal(await TrackingVehicle.countDocuments({ project: proj._id }), 14);
  assert.equal(((await TrackingProject.findById(proj._id).lean()) as any).details.location, "Coimbatore");
  assert.equal(await Budget.countDocuments(), 8 + 5 + 2 + 12);
});

test("cleanup", async () => {
  await mongoose.connection.dropDatabase();
  await new Promise<void>((r) => server.close(() => r()));
  await mongoose.disconnect();
});
