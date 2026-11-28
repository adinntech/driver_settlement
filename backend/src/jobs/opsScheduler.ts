import mongoose from "mongoose";
import { config } from "../config/index.js";
import { backupMessage, runBackup } from "../services/backup.service.js";
import { postToGoogleChat } from "../services/googleChat.service.js";
import { AlertTracker, collectHealth, healthReportMessage, OPS_RUNS, startEventLoopMonitor } from "../services/serverHealth.service.js";

/**
 * Database backup + health report at 00:00, 06:00, 12:00 and 18:00 IST, and an alert check every few minutes, all inside the
 * backend process. Each slot is claimed once in the ops_runs collection (unique job + slot), so a restart catches up a missed
 * slot and a second process never runs it twice. A failed backup is retried up to 3 times, 30 minutes apart.
 */
const SLOT_HOURS = 6;
const RETRY_AFTER_MS = 30 * 60_000;
const MAX_ATTEMPTS = 3;

/** Latest slot that has started, e.g. "2026-11-28T18:00" (IST). */
export function currentSlot(now = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60_000).toISOString();
  const hour = Math.floor(Number(ist.slice(11, 13)) / SLOT_HOURS) * SLOT_HOURS;
  return `${ist.slice(0, 10)}T${String(hour).padStart(2, "0")}:00`;
}

export const slotLabel = (slot: string) => `${slot.slice(11)} IST`;

const runs = () => mongoose.connection.collection(OPS_RUNS);
let indexReady = false;

/** True when this process now owns the run of `job` for `slot`. */
export async function claimSlot(job: string, slot: string, now = new Date(), retryFailed = false): Promise<boolean> {
  if (!indexReady) {
    await runs().createIndex({ job: 1, slot: 1 }, { unique: true });
    indexReady = true;
  }
  try {
    await runs().insertOne({ job, slot, status: "RUNNING", attempts: 1, startedAt: now });
    return true;
  } catch (e) {
    if ((e as { code?: number }).code !== 11000) throw e;
  }
  if (!retryFailed) return false;
  const r = await runs().updateOne(
    { job, slot, status: "FAILED", attempts: { $lt: MAX_ATTEMPTS }, finishedAt: { $lte: new Date(now.getTime() - RETRY_AFTER_MS) } },
    { $set: { status: "RUNNING", startedAt: now }, $inc: { attempts: 1 } },
  );
  return r.modifiedCount === 1;
}

async function finishSlot(job: string, slot: string, fields: Record<string, unknown>) {
  await runs().updateOne({ job, slot }, { $set: { ...fields, finishedAt: new Date() } });
}

let busy = false;

export async function runDueOps(now = new Date()): Promise<void> {
  if (busy || mongoose.connection.readyState !== 1) return;
  busy = true;
  const slot = currentSlot(now);
  try {
    if (config.ops.backupEnabled && (await claimSlot("backup", slot, now, true))) {
      const r = await runBackup();
      // PARTIAL (dump kept locally, upload or clean-up failed) counts as failed so it is retried
      await finishSlot("backup", slot, { status: r.status === "SUCCESS" ? "SUCCESS" : "FAILED", fileName: r.fileName, size: r.size, errors: r.errors });
      console.log(`[ops] backup ${slot}: ${r.status}${r.errors.length ? ` (${r.errors.join("; ")})` : ""}`);
      await postToGoogleChat(backupMessage(r, slotLabel(slot)));
    }
    if (config.ops.healthMonitorEnabled && (await claimSlot("health-report", slot, now))) {
      const checks = await collectHealth();
      await finishSlot("health-report", slot, { status: "SUCCESS" });
      await postToGoogleChat(healthReportMessage(checks));
    }
  } catch (e) {
    console.error("[ops] scheduled run failed:", e instanceof Error ? e.message : e);
  } finally {
    busy = false;
  }
}

const tracker = new AlertTracker();
let checking = false;

export async function runAlertCheck(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const text = tracker.update(await collectHealth());
    if (text) await postToGoogleChat(text);
  } catch (e) {
    console.error("[ops] health check failed:", e instanceof Error ? e.message : e);
  } finally {
    checking = false;
  }
}

export function startOpsScheduler(): () => void {
  const { backupEnabled, healthMonitorEnabled } = config.ops;
  if (!backupEnabled && !healthMonitorEnabled) return () => undefined;
  if (!config.ops.googleChatWebhook) console.warn("[ops] GOOGLE_CHAT_WEBHOOK_URL is not set: backups run, no Google Chat messages");
  startEventLoopMonitor();
  void runDueOps();
  const slotTimer = setInterval(() => void runDueOps(), 60_000);
  const alertTimer = healthMonitorEnabled ? setInterval(() => void runAlertCheck(), Math.max(config.ops.healthIntervalMs, 60_000)) : null;
  return () => {
    clearInterval(slotTimer);
    if (alertTimer) clearInterval(alertTimer);
  };
}
