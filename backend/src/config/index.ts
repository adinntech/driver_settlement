import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const port = Number(process.env.PORT) || 5000;

export const config = {
  env: process.env.NODE_ENV ?? "development",
  port,
  mongoUri: process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/driver_settlement",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  jwtSecret: process.env.JWT_SECRET ?? "",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
  // Seed credentials come from env only; never hard-coded in source.
  seedUsers: [
    { role: "RSOP", username: process.env.RSOP_USERNAME, password: process.env.RSOP_PASSWORD },
    { role: "RBP", username: process.env.RBP_USERNAME, password: process.env.RBP_PASSWORD },
    { role: "RSOM", username: process.env.RSOM_USERNAME, password: process.env.RSOM_PASSWORD },
    { role: "RSA", username: process.env.RSA_USERNAME, password: process.env.RSA_PASSWORD },
    { role: "RSO", username: process.env.RSO_USERNAME, password: process.env.RSO_PASSWORD },
  ],
  // Encrypts bank account numbers and payment transaction details at rest (AES-256-GCM). Falls back to a key derived from JWT_SECRET.
  dataKey: process.env.DATA_ENCRYPTION_KEY ?? "",
  companyName: process.env.COMPANY_NAME ?? "ADINN",
  // Opt-in, development only: lets the login page show the demo username / password of each role. Never active in production.
  demoLoginHints: process.env.DEMO_LOGIN_HINTS === "true",
  // Toll plaza directory for the RBP budget (server side only; downloaded at most once per TTL and cached on disk).
  tolls: {
    dataUrl: process.env.TOLL_DATA_URL ?? "https://raw.githubusercontent.com/ForceGT/india-toll-plazas/main/data/latest.json",
    cacheFile: process.env.TOLL_CACHE_FILE ?? fileURLToPath(new URL("../../.cache/toll-plazas.json", import.meta.url)),
    ttlMs: (Number(process.env.TOLL_DATA_TTL_HOURS) || 24) * 3600_000,
  },
  storage: {
    // local = backend/public folder, space = cloud bucket (DigitalOcean Spaces)
    type: (process.env.STORAGE_TYPE ?? "local").trim().toLowerCase(),
    localDir: process.env.STORAGE_LOCAL_DIR ?? fileURLToPath(new URL("../../public", import.meta.url)),
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`,
    space: {
      key: process.env.DO_SPACES_KEY ?? "",
      secret: process.env.DO_SPACES_SECRET ?? "",
      endpoint: process.env.DO_SPACES_ENDPOINT ?? "",
      region: process.env.DO_SPACES_REGION ?? "",
      bucket: process.env.DO_SPACES_BUCKET ?? "",
      cdnBase: process.env.DO_SPACES_CDN_BASE ?? "",
    },
  },
  // Scheduled MongoDB backup to the Space above (06:00, 12:00, 18:00, 00:00 IST) and server health monitoring, both reported to
  // Google Chat. Off unless enabled, so local development and tests never back up or post anything.
  ops: {
    backupEnabled: process.env.BACKUP_ENABLED === "true",
    healthMonitorEnabled: process.env.HEALTH_MONITOR_ENABLED === "true",
    googleChatWebhook: process.env.GOOGLE_CHAT_WEBHOOK_URL ?? "",
    serverName: process.env.SERVER_NAME || "driver-settlement",
    backupLocalDir: process.env.BACKUP_LOCAL_DIR ?? fileURLToPath(new URL("../../backups", import.meta.url)),
    backupRetentionDays: Number(process.env.BACKUP_RETENTION_DAYS) || 7,
    healthCheckUrls: (process.env.HEALTH_CHECK_URLS ?? "").split(",").map((u) => u.trim()).filter(Boolean),
    healthIntervalMs: (Number(process.env.HEALTH_CHECK_INTERVAL_MINUTES) || 5) * 60_000,
    alertRepeatMs: (Number(process.env.HEALTH_ALERT_REPEAT_MINUTES) || 60) * 60_000,
  },
};
