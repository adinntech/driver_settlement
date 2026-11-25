/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_allotment";
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

// SAFETY: every app module is imported dynamically after the config points at the throw-away test database.
const { config: cfg } = await import("../src/config/index.js");
cfg.mongoUri = "mongodb://127.0.0.1:27017/driver_settlement_test_allotment";
cfg.storage.type = "local";
const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { User } = await import("../src/models/User.js");
const { Vehicle, VehicleHistory } = await import("../src/models/Vehicle.js");
const { TrackingProject } = await import("../src/models/TrackingProject.js");
const { TrackingVehicle } = await import("../src/models/TrackingVehicle.js");
const { Budget } = await import("../src/models/Budget.js");
const { VehicleAllotment, AllotmentEvent } = await import("../src/models/VehicleAllotment.js");
const { releaseDueVehicles } = await import("../src/services/availability.service.js");
const { validateAllot, validateChange, validateSchedule } = await import("../src/validators/allotment.validator.js");
const { addDays, todayYmd } = await import("../src/validators/vehicle.validator.js");

const today = todayYmd();
const d = (n: number) => addDays(today, n);

let server: Server;
let base = "";
{
  await connectDB();
  assert.match(mongoose.connection.name, /_test_/, "refusing to drop a non-test database");
  await mongoose.connection.dropDatabase();
  await Promise.all([User.init(), Vehicle.init(), VehicleHistory.init(), TrackingProject.init(), TrackingVehicle.init(), Budget.init(), VehicleAllotment.init(), AllotmentEvent.init()]);
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

// ---- fixtures
let seq = 0;
const full = (over: Record<string, unknown> = {}) => ({
  vehicleNo: `TN${20 + (seq % 70)}ZA${1000 + seq++}`, make: "Tata", model: "Ace", type: "Dynamic", yearOfManufacture: 2022, purchaseDate: "2022-06-15",
  currentRunning: 1200, totalRunning: 45000, fc: [], insurance: [], rtoPermission: [], policePermission: [], permit: [], ...over,
});
const mkVehicle = async (over: Record<string, unknown> = {}, availability: unknown = { status: "AVAILABLE" }) => {
  const t = await T();
  const r = await call("/vehicles", "POST", full({ availability, ...over }), t.rbp);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data as any;
};
const budgetNo = (() => { let n = 0; return () => `BUD-A-${++n}`; })();
const mkBudget = (tv: any, projectId: string, state: Record<string, unknown>) =>
  Budget.create({ budgetNumber: budgetNo(), vehicle: tv._id, project: projectId, data: {}, total: 125000.5, currentVersion: 1, createdBy: "RBP", updatedBy: "RBP", reviewedAt: new Date("2026-11-20T06:00:00Z"), ...state });

let projA: any; // 12 vehicles: 0..9 approved, 10 pending, 11 rejected
let projB: any; // 1 vehicle: draft budget
let projC: any; // 1 vehicle: approved v1 but v2 (pending) is the latest
let projR: any; // roadshow, 2 vehicles approved
let projP: any; // pool of approved project vehicles held by "busy" fixture vehicles
{
  const t = await T();
  const mk = async (body: unknown) => {
    const r = await call("/tracking", "POST", body, t.rsop);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.data;
  };
  projA = await mk({ projectType: "SIGNAGE", details: { client: "Alpha Foods", jobSheetNumber: "ZZALT-1", location: "Salem", date: d(0), fromDate: d(2), toDate: d(12), numberOfVehicles: 12 } });
  projB = await mk({ projectType: "SIGNAGE", details: { client: "Beta Drafts", jobSheetNumber: "ZZALT-2", location: "Erode", date: d(0), fromDate: d(2), toDate: d(5), numberOfVehicles: 1 } });
  projC = await mk({ projectType: "SIGNAGE", details: { client: "Gamma Versions", jobSheetNumber: "ZZALT-3", location: "Hosur", date: d(0), fromDate: d(2), toDate: d(5), numberOfVehicles: 1 } });
  projR = await mk({ projectType: "ROADSHOW", details: { billingName: "Roadie Co", stateCode: "33", startDate: d(3), endDate: d(8), reportingDate: d(3), sundayHalt: "NO", numberOfVans: 2, reportingLocations: ["Chennai", "Trichy"] } });
  projP = await mk({ projectType: "SIGNAGE", details: { client: "Pool Holders", jobSheetNumber: "ZZALT-4", location: "Karur", date: d(0), fromDate: d(2), toDate: d(5), numberOfVehicles: 8 } });
  const approved = { approvalStatus: "APPROVED", approvedVersion: 1 };
  for (const tv of projP.vehicles) await mkBudget(tv, projP._id, approved);
  for (let i = 0; i < 10; i++) await mkBudget(projA.vehicles[i], projA._id, approved);
  await mkBudget(projA.vehicles[10], projA._id, { approvalStatus: "PENDING", submittedVersion: 1 });
  await mkBudget(projA.vehicles[11], projA._id, { approvalStatus: "REJECTED", rejectedVersion: 1 });
  await mkBudget(projB.vehicles[0], projB._id, { approvalStatus: "DRAFT" });
  await mkBudget(projC.vehicles[0], projC._id, { approvalStatus: "PENDING", approvedVersion: 1, currentVersion: 2, submittedVersion: 2 });
  for (const tv of projR.vehicles) await mkBudget(tv, projR._id, approved);
}
const A = (i: number) => projA.vehicles[i];
let poolNext = 0;
const busyRef = () => projP.vehicles[poolNext++].trackupNumber; // each "already in use" fixture holds its own project vehicle
const sched = (over: Record<string, unknown> = {}) => ({
  expectedReleaseDate: d(3), expectedReleaseTime: "20:00", nextAvailableDate: d(4), nextAvailableTime: "09:00", ...over,
});
const allot = async (vehicleId: string, trackupNumber: string, over: Record<string, unknown> = {}) => {
  const t = await T();
  return call("/vehicle-allotments", "POST", { vehicleId, trackupNumber, ...sched(), ...over }, t.rbp);
};
const att = (name: string) => ({ storage: "local", key: `driver_settlement/vehicles/2026/123e4567-e89b-12d3-a456-426614174000-${name}`, name, size: 1234, mimeType: "application/pdf" });

// ================================================================== validators (pure)
test("validators: allotment times, mandatory next availability, change reason, schedule", () => {
  const NOW = new Date("2026-11-24T06:30:00Z"); // 12:00 IST
  const ok = { vehicleId: "a".repeat(24), trackupNumber: "TRK-1", nextAvailableDate: "2026-11-26", nextAvailableTime: "09:00" };
  assert.deepEqual(validateAllot(ok, NOW).errors, []);
  assert.equal(validateAllot(ok, NOW).data?.allottedAt.toISOString(), NOW.toISOString()); // defaults to now
  assert.equal(validateAllot({ ...ok, allottedDate: "2026-11-24", allottedTime: "10:00" }, NOW).data?.allottedAt.toISOString(), "2026-11-24T04:30:00.000Z"); // IST -> UTC
  for (const [over, re] of [
    [{ nextAvailableDate: "" }, /Next available date is required/],
    [{ nextAvailableTime: "" }, /Next available time is required/],
    [{ nextAvailableDate: "2026-02-31" }, /valid date/],
    [{ nextAvailableTime: "25:00" }, /valid time/],
    [{ allottedDate: "2026-11-25", allottedTime: "10:00" }, /cannot be in the future/],
    [{ allottedDate: "2026-11-24" }, /Allotment date & time is invalid/],
    [{ expectedReleaseDate: "2026-11-25" }, /both date and time/],
    [{ expectedReleaseDate: "2026-11-23", expectedReleaseTime: "10:00" }, /before the allotment/],
    [{ expectedReleaseDate: "2026-11-27", expectedReleaseTime: "10:00" }, /before the expected release/],
    [{ nextAvailableDate: "2026-11-23", nextAvailableTime: "10:00" }, /before the allotment/],
    [{ vehicleId: "zz" }, /Vehicle is required/],
    [{ trackupNumber: "" }, /Project \(Trackup Number\) is required/],
    [{ remarks: "<b>x</b>" }, /invalid characters/],
    [{ remarks: "x".repeat(301) }, /too long/],
  ] as const) assert.match(validateAllot({ ...ok, ...over }, NOW).errors.join(";"), re, JSON.stringify(over));
  assert.deepEqual(validateAllot({ ...ok, remarks: "Bring ladder" }, NOW).data?.remarks, "Bring ladder");
  // change
  const c = { vehicleId: "b".repeat(24), reason: "Breakdown" };
  assert.deepEqual(validateChange(c).errors, []);
  assert.match(validateChange({ ...c, reason: " " }).errors.join(), /Change reason is required/);
  assert.match(validateChange({ ...c, vehicleId: "" }).errors.join(), /Replacement vehicle is required/);
  assert.deepEqual(validateChange({ ...c, attachments: [att("a.pdf"), att("b.pdf")] }).data?.attachments.length, 2);
  assert.equal(validateChange({ ...c, attachments: [] }).data?.attachments.length, 0); // optional
  assert.match(validateChange({ ...c, attachments: [{ name: "x.pdf" }] }).errors.join(), /Attachment 1 is invalid/);
  assert.match(validateChange({ ...c, attachments: Array(6).fill(att("a.pdf")) }).errors.join(), /Too many attachments/);
  assert.match(validateChange({ ...c, attachments: "x" }).errors.join(), /must be a list/);
  // schedule (extension)
  assert.deepEqual(validateSchedule({ nextAvailableDate: "2026-12-01", nextAvailableTime: "10:00" }).errors, []);
  assert.match(validateSchedule({ nextAvailableDate: "2026-12-01" }).errors.join(), /Next available time is required/);
});

// ================================================================== access
test("access: RBP only, standard envelope on every endpoint", async () => {
  const t = await T();
  for (const [m, p] of [["GET", "/vehicle-allotments"], ["GET", "/vehicle-allotments/projects"], ["GET", "/vehicle-allotments/vehicles"], ["POST", "/vehicle-allotments"]] as const) {
    assert.equal((await call(p, m)).status, 401, p);
    for (const tok of [t.rsop, t.rsom]) {
      const r = await call(p, m, m === "POST" ? {} : undefined, tok);
      assert.equal(r.status, 403, p);
      assert.deepEqual(Object.keys(r.body).sort(), ["data", "message", "success"]);
    }
  }
  const ok = await call("/vehicle-allotments", "GET", undefined, t.rbp);
  assert.equal(ok.status, 200);
  assert.deepEqual(Object.keys(ok.body).sort(), ["data", "message", "success"]);
  const bad = await call("/vehicle-allotments", "POST", {}, t.rbp);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.data, null);
  assert.equal((await call("/vehicle-allotments/not-an-id", "GET", undefined, t.rbp)).status, 400);
  assert.equal((await call("/vehicle-allotments/000000000000000000000000", "GET", undefined, t.rbp)).status, 404);
});

// ================================================================== Tab 2: approved projects
test("approved projects: only a currently approved latest budget; pending / rejected / draft / superseded excluded; fields shown", async () => {
  const t = await T();
  const r = await call("/vehicle-allotments/projects?limit=50", "GET", undefined, t.rbp);
  assert.equal(r.status, 200);
  const got = new Map<string, any>(r.body.data.items.map((x: any) => [x.trackupNumber, x]));
  assert.equal(r.body.data.total, 20); // 10 + 2 roadshow + 8 pool
  for (let i = 0; i < 10; i++) assert.ok(got.has(A(i).trackupNumber), `approved ${i}`);
  for (const tv of [A(10), A(11), projB.vehicles[0], projC.vehicles[0]]) assert.ok(!got.has(tv.trackupNumber), `excluded ${tv.trackupNumber}`);
  const row: any = got.get(A(0).trackupNumber);
  assert.equal(row.clientName, "Alpha Foods");
  assert.equal(row.projectType, "SIGNAGE");
  assert.match(row.projectName, /Alpha Foods Signage – ZZALT-1/);
  assert.equal(row.pifNumber, A(0).pifNumber);
  assert.equal(row.billNumber, null); // "where available": the tracking records carry none
  assert.equal(row.startDate, d(2));
  assert.equal(row.endDate, d(12));
  assert.equal(row.vehicleCount, 12);
  assert.equal(row.budgetAmount, 125000.5);
  assert.equal(row.approvedAt, "2026-11-20T06:00:00.000Z");
  assert.equal(row.budgetStatus, "APPROVED");
  assert.equal(row.allotment, null);
  const rs: any = [...got.values()].find((x) => x.projectType === "ROADSHOW");
  assert.equal(rs.projectName, "Roadie Co Roadshow");
  assert.equal(rs.vehicleCount, 2);
  // a budget that stops being approved disappears; an approved one with a newer unapproved version too
  await Budget.updateOne({ vehicle: A(9)._id }, { $set: { approvalStatus: "PENDING" } });
  await Budget.updateOne({ vehicle: A(8)._id }, { $set: { currentVersion: 2 } });
  const after = (await call("/vehicle-allotments/projects?limit=50", "GET", undefined, t.rbp)).body.data;
  assert.equal(after.total, 18);
  await Budget.updateOne({ vehicle: A(9)._id }, { $set: { approvalStatus: "APPROVED" } });
  await Budget.updateOne({ vehicle: A(8)._id }, { $set: { currentVersion: 1 } });
  assert.equal((await call("/vehicle-allotments/projects?limit=50", "GET", undefined, t.rbp)).body.data.total, 20);
});

test("approved projects: search, project type and pagination happen on the server", async () => {
  const t = await T();
  const s = async (qs: string) => (await call(`/vehicle-allotments/projects?${qs}`, "GET", undefined, t.rbp)).body.data;
  assert.equal((await s("q=alpha")).total, 10);
  assert.deepEqual((await s(`q=${A(3).trackupNumber}`)).items.map((x: any) => x.pifNumber), [A(3).pifNumber]);
  assert.equal((await s(`q=${A(4).pifNumber}`)).items[0].trackupNumber, A(4).trackupNumber);
  assert.equal((await s("q=roadie")).total, 2);
  assert.equal((await s("q=roadshow")).total, 2);
  assert.equal((await s("q=zzalt-1")).total, 10);
  assert.equal((await s("q=beta")).total, 0);
  const p1 = await s("q=alpha&limit=4&page=1");
  const p3 = await s("q=alpha&limit=4&page=3");
  assert.deepEqual([p1.items.length, p3.items.length, p1.total], [4, 2, 10]);
});

// ================================================================== vehicle autocomplete
test("vehicle autocomplete: only Available Now, active vehicles; in use / issue / draft / inactive / future-available are excluded", async () => {
  const t = await T();
  const av = await mkVehicle({ vehicleNo: "TN90ZZ1111", make: "Mahindra", model: "Bolero" });
  const av2 = await mkVehicle({ vehicleNo: "TN90ZZ1112" });
  const busy = await mkVehicle({ vehicleNo: "TN90ZZ2222" }, { status: "IN_USE", project: { trackupNumber: busyRef() }, ...sched() });
  const bad = await mkVehicle({ vehicleNo: "TN90ZZ3333" }, { status: "ISSUE", issue: { category: "Other", description: "Brakes" } });
  const later = await mkVehicle({ vehicleNo: "TN90ZZ4444" }, { status: "AVAILABLE", availableFromDate: d(5), availableFromTime: "09:00" });
  const inactive = await mkVehicle({ vehicleNo: "TN90ZZ5555" });
  await call(`/vehicles/${inactive._id}`, "PUT", { ...inactive, status: "INACTIVE" }, t.rbp);
  const draft = (await call("/vehicles", "POST", { saveAs: "DRAFT", vehicleNo: "TN90ZZ6666", availability: { status: "AVAILABLE" } }, t.rbp)).body.data;
  const nums = async (q: string) => (await call(`/vehicle-allotments/vehicles?q=${encodeURIComponent(q)}`, "GET", undefined, t.rbp)).body.data.map((x: any) => x.vehicleNo);
  assert.deepEqual(await nums("90ZZ"), ["TN90ZZ1111", "TN90ZZ1112"]);
  assert.deepEqual(await nums("tn 90 zz 1111"), ["TN90ZZ1111"]); // partial, any case / spacing
  assert.deepEqual(await nums("1112"), ["TN90ZZ1112"]);
  const row = (await call("/vehicle-allotments/vehicles?q=1111", "GET", undefined, t.rbp)).body.data[0];
  assert.deepEqual([row.make, row.model, row.type], ["Mahindra", "Bolero", "Dynamic"]); // make / model shown with the number
  for (const x of [busy, bad, later, inactive, draft]) assert.ok(!(await nums("90ZZ")).includes(x.vehicleNo), x.vehicleNo ?? "draft");
  assert.ok(av && av2);
  const lim = (await call("/vehicle-allotments/vehicles?limit=1&q=90ZZ", "GET", undefined, t.rbp)).body.data;
  assert.equal(lim.length, 1);
  assert.deepEqual(await nums("%.*["), []);
});

// ================================================================== allotment
test("allot: vehicle becomes In Use, identifiers auto-populated, times stored in UTC, history + events written", async () => {
  const t = await T();
  const veh = await mkVehicle({ vehicleNo: "TN91AL0001" });
  const r = await allot(veh._id, A(0).trackupNumber.toLowerCase(), { allottedDate: d(-1), allottedTime: "10:30", remarks: "Bring the ladder" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body).sort(), ["data", "message", "success"]);
  const a = r.body.data;
  assert.equal(a.status, "ACTIVE");
  assert.equal(a.vehicleNo, "TN91AL0001");
  assert.equal(a.trackupNumber, A(0).trackupNumber);
  assert.equal(a.pifNumber, A(0).pifNumber); // the pair of THIS project vehicle, not another one of the project
  assert.notEqual(A(0).pifNumber, A(1).pifNumber);
  assert.equal(a.clientName, "Alpha Foods");
  assert.equal(a.projectType, "SIGNAGE");
  assert.equal(a.projectStart, d(2));
  assert.equal(a.billNumber ?? null, null);
  assert.equal(a.remarks, "Bring the ladder");
  assert.equal(a.createdBy, "RBP");
  assert.equal(a.source, "ALLOTMENT");
  assert.equal(a.allottedAt, new Date(`${d(-1)}T10:30:00+05:30`).toISOString());
  assert.equal(a.expectedReleaseAt, new Date(`${d(3)}T20:00:00+05:30`).toISOString());
  assert.equal(a.nextAvailableAt, new Date(`${d(4)}T09:00:00+05:30`).toISOString());

  const v = (await call(`/vehicles/${veh._id}`, "GET", undefined, t.rbp)).body.data;
  assert.equal(v.availability.status, "IN_USE");
  assert.equal(v.availability.project.trackupNumber, A(0).trackupNumber);
  assert.equal(v.availability.nextAvailableAt, `${d(4)}T09:00`); // same value the scheduler watches
  assert.equal(v.allocatable, false);
  const vh = (await call(`/vehicles/${veh._id}/history`, "GET", undefined, t.rbp)).body.data;
  const row = vh.find((x: any) => x.action === "PROJECT_ASSIGNED");
  assert.equal(row.previousStatus, "AVAILABLE");
  assert.equal(row.newStatus, "IN_USE");
  assert.match(row.reason, /Allotted to Alpha Foods Signage/);
  const ev = await AllotmentEvent.find({ allotment: a._id }).lean();
  assert.deepEqual(ev.map((e: any) => e.action), ["ALLOTTED"]);
  assert.equal((ev[0] as any).username, "RBP");
  // it is listed against the project, and no longer offered as a vehicle
  const pr = (await call(`/vehicle-allotments/projects?q=${A(0).trackupNumber}`, "GET", undefined, t.rbp)).body.data.items[0];
  assert.equal(pr.allotment.vehicleNo, "TN91AL0001");
  assert.ok(!(await call("/vehicle-allotments/vehicles?q=TN91AL0001", "GET", undefined, t.rbp)).body.data.length);
});

test("allot: invalid input, unavailable vehicles and unapproved projects are refused and nothing is saved", async () => {
  const t = await T();
  const veh = await mkVehicle({ vehicleNo: "TN91AL0002" });
  const busy = await mkVehicle({ vehicleNo: "TN91AL0003" }, { status: "IN_USE", project: { trackupNumber: busyRef() }, ...sched() });
  const sick = await mkVehicle({ vehicleNo: "TN91AL0004" }, { status: "ISSUE", issue: { category: "Other", description: "Gearbox" } });
  const inactive = await mkVehicle({ vehicleNo: "TN91AL0005" });
  await call(`/vehicles/${inactive._id}`, "PUT", { ...inactive, status: "INACTIVE" }, t.rbp);
  const draft = (await call("/vehicles", "POST", { saveAs: "DRAFT", vehicleNo: "TN91AL0006", availability: { status: "AVAILABLE" } }, t.rbp)).body.data;
  const before = { allots: await VehicleAllotment.countDocuments(), hist: await VehicleHistory.countDocuments({ vehicle: veh._id }) };
  const bad = (over: Record<string, unknown>, status: number, re: RegExp, vehicleId = veh._id, trackup = A(1).trackupNumber) =>
    allot(vehicleId, trackup, over).then((r) => {
      assert.equal(r.status, status, JSON.stringify(r.body));
      assert.equal(r.body.success, false);
      assert.equal(r.body.data, null);
      assert.match(r.body.message, re);
    });
  await bad({ nextAvailableDate: "" }, 400, /Next available date is required/);
  await bad({ nextAvailableTime: "" }, 400, /Next available time is required/);
  await bad({ expectedReleaseDate: d(5), expectedReleaseTime: "10:00" }, 400, /before the expected release/); // next (d4) < expected (d5)
  await bad({ allottedDate: d(1), allottedTime: "10:00" }, 400, /cannot be in the future/);
  await bad({ nextAvailableDate: d(-1), nextAvailableTime: "09:00", expectedReleaseDate: d(-2), expectedReleaseTime: "09:00" }, 400, /in the past|before the allotment/);
  await bad({}, 400, /Only approved projects/, veh._id, A(10).trackupNumber); // pending
  await bad({}, 400, /Only approved projects/, veh._id, A(11).trackupNumber); // rejected
  await bad({}, 400, /Only approved projects/, veh._id, projB.vehicles[0].trackupNumber); // draft
  await bad({}, 400, /Only approved projects/, veh._id, projC.vehicles[0].trackupNumber); // older approved version superseded
  await bad({}, 400, /was not found/, veh._id, "TRK-NOPE");
  await bad({ pifNumber: A(2).pifNumber }, 400, /do not belong to the same project vehicle/); // trackup of #1, PIF of #2
  await bad({}, 404, /Vehicle not found/, "0".repeat(24));
  await bad({}, 409, /already in use on another project/, busy._id);
  await bad({}, 409, /vehicle issue/, sick._id);
  await bad({}, 409, /only active vehicles/, inactive._id);
  await bad({}, 409, /only active vehicles/, draft._id);
  assert.equal(await VehicleAllotment.countDocuments({ trackupNumber: A(1).trackupNumber }), 0);
  assert.equal(await VehicleAllotment.countDocuments(), before.allots);
  assert.equal(await VehicleHistory.countDocuments({ vehicle: veh._id }), before.hist);
  assert.equal(((await Vehicle.findById(veh._id).lean()) as any).availability.status, "AVAILABLE");
});

test("duplicate and concurrent allotments: one project vehicle / one vehicle can hold only one active allotment", async () => {
  const t = await T();
  const v1 = await mkVehicle({ vehicleNo: "TN92CC0001" });
  const v2 = await mkVehicle({ vehicleNo: "TN92CC0002" });
  assert.equal((await allot(v1._id, A(2).trackupNumber)).status, 201);
  const dup = await allot(v2._id, A(2).trackupNumber); // same project vehicle again
  assert.equal(dup.status, 409);
  assert.match(dup.body.message, /already allotted to vehicle TN92CC0001; use Change Vehicle/);
  assert.equal(((await Vehicle.findById(v2._id).lean()) as any).availability.status, "AVAILABLE");
  // two users, one project vehicle, two vehicles
  const [a, b] = await Promise.all([allot(v1._id === v2._id ? v1._id : (await mkVehicle({ vehicleNo: "TN92CC0003" }))._id, A(3).trackupNumber), allot((await mkVehicle({ vehicleNo: "TN92CC0004" }))._id, A(3).trackupNumber)]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  assert.equal(await VehicleAllotment.countDocuments({ trackupNumber: A(3).trackupNumber, status: "ACTIVE" }), 1);
  // one vehicle, two projects at the same moment
  const solo = await mkVehicle({ vehicleNo: "TN92CC0005" });
  const [c, e] = await Promise.all([allot(solo._id, A(4).trackupNumber), allot(solo._id, A(5).trackupNumber)]);
  assert.deepEqual([c.status, e.status].sort(), [201, 409]);
  assert.equal(await VehicleAllotment.countDocuments({ vehicle: solo._id, status: "ACTIVE" }), 1);
  const winner = [c, e].find((x) => x.status === 201)!.body.data;
  const loser = [c, e].find((x) => x.status === 409)!;
  assert.equal(await VehicleAllotment.countDocuments({ trackupNumber: loser === c ? A(4).trackupNumber : A(5).trackupNumber }), 0); // no half-saved record
  assert.equal(((await Vehicle.findById(solo._id).lean()) as any).availability.project.trackupNumber, winner.trackupNumber);
  assert.ok(t);
});

// ================================================================== change vehicle
test("change vehicle: reason mandatory, replacement must be available, old is released, new allotted, project identifiers and history preserved", async () => {
  const t = await T();
  const oldV = await mkVehicle({ vehicleNo: "TN93CH0001" });
  const newV = await mkVehicle({ vehicleNo: "TN93CH0002" });
  const first = (await allot(oldV._id, A(5).trackupNumber, { remarks: "keep" })).body.data;
  const ch = (body: unknown) => call(`/vehicle-allotments/${first._id}/change-vehicle`, "POST", body, t.rbp);
  // validation
  let r = await ch({ vehicleId: newV._id });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /Change reason is required/);
  r = await ch({ vehicleId: oldV._id, reason: "Breakdown" });
  assert.match(r.body.message, /different vehicle/);
  r = await ch({ vehicleId: newV._id, reason: "Breakdown", attachments: [{ name: "x" }] });
  assert.equal(r.status, 400);
  assert.equal((await ch({ vehicleId: "0".repeat(24), reason: "x" })).status, 404);
  const busy = await mkVehicle({ vehicleNo: "TN93CH0003" }, { status: "IN_USE", project: { trackupNumber: busyRef() }, ...sched() });
  assert.equal((await ch({ vehicleId: busy._id, reason: "x" })).status, 409);
  // nothing changed so far
  assert.equal(((await VehicleAllotment.findById(first._id).lean()) as any).status, "ACTIVE");
  assert.equal(((await Vehicle.findById(oldV._id).lean()) as any).availability.status, "IN_USE");

  // success, with two optional attachments
  r = await ch({ vehicleId: newV._id, reason: "Engine failure on route", remarks: "Replacement sent from depot", attachments: [att("photo.pdf"), att("report.pdf")] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const n = r.body.data;
  assert.equal(n.status, "ACTIVE");
  assert.equal(n.vehicleNo, "TN93CH0002");
  assert.equal(n.changedFromVehicleNo, "TN93CH0001");
  assert.equal(n.changeReason, "Engine failure on route");
  assert.equal(n.createdBy, "RBP");
  assert.equal(n.previousAllotment, first._id);
  assert.equal(n.changeAttachments.length, 2);
  assert.ok(n.changeAttachments[0].url.includes("/files/")); // served from the existing storage
  for (const k of ["trackupNumber", "pifNumber", "clientName", "projectName", "projectType", "projectStart", "projectEnd", "remarks"]) assert.equal(n[k], first[k], k); // identifiers preserved
  assert.equal(n.nextAvailableAt, first.nextAvailableAt);
  assert.equal(n.expectedReleaseAt, first.expectedReleaseAt);
  const oldRow: any = await VehicleAllotment.findById(first._id).lean(); // original row kept, not overwritten
  assert.equal(oldRow.status, "CHANGED");
  assert.equal(oldRow.vehicleNo, "TN93CH0001");
  assert.equal(String(oldRow.replacedBy), n._id);
  assert.equal(oldRow.allottedAt.toISOString(), first.allottedAt);
  const ov: any = (await call(`/vehicles/${oldV._id}`, "GET", undefined, t.rbp)).body.data;
  assert.equal(ov.availability.status, "AVAILABLE");
  assert.equal(ov.allocatable, true);
  assert.equal(ov.availability.project ?? null, null);
  const nv: any = (await call(`/vehicles/${newV._id}`, "GET", undefined, t.rbp)).body.data;
  assert.equal(nv.availability.status, "IN_USE");
  assert.equal(nv.availability.project.trackupNumber, A(5).trackupNumber);
  assert.equal(nv.availability.nextAvailableAt, `${d(4)}T09:00`);
  // vehicle histories keep earlier rows and explain the move
  const oh = (await call(`/vehicles/${oldV._id}/history`, "GET", undefined, t.rbp)).body.data;
  assert.ok(oh.some((x: any) => x.action === "PROJECT_ASSIGNED")); // earlier allocation preserved
  const rel = oh.find((x: any) => x.action === "MARKED_AVAILABLE");
  assert.match(rel.reason, /Replaced by TN93CH0002: Engine failure on route/);
  assert.equal(rel.previousStatus, "IN_USE");
  const nh = (await call(`/vehicles/${newV._id}/history`, "GET", undefined, t.rbp)).body.data;
  assert.match(nh.find((x: any) => x.action === "PROJECT_ASSIGNED").reason, /replacement for TN93CH0001/);
  // allotment events
  const oe: any[] = await AllotmentEvent.find({ allotment: first._id }).lean();
  const changed = oe.find((e) => e.action === "VEHICLE_CHANGED");
  assert.equal(changed.username, "RBP");
  assert.equal(changed.details.fromVehicleNo, "TN93CH0001");
  assert.equal(changed.details.toVehicleNo, "TN93CH0002");
  assert.equal(changed.details.reason, "Engine failure on route");
  assert.equal(changed.details.attachments.length, 2);
  // the old row can no longer be changed; the project row now shows the new vehicle
  assert.equal((await ch({ vehicleId: newV._id, reason: "again" })).status, 409);
  const pr = (await call(`/vehicle-allotments/projects?q=${A(5).trackupNumber}`, "GET", undefined, t.rbp)).body.data.items[0];
  assert.equal(pr.allotment.vehicleNo, "TN93CH0002");
});

test("failed replacement leaves the original allocation exactly as it was (every failure point)", async () => {
  const t = await T();
  const oldV = await mkVehicle({ vehicleNo: "TN94FA0001" });
  const repl = await mkVehicle({ vehicleNo: "TN94FA0002" });
  const a = (await allot(oldV._id, A(6).trackupNumber)).body.data;
  const taken = await mkVehicle({ vehicleNo: "TN94FA0003" }, { status: "IN_USE", project: { trackupNumber: busyRef() }, ...sched() });
  const snap = async () => ({
    allot: await VehicleAllotment.findById(a._id).lean() as any,
    oldV: await Vehicle.findById(oldV._id).lean() as any,
    repl: await Vehicle.findById(repl._id).lean() as any,
    count: await VehicleAllotment.countDocuments(),
  });
  const before = await snap();
  const intact = async () => {
    const s = await snap();
    assert.equal(s.allot.status, "ACTIVE");
    assert.equal(s.allot.replacedBy, undefined);
    assert.equal(s.oldV.availability.status, "IN_USE");
    assert.equal(s.oldV.availability.project.trackupNumber, A(6).trackupNumber);
    assert.equal(s.oldV.availability.nextAvailableAt, before.oldV.availability.nextAvailableAt);
    assert.equal(s.repl.availability.status, "AVAILABLE");
    assert.equal(s.count, before.count);
  };
  // (a) the new allotment row cannot be created
  const orig = VehicleAllotment.create.bind(VehicleAllotment);
  (VehicleAllotment as any).create = async () => { throw new Error("disk full"); };
  try {
    const r = await call(`/vehicle-allotments/${a._id}/change-vehicle`, "POST", { vehicleId: repl._id, reason: "Breakdown" }, t.rbp);
    assert.equal(r.status, 500);
    assert.equal(r.body.success, false);
    assert.equal(r.body.data, null);
  } finally {
    (VehicleAllotment as any).create = orig;
  }
  await intact();
  // (b) the replacement is taken by someone else at the last moment
  const origFind = Vehicle.findOneAndUpdate.bind(Vehicle);
  let n = 0;
  (Vehicle as any).findOneAndUpdate = (...args: any[]) => ({
    lean: async () => {
      n++;
      if (n === 2) return null; // 1st call frees the old vehicle, 2nd reserves the replacement
      return (origFind as any)(...args).lean();
    },
  });
  try {
    const r = await call(`/vehicle-allotments/${a._id}/change-vehicle`, "POST", { vehicleId: repl._id, reason: "Breakdown" }, t.rbp);
    assert.equal(r.status, 409);
    assert.match(r.body.message, /original allotment is unchanged/);
  } finally {
    (Vehicle as any).findOneAndUpdate = origFind;
  }
  await intact();
  // (c) replacement already used elsewhere: refused up front
  assert.equal((await call(`/vehicle-allotments/${a._id}/change-vehicle`, "POST", { vehicleId: taken._id, reason: "x" }, t.rbp)).status, 409);
  await intact();
  // and the change still works afterwards
  assert.equal((await call(`/vehicle-allotments/${a._id}/change-vehicle`, "POST", { vehicleId: repl._id, reason: "Breakdown" }, t.rbp)).status, 200);
});

// ================================================================== extension / release / scheduler / form sync
test("extension updates the allotment and the vehicle's availability; manual release frees the vehicle", async () => {
  const t = await T();
  const veh = await mkVehicle({ vehicleNo: "TN95EX0001" });
  const a = (await allot(veh._id, A(7).trackupNumber)).body.data;
  const put = (body: unknown) => call(`/vehicle-allotments/${a._id}/schedule`, "PUT", body, t.rbp);
  assert.equal((await put({ nextAvailableDate: d(9) })).status, 400);
  assert.equal((await put({ expectedReleaseDate: d(8), expectedReleaseTime: "18:00", nextAvailableDate: d(9), nextAvailableTime: "10:00" })).status, 200);
  const v = (await call(`/vehicles/${veh._id}`, "GET", undefined, t.rbp)).body.data;
  assert.equal(v.availability.nextAvailableAt, `${d(9)}T10:00`); // the scheduler will now wait for the new moment
  assert.equal(v.availability.expectedReleaseDate, d(8));
  const row: any = await VehicleAllotment.findById(a._id).lean();
  assert.equal(row.nextAvailableAt.toISOString(), new Date(`${d(9)}T10:00:00+05:30`).toISOString());
  const ev: any[] = await AllotmentEvent.find({ allotment: a._id, action: "EXTENDED" }).lean();
  assert.equal(ev.length, 1);
  assert.equal(ev[0].details.to.nextAvailableAt.toISOString(), row.nextAvailableAt.toISOString());
  assert.ok((await call(`/vehicles/${veh._id}/history`, "GET", undefined, t.rbp)).body.data.some((x: any) => x.action === "RELEASE_CHANGED"));
  assert.equal((await put({ expectedReleaseDate: d(8), expectedReleaseTime: "18:00", nextAvailableDate: d(9), nextAvailableTime: "10:00" })).status, 400); // no change
  assert.equal((await put({ nextAvailableDate: d(-3), nextAvailableTime: "09:00" })).status, 400);
  // release
  const rel = await call(`/vehicle-allotments/${a._id}/release`, "POST", { remarks: "Project finished early" }, t.rbp);
  assert.equal(rel.status, 200, JSON.stringify(rel.body));
  assert.equal(rel.body.data.status, "RELEASED");
  assert.match(rel.body.data.releaseReason, /Project finished early/);
  const fv = (await call(`/vehicles/${veh._id}`, "GET", undefined, t.rbp)).body.data;
  assert.equal(fv.availability.status, "AVAILABLE");
  assert.equal(fv.allocatable, true);
  assert.equal((await call(`/vehicle-allotments/${a._id}/release`, "POST", {}, t.rbp)).status, 409); // already closed
  assert.equal((await put({ nextAvailableDate: d(20), nextAvailableTime: "10:00" })).status, 409);
  // the project vehicle can be allotted again after the release
  assert.equal((await allot(veh._id, A(7).trackupNumber)).status, 201);
});

test("the existing scheduler releases the vehicle AND ends its allotment; extended allotments are not released", async () => {
  const t = await T();
  const v1 = await mkVehicle({ vehicleNo: "TN96SC0001" });
  const v2 = await mkVehicle({ vehicleNo: "TN96SC0002" });
  const a1 = (await allot(v1._id, A(8).trackupNumber)).body.data;
  const a2 = (await allot(v2._id, A(9).trackupNumber)).body.data;
  const past = "2026-01-01T09:00";
  await Vehicle.updateOne({ _id: v1._id }, { $set: { "availability.nextAvailableAt": past, "availability.nextAvailableDate": "2026-01-01", "availability.nextAvailableTime": "09:00" } });
  await VehicleAllotment.updateOne({ _id: a1._id }, { $set: { nextAvailableAt: new Date("2026-01-01T03:30:00Z") } });
  const run = await releaseDueVehicles(new Date());
  assert.ok(run.released >= 1);
  const r1: any = await VehicleAllotment.findById(a1._id).lean();
  assert.equal(r1.status, "RELEASED");
  assert.match(r1.releaseReason, /automatically marked Available/);
  assert.equal(((await Vehicle.findById(v1._id).lean()) as any).availability.status, "AVAILABLE");
  const ev: any[] = await AllotmentEvent.find({ allotment: a1._id, action: "RELEASED" }).lean();
  assert.equal(ev.length, 1);
  assert.equal(ev[0].username, "SYSTEM");
  await releaseDueVehicles(new Date()); // repeat run: no second event
  assert.equal(await AllotmentEvent.countDocuments({ allotment: a1._id, action: "RELEASED" }), 1);
  assert.equal(((await VehicleAllotment.findById(a2._id).lean()) as any).status, "ACTIVE"); // future moment: untouched
  assert.equal(((await Vehicle.findById(v2._id).lean()) as any).availability.status, "IN_USE");
  assert.ok(t);
});

test("vehicle form changes stay in sync: linked In Use creates an allotment, leaving In Use releases it, new times are an extension", async () => {
  const t = await T();
  const inUse = (over: Record<string, unknown> = {}) => ({ status: "IN_USE", project: { trackupNumber: projR.vehicles[0].trackupNumber }, ...sched(), ...over });
  const v = await mkVehicle({ vehicleNo: "TN97FS0001" }, inUse());
  let rows: any[] = await VehicleAllotment.find({ vehicle: v._id }).lean();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "VEHICLE_FORM");
  assert.equal(rows[0].status, "ACTIVE");
  assert.equal(rows[0].projectName, "Roadie Co Roadshow");
  assert.equal(rows[0].createdBy, "RBP");
  const put = (availability: unknown) => call(`/vehicles/${v._id}`, "PUT", { ...v, availability }, t.rbp);
  assert.equal((await put(inUse({ nextAvailableDate: d(7) }))).status, 200);
  assert.equal(await AllotmentEvent.countDocuments({ allotment: rows[0]._id, action: "EXTENDED" }), 1);
  assert.equal(((await VehicleAllotment.findById(rows[0]._id).lean()) as any).nextAvailableAt.toISOString(), new Date(`${d(7)}T09:00:00+05:30`).toISOString());
  assert.equal((await put({ status: "AVAILABLE" })).status, 200);
  rows = await VehicleAllotment.find({ vehicle: v._id }).lean();
  assert.equal(rows[0].status, "RELEASED");
  assert.equal(await AllotmentEvent.countDocuments({ allotment: rows[0]._id, action: "RELEASED" }), 1);
  // history tab shows it
  const h = (await call("/vehicle-allotments?vehicleNo=TN97FS0001", "GET", undefined, t.rbp)).body.data;
  assert.equal(h.total, 1);
  assert.equal(h.items[0].status, "RELEASED");
});

// ================================================================== Tab 3: history
test("history: latest first, every filter, mass search, pagination, previous vehicle / reason / attachments / users", async () => {
  const t = await T();
  const list = async (qs = "") => (await call(`/vehicle-allotments?limit=100&${qs}`, "GET", undefined, t.rbp)).body.data;
  const all = await list();
  assert.ok(all.total >= 8);
  for (let i = 1; i < all.items.length; i++) assert.ok(new Date(all.items[i - 1].createdAt) >= new Date(all.items[i].createdAt)); // latest first
  assert.ok(all.items.every((x: any) => x.createdBy && x.allottedAt && x.nextAvailableAt && x.trackupNumber && x.pifNumber));
  // statuses
  for (const s of ["ACTIVE", "RELEASED", "CHANGED"]) {
    const r = await list(`status=${s}`);
    assert.ok(r.total >= 1, s);
    assert.ok(r.items.every((x: any) => x.status === s));
  }
  assert.equal((await list("status=BOGUS")).total, all.total); // unknown values are ignored
  // replacement rows carry previous vehicle, reason, attachments
  const changed = (await list("q=TN93CH0002")).items.find((x: any) => x.vehicleNo === "TN93CH0002");
  assert.equal(changed.changedFromVehicleNo, "TN93CH0001");
  assert.equal(changed.changeReason, "Engine failure on route");
  assert.equal(changed.changeAttachments.length, 2);
  assert.ok(changed.changedAt);
  // searching the OLD vehicle number finds both the old row and the replacement
  assert.ok((await list("vehicleNo=TN93CH0001")).total >= 2);
  // individual filters
  assert.ok((await list("clientName=alpha")).items.every((x: any) => x.clientName === "Alpha Foods"));
  assert.equal((await list("clientName=nobody")).total, 0);
  assert.ok((await list(`trackupNumber=${A(5).trackupNumber}`)).total >= 2);
  assert.equal((await list(`pifNumber=${A(6).pifNumber}`)).items[0].trackupNumber, A(6).trackupNumber);
  assert.ok((await list("projectType=ROADSHOW")).items.every((x: any) => x.projectType === "ROADSHOW"));
  assert.ok((await list("projectType=SIGNAGE")).total >= 5);
  assert.equal((await list(`from=${d(1)}`)).total, 0); // nothing allotted from tomorrow on
  assert.ok((await list(`from=${d(-1)}&to=${d(0)}`)).total >= 1);
  // mass search over vehicle, client, project, trackup, PIF
  for (const q of ["TN91AL0001", "alpha foods", "Roadie", A(0).trackupNumber, A(0).pifNumber, "ZZALT-1"]) assert.ok((await list(`q=${encodeURIComponent(q)}`)).total >= 1, q);
  assert.equal((await list("q=zzz-no-match")).total, 0);
  // combined filters and pagination
  const combo = await list("clientName=alpha&status=ACTIVE&projectType=SIGNAGE");
  assert.ok(combo.items.every((x: any) => x.status === "ACTIVE" && x.clientName === "Alpha Foods"));
  const p1 = (await call("/vehicle-allotments?limit=3&page=1", "GET", undefined, t.rbp)).body.data;
  const p2 = (await call("/vehicle-allotments?limit=3&page=2", "GET", undefined, t.rbp)).body.data;
  assert.equal(p1.items.length, 3);
  assert.equal(p1.total, all.total);
  assert.ok(p1.items.every((x: any) => !p2.items.some((y: any) => y._id === x._id))); // no overlap
});

test("history detail: project info, original and current vehicle, every change with reason, attachments, complete timeline", async () => {
  const t = await T();
  const chg = (await VehicleAllotment.findOne({ vehicleNo: "TN93CH0002" }).lean()) as any;
  const r = await call(`/vehicle-allotments/${chg._id}`, "GET", undefined, t.rbp);
  assert.equal(r.status, 200);
  const x = r.body.data;
  assert.equal(x.allotment.trackupNumber, A(5).trackupNumber);
  assert.equal(x.allotment.clientName, "Alpha Foods");
  assert.equal(x.original.vehicleNo, "TN93CH0001");
  assert.equal(x.current.vehicleNo, "TN93CH0002");
  assert.deepEqual(x.chain.map((c: any) => [c.vehicleNo, c.status]), [["TN93CH0001", "CHANGED"], ["TN93CH0002", "ACTIVE"]]); // old row preserved
  assert.equal(x.chain[1].changeAttachments[0].name, "photo.pdf");
  assert.ok(x.chain[1].changeAttachments[0].url);
  assert.equal(x.vehicle.vehicleNo, "TN93CH0002");
  assert.equal(x.vehicle.availabilityStatus, "IN_USE");
  const acts = x.events.map((e: any) => e.action);
  assert.deepEqual([...acts].sort(), ["ALLOTTED", "ALLOTTED", "VEHICLE_CHANGED"]);
  for (let i = 1; i < x.events.length; i++) assert.ok(new Date(x.events[i - 1].createdAt) >= new Date(x.events[i].createdAt)); // newest first
  assert.ok(x.events.every((e: any) => e.username === "RBP" && e.createdAt));
  await assert.rejects(AllotmentEvent.updateOne({ allotment: chg._id }, { username: "x" })); // immutable
  await assert.rejects(AllotmentEvent.deleteMany({ allotment: chg._id }));
});

// ================================================================== Tab 1: filters
test("vehicle list filters: consolidated FC / Insurance expiry filter evaluates each document on its own and combines with the others", async () => {
  const t = await T();
  const doc = (n: number | null) => (n === null ? [] : [{ nextRenewalDate: d(n) }]);
  const mk = (no: string, fc: number | null, ins: number | null, availability: unknown = { status: "AVAILABLE" }) =>
    mkVehicle({ vehicleNo: no, make: "ZZDocMake", fc: doc(fc), insurance: doc(ins) }, availability);
  const A1 = await mk("TN98DF0001", 10, 200); // FC expiring soon, insurance valid
  const B1 = await mk("TN98DF0002", -5, null); // FC expired, no insurance expiry
  const C1 = await mk("TN98DF0003", null, null, { status: "ISSUE", issue: { category: "Other", description: "x" } }); // nothing configured
  const D1 = await mk("TN98DF0004", 100, 5); // FC valid, insurance expiring soon
  const ids = async (qs: string) => (await call(`/vehicles?limit=100&q=ZZDocMake&${qs}`, "GET", undefined, t.rbp)).body.data.items.map((x: any) => x.vehicleNo).sort();
  const no = (...v: any[]) => v.map((x) => x.vehicleNo).sort();
  assert.deepEqual(await ids(""), no(A1, B1, C1, D1)); // no document filter: the list is unchanged
  assert.deepEqual(await ids("docStatus=EXPIRING_SOON"), no(A1, D1)); // FC or insurance
  assert.deepEqual(await ids("docStatus=EXPIRING_SOON&docType=FC"), no(A1));
  assert.deepEqual(await ids("docStatus=EXPIRING_SOON&docType=INSURANCE"), no(D1));
  assert.deepEqual(await ids("docStatus=EXPIRED"), no(B1));
  assert.deepEqual(await ids("docStatus=EXPIRED&docType=INSURANCE"), []);
  assert.deepEqual(await ids("docStatus=VALID"), no(A1, D1)); // A: insurance valid, D: FC valid
  assert.deepEqual(await ids("docStatus=VALID&docType=FC"), no(D1));
  assert.deepEqual(await ids("docStatus=VALID&docType=INSURANCE"), no(A1));
  assert.deepEqual(await ids("docStatus=NONE"), no(B1, C1)); // a missing expiry is "No Expiry", never "Valid"
  assert.deepEqual(await ids("docStatus=NONE&docType=FC"), no(C1));
  assert.deepEqual(await ids("docStatus=NONE&docType=INSURANCE"), no(B1, C1));
  assert.deepEqual(await ids("docType=FC"), no(A1, B1, C1, D1)); // type alone is not a filter
  assert.deepEqual(await ids("docStatus=BOGUS"), no(A1, B1, C1, D1));
  // other filters work together with it
  assert.deepEqual(await ids("docStatus=NONE&availabilityStatus=ISSUE"), no(C1));
  assert.deepEqual(await ids("docStatus=EXPIRING_SOON&availabilityStatus=AVAILABLE"), no(A1, D1));
  assert.deepEqual(await ids("docStatus=EXPIRING_SOON&availabilityStatus=IN_USE"), []);
  assert.deepEqual(await ids("docStatus=EXPIRED&q=TN98DF0002"), no(B1));
  // the statuses shown on each row use the same rules
  const rows = (await call("/vehicles?limit=100&q=ZZDocMake", "GET", undefined, t.rbp)).body.data.items;
  const st = (n: string) => rows.find((x: any) => x.vehicleNo === n);
  assert.deepEqual([st("TN98DF0001").fcStatus, st("TN98DF0001").insuranceStatus], ["EXPIRING_SOON", "VALID"]);
  assert.deepEqual([st("TN98DF0002").fcStatus, st("TN98DF0002").insuranceStatus], ["EXPIRED", "NONE"]);
  assert.deepEqual([st("TN98DF0003").fcStatus, st("TN98DF0003").insuranceStatus], ["NONE", "NONE"]);
  // pagination + total on the server
  const p = (await call("/vehicles?limit=2&page=2&q=ZZDocMake", "GET", undefined, t.rbp)).body.data;
  assert.deepEqual([p.total, p.items.length, p.page], [4, 2, 2]);
});

test("mass search covers vehicle number, make, model, type, trackup, PIF and project name", async () => {
  const t = await T();
  const v = await mkVehicle({ vehicleNo: "TN99MS0001", make: "ZZMakeQ", model: "ZZModelQ", type: "Utility" }, { status: "IN_USE", project: { trackupNumber: projR.vehicles[1].trackupNumber }, ...sched() });
  const find = async (q: string) => (await call(`/vehicles?limit=100&q=${encodeURIComponent(q)}`, "GET", undefined, t.rbp)).body.data.items.map((x: any) => x._id);
  for (const q of ["TN99MS0001", "tn 99 ms", "ZZMakeQ", "ZZModelQ", "Utility", projR.vehicles[1].trackupNumber, projR.vehicles[1].pifNumber, "Roadie Co Roadshow"])
    assert.ok((await find(q)).includes(v._id), q);
  assert.ok(!(await find("TN99MS9999")).includes(v._id));
});

// ================================================================== regression
test("regression: vehicle CRUD, draft, issue workflow and the rest of the API behave as before", async () => {
  const t = await T();
  const body = full({ vehicleNo: "TN70RG0001" });
  const c = await call("/vehicles", "POST", body, t.rbp); // no availability block at all
  assert.equal(c.status, 201);
  assert.equal((await call("/vehicles", "POST", body, t.rbp)).status, 409);
  assert.equal((await call(`/vehicles/${c.body.data._id}`, "PUT", { ...body, model: "New" }, t.rbp)).status, 200);
  const dr = await call("/vehicles", "POST", { saveAs: "DRAFT", vehicleNo: "TN70RG0002" }, t.rbp);
  assert.equal(dr.status, 201);
  assert.equal(dr.body.data.status, "DRAFT");
  assert.equal((await call(`/vehicles/${dr.body.data._id}`, "DELETE", undefined, t.rbp)).status, 200);
  const issue = await mkVehicle({}, { status: "ISSUE", issue: { category: "Battery Problem", description: "Dead" } });
  assert.equal(issue.availability.status, "ISSUE");
  assert.equal((await call(`/vehicles/${issue._id}`, "PUT", { ...issue, availability: { status: "AVAILABLE" } }, t.rbp)).status, 200); // explicit resolve
  assert.equal((await call("/vehicles/summary", "GET", undefined, t.rbp)).status, 200);
  assert.equal((await call("/vehicles/filters", "GET", undefined, t.rbp)).status, 200);
  assert.equal((await call("/vehicles/projects?limit=5", "GET", undefined, t.rbp)).status, 200);
  assert.equal((await call("/tracking", "GET", undefined, t.rsop)).status, 200);
  assert.equal((await call("/approvals/stats", "GET", undefined, t.rsom)).status, 200);
  assert.equal(await TrackingVehicle.countDocuments({ project: projA._id }), 12); // RSOP records only read
  assert.equal(await Budget.countDocuments(), 12 + 1 + 1 + 2 + 8);
  assert.equal(((await TrackingProject.findById(projA._id).lean()) as any).clientName, "Alpha Foods");
});

test("cleanup", async () => {
  await mongoose.connection.dropDatabase();
  await new Promise<void>((r) => server.close(() => r()));
  await mongoose.disconnect();
});
