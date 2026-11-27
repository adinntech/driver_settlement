/* eslint-disable @typescript-eslint/no-explicit-any */
// Records saved before vehicles shared a Trackup Number have one per vehicle. Suites that identify rows by Trackup run on that
// shape (it must keep working); the shared-number behaviour itself is covered by sharedTrackup.test.ts.
import { randomInt } from "node:crypto";
import mongoose from "mongoose";

const used = new Set<string>();

export async function perVehicleTrackups<T extends { vehicles: any[] }>(project: T): Promise<T> {
  for (const v of project.vehicles) {
    let n: string;
    do n = String(v.trackupNumber).replace(/\d{5}/, String(randomInt(10000, 99999)));
    while (used.has(n));
    used.add(n);
    v.trackupNumber = n;
    await mongoose.connection.collection("trackingvehicles").updateOne({ _id: new mongoose.Types.ObjectId(String(v._id)) }, { $set: { trackupNumber: n } });
  }
  return project;
}
