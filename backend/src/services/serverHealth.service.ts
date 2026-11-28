import { statfs } from "node:fs/promises";
import os from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";
import mongoose from "mongoose";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { config } from "../config/index.js";
import { formatBytes, getBackupSpace, istDisplay, type S3Like } from "./backup.service.js";

/**
 * Health of this backend as seen from inside its own container: database, Space, backups, disk, memory, load, event loop
 * and the configured public URLs. Host-level checks (other containers, listening ports) are out of reach from here.
 */
export interface HealthCheck {
  key: string;
  name: string;
  level: "ok" | "warning" | "critical";
  detail: string;
}

export const OPS_RUNS = "ops_runs";
export const BACKUP_MAX_AGE_MS = 7 * 3600_000; // one 6-hour slot plus an hour of grace

let loopDelay: ReturnType<typeof monitorEventLoopDelay> | null = null;
export function startEventLoopMonitor(): void {
  if (loopDelay) return;
  loopDelay = monitorEventLoopDelay({ resolution: 20 });
  loopDelay.enable();
}

const ms = (start: number) => Math.round(performance.now() - start);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

export interface HealthDeps {
  db?: mongoose.mongo.Db | null;
  space?: { client: S3Like; bucket: string } | null;
  backupEnabled?: boolean;
  urls?: string[];
  diskPath?: string;
  now?: Date;
}

export async function collectHealth(deps: HealthDeps = {}): Promise<HealthCheck[]> {
  const now = deps.now ?? new Date();
  const db = deps.db === undefined ? (mongoose.connection.readyState === 1 ? mongoose.connection.db ?? null : null) : deps.db;
  const backupEnabled = deps.backupEnabled ?? config.ops.backupEnabled;
  const checks: HealthCheck[] = [];

  // MongoDB
  if (!db) {
    checks.push({ key: "mongo", name: "MongoDB", level: "critical", detail: "not connected" });
  } else {
    const t = performance.now();
    try {
      await Promise.race([db.command({ ping: 1 }), new Promise((_, rej) => setTimeout(() => rej(new Error("ping timed out after 5 s")), 5000))]);
      const took = ms(t);
      checks.push({ key: "mongo", name: "MongoDB", level: took > 1500 ? "warning" : "ok", detail: `connected (${db.databaseName}, ping ${took} ms)` });
    } catch (e) {
      checks.push({ key: "mongo", name: "MongoDB", level: "critical", detail: `ping failed: ${errText(e)}` });
    }
  }

  // Space + last backup (only when backups are on)
  if (backupEnabled) {
    const space = deps.space === undefined ? getBackupSpace() : deps.space;
    if (!space) {
      checks.push({ key: "space", name: "DigitalOcean Space", level: "critical", detail: "DO_SPACES_* keys are not set" });
    } else {
      try {
        await space.client.send(new HeadBucketCommand({ Bucket: space.bucket }));
        checks.push({ key: "space", name: "DigitalOcean Space", level: "ok", detail: `reachable (${space.bucket})` });
      } catch (e) {
        checks.push({ key: "space", name: "DigitalOcean Space", level: "critical", detail: `not reachable: ${errText(e)}` });
      }
    }
    if (db) {
      try {
        const last = await db.collection(OPS_RUNS).findOne({ job: "backup", status: "SUCCESS" }, { sort: { finishedAt: -1 } });
        const at = last?.finishedAt as Date | undefined;
        if (at && now.getTime() - at.getTime() <= BACKUP_MAX_AGE_MS) {
          checks.push({ key: "backup", name: "Last backup", level: "ok", detail: `${istDisplay(at)} (${formatBytes(Number(last?.size) || 0)})` });
        } else {
          checks.push({ key: "backup", name: "Last backup", level: "critical", detail: at ? `last successful backup ${istDisplay(at)} (older than 7 hours)` : "no successful backup recorded" });
        }
      } catch (e) {
        checks.push({ key: "backup", name: "Last backup", level: "warning", detail: `could not read backup history: ${errText(e)}` });
      }
    }
  }

  // Disk (the volume holding the local backup copies)
  try {
    const s = await statfs(deps.diskPath ?? (await existingDir(config.ops.backupLocalDir)));
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    const p = pct(free, total);
    checks.push({ key: "disk", name: "Disk", level: p < 5 ? "critical" : p < 10 ? "warning" : "ok", detail: `${formatBytes(free)} free of ${formatBytes(total)} (${p}%)` });
  } catch (e) {
    checks.push({ key: "disk", name: "Disk", level: "warning", detail: `could not read: ${errText(e)}` });
  }

  // Memory, CPU load, event loop
  const memFree = pct(os.freemem(), os.totalmem());
  checks.push({ key: "memory", name: "Memory", level: memFree < 5 ? "critical" : memFree < 10 ? "warning" : "ok", detail: `${formatBytes(os.freemem())} free of ${formatBytes(os.totalmem())} (${memFree}%)` });
  const cpus = os.cpus().length || 1;
  const load = os.loadavg()[0];
  checks.push({ key: "load", name: "CPU load", level: load / cpus > 2 ? "warning" : "ok", detail: `${load.toFixed(2)} (${cpus} cores)` });
  if (loopDelay) {
    const p99 = Math.round(loopDelay.percentile(99) / 1e6);
    loopDelay.reset();
    checks.push({ key: "eventloop", name: "Event loop delay", level: p99 > 1000 ? "warning" : "ok", detail: `${p99} ms (p99)` });
  }

  // Public URLs (frontend login page, API health ...)
  for (const url of deps.urls ?? config.ops.healthCheckUrls) {
    const t = performance.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "manual" });
      const took = ms(t);
      const level = res.status >= 500 ? "critical" : took > 5000 ? "warning" : "ok";
      checks.push({ key: `url:${url}`, name: url, level, detail: `HTTP ${res.status} in ${took} ms` });
    } catch (e) {
      checks.push({ key: `url:${url}`, name: url, level: "critical", detail: `not reachable: ${errText(e)}` });
    }
  }
  return checks;
}

async function existingDir(dir: string): Promise<string> {
  try {
    await statfs(dir);
    return dir;
  } catch {
    return process.cwd();
  }
}

const ICON = { ok: "✅", warning: "🟡", critical: "🔴" } as const;

function uptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

/** Scheduled report (06:00 / 12:00 / 18:00 / 00:00 IST). */
export function healthReportMessage(checks: HealthCheck[], now = new Date(), server = config.ops.serverName): string {
  const worst = checks.some((c) => c.level === "critical") ? "critical" : checks.some((c) => c.level === "warning") ? "warning" : "ok";
  const title = { ok: "🟢 *Driver Settlement — Server Health OK*", warning: "🟡 *Driver Settlement — Server Health WARNING*", critical: "🔴 *Driver Settlement — Server Health CRITICAL*" }[worst];
  return [
    title,
    `Server: ${server}`,
    `Checked: ${istDisplay(now)}`,
    "",
    ...checks.map((c) => `${ICON[c.level]} ${c.name}: ${c.detail}`),
    `ℹ️ Backend uptime: ${uptime(process.uptime())} · memory ${formatBytes(process.memoryUsage().rss)} · Node ${process.version}`,
  ].join("\n");
}

/**
 * Alert state between health checks: sends when a problem appears or clears, and repeats every `repeatMs` while one stays
 * active. Problems already reported earlier are marked "(still active)".
 */
export class AlertTracker {
  private active = new Map<string, Date>();
  private lastSent = 0;

  constructor(private repeatMs = config.ops.alertRepeatMs, private server = config.ops.serverName) {}

  update(checks: HealthCheck[], now = new Date()): string | null {
    const issues = checks.filter((c) => c.level !== "ok");
    const current = new Set(issues.map((c) => c.key));
    const fresh = issues.filter((c) => !this.active.has(c.key));
    const resolved = [...this.active.entries()].filter(([k]) => !current.has(k));
    const names = new Map(checks.map((c) => [c.key, c.name]));
    const previous = new Set(this.active.keys());
    for (const [k] of resolved) this.active.delete(k);
    for (const c of fresh) this.active.set(c.key, now);

    if (!issues.length) {
      if (!resolved.length) return null;
      this.lastSent = now.getTime();
      return [
        "✅ *ADINN SERVER ALERT — RESOLVED*",
        `Server: ${this.server}`,
        `Resolved: ${istDisplay(now)}`,
        "",
        ...resolved.map(([k, since]) => `✅ ${names.get(k) ?? k.replace(/^url:/, "")}: OK now (active since ${istDisplay(since)})`),
      ].join("\n");
    }
    if (!fresh.length && !resolved.length && now.getTime() - this.lastSent < this.repeatMs) return null;
    this.lastSent = now.getTime();
    const critical = issues.some((c) => c.level === "critical");
    const out = [
      `${critical ? "🔴" : "🟡"} *ADINN SERVER ALERT — ${critical ? "CRITICAL" : "WARNING"}*`,
      `Server: ${this.server}`,
      `Detected: ${istDisplay(now)}`,
      "",
    ];
    for (const c of issues) out.push("", `${ICON[c.level]} ${c.name}${previous.has(c.key) ? " (still active)" : ""}`, c.detail, "");
    if (resolved.length) out.push("", ...resolved.map(([k]) => `✅ Resolved: ${names.get(k) ?? k.replace(/^url:/, "")}`));
    out.push("", "Action: manual investigation required.", "No automatic changes were made.");
    return out.join("\n").replace(/\n{4,}/g, "\n\n\n");
  }
}
