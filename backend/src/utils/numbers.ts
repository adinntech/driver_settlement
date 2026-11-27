import { randomInt } from "node:crypto";

/** Indian financial year (Apr-Mar), evaluated in IST: Apr 2026..Mar 2027 => "2026-27". */
export function financialYear(date: Date = new Date()): string {
  const ist = new Date(date.getTime() + 5.5 * 3600 * 1000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

const rand = (min: number, max: number): number => randomInt(min, max + 1);

export const generateTrackupNumber = (date?: Date) =>
  `JS-${rand(10000, 99999)}/${financialYear(date)}`;
export const generatePifNumber = () => `PIF-${rand(10000, 99999)}`;
