/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_rso_env";
process.env.JWT_SECRET = "test-secret";
for (const [r, p] of [["RSOP", "p1"], ["RBP", "p2"], ["RSOM", "p3"], ["RSA", "p4"], ["RSO", "first-Pass#1"]]) {
  process.env[`${r}_USERNAME`] = r === "RSO" ? "rso.first" : r;
  process.env[`${r}_PASSWORD`] = p;
}

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import mongoose from "mongoose";

const { config: cfg } = await import("../src/config/index.js");
cfg.mongoUri = process.env.MONGO_URI!;
const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers, syncEnvUser } = await import("../src/services/auth.service.js");
const { User } = await import("../src/models/User.js");

let server: Server;
let base = "";
const login = async (role: string, username: string, password: string) => {
  const r = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, username, password }) });
  return { status: r.status, body: (await r.json()) as any, raw: "" };
};
/** what a restart does: .env is read again (simulated by changing the loaded config) and startup syncs the users */
const restartWith = async (username: string, password: string) => {
  const rso = cfg.seedUsers.find((s) => s.role === "RSO")!;
  rso.username = username;
  rso.password = password;
  await seedUsers();
};
const otherHashes = async () => Object.fromEntries((await User.find({ role: { $ne: "RSO" } }).select("+passwordHash username role").lean()).map((u: any) => [u.role, `${u.username}:${u.passwordHash}`]));

before(async () => {
  await connectDB();
  assert.match(mongoose.connection.name, /_test_/);
  await mongoose.connection.dropDatabase();
  await User.init();
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});
after(async () => {
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test("startup creates the RSO login from RSO_USERNAME / RSO_PASSWORD, with a bcrypt hash only", async () => {
  await seedUsers();
  const u: any = await User.findOne({ role: "RSO" }).select("+passwordHash").lean();
  assert.equal(u.username, "rso.first");
  assert.notEqual(u.passwordHash, "first-Pass#1");
  assert.match(u.passwordHash, /^\$2[aby]\$10\$/, "stored as a bcrypt hash");
  const ok = await login("RSO", "rso.first", "first-Pass#1");
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.user.username, "rso.first");
  assert.ok(!JSON.stringify(ok.body).includes("first-Pass#1") && !JSON.stringify(ok.body).includes(u.passwordHash), "no password / hash in the response");
});

test("changing both variables and restarting: the new credentials log in, the old ones are rejected; other roles untouched", async () => {
  const before = await otherHashes();
  const idBefore = String(((await User.findOne({ role: "RSO" }).lean()) as any)._id);
  await restartWith("rso.second", "second-Pass#2");

  const fresh = await login("RSO", "rso.second", "second-Pass#2");
  assert.equal(fresh.status, 200, "new username + new password work");
  assert.equal((await login("RSO", "rso.first", "first-Pass#1")).status, 401, "old username + old password rejected");
  assert.equal((await login("RSO", "rso.second", "first-Pass#1")).status, 401, "old password rejected");
  assert.equal((await login("RSO", "rso.first", "second-Pass#2")).status, 401, "old username rejected");

  assert.equal(await User.countDocuments({ role: "RSO" }), 1, "the same account was updated, not duplicated");
  assert.equal(String(((await User.findOne({ role: "RSO" }).lean()) as any)._id), idBefore);
  assert.deepEqual(await otherHashes(), before, "RSOP, RBP, RSOM and RSA logins are unchanged");
  for (const r of ["RSOP", "RBP", "RSOM", "RSA"]) assert.equal((await login(r, r, cfg.seedUsers.find((s) => s.role === r)!.password!)).status, 200, `${r} still logs in`);
});

test("only the password changed: same account, new password works, old one rejected", async () => {
  await restartWith("rso.second", "third-Pass#3");
  assert.equal((await login("RSO", "rso.second", "third-Pass#3")).status, 200);
  assert.equal((await login("RSO", "rso.second", "second-Pass#2")).status, 401);
});

test("a restart with unchanged values changes nothing (no re-hash)", async () => {
  const h1 = ((await User.findOne({ role: "RSO" }).select("+passwordHash").lean()) as any).passwordHash;
  assert.equal(await syncEnvUser("RSO", "rso.second", "third-Pass#3"), "unchanged");
  const h2 = ((await User.findOne({ role: "RSO" }).select("+passwordHash").lean()) as any).passwordHash;
  assert.equal(h1, h2);
});

test("a username that belongs to another role is refused and nothing changes", async () => {
  assert.equal(await syncEnvUser("RSO", "RBP", "whatever-1"), "skipped");
  assert.equal(((await User.findOne({ role: "RSO" }).lean()) as any).username, "rso.second");
  assert.equal((await login("RBP", "RBP", "p2")).status, 200, "the RBP login is not touched");
  assert.equal(await syncEnvUser("RSO", "", "x"), "skipped", "missing values never wipe the login");
});

test("the login screen prefills the RSO username from .env (never a hardcoded value, never the password)", async () => {
  const r = (await (await fetch(`${base}/auth/roles`)).json()) as any;
  assert.equal(r.data.RSO.defaultUsername, "rso.second");
  assert.ok(!JSON.stringify(r).includes("third-Pass#3"));
  assert.equal(r.data.RSOM.defaultUsername, "RSOM", "other roles keep their own defaults");
});
