import { randomInt } from "node:crypto";
const rand = (min, max) => randomInt(min, max + 1);
/** "DR-" + 4 random digits (1000-9999), or 5 digits (10000-99999) once the 4-digit space is crowded. */
export const generateDriverNumber = (fiveDigits = false) => `DR-${fiveDigits ? rand(10000, 99999) : rand(1000, 9999)}`;
export const isDriverNumberClash = (e) => {
    const err = e;
    return err?.code === 11000 && !!err.keyPattern && "driverNumber" in err.keyPattern;
};
const MAX_ATTEMPTS = 60;
const FIVE_DIGIT_AFTER = 12; // 4-digit tries before moving to 5 digits
/**
 * Creates a driver with a unique Driver Number. Pre-checks the database, relies on the unique index as the final guard
 * (safe for simultaneous requests), retries with a new random number on a clash, and switches to 5 digits when 4-digit
 * numbers keep colliding. Any other error (e.g. a duplicate mobile number) is passed through untouched.
 */
export async function createWithDriverNumber(store, gen = generateDriverNumber) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const number = gen(attempt >= FIVE_DIGIT_AFTER);
        if (await store.exists(number))
            continue;
        try {
            return await store.insert(number);
        }
        catch (e) {
            if (!isDriverNumberClash(e))
                throw e;
        }
    }
    throw new Error("Unable to generate a unique driver number; number space may be exhausted");
}
