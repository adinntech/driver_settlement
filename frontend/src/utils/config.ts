// NEXT_PUBLIC_ENVIRONMENT=local (default): localhost, no base path. live: adinntech.in under /driver-settlement.
// NEXT_PUBLIC_BASE_PATH / NEXT_PUBLIC_API_BASE_URL, when set, override these defaults.
const IS_LIVE = process.env.NEXT_PUBLIC_ENVIRONMENT === "live";

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? (IS_LIVE ? "/driver-settlement" : "");

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  (IS_LIVE ? "https://adinntech.in/driver-settlement/api" : "http://localhost:5000/api");
