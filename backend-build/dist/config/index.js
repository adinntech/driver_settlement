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
};
