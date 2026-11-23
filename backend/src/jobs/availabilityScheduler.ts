import { releaseDueVehicles } from "../services/availability.service.js";

/**
 * Runs inside the existing backend process (no extra container / port): every minute, and once immediately at start-up so
 * vehicles whose release moment passed while the server was down are released straight away. The release itself is atomic
 * and idempotent (see releaseDueVehicles), so overlapping or repeated runs are harmless.
 */
let running = false;

export async function runAvailabilityJob(now = new Date()): Promise<{ released: number; skipped: number } | null> {
  if (running) return null; // never overlap two runs of this process
  running = true;
  try {
    let total = { released: 0, skipped: 0 };
    // keep going while full batches come back, so a big backlog after a long outage is cleared in one run
    for (let i = 0; i < 20; i++) {
      const r = await releaseDueVehicles(now, 500);
      total = { released: total.released + r.released, skipped: total.skipped + r.skipped };
      if (r.released + r.skipped < 500) break;
    }
    if (total.released) console.log(`[availability] ${total.released} vehicle(s) marked Available after their scheduled release time`);
    return total;
  } catch (e) {
    console.error("[availability] scheduled release failed:", e);
    return null;
  } finally {
    running = false;
  }
}

export function startAvailabilityScheduler(intervalMs = Number(process.env.AVAILABILITY_JOB_INTERVAL_MS) || 60_000): () => void {
  void runAvailabilityJob(); // catch-up after a restart
  const timer = setInterval(() => void runAvailabilityJob(), Math.max(intervalMs, 5_000));
  return () => clearInterval(timer);
}
