import mongoose from "mongoose";
import { config } from "../config/index.js";
import { formatBytes, runBackup } from "../services/backup.service.js";

/**
 * Go-live wipe: deletes every document in every collection EXCEPT users (logins stay). Counters go too, so PAY-, settlement and
 * DSE numbers start again from 1; Trackup and PIF numbers stay random and unique. Indexes are kept (deleteMany, not drop).
 *
 *   Dry run (default, changes nothing):  npm run golive:wipe
 *   Wipe:                                npm run golive:wipe -- --confirm <database name>
 *   Production image:                    node dist/jobs/goLiveWipe.cli.js [--confirm <database name>]
 *
 * A full backup is taken first; if it does not succeed, nothing is deleted.
 */
const KEEP = new Set(["users"]);
const i = process.argv.indexOf("--confirm");
const confirm = i > 0 ? process.argv[i + 1] : undefined;

try {
  await mongoose.connect(config.mongoUri);
  const db = mongoose.connection.db!;
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !n.startsWith("system.")).sort();
  console.log(`Database: ${db.databaseName}`);
  for (const n of names) console.log(`  ${KEEP.has(n) ? "KEEP " : "WIPE "} ${n} (${await db.collection(n).countDocuments()} documents)`);

  if (confirm === undefined) {
    console.log(`\nDry run only. To wipe, run again with: --confirm ${db.databaseName}`);
  } else if (confirm !== db.databaseName) {
    console.error(`\n--confirm "${confirm}" does not match the connected database "${db.databaseName}". Nothing deleted.`);
    process.exitCode = 1;
  } else {
    console.log("\nTaking a backup first...");
    const r = await runBackup();
    if (r.status !== "SUCCESS") {
      console.error(`Backup ${r.status}: ${r.errors.join("; ")}. Nothing deleted.`);
      process.exitCode = 1;
    } else {
      console.log(`Backup OK: ${r.fileName} (${formatBytes(r.size)})${r.bucket ? `, Space: ${r.bucket}/${r.key}` : ""}, local: ${r.localPath}`);
      for (const n of names.filter((x) => !KEEP.has(x))) {
        const { deletedCount } = await db.collection(n).deleteMany({});
        console.log(`  wiped ${n}: ${deletedCount}`);
      }
      console.log(`Done. users kept: ${await db.collection("users").countDocuments()}`);
    }
  }
} catch (e) {
  console.error("Go-live wipe failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
