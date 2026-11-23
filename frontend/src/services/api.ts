import { API_BASE_URL } from "@/utils/config";
import type { ApiResponse } from "@/types/api";

export async function apiGet<T = ApiResponse>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
  return res.json() as Promise<T>;
}

export const getHealth = () => apiGet<ApiResponse>("/health");
