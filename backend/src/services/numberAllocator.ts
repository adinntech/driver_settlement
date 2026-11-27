import { generatePifNumber, generateTrackupNumber } from "../utils/numbers.js";

/** Store abstractions so the uniqueness logic is testable without a database. */
export interface PifStore {
  exists(pifNumber: string): Promise<boolean>;
  /** Must throw an error with code 11000 on a duplicate key (DB unique index). */
  insert(pifNumber: string): Promise<void>;
}
export interface TrackupStore {
  /** The number this group already has, if any. */
  find(): Promise<string | null>;
  /** Is the candidate already used by any vehicle? */
  used(trackupNumber: string): Promise<boolean>;
  /** Must throw code 11000 when the group already has a number or the number belongs to another group. */
  claim(trackupNumber: string): Promise<void>;
}

const isDuplicateKey = (e: unknown) => (e as { code?: number })?.code === 11000;
const MAX_ATTEMPTS = 80;
const exhausted = () => new Error("Unable to generate unique numbers; number space may be exhausted");

/** One unique PIF Number per vehicle: pre-check, with the DB unique index as the final guard under concurrency. */
export async function allocatePif(store: PifStore, gen: () => string = generatePifNumber): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const pif = gen();
    if (await store.exists(pif)) continue;
    try {
      await store.insert(pif);
      return pif;
    } catch (e) {
      if (!isDuplicateKey(e)) throw e;
    }
  }
  throw exhausted();
}

/** The group's Trackup Number: reused when it exists, otherwise a new unique one is claimed. */
export async function sharedTrackup(store: TrackupStore, gen: () => string = generateTrackupNumber): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const current = await store.find(); // also picks up the winner of a simultaneous claim
    if (current) return current;
    const candidate = gen();
    if (await store.used(candidate)) continue;
    try {
      await store.claim(candidate);
      return candidate;
    } catch (e) {
      if (!isDuplicateKey(e)) throw e;
    }
  }
  throw exhausted();
}
