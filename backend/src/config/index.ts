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
  ],
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
