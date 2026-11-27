import mongoose from "mongoose";

/** Renamed vehicle types: [code (unchanged), name as saved before, name now]. */
const RENAMED = [
  ["TATA_ACE_9FT_2S_LED", "Tata Ace 9 Ft 2 Sides LED", "2 Sided LED"],
  ["TATA_ULTRA_19FT_3S_LED", "Tata Ultra 19 Ft - 3 Sides LED", "3 Sided LED"],
] as const;

/**
 * Saved requests, vehicles and allotment snapshots store the type name: bring renamed ones up to date. Safe to run on every start
 * (a second run matches nothing). Native updates, so no timestamps change.
 */
export async function renameVehicleTypes(): Promise<void> {
  const db = mongoose.connection.db!;
  for (const [code, before, now] of RENAMED) {
    await db.collection("trackingprojects").updateMany(
      { "details.vehicleTypes": { $elemMatch: { code, name: before } } },
      { $set: { "details.vehicleTypes.$[t].name": now } },
      { arrayFilters: [{ "t.code": code }] },
    );
    await db.collection("trackingvehicles").updateMany({ vehicleTypeCode: code, vehicleType: before }, { $set: { vehicleType: now } });
    await db.collection("vehicleallotments").updateMany({ requestedVehicleType: before }, { $set: { requestedVehicleType: now } });
  }
}
