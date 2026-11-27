/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_dev_seed";
process.env.JWT_SECRET = "test-secret";
process.env.RSOP_USERNAME = "RSOP";
process.env.RSOP_PASSWORD = "pass2";
process.env.RBP_USERNAME = "RBP";
process.env.RBP_PASSWORD = "123123";
process.env.RSOM_USERNAME = "RSOM";
process.env.RSOM_PASSWORD = "pass3";
process.env.RSA_USERNAME = "RSA";
process.env.RSA_PASSWORD = "pass4";
process.env.STORAGE_TYPE = "local";

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import mongoose from "mongoose";

// SAFETY: modules are imported dynamically after the config points at the throw-away test database and a throw-away upload folder.
const { config: cfg } = await import("../src/config/index.js");
const TEST_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_dev_seed";
cfg.mongoUri = TEST_URI;
cfg.env = "test";
cfg.storage.type = "local";
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-devseed-test-"));
cfg.storage.localDir = storageDir;
const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { User } = await import("../src/models/User.js");
const { TrackingProject } = await import("../src/models/TrackingProject.js");
const { Driver } = await import("../src/models/Driver.js");
const { Vehicle } = await import("../src/models/Vehicle.js");
const { VehicleAllotment } = await import("../src/models/VehicleAllotment.js");
const { assertDevOnly, mongoHosts, seedDevData, makePng } = await import("../src/seed/devSeed.js");
const { verifyDevSeed } = await import("../src/seed/devSeed.verify.js");
const { PROJECTS, DRIVERS, VEHICLES } = await import("../src/seed/devSeed.data.js");

let server: Server;
let base = "";
const creds = {
  RSOP: { username: "RSOP", password: "pass2" }, RBP: { username: "RBP", password: "123123" },
  RSOM: { username: "RSOM", password: "pass3" }, RSA: { username: "RSA", password: "pass4" },
};

before(async () => {
  await connectDB();
  assert.match(mongoose.connection.name, /_test_/, "refusing to drop a non-test database");
  await mongoose.connection.dropDatabase();
  await seedUsers();
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});

after(async () => {
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  fs.rmSync(storageDir, { recursive: true, force: true });
});

test("the seed refuses to run outside a local development setup", () => {
  const keep = { env: cfg.env, uri: cfg.mongoUri, storage: cfg.storage.type };
  try {
    cfg.env = "production";
    assert.throws(() => assertDevOnly(), /NODE_ENV is "production"/);
    cfg.env = "staging";
    assert.throws(() => assertDevOnly(), /NODE_ENV is "staging"/);
    cfg.env = "test";
    cfg.mongoUri = "mongodb+srv://user:secret@cluster0.example.mongodb.net/driver_settlement";
    assert.throws(() => assertDevOnly(), /does not point at a local MongoDB/);
    cfg.mongoUri = "mongodb://db.internal.example.com:27017/driver_settlement";
    assert.throws(() => assertDevOnly(), /does not point at a local MongoDB/);
    cfg.mongoUri = keep.uri;
    cfg.storage.type = "space";
    assert.throws(() => assertDevOnly(), /STORAGE_TYPE/);
    cfg.storage.type = "local";
    assert.doesNotThrow(() => assertDevOnly());
  } finally {
    cfg.env = keep.env;
    cfg.mongoUri = keep.uri;
    cfg.storage.type = keep.storage;
  }
  assert.deepEqual(mongoHosts("mongodb://u:p@127.0.0.1:27017,localhost:27018/db?x=1"), ["127.0.0.1", "localhost"]);
  assert.equal(mongoHosts("mongodb+srv://c.example.net/db"), null);
});

test("the generated delivery photo is a valid PNG", () => {
  const png = makePng(32, 20, [10, 20, 30]);
  assert.equal(png.subarray(1, 4).toString("latin1"), "PNG");
  assert.equal(png.readUInt32BE(16), 32); // IHDR width
  assert.equal(png.readUInt32BE(20), 20); // IHDR height
});

test("seeding twice creates the data once, and never touches existing users or records", async () => {
  // pre-existing data that the seed must leave alone
  const rsopBefore: any = await User.findOne({ username: "RSOP" }).select("+passwordHash").lean();
  const userCountBefore = await User.countDocuments();
  const own = await TrackingProject.create({
    projectType: "SIGNAGE", clientName: "Pre-existing Client", vehicleCount: 1, details: { client: "Pre-existing Client" }, createdBy: rsopBefore._id, createdByName: "RSOP",
  });
  const ownDriver = await Driver.create({ driverNumber: "DR-0001", driverName: "Existing Driver", driverType: "COMPANY_DRIVER", mobileNumber: "+91 9000000001", mobileDigits: "9000000001", createdBy: "RBP", updatedBy: "RBP" });

  const first = await seedDevData();
  assert.equal(first.created.projects, 10);
  assert.equal(first.created.drivers, DRIVERS.length);
  assert.equal(first.created.vehicles, VEHICLES.length);
  assert.equal(first.vehicles.length, PROJECTS.reduce((s, p) => s + p.vehicles.length, 0));
  assert.ok(first.created.deliveries === 3 && first.created.rsaPayments === 11 && first.created.driverAdvances === 6);

  const counts = async () => ({
    projects: await TrackingProject.countDocuments(), drivers: await Driver.countDocuments(), vehicles: await Vehicle.countDocuments(),
    allotments: await VehicleAllotment.countDocuments(), payments: await mongoose.connection.collection("rsapayments").countDocuments(),
    clearances: await mongoose.connection.collection("clearances").countDocuments(), budgets: await mongoose.connection.collection("budgets").countDocuments(),
    notifications: await mongoose.connection.collection("notifications").countDocuments(), events: await mongoose.connection.collection("clearanceevents").countDocuments(),
    files: fs.readdirSync(path.join(storageDir, "driver_settlement", "vehicles", String(new Date().getUTCFullYear()))).length,
  });
  const afterFirst = await counts();
  const second = await seedDevData();
  assert.deepEqual(second.created, {}, "the second run must create nothing");
  assert.deepEqual(await counts(), afterFirst, "the second run must not change any collection or upload any file");

  // existing users and records are untouched
  assert.equal(await User.countDocuments(), userCountBefore);
  const rsopAfter: any = await User.findOne({ username: "RSOP" }).select("+passwordHash").lean();
  assert.equal(rsopAfter.passwordHash, rsopBefore.passwordHash);
  assert.equal((await TrackingProject.findById(own._id).lean() as any).clientName, "Pre-existing Client");
  assert.equal((await Driver.findById(ownDriver._id).lean() as any).driverName, "Existing Driver");
});

test("all four logins see all 10 projects, and the data is internally consistent", async () => {
  const r = await verifyDevSeed(base, creds);
  assert.deepEqual(r.failed, []);
  assert.ok(r.checks.length > 300);
  for (const p of PROJECTS) for (const role of ["RSOP", "RBP", "RSOM", "RSA"] as const) assert.ok(r.visibility[p.key][role] > 0, `${role} cannot see ${p.key}`);
});

test("a run that stopped part-way is completed by the next run", async () => {
  // simulate an interruption after the allotment / clearance stages: the RSA payments (the last step) are missing
  await mongoose.connection.collection("rsapayments").deleteMany({});
  const resumed = await seedDevData();
  assert.deepEqual(resumed.created, { rsaPayments: 11 }, "only the missing payments are created");
  const r = await verifyDevSeed(base, creds);
  assert.deepEqual(r.failed, []);
});
