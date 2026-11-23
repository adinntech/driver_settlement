import { API_BASE_URL } from "@/utils/config";
import type { ApiResponse } from "@/types/api";

const TOKEN_KEY = "ds_token";

export const tokenStore = {
  get: (): string | null => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t: string) => {
    try {
      localStorage.setItem(TOKEN_KEY, t);
    } catch {
      /* storage unavailable */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable */
    }
  },
};

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function apiGet<T = ApiResponse>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
  return res.json() as Promise<T>;
}

export const getHealth = () => apiGet<ApiResponse>("/health");

/** Authenticated request. Unwraps the sendResponse() envelope; throws ApiError on failure. */
export async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const token = tokenStore.get();
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Cannot reach the server. Please check your connection.", 0);
  }
  let json: ApiResponse<T> | null = null;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok || !json?.success) throw new ApiError(json?.message ?? `Request failed (${res.status})`, res.status);
  return json.data as T;
}

/** Uploads one file (multipart) and returns the stored attachment. Used for vehicle document attachments. */
export async function uploadAttachment(file: File): Promise<import("@/types/domain").Attachment> {
  const token = tokenStore.get();
  const fd = new FormData();
  fd.append("file", file);
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/vehicles/attachments`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
  } catch {
    throw new ApiError("Cannot reach the server. Please check your connection.", 0);
  }
  let json: ApiResponse<import("@/types/domain").Attachment> | null = null;
  try {
    json = (await res.json()) as ApiResponse<import("@/types/domain").Attachment>;
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok || !json?.success || !json.data) throw new ApiError(json?.message ?? `Upload failed (${res.status})`, res.status);
  return json.data;
}
