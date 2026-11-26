/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_allotment_driver";
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
cfg.mongoUri = "mongodb://127.0.0.1:27017/driver_settlement_test_allotment_driver";
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
const { releaseDueVehicles } = await import("../src/services/availability.service.js");
const { releaseDueDrivers } = await import("../src/services/driverAvailability.service.js");
const { validateAllot } = await import("../src/validators/allotment.validator.js");
const { validateChangeDriver, validateAssignDriver } = await import("../src/services/allotmentDriver.service.js");
const { addDays, todayYmd } = await import("../src/validators/vehicle.validator.js");

const today = todayYmd();
const d = (n: number) => addDays(today, n);
const at = (ymd: string, hhmm = "10:00") => new Date(`${ymd}T${hhmm}:00+05:30`);

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
  const r = await call("/tracking", "POST", { projectType: "SIGNAGE", details: { projectCode: "12000001", client: "Delta Foods", jobSheetNumber: "ZZAD-" + k, location: "Salem", date: d(0), fromDate: d(2), toDate: d(20), numberOfVehicles: 20 } }, t.rsop);
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
const veh = async (id: string) => (await Vehicle.findById(id).lean()) as any;
const alt = async (id: string) => (await VehicleAllotment.findById(id).lean()) as any;
const events = async (id: string) => (await AllotmentEvent.find({ allotment: id }).sort({ createdAt: 1, _id: 1 }).lean()) as any[];
const dHist = async (id: string) => (await DriverHistory.find({ driver: id }).sort({ createdAt: 1, _id: 1 }).lean()) as any[];
const att = (name: string) => ({ storage: "local", key: `driver_settlement/vehicles/2026/123e4567-e89b-12d3-a456-426614174000-${name}`, name, size: 1234, mimeType: "application/pdf" });
const keys = (b: any) => Object.keys(b).sort();

// ================================================================== search + two-way mapping
test("driver search: by number and by name; only Available Now drivers; in-use / not available / unconfirmed / inactive excluded", async () => {
  const t = await rbp();
  const ok1 = await mkDriver({ status: "AVAILABLE" }, { driverName: "Searchable Alpha" });
  const ok2 = await mkDriver({ status: "AVAILABLE" }, { driverName: "Searchable Beta" });
  const inUse = await mkDriver({ status: "IN_USE", project: { trackupNumber: nextTrk(), startDate: d(0), endDate: d(5) } }, { driverName: "Searchable Busy" });
  const na = await mkDriver({ status: "NOT_AVAILABLE", notAvailable: { reason: "Leave", category: "Personal Leave" } }, { driverName: "Searchable Leave" });
  const inactive = await mkDriver({ status: "AVAILABLE" }, { driverName: "Searchable Inactive" });
  await call(`/drivers/${inactive._id}`, "PUT", { driverName: inactive.driverName, driverType: inactive.driverType, mobileNumber: inactive.mobileNumber, status: "INACTIVE" }, t);
  const legacy: any = await Driver.collection.insertOne({
    driverNumber: "DR-9100", driverName: "Searchable Legacy", driverType: "ACTING_DRIVER", mobileNumber: "+91 7999911111", mobileDigits: "7999911111", salary: 0, status: "ACTIVE",
    createdBy: "RBP", updatedBy: "RBP", createdAt: new Date(), updatedAt: new Date(),
  });
  const future = await mkDriver({ status: "AVAILABLE", availableFromDate: d(3), availableFromTime: "10:00" }, { driverName: "Searchable Future" });
  const r = await call("/vehicle-allotments/drivers?q=searchable", "GET", undefined, t);
  assert.equal(r.status, 200);
  assert.deepEqual(keys(r.body), ["data", "message", "success"]);
  const got = r.body.data.map((x: any) => x.driverName).sort();
  assert.deepEqual(got, ["Searchable Alpha", "Searchable Beta"]);
  for (const x of [inUse, na, inactive, future]) assert.ok(!got.includes(x.driverName), x.driverName);
  assert.ok(!got.includes("Searchable Legacy") && legacy.insertedId);
  const row = r.body.data.find((x: any) => x.driverName === "Searchable Alpha");
  assert.deepEqual(keys(row), ["_id", "driverName", "driverNumber", "driverType", "mobileNumber"]); // exactly what a suggestion shows
  assert.equal(row.driverNumber, ok1.driverNumber);
  assert.equal(row.mobileNumber, ok1.mobileNumber);
  assert.equal(row.driverType, ok1.driverType);
  const byNo = await call(`/vehicle-allotments/drivers?q=${encodeURIComponent(ok2.driverNumber)}`, "GET", undefined, t);
  assert.deepEqual(byNo.body.data.map((x: any) => x.driverNumber), [ok2.driverNumber]);
  const byNoLower = await call(`/vehicle-allotments/drivers?q=${encodeURIComponent(ok2.driverNumber.toLowerCase())}`, "GET", undefined, t);
  assert.equal(byNoLower.body.data.length, 1);
  assert.equal((await call("/vehicle-allotments/drivers?q=zzzz-none", "GET", undefined, t)).body.data.length, 0);
  assert.equal((await call("/vehicle-allotments/drivers?q=%25.*%5B", "GET", undefined, t)).status, 200); // regex characters are escaped
  assert.ok((await call("/vehicle-allotments/drivers?limit=1", "GET", undefined, t)).body.data.length <= 1);
});

test("two-way mapping: a Driver Number resolves its name, a Driver Name resolves its number; invalid / unavailable / ambiguous are rejected", async () => {
  const t = await rbp();
  const a = await mkDriver({ status: "AVAILABLE" }, { driverName: "Mapping Mohan", driverType: "COMPANY_DRIVER" });
  const byNo = await call(`/vehicle-allotments/drivers/lookup?number=${encodeURIComponent(a.driverNumber.toLowerCase())}`, "GET", undefined, t);
  assert.equal(byNo.status, 200);
  assert.deepEqual(keys(byNo.body), ["data", "message", "success"]);
  assert.deepEqual([byNo.body.data.driverName, byNo.body.data.driverNumber, byNo.body.data.driverType, byNo.body.data.mobileNumber, byNo.body.data._id], ["Mapping Mohan", a.driverNumber, "COMPANY_DRIVER", a.mobileNumber, a._id]);
  const byName = await call("/vehicle-allotments/drivers/lookup?name=mapping%20%20mohan", "GET", undefined, t);
  assert.equal(byName.status, 200);
  assert.deepEqual([byName.body.data.driverNumber, byName.body.data._id], [a.driverNumber, a._id]); // same database record both ways
  assert.equal((await call("/vehicle-allotments/drivers/lookup", "GET", undefined, t)).status, 400);
  const nf = await call("/vehicle-allotments/drivers/lookup?number=DR-0000", "GET", undefined, t);
  assert.equal(nf.status, 404);
  assert.equal(nf.body.data, null);
  assert.equal((await call("/vehicle-allotments/drivers/lookup?name=Nobody%20Here", "GET", undefined, t)).status, 404);
  const busy = await mkDriver({ status: "IN_USE", project: { trackupNumber: nextTrk(), startDate: d(0), endDate: d(5) } }, { driverName: "Mapping Busy" });
  const b = await call(`/vehicle-allotments/drivers/lookup?number=${busy.driverNumber}`, "GET", undefined, t);
  assert.equal(b.status, 409);
  assert.match(b.body.message, /already in use/);
  const na = await mkDriver({ status: "NOT_AVAILABLE", notAvailable: { reason: "Medical rest", category: "Medical Leave" } }, { driverName: "Mapping Leave" });
  const n = await call(`/vehicle-allotments/drivers/lookup?name=Mapping%20Leave`, "GET", undefined, t);
  assert.equal(n.status, 409);
  assert.match(n.body.message, /not available: Medical rest/);
  assert.ok(na._id);
  await mkDriver({ status: "AVAILABLE" }, { driverName: "Twin Same" });
  await mkDriver({ status: "AVAILABLE" }, { driverName: "Twin Same" });
  const amb = await call("/vehicle-allotments/drivers/lookup?name=Twin%20Same", "GET", undefined, t);
  assert.equal(amb.status, 409);
  assert.match(amb.body.message, /choose one from the suggestions/);
});

test("access: driver endpoints are RBP only", async () => {
  const t = await T();
  for (const [m, p] of [["GET", "/vehicle-allotments/drivers"], ["GET", "/vehicle-allotments/drivers/lookup?number=DR-1"], ["POST", `/vehicle-allotments/${"a".repeat(24)}/assign-driver`], ["POST", `/vehicle-allotments/${"a".repeat(24)}/change-driver`]] as const) {
    assert.equal((await call(p, m, m === "POST" ? {} : undefined)).status, 401, p);
    for (const tok of [t.rsop, t.rsom]) assert.equal((await call(p, m, m === "POST" ? {} : undefined, tok)).status, 403, p);
  }
});

// ================================================================== validators (pure)
test("validators: driverId optional and must be an id; assign / change inputs", () => {
  const base = { vehicleId: "a".repeat(24), trackupNumber: "T-1", ...sched() };
  assert.equal(validateAllot(base).data?.driverId, null); // vehicle only
  assert.equal(validateAllot({ ...base, driverId: "" }).data?.driverId, null);
  assert.equal(validateAllot({ ...base, driverId: "b".repeat(24) }).data?.driverId, "b".repeat(24));
  assert.ok(validateAllot({ ...base, driverId: "Arun Kumar" }).errors.some((e) => /Driver is invalid/.test(e))); // arbitrary text is never accepted
  assert.deepEqual(validateAssignDriver({}).errors, ["Driver is required"]);
  assert.equal(validateAssignDriver({ driverId: "b".repeat(24), remarks: "x" }).data?.remarks, "x");
  assert.ok(validateChangeDriver({ driverId: "b".repeat(24) }).errors.includes("Change reason is required"));
  assert.ok(validateChangeDriver({ driverId: "b".repeat(24), reason: "  " }).errors.includes("Change reason is required"));
  assert.ok(validateChangeDriver({ reason: "x" }).errors.includes("Replacement driver is required"));
  assert.ok(validateChangeDriver({ driverId: "b".repeat(24), reason: "x", attachments: [{ name: "bad" }] }).errors.some((e) => /Attachment 1 is invalid/.test(e)));
  assert.deepEqual(validateChangeDriver({ driverId: "b".repeat(24), reason: "Driver fell ill", attachments: [att("a.pdf")] }).errors, []);
  assert.equal(validateChangeDriver({ driverId: "b".repeat(24), reason: "Driver fell ill" }).data?.attachments.length, 0); // attachment optional
  assert.ok(validateChangeDriver({ driverId: "b".repeat(24), reason: "<b>" }).errors.some((e) => /invalid characters/.test(e)));
});

// ================================================================== vehicle only
test("vehicle-only allotment works unchanged: no driver saved, driver untouched, detail says Driver Not Assigned", async () => {
  const v = await mkVehicle();
  const bystander = await mkDriver();
  const r = await allot(v._id);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.message, "Vehicle allotted successfully");
  assert.equal(r.body.data.driver, undefined);
  assert.equal(r.body.data.activeDriver, undefined);
  assert.equal(r.body.data.status, "ACTIVE");
  assert.equal((await veh(v._id)).availability.status, "IN_USE");
  assert.equal((await drv(bystander._id)).availability.status, "AVAILABLE");
  const detail = await call(`/vehicle-allotments/${r.body.data._id}`, "GET", undefined, await rbp());
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.driver, null);
  assert.deepEqual((await events(r.body.data._id)).map((e) => e.action), ["ALLOTTED"]);
  const nullDriver = await allot((await mkVehicle())._id, null); // an explicit null is also vehicle-only
  assert.equal(nullDriver.status, 201);
});

// ================================================================== vehicle + driver
test("vehicle + driver: both are allotted together to the same project, statuses and history are recorded", async () => {
  const v = await mkVehicle();
  const dr = await mkDriver({ status: "AVAILABLE" }, { driverName: "Together Tamil" });
  const trk = proj.vehicles[pn].trackupNumber;
  const r = await allot(v._id, dr._id, { remarks: "festival season" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.message, "Vehicle and driver allotted successfully");
  const a = await alt(r.body.data._id);
  assert.deepEqual([String(a.driver), String(a.activeDriver), a.driverNumber, a.driverName, a.driverType, a.driverMobile, a.driverAssignedBy],
    [dr._id, dr._id, dr.driverNumber, "Together Tamil", dr.driverType, dr.mobileNumber, "RBP"]);
  assert.ok(a.driverAssignedAt);
  const vv = await veh(v._id);
  const dd = await drv(dr._id);
  assert.equal(vv.availability.status, "IN_USE");
  assert.equal(dd.availability.status, "IN_USE"); // "In Use – Another Project"
  assert.equal(vv.availability.project.trackupNumber, trk);
  assert.equal(dd.availability.project.trackupNumber, trk); // same project
  assert.equal(String(dd.availability.project.trackingVehicle), String(a.trackingVehicle));
  assert.equal(String(dd.availability.project.allotment), String(a._id)); // driver <-> allotment link
  assert.equal(dd.availability.project.vehicleNo, v.vehicleNo);
  assert.equal(dd.availability.project.startDate, today);
  assert.equal(dd.availability.project.endDate, d(4)); // the day the allotment ends
  assert.equal(dd.availability.lastStatusUpdatedBy, "RBP");
  assert.deepEqual((await events(a._id)).map((e) => e.action), ["ALLOTTED", "DRIVER_ASSIGNED"]);
  const ev = (await events(a._id))[1];
  assert.equal(ev.details.driverNumber, dr.driverNumber);
  assert.equal(ev.details.later, false);
  const h = await dHist(dr._id);
  const last = h[h.length - 1];
  assert.equal(last.action, "PROJECT_ASSIGNED");
  assert.equal(last.previousStatus, "AVAILABLE");
  assert.equal(last.newStatus, "IN_USE");
  assert.equal(last.project.trackupNumber, trk);
  assert.match(last.reason, new RegExp(v.vehicleNo));
  assert.ok((await VehicleHistory.find({ vehicle: v._id }).lean()).some((x: any) => x.newStatus === "IN_USE")); // vehicle history still recorded
  const detail = (await call(`/vehicle-allotments/${a._id}`, "GET", undefined, await rbp())).body.data;
  assert.deepEqual([detail.driver.driverNumber, detail.driver.driverName, detail.driver.driverType, detail.driver.mobileNumber, detail.driver.status, detail.driver.active, detail.driver.assignedBy],
    [dr.driverNumber, "Together Tamil", dr.driverType, dr.mobileNumber, "IN_USE", true, "RBP"]);
  assert.ok(detail.driver.assignedAt);
});

test("vehicle + driver: unavailable / unknown / invalid drivers are rejected and the vehicle is not allotted", async () => {
  const cases: [string, any, number, RegExp][] = [
    ["in use", await mkDriver({ status: "IN_USE", project: { trackupNumber: nextTrk(), startDate: d(0), endDate: d(5) } }), 409, /already in use/],
    ["not available", await mkDriver({ status: "NOT_AVAILABLE", notAvailable: { reason: "Leave", category: "Personal Leave" } }), 409, /not available/],
    ["future available-from", await mkDriver({ status: "AVAILABLE", availableFromDate: d(2), availableFromTime: "09:00" }), 409, /available only from/],
  ];
  for (const [name, dr, status, re] of cases) {
    const v = await mkVehicle();
    const r = await allot(v._id, dr._id);
    assert.equal(r.status, status, name);
    assert.match(r.body.message, re, name);
    assert.equal(r.body.data, null);
    assert.equal((await veh(v._id)).availability.status, "AVAILABLE", `${name}: vehicle untouched`);
    assert.equal(await VehicleAllotment.countDocuments({ vehicle: v._id }), 0, name);
  }
  const v = await mkVehicle();
  assert.equal((await allot(v._id, "0".repeat(24))).status, 404);
  assert.equal((await allot(v._id, "not-an-id")).status, 400);
  assert.equal((await allot(v._id, "Arun Kumar")).status, 400); // free text is never an assignment
  const legacy: any = await Driver.collection.insertOne({
    driverNumber: "DR-9101", driverName: "No Availability", driverType: "ACTING_DRIVER", mobileNumber: "+91 7999922222", mobileDigits: "7999922222", salary: 0, status: "ACTIVE",
    createdBy: "RBP", updatedBy: "RBP", createdAt: new Date(), updatedAt: new Date(),
  });
  const l = await allot(v._id, String(legacy.insertedId));
  assert.equal(l.status, 409);
  assert.match(l.body.message, /not confirmed/);
  assert.equal((await veh(v._id)).availability.status, "AVAILABLE");
  const inactive = await mkDriver();
  await call(`/drivers/${inactive._id}`, "PUT", { driverName: inactive.driverName, driverType: inactive.driverType, mobileNumber: inactive.mobileNumber, status: "INACTIVE" }, await rbp());
  assert.equal((await allot(v._id, inactive._id)).status, 409);
});

test("duplicate driver assignment is prevented: a driver already on an allotment cannot take a second one", async () => {
  const dr = await mkDriver();
  const v1 = await mkVehicle();
  const v2 = await mkVehicle();
  assert.equal((await allot(v1._id, dr._id)).status, 201);
  const second = await allot(v2._id, dr._id);
  assert.equal(second.status, 409);
  assert.match(second.body.message, /already in use|already assigned/);
  assert.equal((await veh(v2._id)).availability.status, "AVAILABLE");
  // even with the driver's own availability forced back, the allotment unique index still refuses a double hold
  await Driver.updateOne({ _id: dr._id }, { $set: { "availability.status": "AVAILABLE" } });
  const third = await allot(v2._id, dr._id);
  assert.equal(third.status, 409);
  assert.match(third.body.message, /already assigned to another vehicle/);
  assert.equal((await veh(v2._id)).availability.status, "AVAILABLE");
  const search = await call(`/vehicle-allotments/drivers?q=${dr.driverNumber}`, "GET", undefined, await rbp());
  assert.equal(search.body.data.length, 0); // a driver holding an allotment is not suggested either
});

test("concurrent requests: two RBP users allotting the same driver at once - exactly one wins, the other leaves its vehicle free", async () => {
  const dr = await mkDriver();
  const vs = [await mkVehicle(), await mkVehicle(), await mkVehicle(), await mkVehicle()];
  const rs = await Promise.all(vs.map((v) => allot(v._id, dr._id)));
  assert.equal(rs.filter((r) => r.status === 201).length, 1, JSON.stringify(rs.map((r) => r.status)));
  assert.ok(rs.filter((r) => r.status !== 201).every((r) => r.status === 409));
  const free = await Promise.all(vs.map(async (v) => (await veh(v._id)).availability.status));
  assert.equal(free.filter((s) => s === "IN_USE").length, 1);
  assert.equal(free.filter((s) => s === "AVAILABLE").length, 3);
  assert.equal(await VehicleAllotment.countDocuments({ activeDriver: dr._id }), 1);
  assert.equal((await drv(dr._id)).availability.status, "IN_USE");
});

test("failure while saving the allotment rolls back both the vehicle and the driver", async () => {
  const dr = await mkDriver();
  const v = await mkVehicle();
  const before = { d: await drv(dr._id), v: await veh(v._id) };
  const orig = VehicleAllotment.create.bind(VehicleAllotment);
  (VehicleAllotment as any).create = async () => { throw new Error("simulated database failure"); };
  let r: any;
  try {
    r = await allot(v._id, dr._id);
  } finally {
    (VehicleAllotment as any).create = orig;
  }
  assert.equal(r.status, 500);
  const after = { d: await drv(dr._id), v: await veh(v._id) };
  assert.equal(after.d.availability.status, "AVAILABLE"); // driver is back
  assert.equal(after.d.availability.project, null);
  assert.equal(after.v.availability.status, "AVAILABLE"); // vehicle is back
  assert.ok(after.v.availability.project == null);
  assert.equal(after.d.driverName, before.d.driverName);
  assert.equal(await VehicleAllotment.countDocuments({ vehicle: v._id }), 0);
  assert.equal((await allot(v._id, dr._id)).status, 201); // and the same pair can be allotted afterwards
});

// ================================================================== assign driver later
test("assign driver later: links an available driver to the active allotment; the original allotment is preserved", async () => {
  const v = await mkVehicle();
  const a0 = (await allot(v._id)).body.data;
  const dr = await mkDriver({ status: "AVAILABLE" }, { driverName: "Later Lokesh" });
  const t = await rbp();
  const bad = await call(`/vehicle-allotments/${a0._id}/assign-driver`, "POST", {}, t);
  assert.equal(bad.status, 400);
  assert.equal((await call(`/vehicle-allotments/${a0._id}/assign-driver`, "POST", { driverId: "x" }, t)).status, 400);
  assert.equal((await call(`/vehicle-allotments/${a0._id}/assign-driver`, "POST", { driverId: "0".repeat(24) }, t)).status, 404);
  assert.equal((await call(`/vehicle-allotments/${"0".repeat(24)}/assign-driver`, "POST", { driverId: dr._id }, t)).status, 404);
  const r = await call(`/vehicle-allotments/${a0._id}/assign-driver`, "POST", { driverId: dr._id, remarks: "driver joined late" }, t);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(keys(r.body), ["data", "message", "success"]);
  assert.equal(r.body.message, "Driver assigned successfully");
  const a = await alt(a0._id);
  const orig = await VehicleAllotment.findById(a0._id).lean();
  assert.ok(orig);
  assert.equal(a.status, "ACTIVE");
  assert.equal(String(a.vehicle), v._id); // vehicle allotment untouched
  assert.equal(+new Date(a.allottedAt), +new Date(a0.allottedAt));
  assert.equal(+new Date(a.nextAvailableAt), +new Date(a0.nextAvailableAt));
  assert.equal(a.trackupNumber, a0.trackupNumber);
  assert.equal(await VehicleAllotment.countDocuments({ trackupNumber: a0.trackupNumber }), 1); // no duplicate allotment
  assert.deepEqual([String(a.activeDriver), a.driverNumber, a.driverName, a.driverAssignedBy], [dr._id, dr.driverNumber, "Later Lokesh", "RBP"]);
  assert.ok(a.driverAssignedAt);
  const dd = await drv(dr._id);
  assert.equal(dd.availability.status, "IN_USE");
  assert.equal(dd.availability.project.trackupNumber, a0.trackupNumber);
  assert.equal(String(dd.availability.project.allotment), a0._id);
  assert.equal(dd.availability.project.endDate, d(4));
  assert.equal((await veh(v._id)).availability.status, "IN_USE"); // vehicle availability unchanged
  const ev = await events(a0._id);
  assert.deepEqual(ev.map((e) => e.action), ["ALLOTTED", "DRIVER_ASSIGNED"]);
  assert.equal(ev[1].details.later, true);
  assert.equal(ev[1].username, "RBP");
  const h = await dHist(dr._id);
  assert.equal(h[h.length - 1].action, "PROJECT_ASSIGNED");
  assert.match(h[h.length - 1].reason, new RegExp(v.vehicleNo));
  const again = await call(`/vehicle-allotments/${a0._id}/assign-driver`, "POST", { driverId: (await mkDriver())._id }, t);
  assert.equal(again.status, 409);
  assert.match(again.body.message, /use Change Driver/);
});

test("assign driver later: duplicate and unavailable drivers are refused; a closed allotment cannot take a driver; concurrent assigns have one winner", async () => {
  const t = await rbp();
  const dr = await mkDriver();
  const [a1, a2, a3] = [(await allot((await mkVehicle())._id)).body.data, (await allot((await mkVehicle())._id)).body.data, (await allot((await mkVehicle())._id)).body.data];
  const results = await Promise.all([a1, a2, a3].map((a) => call(`/vehicle-allotments/${a._id}/assign-driver`, "POST", { driverId: dr._id }, t)));
  assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.status)));
  assert.ok(results.filter((r) => r.status !== 200).every((r) => r.status === 409));
  assert.equal(await VehicleAllotment.countDocuments({ activeDriver: dr._id }), 1);
  const busy = await mkDriver({ status: "IN_USE", project: { trackupNumber: nextTrk(), startDate: d(0), endDate: d(5) } });
  const pick = [a1, a2, a3].find((a, i) => results[i].status !== 200)!;
  const r = await call(`/vehicle-allotments/${pick._id}/assign-driver`, "POST", { driverId: busy._id }, t);
  assert.equal(r.status, 409);
  assert.equal((await alt(pick._id)).activeDriver, undefined);
  const na = await mkDriver({ status: "NOT_AVAILABLE", notAvailable: { reason: "Leave", category: "Personal Leave" } });
  assert.equal((await call(`/vehicle-allotments/${pick._id}/assign-driver`, "POST", { driverId: na._id }, t)).status, 409);
  await call(`/vehicle-allotments/${pick._id}/release`, "POST", {}, t);
  const closed = await call(`/vehicle-allotments/${pick._id}/assign-driver`, "POST", { driverId: (await mkDriver())._id }, t);
  assert.equal(closed.status, 409);
  assert.match(closed.body.message, /active allotment/);
});

test("assign driver later: a failed link restores the driver; older allotments without driver fields keep working", async () => {
  const t = await rbp();
  const v = await mkVehicle();
  const a0 = (await allot(v._id)).body.data;
  await VehicleAllotment.collection.updateOne({ _id: new mongoose.Types.ObjectId(a0._id) }, { $unset: { driver: "", activeDriver: "", driverNumber: "" } }); // shape of an older record
  const detail = await call(`/vehicle-allotments/${a0._id}`, "GET", undefined, t);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.driver, null);
  const dr = await mkDriver();
  const orig = VehicleAllotment.findOneAndUpdate.bind(VehicleAllotment);
  (VehicleAllotment as any).findOneAndUpdate = () => ({ lean: async () => { (VehicleAllotment as any).findOneAndUpdate = orig; return null; } });
  let r: any;
  try {
    r = await call(`/vehicle-allotments/${a0._id}/assign-driver`, "POST", { driverId: dr._id }, t);
  } finally {
    (VehicleAllotment as any).findOneAndUpdate = orig;
  }
  assert.equal(r.status, 409);
  assert.equal((await drv(dr._id)).availability.status, "AVAILABLE"); // driver restored
  assert.equal((await call(`/vehicle-allotments/${a0._id}/assign-driver`, "POST", { driverId: dr._id }, t)).status, 200); // and can be assigned afterwards
});

// ================================================================== change driver
test("change driver: reason mandatory, attachment and remarks optional; previous driver released, replacement allocated, vehicle allocation preserved", async () => {
  const t = await rbp();
  const d1 = await mkDriver({ status: "AVAILABLE" }, { driverName: "First Fazil" });
  const d2 = await mkDriver({ status: "AVAILABLE" }, { driverName: "Second Siva" });
  const v = await mkVehicle();
  const a0 = (await allot(v._id, d1._id)).body.data;
  const path = `/vehicle-allotments/${a0._id}/change-driver`;
  const noReason = await call(path, "POST", { driverId: d2._id }, t);
  assert.equal(noReason.status, 400);
  assert.match(noReason.body.message, /Change reason is required/);
  assert.equal((await call(path, "POST", { driverId: d2._id, reason: "   " }, t)).status, 400);
  assert.equal((await call(path, "POST", { reason: "x" }, t)).status, 400);
  assert.equal((await call(path, "POST", { driverId: d2._id, reason: "x", attachments: [{ name: "x" }] }, t)).status, 400); // invalid attachment
  assert.equal((await call(path, "POST", { driverId: d1._id, reason: "same driver" }, t)).status, 400);
  assert.equal(String((await alt(a0._id)).activeDriver), d1._id); // refused requests changed nothing
  assert.equal((await drv(d2._id)).availability.status, "AVAILABLE");
  const r = await call(path, "POST", { driverId: d2._id, reason: "Driver fell ill", remarks: "replacement from Salem depot", attachments: [att("medical.pdf")] }, t);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(keys(r.body), ["data", "message", "success"]);
  assert.equal(r.body.message, "Driver changed successfully");
  const a = await alt(a0._id);
  assert.equal(a.status, "ACTIVE"); // vehicle allocation preserved
  assert.equal(String(a.vehicle), v._id);
  assert.equal(String(a._id), a0._id);
  assert.equal(await VehicleAllotment.countDocuments({ trackupNumber: a0.trackupNumber }), 1);
  assert.deepEqual([String(a.activeDriver), a.driverNumber, a.driverName, a.driverAssignedBy], [d2._id, d2.driverNumber, "Second Siva", "RBP"]);
  assert.equal((await veh(v._id)).availability.status, "IN_USE");
  const old = await drv(d1._id);
  assert.equal(old.availability.status, "AVAILABLE"); // previous driver: Available Now again
  assert.equal(old.availability.project, null);
  const nw = await drv(d2._id);
  assert.equal(nw.availability.status, "IN_USE");
  assert.equal(String(nw.availability.project.allotment), a0._id);
  assert.equal(nw.availability.project.trackupNumber, a0.trackupNumber);
  const ev = (await events(a0._id)).find((e) => e.action === "DRIVER_CHANGED");
  assert.equal(ev.details.from.driverNumber, d1.driverNumber);
  assert.equal(ev.details.from.driverName, "First Fazil");
  assert.equal(ev.details.to.driverNumber, d2.driverNumber);
  assert.equal(ev.details.reason, "Driver fell ill");
  assert.equal(ev.details.remarks, "replacement from Salem depot");
  assert.equal(ev.details.attachments[0].name, "medical.pdf");
  assert.equal(ev.username, "RBP");
  assert.ok(ev.createdAt);
  const h1 = await dHist(d1._id);
  assert.equal(h1[h1.length - 1].action, "STATUS_CHANGED");
  assert.deepEqual([h1[h1.length - 1].previousStatus, h1[h1.length - 1].newStatus], ["IN_USE", "AVAILABLE"]);
  assert.equal(h1[h1.length - 1].project.trackupNumber, a0.trackupNumber); // the old assignment is preserved in history
  assert.match(h1[h1.length - 1].reason, /Replaced by .*Driver fell ill/);
  const h2 = await dHist(d2._id);
  assert.equal(h2[h2.length - 1].action, "PROJECT_ASSIGNED");
  assert.match(h2[h2.length - 1].reason, /replacement for .*Driver fell ill/);
  const detail = (await call(`/vehicle-allotments/${a0._id}`, "GET", undefined, t)).body.data;
  assert.equal(detail.driver.driverNumber, d2.driverNumber);
  assert.deepEqual(detail.events.map((e: any) => e.action).filter((x: string) => x.startsWith("DRIVER")).sort(), ["DRIVER_ASSIGNED", "DRIVER_CHANGED"]);
  const back = await call(path, "POST", { driverId: d1._id, reason: "Original driver recovered" }, t); // the released driver is assignable again; no attachment is fine
  assert.equal(back.status, 200, JSON.stringify(back.body));
});

test("change driver: an unavailable or duplicate replacement fails and the existing assignment stays intact", async () => {
  const t = await rbp();
  const d1 = await mkDriver();
  const v = await mkVehicle();
  const a0 = (await allot(v._id, d1._id)).body.data;
  const path = `/vehicle-allotments/${a0._id}/change-driver`;
  const other = await mkDriver();
  await allot((await mkVehicle())._id, other._id); // other driver is already on another allotment
  const na = await mkDriver({ status: "NOT_AVAILABLE", notAvailable: { reason: "Leave", category: "Personal Leave" } });
  for (const bad of [other, na]) {
    const r = await call(path, "POST", { driverId: bad._id, reason: "swap" }, t);
    assert.equal(r.status, 409);
    assert.equal(r.body.data, null);
    assert.equal(String((await alt(a0._id)).activeDriver), d1._id);
    assert.equal((await drv(d1._id)).availability.status, "IN_USE");
  }
  assert.equal((await call(path, "POST", { driverId: "0".repeat(24), reason: "swap" }, t)).status, 404);
  const vehicleOnly = (await allot((await mkVehicle())._id)).body.data;
  const nd = await call(`/vehicle-allotments/${vehicleOnly._id}/change-driver`, "POST", { driverId: (await mkDriver())._id, reason: "x" }, t);
  assert.equal(nd.status, 409);
  assert.match(nd.body.message, /use Assign Driver/);
});

test("change driver: a failure while switching restores the replacement and keeps the current driver", async () => {
  const t = await rbp();
  const d1 = await mkDriver();
  const d2 = await mkDriver();
  const a0 = (await allot((await mkVehicle())._id, d1._id)).body.data;
  const orig = VehicleAllotment.findOneAndUpdate.bind(VehicleAllotment);
  (VehicleAllotment as any).findOneAndUpdate = () => ({ lean: async () => { throw new Error("simulated database failure"); } });
  let r: any;
  try {
    r = await call(`/vehicle-allotments/${a0._id}/change-driver`, "POST", { driverId: d2._id, reason: "swap" }, t);
  } finally {
    (VehicleAllotment as any).findOneAndUpdate = orig;
  }
  assert.equal(r.status, 500);
  assert.equal(String((await alt(a0._id)).activeDriver), d1._id); // existing assignment preserved
  assert.equal((await drv(d1._id)).availability.status, "IN_USE");
  assert.equal((await drv(d2._id)).availability.status, "AVAILABLE"); // the replacement hold is rolled back
});

test("change driver: a lost race on the allotment (current driver changed meanwhile) restores the replacement", async () => {
  const t = await rbp();
  const d1 = await mkDriver();
  const d2 = await mkDriver();
  const a0 = (await allot((await mkVehicle())._id, d1._id)).body.data;
  const orig = VehicleAllotment.findOneAndUpdate.bind(VehicleAllotment);
  (VehicleAllotment as any).findOneAndUpdate = () => ({ lean: async () => { (VehicleAllotment as any).findOneAndUpdate = orig; return null; } });
  let r: any;
  try {
    r = await call(`/vehicle-allotments/${a0._id}/change-driver`, "POST", { driverId: d2._id, reason: "swap" }, t);
  } finally {
    (VehicleAllotment as any).findOneAndUpdate = orig;
  }
  assert.equal(r.status, 409);
  assert.equal(String((await alt(a0._id)).activeDriver), d1._id);
  assert.equal((await drv(d1._id)).availability.status, "IN_USE");
  assert.equal((await drv(d2._id)).availability.status, "AVAILABLE"); // replacement is free again
  assert.equal((await call(`/vehicle-allotments/${a0._id}/change-driver`, "POST", { driverId: d2._id, reason: "swap" }, t)).status, 200);
});

// ================================================================== release + scheduler integration
test("manual vehicle release also releases the driver (Available Now) and records it; history is preserved", async () => {
  const t = await rbp();
  const dr = await mkDriver();
  const a0 = (await allot((await mkVehicle())._id, dr._id)).body.data;
  const r = await call(`/vehicle-allotments/${a0._id}/release`, "POST", { remarks: "project over" }, t);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const a = await alt(a0._id);
  assert.equal(a.status, "RELEASED");
  assert.equal(a.activeDriver, undefined);
  assert.ok(a.driverReleasedAt);
  assert.equal(a.driverNumber, dr.driverNumber); // the driver's details stay on the record
  const dd = await drv(dr._id);
  assert.equal(dd.availability.status, "AVAILABLE");
  assert.equal(dd.availability.project, null);
  assert.deepEqual((await events(a0._id)).map((e) => e.action), ["ALLOTTED", "DRIVER_ASSIGNED", "RELEASED", "DRIVER_RELEASED"]);
  const h = await dHist(dr._id);
  assert.equal(h[h.length - 1].action, "STATUS_CHANGED");
  assert.equal(h[h.length - 1].project.trackupNumber, a0.trackupNumber);
  const detail = (await call(`/vehicle-allotments/${a0._id}`, "GET", undefined, t)).body.data;
  assert.equal(detail.driver.active, false);
  assert.ok(detail.driver.releasedAt);
  assert.equal((await allot((await mkVehicle())._id, dr._id)).status, 201); // the driver can be allotted again
});

test("scheduler: when the vehicle is auto-released its driver becomes Available Now once; running again adds no duplicate history", async () => {
  const dr = await mkDriver();
  const a0 = (await allot((await mkVehicle())._id, dr._id)).body.data;
  const later = at(d(5));
  const r1 = await releaseDueVehicles(later);
  assert.ok(r1.released >= 1);
  const dd = await drv(dr._id);
  assert.equal(dd.availability.status, "AVAILABLE");
  assert.equal(dd.availability.lastStatusUpdatedBy, "SYSTEM");
  assert.ok(dd.availability.autoReleasedAt);
  await releaseDueVehicles(later);
  await releaseDueDrivers(later);
  await releaseDueDrivers(later);
  const auto = (await dHist(dr._id)).filter((x) => x.action === "AUTO_AVAILABILITY_UPDATE");
  assert.equal(auto.length, 1);
  assert.equal(auto[0].project.trackupNumber, a0.trackupNumber); // previous project assignment preserved
  assert.equal(auto[0].username, "SYSTEM");
  assert.equal((await dHist(dr._id)).filter((x) => x.action === "PROJECT_ASSIGNED").length, 1);
  assert.equal((await events(a0._id)).filter((e) => e.action === "DRIVER_RELEASED").length, 1);
  assert.equal((await alt(a0._id)).status, "RELEASED");
});

test("scheduler: the driver scheduler on its own releases an overdue driver and ends the allotment's driver hold", async () => {
  const dr = await mkDriver();
  const a0 = (await allot((await mkVehicle())._id, dr._id)).body.data;
  assert.equal((await releaseDueDrivers(at(d(4), "23:59"))).released >= 0, true);
  assert.equal((await drv(dr._id)).availability.status, "IN_USE"); // the To date itself: still in use
  await releaseDueDrivers(at(d(5), "00:00"));
  assert.equal((await drv(dr._id)).availability.status, "AVAILABLE");
  const a = await alt(a0._id);
  assert.equal(a.status, "ACTIVE"); // the vehicle allotment itself is the vehicle scheduler's business
  assert.equal(a.activeDriver, undefined);
  assert.ok(a.driverReleasedAt);
  assert.ok((await events(a0._id)).some((e) => e.action === "DRIVER_RELEASED" && e.username === "SYSTEM"));
  const dr2 = await mkDriver(); // the vehicle-only allotment can take a driver again
  assert.equal((await call(`/vehicle-allotments/${a0._id}/assign-driver`, "POST", { driverId: dr2._id }, await rbp())).status, 200);
});

test("extension: the driver's To date follows the allotment, so the old date's release cannot fire", async () => {
  const t = await rbp();
  const dr = await mkDriver();
  const a0 = (await allot((await mkVehicle())._id, dr._id)).body.data;
  const ext = await call(`/vehicle-allotments/${a0._id}/schedule`, "PUT", { expectedReleaseDate: d(8), expectedReleaseTime: "20:00", nextAvailableDate: d(9), nextAvailableTime: "09:00", reason: "project extended" }, t);
  assert.equal(ext.status, 200, JSON.stringify(ext.body));
  assert.equal((await drv(dr._id)).availability.project.endDate, d(9));
  await releaseDueDrivers(at(d(6))); // the old end date (d(4)) has passed
  assert.equal((await drv(dr._id)).availability.status, "IN_USE");
  assert.ok((await dHist(dr._id)).some((x) => x.action === "PROJECT_EXTENDED"));
  await releaseDueDrivers(at(d(10)));
  assert.equal((await drv(dr._id)).availability.status, "AVAILABLE");
});

test("a newer assignment is never touched by the previous allocation's scheduled release; Not Available is respected", async () => {
  const t = await rbp();
  const dr = await mkDriver();
  const a1 = (await allot((await mkVehicle())._id, dr._id)).body.data; // ends d(4)
  await call(`/vehicle-allotments/${a1._id}/release`, "POST", {}, t); // released early
  const a2 = (await allot((await mkVehicle())._id, dr._id, sched({ expectedReleaseDate: d(9), nextAvailableDate: d(10) }))).body.data; // newer assignment, ends d(10)
  await releaseDueDrivers(at(d(5)));
  await releaseDueVehicles(at(d(5)));
  const cur = await drv(dr._id);
  assert.equal(cur.availability.status, "IN_USE");
  assert.equal(String(cur.availability.project.allotment), a2._id);
  assert.equal((await dHist(dr._id)).filter((x) => x.action === "AUTO_AVAILABILITY_UPDATE").length, 0);
  // a driver set Not Available by hand afterwards (after the allotment ended) is never released by the scheduler
  await call(`/vehicle-allotments/${a2._id}/release`, "POST", {}, t);
  await call(`/drivers/${dr._id}`, "PUT", { driverName: cur.driverName, driverType: cur.driverType, mobileNumber: cur.mobileNumber, availability: { status: "NOT_AVAILABLE", notAvailable: { reason: "Family function", category: "Personal Leave" } } }, t);
  await releaseDueDrivers(at(d(60)));
  await releaseDueVehicles(at(d(60)));
  assert.equal((await drv(dr._id)).availability.status, "NOT_AVAILABLE");
});

test("replacing the vehicle keeps the driver with the project vehicle", async () => {
  const t = await rbp();
  const dr = await mkDriver();
  const v1 = await mkVehicle();
  const v2 = await mkVehicle();
  const a0 = (await allot(v1._id, dr._id)).body.data;
  const r = await call(`/vehicle-allotments/${a0._id}/change-vehicle`, "POST", { vehicleId: v2._id, reason: "breakdown" }, t);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const n = await alt(r.body.data._id);
  assert.deepEqual([String(n.activeDriver), n.driverNumber, n.vehicleNo], [dr._id, dr.driverNumber, v2.vehicleNo]);
  assert.equal((await alt(a0._id)).status, "CHANGED");
  assert.equal((await alt(a0._id)).activeDriver, undefined); // only one allotment holds the driver
  const dd = await drv(dr._id);
  assert.equal(dd.availability.status, "IN_USE");
  assert.equal(String(dd.availability.project.allotment), String(n._id));
  assert.equal(dd.availability.project.vehicleNo, v2.vehicleNo);
  assert.equal((await call(`/vehicle-allotments/${n._id}/release`, "POST", {}, t)).status, 200); // and releasing the new allotment frees the driver
  assert.equal((await drv(dr._id)).availability.status, "AVAILABLE");
});

// ================================================================== Driver Management interplay + regression
test("Driver Management: a driver held by an allotment cannot have its availability edited there; other edits still work", async () => {
  const t = await rbp();
  const dr = await mkDriver();
  const a0 = (await allot((await mkVehicle())._id, dr._id)).body.data;
  const cur = (await call(`/drivers/${dr._id}`, "GET", undefined, t)).body.data;
  const blocked = await call(`/drivers/${dr._id}`, "PUT", { driverName: cur.driverName, driverType: cur.driverType, mobileNumber: cur.mobileNumber, availability: { status: "AVAILABLE" } }, t);
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.message, /Vehicle Allotment/);
  assert.equal((await drv(dr._id)).availability.status, "IN_USE");
  const rename = await call(`/drivers/${dr._id}`, "PUT", { driverName: "Renamed Rajan", driverType: cur.driverType, mobileNumber: cur.mobileNumber }, t);
  assert.equal(rename.status, 200, JSON.stringify(rename.body));
  assert.equal((await drv(dr._id)).availability.status, "IN_USE");
  await call(`/vehicle-allotments/${a0._id}/release`, "POST", {}, t);
  const free = await call(`/drivers/${dr._id}`, "PUT", { driverName: "Renamed Rajan", driverType: cur.driverType, mobileNumber: cur.mobileNumber, availability: { status: "NOT_AVAILABLE", notAvailable: { reason: "Leave", category: "Personal Leave" } } }, t);
  assert.equal(free.status, 200, JSON.stringify(free.body)); // after release the normal rules apply again
});

test("regression: allotment list / projects / vehicles / existing endpoints keep their envelope; the vehicle form flow is unaffected", async () => {
  const t = await rbp();
  for (const p of ["/vehicle-allotments", "/vehicle-allotments/projects", "/vehicle-allotments/vehicles", "/vehicles", "/drivers", "/vehicle-allotments/drivers"]) {
    const r = await call(p, "GET", undefined, t);
    assert.equal(r.status, 200, p);
    assert.deepEqual(keys(r.body), ["data", "message", "success"], p);
  }
  const bad = await call("/vehicle-allotments", "POST", {}, t);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.data, null);
  // vehicle form: moving a vehicle In Use through Vehicle Management still creates its (driver-less) allotment and releasing it works
  const v = await mkVehicle();
  const tv = proj.vehicles[pn++];
  const put = await call(`/vehicles/${v._id}`, "PUT", {
    vehicleNo: v.vehicleNo, make: v.make, model: v.model, type: v.type, yearOfManufacture: v.yearOfManufacture, purchaseDate: v.purchaseDate, currentRunning: 1, totalRunning: 2,
    fc: [], insurance: [], rtoPermission: [], policePermission: [], permit: [],
    availability: { status: "IN_USE", project: { trackupNumber: tv.trackupNumber }, expectedReleaseDate: d(3), expectedReleaseTime: "20:00", nextAvailableDate: d(4), nextAvailableTime: "09:00" },
  }, t);
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const al = await VehicleAllotment.findOne({ vehicle: v._id, status: "ACTIVE" }).lean() as any;
  assert.ok(al);
  assert.equal(al.driver, undefined);
  assert.equal(al.source, "VEHICLE_FORM");
  assert.equal((await call(`/vehicle-allotments/${al._id}/assign-driver`, "POST", { driverId: (await mkDriver())._id }, t)).status, 200); // a driver can be added to it later
});

test("cleanup", async () => {
  assert.match(mongoose.connection.name, /_test_/);
  await mongoose.connection.dropDatabase();
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
});
