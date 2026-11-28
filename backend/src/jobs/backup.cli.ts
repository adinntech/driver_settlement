import mongoose from "mongoose";
import { config } from "../config/index.js";
import { backupMessage, formatBytes, runBackup } from "../services/backup.service.js";
import { postToGoogleChat } from "../services/googleChat.service.js";

/**
 * One backup now, outside the schedule: npm run backup:now [-- --notify]
 * (production image: node dist/jobs/backup.cli.js [--notify]). --notify also posts the result to Google Chat.
 */
const notify = process.argv.includes("--notify");

try {
  await mongoose.connect(config.mongoUri);
  const r = await runBackup();
  console.log(`Backup ${r.status}: ${r.fileName} (${formatBytes(r.size)}, ${r.stats?.documents ?? 0} documents)`);
  console.log(`Local copy: ${r.localPath}`);
  if (r.status !== "FAILED" && r.bucket) console.log(`Space: ${r.bucket}/${r.key}`);
  for (const e of r.errors) console.log(`Error: ${e}`);
  if (notify) await postToGoogleChat(backupMessage(r, "manual"));
  process.exitCode = r.status === "SUCCESS" ? 0 : 1;
} catch (e) {
  console.error("Backup failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
