export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5000/api";

// Sub-path deployment (e.g. /driver-settlement). Empty for local dev.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
