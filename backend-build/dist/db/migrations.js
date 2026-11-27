import mongoose from "mongoose";
/**
 * Indexes from when every vehicle had its own Trackup and Display number. Left in place they would reject vehicles that share a
 * Trackup Number, and (displayNumber) every second vehicle saved without the removed field. Only indexes are changed: existing
 * records keep their numbers. Safe to run on every start.
 */
const OBSOLETE = [
    ["trackingvehicles", "trackupNumber_1"],
    ["trackingvehicles", "displayNumber_1"],
    ["vehicles", "availability.project.trackupNumber_1"],
];
/**
 * Runs on its own connection, BEFORE the application connects: Mongoose builds the new (non-unique) trackupNumber_1 index as
 * soon as it connects, which would fail while the old unique index of the same name still exists.
 */
export async function migrateIndexes(uri) {
    const conn = await mongoose.createConnection(uri).asPromise();
    try {
        const db = conn.db;
        for (const [name, index] of OBSOLETE) {
            if (!(await db.listCollections({ name }).toArray()).length)
                continue;
            const found = (await db.collection(name).indexes()).find((i) => i.name === index);
            if (!found?.unique)
                continue; // already migrated (trackupNumber_1 is re-created as a plain index)
            await db.collection(name).dropIndex(index).catch((e) => {
                if (e.codeName !== "IndexNotFound")
                    throw e; // another process dropped it first
            });
        }
    }
    finally {
        await conn.close();
    }
}
