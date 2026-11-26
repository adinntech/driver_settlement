/* eslint-disable @typescript-eslint/no-explicit-any */
// Project Code: validation and grouping rules. Runs against its own test database; never the real one.
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_project_code";
process.env.JWT_SECRET = "test-secret";
process.env.RSOP_USERNAME = "RSOP";
process.env.RSOP_PASSWORD = "pass2";
process.env.RBP_USERNAME = "RBP";
process.env.RBP_PASSWORD = "123123";

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import mongoose from "mongoose";

const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { User } = await import("../src/models/User.js");
const { TrackingVehicle } = await import("../src/models/TrackingVehicle.js");
const { TrackingProject } = await import("../src/models/TrackingProject.js");
const { validateTracking } = await import("../src/validators/tracking.validator.js");

let server: Server;
let base = "";
before(async () => {
  await connectDB();
  await mongoose.connection.dropDatabase();
  await Promise.all([User.init(), TrackingVehicle.init(), TrackingProject.init()]);
  await seedUsers();
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});
after(async () => {
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const call = async (path: string, method = "GET", body?: unknown, token?: string) => {
  const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json()) as { success: boolean; message: string; data: any } };
};
let rsop = "";
const token = async () => (rsop ||= (await call("/auth/login", "POST", { role: "RSOP", username: "RSOP", password: "pass2" })).body.data.token);
const signage = (code: unknown, client = "DALMIA", n = 1) => ({ projectCode: code, date: "2026-10-20", client, jobSheetNumber: "J1", location: "RAMNAD", numberOfVehicles: n, fromDate: "2026-10-21", toDate: "2026-10-26" });
const roadshow = (code: unknown, client = "DALMIA", n = 1) => ({ projectCode: code, billingName: client, stateCode: "33", numberOfVans: n, startDate: "2027-10-22", endDate: "2027-10-23", reportingDate: "2027-10-22", sundayHalt: "NO", reportingLocations: ["Madurai"] });
const post = async (projectType: string, details: unknown) => call("/tracking", "POST", { projectType, details }, await token());

test("validation: exactly 8 digits, both project types (frontend uses the same rule)", () => {
  for (const type of ["ROADSHOW", "SIGNAGE"]) {
    const mk = type === "ROADSHOW" ? roadshow : signage;
    const errs = (code: unknown) => validateTracking(type, mk(code), { allowPastStart: true }).errors;
    assert.ok(!errs("12345678").some((e) => /Project Code/.test(e)), type);
    assert.ok(!errs("00001234").some((e) => /Project Code/.test(e)), "leading zeros are kept");
    assert.equal(validateTracking(type, mk("00001234"), { allowPastStart: true }).details.projectCode, "00001234");
    assert.ok(errs(undefined).includes("Project Code is required"));
    assert.ok(errs("").includes("Project Code is required"));
    for (const bad of ["1234567", "123456789", "1234567a", "ABCDEFGH", "1234-678", "1234 678", "１２３４５６７８", 12345678, "+1234567", "1.234567"])
      assert.ok(errs(bad).includes("Project Code must be exactly 8 digits (0-9 only)"), `${type} ${JSON.stringify(bad)}`);
  }
});

test("API rejects invalid codes; a valid request with N vehicles creates N individual numbers under the code", async () => {
  assert.equal((await post("SIGNAGE", signage("12AB5678"))).status, 400);
  assert.equal((await post("ROADSHOW", roadshow("123"))).status, 400);
  const r = await post("ROADSHOW", roadshow("12345678", "Sapphire Foods", 10));
  assert.equal(r.status, 201, r.body.message);
  assert.equal(r.body.data.projectCode, "12345678");
  assert.equal(r.body.data.details.projectCode, "12345678");
  assert.equal(r.body.data.vehicles.length, 10);
  const nums = r.body.data.vehicles.flatMap((v: any) => [v.trackupNumber, v.pifNumber, v.displayNumber]);
  assert.equal(new Set(nums).size, 30); // every vehicle keeps its own Trackup, PIF and Display numbers
});

test("duplicate code: same client adds another request to the project; another client is rejected; types are separate", async () => {
  const again = await post("ROADSHOW", roadshow("12345678", "  sapphire   FOODS ", 2)); // same client (case / spaces ignored)
  assert.equal(again.status, 201, again.body.message);
  const clash = await post("ROADSHOW", roadshow("12345678", "Other Client"));
  assert.equal(clash.status, 409);
  assert.match(clash.body.message, /Project Code 12345678 is already used by the Roadshow project of Sapphire Foods/);
  const signageSameCode = await post("SIGNAGE", signage("12345678", "Other Client")); // signage codes are independent
  assert.equal(signageSameCode.status, 201, signageSameCode.body.message);
  assert.equal(await TrackingProject.countDocuments({ projectCode: "12345678", projectType: "ROADSHOW" }), 2);
  assert.equal(await TrackingVehicle.countDocuments({ project: { $in: (await TrackingProject.find({ projectCode: "12345678", projectType: "ROADSHOW" })).map((p: any) => p._id) } }), 12);
});

test("simultaneous requests of two clients with one new code: exactly one keeps it", async () => {
  const [a, b] = await Promise.all([post("SIGNAGE", signage("87654321", "Alpha")), post("SIGNAGE", signage("87654321", "Beta"))]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  const kept = await TrackingProject.find({ projectType: "SIGNAGE", projectCode: "87654321" }).lean();
  assert.equal(new Set(kept.map((p: any) => p.clientName)).size, 1);
  assert.equal(await TrackingVehicle.countDocuments({ project: { $nin: (await TrackingProject.find().lean()).map((p: any) => p._id) } }), 0); // no orphan numbers
});

test("listing: projectCode returned, search by code, legacy requests without a code still listed", async () => {
  const legacy = await TrackingProject.create({ projectType: "SIGNAGE", clientName: "Old Client", vehicleCount: 1, details: { client: "Old Client" }, createdBy: new mongoose.Types.ObjectId(), createdByName: "RSOP" });
  const all = (await call("/tracking", "GET", undefined, await token())).body.data;
  assert.ok(all.some((p: any) => String(p._id) === String(legacy._id) && p.projectCode === undefined));
  const hits = (await call("/tracking?q=1234567", "GET", undefined, await token())).body.data;
  assert.ok(hits.length >= 3 && hits.every((p: any) => p.projectCode === "12345678"));
  const typed = (await call("/tracking?q=12345678&projectType=SIGNAGE", "GET", undefined, await token())).body.data;
  assert.deepEqual(typed.map((p: any) => p.projectType), ["SIGNAGE"]);
});
