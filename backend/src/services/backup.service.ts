import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import mongoose from "mongoose";
import { DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "../config/index.js";
import { STORAGE_ROOT } from "./storage.service.js";

/**
 * MongoDB backup without the mongodump binary (the runtime image has none): every collection is written as canonical
 * Extended JSON lines into one gzip file, so every BSON type (ObjectId, Date, Decimal128, ...) restores exactly.
 * Not a point-in-time snapshot (standalone server, no transactions): collections are read one after the other.
 *
 * File: <dir>/driver-settlement-YYYYMMDD-HHmmss.json.gz (IST). Space: driver_settlement/database-backups/YYYY-MM-DD/<file>, private.
 */
type Db = mongoose.mongo.Db;
const { EJSON } = mongoose.mongo.BSON;

export const BACKUP_FORMAT = "driver-settlement-backup";
export const BACKUP_PREFIX = `${STORAGE_ROOT}/database-backups`;
const FILE_RE = /^driver-settlement-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.json\.gz$/;
const REMOTE_KEY_RE = new RegExp(`^${BACKUP_PREFIX}/\\d{4}-\\d{2}-\\d{2}/(driver-settlement-\\d{8}-\\d{6}\\.json\\.gz)$`);

// ---------------------------------------------------------------- IST formatting
const IST_OFFSET_MS = 330 * 60_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const istIso = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString();
/** 2026-11-28 18:00:03 IST */
export const istStamp = (d: Date) => `${istIso(d).slice(0, 10)} ${istIso(d).slice(11, 19)} IST`;
/** 28-Nov-2026 18:00 IST */
export const istDisplay = (d: Date) => {
  const s = istIso(d);
  return `${s.slice(8, 10)}-${MONTHS[Number(s.slice(5, 7)) - 1]}-${s.slice(0, 4)} ${s.slice(11, 16)} IST`;
};

export const backupFileName = (d: Date) => {
  const s = istIso(d);
  return `driver-settlement-${s.slice(0, 10).replace(/-/g, "")}-${s.slice(11, 19).replace(/:/g, "")}.json.gz`;
};
export const backupKey = (d: Date) => `${BACKUP_PREFIX}/${istIso(d).slice(0, 10)}/${backupFileName(d)}`;

/** Time encoded in a backup file name (IST), or null for any other file. */
export function backupTimeOf(fileName: string): Date | null {
  const m = FILE_RE.exec(fileName);
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+05:30`) : null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

// ---------------------------------------------------------------- dump / restore
export interface DumpStats {
  database: string;
  collections: Record<string, number>;
  documents: number;
}

export async function dumpDatabase(db: Db, file: string): Promise<DumpStats> {
  const names = (await db.listCollections({ type: "collection" }, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith("system."))
    .sort();
  const stats: DumpStats = { database: db.databaseName, collections: {}, documents: 0 };
  async function* lines() {
    yield EJSON.stringify({ format: BACKUP_FORMAT, version: 1, database: db.databaseName, createdAt: new Date(), collections: names }, { relaxed: false }) + "\n";
    for (const name of names) {
      const col = db.collection(name);
      yield EJSON.stringify({ collection: name, indexes: await col.indexes() }, { relaxed: false }) + "\n";
      let n = 0;
      for await (const doc of col.find({}, { sort: { _id: 1 } })) {
        yield EJSON.stringify({ c: name, d: doc }, { relaxed: false }) + "\n";
        n++;
      }
      stats.collections[name] = n;
      stats.documents += n;
    }
  }
  await mkdir(path.dirname(file), { recursive: true });
  await pipeline(Readable.from(lines()), createGzip(), createWriteStream(file));
  return stats;
}

/** Restores a backup file into an EMPTY database (refuses when any of its collections already holds documents). */
export async function restoreDatabase(file: string, db: Db): Promise<DumpStats> {
  const rl = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  const stats: DumpStats = { database: db.databaseName, collections: {}, documents: 0 };
  const indexes: Record<string, Array<Record<string, unknown>>> = {};
  let batchName = "";
  let docs: mongoose.mongo.Document[] = [];
  const flush = async () => {
    if (docs.length) await db.collection(batchName).insertMany(docs, { ordered: true });
    docs = [];
  };
  let header = false;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const row = EJSON.parse(line, { relaxed: false }) as Record<string, unknown>;
    if (!header) {
      if (row.format !== BACKUP_FORMAT) throw new Error("Not a driver-settlement backup file");
      for (const name of row.collections as string[]) {
        if (await db.collection(name).estimatedDocumentCount()) throw new Error(`Target database "${db.databaseName}" is not empty (collection ${name}); restore only into an empty database`);
      }
      header = true;
      continue;
    }
    if (typeof row.collection === "string") {
      await flush();
      indexes[row.collection] = row.indexes as Array<Record<string, unknown>>;
      stats.collections[row.collection] = 0;
      await db.createCollection(row.collection).catch(() => undefined); // keeps empty collections too
      continue;
    }
    const name = row.c as string;
    if (name !== batchName) await flush();
    batchName = name;
    docs.push(row.d as mongoose.mongo.Document);
    stats.collections[name] = (stats.collections[name] ?? 0) + 1;
    stats.documents++;
    if (docs.length >= 500) await flush();
  }
  await flush();
  if (!header) throw new Error("Backup file is empty");
  for (const [name, list] of Object.entries(indexes)) {
    for (const idx of list ?? []) {
      if (idx.name === "_id_") continue;
      const options = Object.fromEntries(Object.entries(idx).filter(([k]) => k !== "key" && k !== "v" && k !== "ns"));
      await db.collection(name).createIndex(idx.key as mongoose.mongo.IndexSpecification, options);
    }
  }
  return stats;
}

// ---------------------------------------------------------------- Space + retention
export interface S3Like {
  send(command: unknown): Promise<unknown>;
}

let s3: S3Client | null = null;
/** Space client from the DO_SPACES_* keys (also used when STORAGE_TYPE=local), or null when they are not set. */
export function getBackupSpace(): { client: S3Like; bucket: string } | null {
  const s = config.storage.space;
  if (!s.key || !s.secret || !s.endpoint || !s.region || !s.bucket) return null;
  s3 ??= new S3Client({
    region: s.region,
    endpoint: s.endpoint,
    credentials: { accessKeyId: s.key, secretAccessKey: s.secret },
    // DigitalOcean Spaces does not accept the newer default checksum headers on every operation
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return { client: s3, bucket: s.bucket };
}

/** Deletes backups in the Space older than the retention window; only keys in our exact backup naming are touched. */
export async function pruneRemoteBackups(client: S3Like, bucket: string, cutoff: Date): Promise<number> {
  const old: string[] = [];
  let token: string | undefined;
  do {
    const r = (await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${BACKUP_PREFIX}/`, ContinuationToken: token }))) as {
      Contents?: { Key?: string }[];
      IsTruncated?: boolean;
      NextContinuationToken?: string;
    };
    for (const o of r.Contents ?? []) {
      const m = o.Key ? REMOTE_KEY_RE.exec(o.Key) : null;
      const t = m ? backupTimeOf(m[1]) : null;
      if (t && t < cutoff) old.push(o.Key!);
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  for (const Key of old) await client.send(new DeleteObjectCommand({ Bucket: bucket, Key }));
  return old.length;
}

export async function pruneLocalBackups(dir: string, cutoff: Date): Promise<number> {
  let removed = 0;
  for (const f of await readdir(dir).catch(() => [] as string[])) {
    const t = backupTimeOf(f);
    if (t && t < cutoff) {
      await rm(path.join(dir, f), { force: true });
      removed++;
    }
  }
  return removed;
}

// ---------------------------------------------------------------- one backup run
export interface BackupResult {
  status: "SUCCESS" | "PARTIAL" | "FAILED";
  startedAt: Date;
  finishedAt: Date;
  fileName: string;
  localPath: string;
  key: string;
  bucket: string;
  size: number;
  stats: DumpStats | null;
  removedRemote: number;
  removedLocal: number;
  errors: string[];
}

export interface BackupDeps {
  db?: Db;
  space?: { client: S3Like; bucket: string } | null;
  localDir?: string;
  retentionDays?: number;
  now?: () => Date;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

export async function runBackup(deps: BackupDeps = {}): Promise<BackupResult> {
  const now = deps.now ?? (() => new Date());
  const db = deps.db ?? mongoose.connection.db;
  const space = deps.space === undefined ? getBackupSpace() : deps.space;
  const localDir = deps.localDir ?? config.ops.backupLocalDir;
  const retentionDays = deps.retentionDays ?? config.ops.backupRetentionDays;
  const startedAt = now();
  const fileName = backupFileName(startedAt);
  const r: BackupResult = {
    status: "FAILED", startedAt, finishedAt: startedAt, fileName, localPath: path.join(localDir, fileName), key: backupKey(startedAt),
    bucket: space?.bucket ?? "", size: 0, stats: null, removedRemote: 0, removedLocal: 0, errors: [],
  };
  const cutoff = new Date(startedAt.getTime() - retentionDays * 86_400_000);
  try {
    if (!db) throw new Error("MongoDB is not connected");
    r.stats = await dumpDatabase(db, r.localPath);
    r.size = (await stat(r.localPath)).size;
  } catch (e) {
    r.errors.push(`Dump failed: ${errText(e)}`);
    await rm(r.localPath, { force: true }).catch(() => undefined); // never keep a half-written file
    r.finishedAt = now();
    return r;
  }
  let uploaded = false;
  if (!space) {
    r.errors.push("DigitalOcean Spaces keys (DO_SPACES_*) are not set: local copy only");
  } else {
    try {
      await space.client.send(new PutObjectCommand({
        Bucket: space.bucket, Key: r.key, Body: await readFile(r.localPath), ContentType: "application/gzip", ACL: "private",
      }));
      uploaded = true;
      r.removedRemote = await pruneRemoteBackups(space.client, space.bucket, cutoff);
    } catch (e) {
      r.errors.push(uploaded ? `Old backups in the Space not removed: ${errText(e)}` : `Upload to DigitalOcean Spaces failed: ${errText(e)}`);
    }
  }
  try {
    r.removedLocal = await pruneLocalBackups(localDir, cutoff);
  } catch (e) {
    r.errors.push(`Old local backups not removed: ${errText(e)}`);
  }
  r.status = uploaded && !r.errors.length ? "SUCCESS" : "PARTIAL";
  r.finishedAt = now();
  return r;
}

// ---------------------------------------------------------------- Google Chat message
const CONTENTS: Array<[string, string]> = [
  ["trackingprojects", "projects"],
  ["trackingvehicles", "tracking vehicles"],
  ["vehicles", "vehicles"],
  ["drivers", "drivers"],
  ["settlementpayments", "settlement payments"],
  ["users", "users"],
];

export function backupMessage(r: BackupResult, slotLabel: string): string {
  const icon = { SUCCESS: "✅", PARTIAL: "⚠️", FAILED: "❌" }[r.status];
  const out = [`${icon} *Database Backup - Driver Settlement (${slotLabel}) — ${r.status}*`];
  out.push(`Database: MongoDB ${r.stats?.database ?? mongoose.connection.name ?? ""}${r.stats ? ` (${Object.keys(r.stats.collections).length} collections, ${r.stats.documents} documents)` : ""}`);
  if (r.stats) {
    out.push(`Backup completed: ${istStamp(r.finishedAt)}`);
    out.push(`Backup file: ${r.fileName}`);
    out.push(`Backup size: ${formatBytes(r.size)}`);
    out.push(`Contents: ${CONTENTS.map(([c, label]) => `${r.stats!.collections[c] ?? 0} ${label}`).join(" · ")}`);
    const uploaded = r.bucket && !r.errors.some((e) => e.startsWith("Upload") || e.startsWith("DigitalOcean"));
    out.push(`Storage: ${uploaded ? `DigitalOcean Spaces (${r.bucket}/${path.posix.dirname(r.key)}/), ${r.removedRemote} old copy(ies) removed` : "not uploaded"}`);
    out.push(`Local copy: ${path.dirname(r.localPath).replace(/\\/g, "/")}`);
    out.push(`Retention: OK: ${config.ops.backupRetentionDays}-day retention applied (deleted ${r.removedRemote + r.removedLocal} old backup(s))`);
  } else {
    out.push(`Attempted: ${istStamp(r.startedAt)}`);
  }
  if (r.errors.length) out.push("", ...r.errors.map((e) => `Error: ${e}`), "Action: manual investigation required.");
  return out.join("\n");
}
