/* eslint-disable @typescript-eslint/no-explicit-any */
// Requested vehicle types: validation and the RSOP -> budget -> allotment-picker chain. Own test database; never the real one.
process.env.ROADSHOW = "on";
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_vehicle_types";
process.env.JWT_SECRET = "test-secret";

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
const { addDaysYmd, todayIst } = await import("../src/utils/dates.js");
const { connectDB } = await import("../src/db/connect.js");
const { parseVehicleTypes, REQUEST_VEHICLE_TYPES } = await import("../src/utils/vehicleTypes.js");
const { validateTracking } = await import("../src/validators/tracking.validator.js");
const { createTracking, listTracking } = await import("../src/services/tracking.service.js");
const { buildContext } = await import("../src/services/budget.service.js");
const { projectFromTracking } = await import("../src/services/availability.service.js");
const { renameVehicleTypes } = await import("../src/db/vehicleTypeNames.js");
const { TrackingProject } = await import("../src/models/TrackingProject.js");

before(async () => {
  await connectDB();
  assert.match(mongoose.connection.name, /_test/, "refusing to drop a non-test database");
  await mongoose.connection.dropDatabase();
});
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const day = (n: number) => addDaysYmd(todayIst(), n);
const A = "L_TRIANGLE_ROOF", B = "L_NO_ROOF";
const roadshow = (n: number, vehicleTypes: unknown) => ({ projectCode: "22000001", billingName: "KFC", stateCode: "33", numberOfVans: n, vehicleTypes, startDate: day(0), endDate: day(1), reportingDate: day(0), sundayHalt: "NO", reportingLocations: ["Madurai"] });
const signage = (n: number, vehicleTypes: unknown) => ({ projectCode: "22000002", date: day(0), client: "DALMIA", jobSheetNumber: "J1", location: "RAMNAD", numberOfVehicles: n, vehicleTypes, fromDate: day(0), toDate: day(1) });

test("quantities must exactly match the vehicle count (both project types)", () => {
  for (const [type, make] of [["ROADSHOW", roadshow], ["SIGNAGE", signage]] as const) {
    const errs = (v: unknown) => validateTracking(type, make(3, v)).errors;
    assert.deepEqual(errs([{ code: A, quantity: 2 }, { code: B, quantity: 1 }]), [], type);
    assert.deepEqual(errs(undefined), ["Select the vehicle types"]);
    assert.deepEqual(errs([]), ["Select the vehicle types"]);
    assert.match(errs([{ code: A, quantity: 2 }])[0], /must equal/);
    assert.match(errs([{ code: A, quantity: 4 }])[0], /must equal/);
  }
});

test("bad rows are refused; names come from the server; retired codes are refused", () => {
  for (const bad of [[{ code: "X", quantity: 1 }], [{ code: A, quantity: 0 }, { code: B, quantity: 1 }], [{ code: A, quantity: 1.5 }], [{ code: A, quantity: "1" }], [null]])
    assert.equal(parseVehicleTypes(bad, 1).errors.length, 1, JSON.stringify(bad));
  assert.equal(parseVehicleTypes([{ code: "TATA" + "_ACE_8FT", quantity: 1 }], 1).errors.length, 1);
  assert.match(parseVehicleTypes([{ code: A, quantity: 1 }, { code: A, quantity: 1 }], 2).errors[0], /more than once/);
  const r = parseVehicleTypes([{ code: B, quantity: 1, name: "forged" }, { code: A, quantity: 1 }], 2);
  assert.deepEqual(r.items.map((x) => x.code), [A, B]);
  assert.equal(r.items[1].name, "L Model Without Roof");
  assert.equal(REQUEST_VEHICLE_TYPES.length, 9);
});

test("saved per request and per vehicle, including a second request under the same Project Code", async () => {
  const actor = { id: String(new mongoose.Types.ObjectId()), username: "RSOP" };
  const first: any = await createTracking(actor, { projectType: "ROADSHOW", details: roadshow(3, [{ code: "CENTRE_NO_ROOF", quantity: 2 }, { code: B, quantity: 1 }]) });
  assert.deepEqual(first.vehicles.map((v: any) => v.vehicleTypeCode), ["CENTRE_NO_ROOF", "CENTRE_NO_ROOF", B]);
  assert.deepEqual(first.details.vehicleTypes.map((t: any) => [t.code, t.quantity]), [["CENTRE_NO_ROOF", 2], [B, 1]]);
  await createTracking(actor, { projectType: "ROADSHOW", details: roadshow(1, [{ code: "CENTRE_TRIANGLE_ROOF", quantity: 1 }]) });
  const all: any[] = await listTracking({ q: "22000001" });
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((p) => p.vehicles.length).sort(), [1, 3]);

  const tv = first.vehicles[2];
  assert.equal(buildContext(first, tv).vehicleType, tv.vehicleType);
  assert.equal(projectFromTracking(tv, first).vehicleType, tv.vehicleType); // what RBP Vehicle Allotment shows
});

test("each vehicle is listed and budgeted with its own type (Signage)", async () => {
  const actor = { id: String(new mongoose.Types.ObjectId()), username: "RSOP" };
  await createTracking(actor, { projectType: "SIGNAGE", details: signage(2, [{ code: "CENTRE_NO_ROOF", quantity: 1 }, { code: B, quantity: 1 }]) });
  const [p]: any[] = await listTracking({ q: "22000002" });
  const own = ["Centre Portion Without Roof", REQUEST_VEHICLE_TYPES.find((t) => t.code === B)!.name];
  assert.deepEqual(p.vehicles.map((v: any) => v.vehicleType), own);
  assert.deepEqual(p.vehicles.map((v: any) => buildContext(p, v).vehicleType), own);
});

test("saved names of renamed types are updated once; retired types keep theirs", async () => {
  const db = mongoose.connection.db!;
  const code = "TATA_ACE_9FT_2S_LED", before = "Tata Ace 9 Ft 2 Sides LED";
  const types = [{ code, name: before, quantity: 1 }, { code: "RETIRED", name: "Old Van", quantity: 1 }];
  const { insertedId } = await db.collection("trackingprojects").insertOne({ details: { vehicleTypes: types }, renameCheck: true });
  await db.collection("trackingvehicles").insertOne({ vehicleTypeCode: code, vehicleType: before, pifNumber: "PIF-rename" });
  await db.collection("vehicleallotments").insertOne({ requestedVehicleType: before, renameCheck: true });
  await renameVehicleTypes();
  await renameVehicleTypes();
  const p: any = await db.collection("trackingprojects").findOne({ _id: insertedId });
  assert.deepEqual(p.details.vehicleTypes.map((t: any) => t.name), ["2 Sided LED", "Old Van"]);
  assert.equal((await db.collection("trackingvehicles").findOne({ pifNumber: "PIF-rename" }))!.vehicleType, "2 Sided LED");
  assert.equal((await db.collection("vehicleallotments").findOne({ renameCheck: true }))!.requestedVehicleType, "2 Sided LED");
  await Promise.all([db.collection("trackingprojects").deleteOne({ _id: insertedId }), db.collection("trackingvehicles").deleteOne({ pifNumber: "PIF-rename" }), db.collection("vehicleallotments").deleteOne({ renameCheck: true })]);
});

test("a refused selection creates nothing",async () => {
  const count = await TrackingProject.countDocuments();
  await assert.rejects(createTracking({ id: String(new mongoose.Types.ObjectId()), username: "RSOP" }, { projectType: "SIGNAGE", details: signage(2, [{ code: A, quantity: 1 }]) }), /must equal/);
  assert.equal(await TrackingProject.countDocuments(), count);
});
