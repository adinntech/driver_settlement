import mongoose from "mongoose";
import { config } from "../config/index.js";
import { restoreDatabase } from "../services/backup.service.js";

/**
 * Restores a backup file into a NEW, empty database on the MONGO_URI server:
 *   npm run backup:restore -- <driver-settlement-YYYYMMDD-HHmmss.json.gz> --db <database name>
 * It refuses a database that already holds data, so it can never overwrite the live one. Point MONGO_URI (or the app) at the
 * restored database afterwards if it should replace the live data.
 */
const args = process.argv.slice(2);
const dbIndex = args.indexOf("--db");
const dbName = dbIndex >= 0 ? args[dbIndex + 1] : "";
const file = args.find((a, i) => !a.startsWith("--") && i !== dbIndex + 1);

if (!file || !dbName || !/^[A-Za-z0-9_-]{1,60}$/.test(dbName)) {
  console.error("Usage: npm run backup:restore -- <backup file .json.gz> --db <new database name>");
  process.exit(2);
}

try {
  await mongoose.connect(config.mongoUri, { dbName });
  const stats = await restoreDatabase(file, mongoose.connection.db!);
  console.log(`Restored ${stats.documents} documents in ${Object.keys(stats.collections).length} collections into "${dbName}"`);
} catch (e) {
  console.error("Restore failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
