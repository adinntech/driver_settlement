/* eslint-disable @typescript-eslint/no-explicit-any */
// One Trackup per vehicle type, one PIF per vehicle: creation, legacy index migration and vehicle-wise allocation. Own test database.
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_shared_trackup";
process.env.JWT_SECRET = "test-secret";

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
const { addDaysYmd, todayIst } = await import("../src/utils/dates.js");
const { connectDB } = await import("../src/db/connect.js");
const { migrateIndexes } = await import("../src/db/migrations.js");
const { createTracking, listTracking, loadProject, trackingStats } = await import("../src/services/tracking.service.js");
const { allocationConflict, resolveApprovedProject } = await import("../src/services/availability.service.js");
const { TrackingVehicle } = await import("../src/models/TrackingVehicle.js");
const { Vehicle } = await import("../src/models/Vehicle.js");
const { Budget } = await import("../src/models/Budget.js");
const { allotVehicle, changeVehicle, releaseAllotment, listAllotments } = await import("../src/services/allotment.service.js");
const { VehicleAllotment } = await import("../src/models/VehicleAllotment.js");

const legacyProject = new mongoose.Types.ObjectId();
before(async () => {
  // the old state is built on a separate connection, so no model index is built before connectDB()
  const old = await mongoose.createConnection(process.env.MONGO_URI!).asPromise();
  assert.match(old.name, /_test/, "refusing to drop a non-test database");
  for (const c of await old.db!.listCollections().toArray()) await old.db!.dropCollection(c.name);
  // a database as the previous version left it: unique Trackup / Display indexes and per-vehicle numbers
  const tv = old.collection("trackingvehicles");
  await tv.createIndex({ trackupNumber: 1 }, { unique: true });
  await tv.createIndex({ displayNumber: 1 }, { unique: true });
  await tv.insertOne({ project: legacyProject, vehicleIndex: 1, trackupNumber: "JS-10001/2025-26", pifNumber: "PIF-10001", displayNumber: "1001" });
  await old.collection("trackingprojects").insertOne({ _id: legacyProject, projectType: "SIGNAGE", clientName: "Old Co", vehicleCount: 1, details: {}, createdAt: new Date() });
  await old.collection("vehicles").createIndex({ "availability.project.trackupNumber": 1 }, { unique: true, partialFilterExpression: { "availability.status": "IN_USE" } });
  await old.close();
  await connectDB(); // runs the migration
  assert.match(mongoose.connection.name, /_test/, "refusing to drop a non-test database");
  await Promise.all([TrackingVehicle.init(), Vehicle.init()]);
});
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const actor = { id: String(new mongoose.Types.ObjectId()), username: "RSOP" };
const day = (n: number) => addDaysYmd(todayIst(), n);
const signage = (code: string, vehicleTypes: { code: string; quantity: number }[]) => ({
  projectCode: code, date: day(0), client: "DALMIA", jobSheetNumber: "J1", location: "RAMNAD", vehicleTypes,
  numberOfVehicles: vehicleTypes.reduce((s, t) => s + t.quantity, 0), fromDate: day(0), toDate: day(1),
});
const create = async (code: string, types: [string, number][]): Promise<any> =>
  createTracking(actor, { projectType: "SIGNAGE", details: signage(code, types.map(([c, quantity]) => ({ code: c, quantity }))) });
const trackupsByType = (p: any) => {
  const out: Record<string, Set<string>> = {};
  for (const v of p.vehicles) (out[v.vehicleTypeCode] ??= new Set()).add(v.trackupNumber);
  return out;
};

test("2 + 5 + 3 vehicles: one Trackup per type, ten PIF numbers, no display number", async () => {
  const p = await create("44000001", [["CENTRE_NO_ROOF", 2], ["CENTRE_TRIANGLE_ROOF", 5], ["TATA_ACE_9FT_2S_LED", 3]]);
  const by = trackupsByType(p);
  assert.deepEqual(Object.values(by).map((s) => s.size), [1, 1, 1]);
  assert.equal(new Set(p.vehicles.map((v: any) => v.trackupNumber)).size, 3);
  assert.equal(new Set(p.vehicles.map((v: any) => v.pifNumber)).size, 10);
  assert.ok(p.vehicles.every((v: any) => !("displayNumber" in v)));

  // more vehicles under the same Project Code keep the type's Trackup; a new type and another code get new ones
  const more = await create("44000001", [["CENTRE_NO_ROOF", 1], ["L_BOX_ROOF", 1]]);
  assert.equal(more.vehicles[0].trackupNumber, [...by.CENTRE_NO_ROOF][0]);
  assert.ok(!p.vehicles.some((v: any) => v.trackupNumber === more.vehicles[1].trackupNumber));
  const other = await create("44000002", [["CENTRE_NO_ROOF", 1]]);
  assert.notEqual(other.vehicles[0].trackupNumber, more.vehicles[0].trackupNumber);

  assert.equal((await listTracking({ q: more.vehicles[0].trackupNumber }) as any[]).length, 2);
  const recent = (await trackingStats()).recent.map((r: any) => r.trackupNumber);
  assert.equal(new Set(recent).size, recent.length);
});

test("simultaneous requests under one Project Code share the Trackup", async () => {
  const all = await Promise.all(Array.from({ length: 6 }, () => create("44000003", [["CENTRE_NO_ROOF", 2]])));
  assert.equal(new Set(all.flatMap((p) => p.vehicles.map((v: any) => v.trackupNumber))).size, 1);
  assert.equal(new Set(all.flatMap((p) => p.vehicles.map((v: any) => v.pifNumber))).size, 12);
});

test("legacy records keep their numbers, stay readable without the display number, and the migration can run again", async () => {
  const old: any = await loadProject(String(legacyProject));
  assert.equal(old.vehicles[0].trackupNumber, "JS-10001/2025-26");
  assert.equal("displayNumber" in old.vehicles[0], false);
  assert.equal((await mongoose.connection.collection("trackingvehicles").findOne({ pifNumber: "PIF-10001" }))?.displayNumber, "1001"); // stored data untouched
  await migrateIndexes(process.env.MONGO_URI!);
  const names = (await TrackingVehicle.collection.indexes()).map((i) => `${i.name}:${!!i.unique}`);
  assert.ok(names.includes("trackupNumber_1:false") && names.includes("pifNumber_1:true") && !names.some((n) => n.startsWith("displayNumber")), String(names));
});

test("allocation is per vehicle: the PIF picks it; a shared Trackup alone is ambiguous", async () => {
  const p = await create("44000004", [["CENTRE_NO_ROOF", 2]]);
  const [a, b] = p.vehicles;
  for (const [i, v] of p.vehicles.entries())
    await Budget.collection.insertOne({ vehicle: v._id, project: p._id, budgetNumber: `B-${i}`, approvalStatus: "APPROVED", approvedVersion: 1, currentVersion: 1 });

  assert.match(((await resolveApprovedProject(a.trackupNumber, "")) as any).error, /covers several vehicles/);
  assert.equal(String(((await resolveApprovedProject(a.trackupNumber, b.pifNumber)) as any).tv._id), String(b._id));
  assert.equal(String(((await resolveApprovedProject("", a.pifNumber)) as any).tv._id), String(a._id));
  assert.match(((await resolveApprovedProject("JS-10001/2025-26", a.pifNumber)) as any).error, /do not belong/);

  const use = (v: any, vehicleNo: string) => Vehicle.collection.insertOne({ vehicleNo, availability: { status: "IN_USE", project: { trackupNumber: v.trackupNumber, pifNumber: v.pifNumber } } });
  await use(a, "TN01AA0001");
  await use(b, "TN01AA0002"); // same Trackup, different PIF: allowed
  await assert.rejects(use(a, "TN01AA0003"), /E11000/);
  assert.match((await allocationConflict(a.pifNumber))!, /TN01AA0001/);
});

test("vehicles sharing a Trackup are allotted, changed and released independently", async () => {
  const p = await create("44000005", [["CENTRE_TRIANGLE_ROOF", 2]]);
  const [a, b] = p.vehicles;
  assert.equal(a.trackupNumber, b.trackupNumber);
  for (const [i, v] of p.vehicles.entries())
    await Budget.collection.insertOne({ vehicle: v._id, project: p._id, budgetNumber: `B-L${i}`, total: 1, approvalStatus: "APPROVED", approvedVersion: 1, currentVersion: 1 });
  const ids: string[] = [];
  for (const vehicleNo of ["TN02BB0001", "TN02BB0002", "TN02BB0003"])
    ids.push(String((await Vehicle.collection.insertOne({ vehicleNo, status: "ACTIVE", revision: 1, availability: { status: "AVAILABLE" } })).insertedId));
  const schedule = { expectedReleaseDate: day(2), expectedReleaseTime: "20:00", nextAvailableDate: day(3), nextAvailableTime: "09:00" };

  const first: any = await allotVehicle({ vehicleId: ids[0], pifNumber: a.pifNumber, ...schedule }, "RBP");
  const second: any = await allotVehicle({ vehicleId: ids[1], pifNumber: b.pifNumber, ...schedule }, "RBP");
  assert.equal(first.trackupNumber, second.trackupNumber);
  await assert.rejects(allotVehicle({ vehicleId: ids[2], pifNumber: a.pifNumber, ...schedule }, "RBP"), /already allotted/);
  await assert.rejects(allotVehicle({ vehicleId: ids[2], trackupNumber: a.trackupNumber, ...schedule }, "RBP"), /covers several vehicles/);

  const changed: any = await changeVehicle(String(first._id), { vehicleId: ids[2], reason: "Breakdown" }, "RBP");
  assert.equal(changed.pifNumber, a.pifNumber);
  await releaseAllotment(String(changed._id), {}, "RBP");

  const state = async (id: string) => ((await Vehicle.findById(id).lean()) as any).availability;
  assert.equal((await state(ids[2])).status, "AVAILABLE");
  assert.equal((await state(ids[1])).status, "IN_USE"); // the sibling on the same Trackup is untouched
  assert.equal((await state(ids[1])).project.pifNumber, b.pifNumber);
  assert.equal(((await VehicleAllotment.findById(second._id).lean()) as any).status, "ACTIVE");
  assert.equal((await listAllotments({ trackupNumber: a.trackupNumber })).total, 3);
  assert.equal((await listAllotments({ pifNumber: b.pifNumber })).total, 1);
});
