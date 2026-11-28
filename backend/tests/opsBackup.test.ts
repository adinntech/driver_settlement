/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_backup";
process.env.JWT_SECRET = "test-secret";
process.env.STORAGE_TYPE = "local";
process.env.BACKUP_ENABLED = "false";
process.env.HEALTH_MONITOR_ENABLED = "false";
process.env.GOOGLE_CHAT_WEBHOOK_URL = "";

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";

const B = await import("../src/services/backup.service.js");
const H = await import("../src/services/serverHealth.service.js");
const S = await import("../src/jobs/opsScheduler.js");
const G = await import("../src/services/googleChat.service.js");

const NOW = new Date("2026-11-28T12:30:05Z"); // 28-Nov-2026 18:00:05 IST

// ---------------------------------------------------------------- pure
test("file names, Space key and slots use IST", () => {
  assert.equal(B.backupFileName(NOW), "driver-settlement-20261128-180005.json.gz");
  assert.equal(B.backupKey(NOW), "driver_settlement/database-backups/2026-11-28/driver-settlement-20261128-180005.json.gz");
  assert.equal(B.backupTimeOf("driver-settlement-20261128-180005.json.gz")?.getTime(), NOW.getTime());
  assert.equal(B.backupTimeOf("other-20261128-180005.json.gz"), null);
  assert.equal(B.istDisplay(NOW), "28-Nov-2026 18:00 IST");
  assert.equal(S.currentSlot(NOW), "2026-11-28T18:00");
  assert.equal(S.currentSlot(new Date("2026-11-28T18:29:00Z")), "2026-11-28T18:00"); // 23:59 IST
  assert.equal(S.currentSlot(new Date("2026-11-28T18:30:00Z")), "2026-11-29T00:00"); // midnight IST
  assert.equal(S.currentSlot(new Date("2026-11-29T00:29:59Z")), "2026-11-29T00:00");
  assert.equal(S.currentSlot(new Date("2026-11-29T00:30:00Z")), "2026-11-29T06:00");
});

test("secrets are masked in Google Chat text", () => {
  const s = G.maskSecrets("failed mongodb://u:p@host:27017/db and https://chat.googleapis.com/v1/spaces/X/messages?key=abc and https://u:p@x.io");
  assert.doesNotMatch(s, /u:p|key=abc/);
});

test("alert tracker: new, still active (repeat), resolved", () => {
  const t = new H.AlertTracker(60 * 60_000, "srv");
  const ok = { key: "mongo", name: "MongoDB", level: "ok" as const, detail: "connected" };
  const bad = { key: "mongo", name: "MongoDB", level: "critical" as const, detail: "not connected" };
  const disk = { key: "disk", name: "Disk", level: "warning" as const, detail: "8% free" };
  assert.equal(t.update([ok], NOW), null);
  const first = t.update([bad], NOW)!;
  assert.match(first, /ADINN SERVER ALERT — CRITICAL/);
  assert.match(first, /Detected: 28-Nov-2026 18:00 IST/);
  assert.match(first, /🔴 MongoDB\n/);
  assert.match(first, /No automatic changes were made\./);
  assert.equal(t.update([bad], new Date(NOW.getTime() + 5 * 60_000)), null); // no repeat within the hour
  const more = t.update([bad, disk], new Date(NOW.getTime() + 10 * 60_000))!; // a new problem is sent at once
  assert.match(more, /🔴 MongoDB \(still active\)/);
  assert.match(more, /🟡 Disk\n/);
  assert.match(t.update([bad, disk], new Date(NOW.getTime() + 71 * 60_000))!, /Disk \(still active\)/);
  const partial = t.update([bad, { ...disk, level: "ok" }], new Date(NOW.getTime() + 75 * 60_000))!;
  assert.match(partial, /✅ Resolved: Disk/);
  const done = t.update([ok], new Date(NOW.getTime() + 80 * 60_000))!;
  assert.match(done, /RESOLVED/);
  assert.match(done, /MongoDB: OK now/);
  assert.equal(t.update([ok], new Date(NOW.getTime() + 85 * 60_000)), null);
});

// ---------------------------------------------------------------- database
function fakeSpace(existing: string[]) {
  const calls: any[] = [];
  const client = {
    async send(cmd: any) {
      calls.push(cmd);
      const name = cmd.constructor.name;
      if (name === "ListObjectsV2Command") return { Contents: existing.map((Key) => ({ Key })), IsTruncated: false };
      if (name === "HeadBucketCommand") return {};
      return {};
    },
  };
  return { client, bucket: "adinn-space", calls };
}

test("backup -> Space upload, retention, message, then restore into an empty database", async () => {
  await mongoose.connect(process.env.MONGO_URI!);
  assert.match(mongoose.connection.name, /_test/);
  await mongoose.connection.dropDatabase();
  const restoreDb = mongoose.connection.useDb("driver_settlement_test_backup_restore", { useCache: false });
  assert.match(restoreDb.name, /_test/);
  await restoreDb.dropDatabase();
  const dir = await mkdtemp(path.join(os.tmpdir(), "ds-backup-"));
  try {
    const db = mongoose.connection.db!;
    const id = new mongoose.Types.ObjectId();
    await db.collection("drivers").insertMany([
      { _id: id, name: "Ravi", joined: new Date("2026-01-02T03:04:05Z"), salary: mongoose.Types.Decimal128.fromString("12345.67") },
      { name: "Kumar", tags: ["a", "b"], nested: { n: 1 } },
    ]);
    await db.collection("drivers").createIndex({ name: 1 }, { unique: true });
    await db.collection("users").insertOne({ username: "RSA" });
    await db.createCollection("emptyone");
    // an 8-day-old local copy and an unrelated file
    await writeFile(path.join(dir, "driver-settlement-20261120-120000.json.gz"), "old");
    await writeFile(path.join(dir, "notes.txt"), "keep");

    const old = "driver_settlement/database-backups/2026-11-20/driver-settlement-20261120-120000.json.gz";
    const recent = "driver_settlement/database-backups/2026-11-27/driver-settlement-20261127-180000.json.gz";
    const foreign = "driver_settlement/database-backups/2026-11-01/something-else.json.gz";
    const space = fakeSpace([old, recent, foreign]);
    const r = await B.runBackup({ db, space, localDir: dir, retentionDays: 7, now: () => NOW });

    assert.equal(r.status, "SUCCESS", r.errors.join("; "));
    assert.deepEqual(r.stats?.collections, { drivers: 2, emptyone: 0, users: 1 });
    const put = space.calls.find((c) => c.constructor.name === "PutObjectCommand").input;
    assert.equal(put.Key, "driver_settlement/database-backups/2026-11-28/driver-settlement-20261128-180005.json.gz");
    assert.equal(put.ACL, "private");
    const deleted = space.calls.filter((c) => c.constructor.name === "DeleteObjectCommand").map((c) => c.input.Key);
    assert.deepEqual(deleted, [old]);
    assert.deepEqual((await readdir(dir)).sort(), ["driver-settlement-20261128-180005.json.gz", "notes.txt"]);

    const msg = B.backupMessage(r, "18:00 IST");
    assert.match(msg, /✅ \*Database Backup - Driver Settlement \(18:00 IST\) — SUCCESS\*/);
    assert.match(msg, /Storage: DigitalOcean Spaces \(adinn-space\/driver_settlement\/database-backups\/2026-11-28\/\), 1 old copy\(ies\) removed/);
    assert.match(msg, /Contents: 0 projects · 0 tracking vehicles · 0 vehicles · 2 drivers · 0 settlement payments · 1 users/);
    assert.match(msg, /deleted 2 old backup\(s\)/);

    // no Space keys: local copy kept, reported as PARTIAL
    const local = await B.runBackup({ db, space: null, localDir: dir, now: () => new Date(NOW.getTime() + 1000) });
    assert.equal(local.status, "PARTIAL");
    assert.match(B.backupMessage(local, "manual"), /⚠️ .*PARTIAL[\s\S]*Error: DigitalOcean Spaces keys/);

    const stats = await B.restoreDatabase(r.localPath, restoreDb.db!);
    assert.equal(stats.documents, 3);
    const back = await restoreDb.db!.collection("drivers").find({}, { sort: { _id: 1 } }).toArray();
    const orig = await db.collection("drivers").find({}, { sort: { _id: 1 } }).toArray();
    assert.deepEqual(back, orig);
    assert.ok(back.find((d) => d._id.equals(id))?.salary instanceof mongoose.mongo.Decimal128);
    assert.ok((await restoreDb.db!.collection("drivers").indexes()).some((i) => i.name === "name_1" && i.unique));
    assert.ok((await restoreDb.db!.listCollections({ name: "emptyone" }).toArray()).length === 1);
    await assert.rejects(B.restoreDatabase(r.localPath, restoreDb.db!), /not empty/);

    // health: backup history + fake Space
    await db.collection(H.OPS_RUNS).insertOne({ job: "backup", slot: "2026-11-28T18:00", status: "SUCCESS", finishedAt: NOW, size: r.size });
    const checks = await H.collectHealth({ db, space, backupEnabled: true, urls: [], diskPath: dir, now: new Date(NOW.getTime() + 3600_000) });
    for (const k of ["mongo", "space", "backup", "disk", "memory", "load"]) assert.ok(checks.some((c) => c.key === k), k);
    assert.equal(checks.find((c) => c.key === "backup")?.level, "ok");
    const late = await H.collectHealth({ db, space, backupEnabled: true, urls: [], diskPath: dir, now: new Date(NOW.getTime() + 8 * 3600_000) });
    assert.equal(late.find((c) => c.key === "backup")?.level, "critical");
    assert.match(H.healthReportMessage(checks, NOW, "srv"), /Server: srv\nChecked: 28-Nov-2026 18:00 IST/);

    // slot claim: once per job + slot; a failed backup is retried after 30 minutes, at most 3 attempts
    assert.equal(await S.claimSlot("backup", "2026-11-29T00:00", NOW, true), true);
    assert.equal(await S.claimSlot("backup", "2026-11-29T00:00", NOW, true), false);
    await db.collection(H.OPS_RUNS).updateOne({ job: "backup", slot: "2026-11-29T00:00" }, { $set: { status: "FAILED", finishedAt: NOW } });
    assert.equal(await S.claimSlot("backup", "2026-11-29T00:00", new Date(NOW.getTime() + 10 * 60_000), true), false);
    assert.equal(await S.claimSlot("backup", "2026-11-29T00:00", new Date(NOW.getTime() + 31 * 60_000), true), true);
    assert.equal(await S.claimSlot("health-report", "2026-11-29T00:00", NOW), true);
    assert.equal(await S.claimSlot("health-report", "2026-11-29T00:00", NOW), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await restoreDb.dropDatabase();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
