import dotenv from "dotenv";

dotenv.config();

export const config = {
  env: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT) || 5000,
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
};
