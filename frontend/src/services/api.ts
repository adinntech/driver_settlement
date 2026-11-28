import { API_BASE_URL } from "@/utils/config";
import type { ApiResponse } from "@/types/api";

export const TOKEN_KEY = "ds_token";

// ---------------------------------------------------------------- shared GET cache + in-flight dedupe + activity
/**
 * One cache for every screen: a GET result is kept per path so revisiting a page (or going back) shows data instantly while it is
 * revalidated, and identical requests made at the same moment share one network call. Any successful POST / PUT / DELETE, and every
 * login / logout, clears the cache, so a change made by one role is never hidden behind a stale copy.
 */
const cache = new Map<string, { data: unknown; at: number }>();
const inflight = new Map<string, Promise<unknown>>();
let generation = 0; // bumped on invalidation: a response that started before it is not cached
let activeRequests = 0;
const activityListeners = new Set<() => void>();
const emitActivity = () => activityListeners.forEach((l) => l());
export const apiActivity = {
  subscribe: (l: () => void) => {
    activityListeners.add(l);
    return () => {
      activityListeners.delete(l);
    };
  },
  count: () => activeRequests,
};
export const cachedGet = (path: string): unknown => cache.get(path)?.data;
export function invalidateApiCache(): void {
  cache.clear();
  inflight.clear();
  generation++;
}
/** GET through the shared cache: concurrent callers share one request; the result is cached for the next render. */
export function fetchCached<T>(path: string): Promise<T> {
  const running = inflight.get(path);
  if (running) return running as Promise<T>;
  const gen = generation;
  activeRequests++;
  emitActivity();
  const p: Promise<T> = request<T>(path)
    .then((data) => {
      if (gen === generation) cache.set(path, { data, at: Date.now() });
      return data;
    })
    .finally(() => {
      if (inflight.get(path) === p) inflight.delete(path);
      activeRequests--;
      emitActivity();
    });
  inflight.set(path, p);
  return p;
}

export const tokenStore = {
  get: (): string | null => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t: string) => {
    invalidateApiCache(); // a new login never sees the previous user's data
    try {
      localStorage.setItem(TOKEN_KEY, t);
    } catch {
      /* storage unavailable */
    }
  },
  clear: () => {
    invalidateApiCache();
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
  if (method !== "GET") invalidateApiCache(); // a change: every list / detail revalidates from the server
  return json.data as T;
}

/**
 * Posts one file (multipart "file" field) to an endpoint and returns its envelope. With `allowFailure`, a 4xx answer that still
 * carries data (e.g. row-wise import errors) is returned as { ok: false } instead of thrown.
 */
export async function postFile<T>(path: string, file: File, allowFailure = false): Promise<{ ok: boolean; message: string; data: T }> {
  const token = tokenStore.get();
  const fd = new FormData();
  fd.append("file", file);
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
  } catch {
    throw new ApiError("Cannot reach the server. Please check your connection.", 0);
  }
  let json: ApiResponse<T> | null = null;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    /* non-JSON error body */
  }
  if (res.ok && json?.success) {
    invalidateApiCache();
    return { ok: true, message: json.message, data: json.data as T };
  }
  if (allowFailure && json && json.data) return { ok: false, message: json.message, data: json.data as T };
  throw new ApiError(json?.message ?? `Request failed (${res.status})`, res.status);
}

/** Uploads one file (multipart) and returns the stored attachment. Used for vehicle document attachments. */
export async function uploadAttachment(file: File, path = "/vehicles/attachments" /* RBP; RSA has its own route */): Promise<import("@/types/domain").Attachment> {
  const token = tokenStore.get();
  const fd = new FormData();
  fd.append("file", file);
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
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
  invalidateApiCache();
  return json.data;
}

export interface UploadedPhoto { kind: string; storage: string; key: string; name: string; size: number; mimeType: string; url: string }
/** Uploads one vehicle delivery photo (multipart) for a clearance; the server binds the stored file to that delivery. */
export async function uploadDeliveryPhoto(clearanceId: string, kind: "speedometer" | "evidence" | "additional", file: File): Promise<UploadedPhoto> {
  const token = tokenStore.get();
  const fd = new FormData();
  fd.append("file", file);
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/on-road-vehicles/${clearanceId}/photos/${kind}`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
  } catch {
    throw new ApiError("Cannot reach the server. Please check your connection.", 0);
  }
  let json: ApiResponse<UploadedPhoto> | null = null;
  try {
    json = (await res.json()) as ApiResponse<UploadedPhoto>;
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok || !json?.success || !json.data) throw new ApiError(json?.message ?? `Upload failed (${res.status})`, res.status);
  invalidateApiCache();
  return json.data;
}

/** Authenticated file download (Excel / PDF). Saves the response under the server's file name. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const token = tokenStore.get();
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store", headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    throw new ApiError("Cannot reach the server. Please check your connection.", 0);
  }
  if (!res.ok) {
    let msg = `Download failed (${res.status})`;
    try {
      msg = ((await res.json()) as ApiResponse).message ?? msg;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(msg, res.status);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
