/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Feature flags, read from the environment (see .env.example). Anything other than "on" means off.
 * ROADSHOW=off: no new Roadshow work, and existing Roadshow projects are hidden (never changed or deleted).
 */
export const roadshowOn = (): boolean => process.env.ROADSHOW?.trim().toLowerCase() === "on";

export const ROADSHOW_DISABLED = "Roadshow is currently disabled. Only Signage is available.";

/**
 * Guard for a vehicle / driver "In Use" block while Roadshow is off. An allocation already saved as Roadshow is kept as it
 * is, so the rest of that vehicle or driver stays editable; a new Roadshow allocation is refused. Null = nothing to do.
 */
export function roadshowAllocation(input: any, prev?: any): { input: any; error?: string } | null {
  if (roadshowOn() || !input || typeof input !== "object" || input.status !== "IN_USE") return null;
  const p = input.project ?? {};
  const old = prev?.status === "IN_USE" ? prev.project : null;
  if (old?.projectType === "ROADSHOW" && (p.pifNumber || null) === (old.pifNumber || null) && (p.trackupNumber || null) === (old.trackupNumber || null)) {
    const saved = JSON.parse(JSON.stringify(old)); // ids as strings, as the validators expect
    return { input: { ...input, project: { ...saved, location: p.location || saved.location, remarks: p.remarks ?? saved.remarks ?? null } } };
  }
  return p.projectType === "ROADSHOW" ? { input, error: ROADSHOW_DISABLED } : null;
}
