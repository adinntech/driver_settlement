import { generatePifNumber, generateTrackupNumber } from "../utils/numbers.js";
const isDuplicateKey = (e) => e?.code === 11000;
const MAX_ATTEMPTS = 80;
const exhausted = () => new Error("Unable to generate unique numbers; number space may be exhausted");
/** One unique PIF Number per vehicle: pre-check, with the DB unique index as the final guard under concurrency. */
export async function allocatePif(store, gen = generatePifNumber) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const pif = gen();
        if (await store.exists(pif))
            continue;
        try {
            await store.insert(pif);
            return pif;
        }
        catch (e) {
            if (!isDuplicateKey(e))
                throw e;
        }
    }
    throw exhausted();
}
/** The group's Trackup Number: reused when it exists, otherwise a new unique one is claimed. */
export async function sharedTrackup(store, gen = generateTrackupNumber) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const current = await store.find(); // also picks up the winner of a simultaneous claim
        if (current)
            return current;
        const candidate = gen();
        if (await store.used(candidate))
            continue;
        try {
            await store.claim(candidate);
            return candidate;
        }
        catch (e) {
            if (!isDuplicateKey(e))
                throw e;
        }
    }
    throw exhausted();
}
