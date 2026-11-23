import {
  generateDisplayNumber,
  generatePifNumber,
  generateTrackupNumber,
} from "../utils/numbers.js";

export interface NumberSet {
  trackupNumber: string;
  pifNumber: string;
  displayNumber: string;
}

/** Store abstraction so uniqueness logic is testable without a database. */
export interface NumberStore {
  exists(set: NumberSet): Promise<boolean>;
  /** Must throw an error with code 11000 on a duplicate key (DB unique index). */
  insert(set: NumberSet, vehicleIndex: number): Promise<void>;
}

const isDuplicateKey = (e: unknown) => (e as { code?: number })?.code === 11000;
const MAX_ATTEMPTS = 80;
const FIVE_DIGIT_AFTER = 30;

/**
 * Allocates one unique Trackup/PIF/Display set. Pre-checks for duplicates, then relies on
 * DB unique indexes as the final guard (safe under concurrent requests); retries on collision.
 */
export async function allocateOne(
  store: NumberStore,
  vehicleIndex: number,
  gen = {
    trackup: generateTrackupNumber,
    pif: generatePifNumber,
    display: generateDisplayNumber as (fiveDigits?: boolean) => string,
  },
): Promise<NumberSet> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const set: NumberSet = {
      trackupNumber: gen.trackup(),
      pifNumber: gen.pif(),
      // After 30 failed tries the 4-digit space is effectively full, so move to 5 digits.
      displayNumber: gen.display(attempt >= FIVE_DIGIT_AFTER),
    };
    if (await store.exists(set)) continue;
    try {
      await store.insert(set, vehicleIndex);
      return set;
    } catch (e) {
      if (!isDuplicateKey(e)) throw e;
    }
  }
  throw new Error("Unable to generate unique numbers; number space may be exhausted");
}
