import { randomInt } from "node:crypto";

const rand = (min: number, max: number): number => randomInt(min, max + 1);

/** "DR-" + 4 random digits (1000-9999), or 5 digits (10000-99999) once the 4-digit space is crowded. */
export const generateDriverNumber = (fiveDigits = false): string => `DR-${fiveDigits ? rand(10000, 99999) : rand(1000, 9999)}`;

/** Store abstraction so the uniqueness logic is testable without a database. */
export interface DriverNumberStore<T> {
  exists(driverNumber: string): Promise<boolean>;
  /** Saves the driver with this number. Must throw an error with code 11000 and keyPattern.driverNumber on a duplicate number. */
  insert(driverNumber: string): Promise<T>;
}

export const isDriverNumberClash = (e: unknown): boolean => {
  const err = e as { code?: number; keyPattern?: Record<string, unknown> };
  return err?.code === 11000 && !!err.keyPattern && "driverNumber" in err.keyPattern;
};

const MAX_ATTEMPTS = 60;
const FIVE_DIGIT_AFTER = 12; // 4-digit tries before moving to 5 digits

/**
 * Creates a driver with a unique Driver Number. Pre-checks the database, relies on the unique index as the final guard
 * (safe for simultaneous requests), retries with a new random number on a clash, and switches to 5 digits when 4-digit
 * numbers keep colliding. Any other error (e.g. a duplicate mobile number) is passed through untouched.
 */
export async function createWithDriverNumber<T>(
  store: DriverNumberStore<T>,
  gen: (fiveDigits: boolean) => string = generateDriverNumber,
): Promise<T> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const number = gen(attempt >= FIVE_DIGIT_AFTER);
    if (await store.exists(number)) continue;
    try {
      return await store.insert(number);
    } catch (e) {
      if (!isDriverNumberClash(e)) throw e;
    }
  }
  throw new Error("Unable to generate a unique driver number; number space may be exhausted");
}
