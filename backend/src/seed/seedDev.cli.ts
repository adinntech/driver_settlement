import mongoose from "mongoose";
import { config } from "../config/index.js";
import { connectDB } from "../db/connect.js";
import { assertDevOnly, mongoHosts, seedDevData } from "./devSeed.js";

/** `npm run seed:dev`: seeds the 10 development projects (idempotent, development databases only). */
try {
  assertDevOnly(); // before any connection is opened
  if (!config.jwtSecret) throw new Error("JWT_SECRET is not set. Add it to backend/.env");
  await connectDB();
  console.log(`Seeding development data into "${mongoose.connection.name}" on ${mongoHosts(config.mongoUri)?.join(",") ?? "remote host"} (${config.env})`);
  const r = await seedDevData((m) => console.log(`  ${m}`));
  const line = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${k}: ${v}`).join(", ") || "none";
  console.log(`\nCreated:  ${line(r.created)}`);
  console.log(`Existing: ${line(r.existing)} (left untouched)`);
  console.log("\nProject vehicles:");
  for (const v of r.vehicles) console.log(`  ${v.project} #${v.index}  ${v.trackupNumber.padEnd(18)} ${v.pifNumber.padEnd(10)} ${v.client}`);
  console.log("\nDone. Verify with: npm run seed:dev:verify");
} catch (e) {
  console.error(`\nSeed failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
