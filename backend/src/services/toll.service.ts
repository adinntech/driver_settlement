import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "../config/index.js";
import { AppError } from "../utils/AppError.js";
import { istDateOf, todayIst } from "../utils/dates.js";

/**
 * Toll plaza directory used by the RBP budget form.
 *
 * Source: the open "India Toll Plaza" dataset (github.com/ForceGT/india-toll-plazas, data/latest.json). Its national-highway
 * rows are compiled from NHAI RajMargyatra fee data ("data_source": "nhai", confidence "complete"); state-highway rows are
 * community curated ("state", usually "partial", many rates null). NHAI's own TIS website has no documented public API, so it
 * is not scraped. The file (~3 MB) is downloaded on the server only, normalised to a compact form, kept in memory and on disk,
 * and refreshed at most once per TTL. Searches never download anything.
 */

export const TOLL_VEHICLE_CLASSES = ["CAR", "LCV", "BUS_TRUCK", "AXLE_3", "AXLE_4_6", "AXLE_7_PLUS", "HCM_EME"] as const;
export type TollVehicleClass = (typeof TOLL_VEHICLE_CLASSES)[number];
/** NHAI fee-rule vehicle categories (as printed on NHAI fee plates). */
export const TOLL_VEHICLE_CLASS_LABEL: Record<TollVehicleClass, string> = {
  CAR: "Car / Jeep / Van",
  LCV: "LCV / Light Goods Vehicle / Mini Bus",
  BUS_TRUCK: "Bus / Truck (2 axle)",
  AXLE_3: "3 Axle Commercial Vehicle",
  AXLE_4_6: "4 to 6 Axle Vehicle",
  AXLE_7_PLUS: "7 or more Axle Vehicle",
  HCM_EME: "HCM / EME",
};
const CLASS_PREFIX: Record<TollVehicleClass, string> = {
  CAR: "car", LCV: "lcv", BUS_TRUCK: "bus", AXLE_3: "multiaxle", AXLE_4_6: "axle_4_6", AXLE_7_PLUS: "axle_7_plus", HCM_EME: "hcm",
};
export const isTollVehicleClass = (v: unknown): v is TollVehicleClass => TOLL_VEHICLE_CLASSES.includes(v as TollVehicleClass);

export const TOLL_SOURCE_NAME = "India Toll Plaza dataset (ForceGT/india-toll-plazas; NH rates from NHAI RajMargyatra)";

export interface TollRates { single: number | null; return: number | null }
export interface TollPlaza {
  id: number;
  name: string;
  code: string | null;
  state: string | null;
  nh: string | null;
  location: string | null;
  chainage: string | null;
  sourceType: "nhai" | "state";
  confidence: "complete" | "partial" | "verified";
  active: boolean;
  rateEffectiveDate: string | null; // IST calendar date
  rateRevisionDate: string | null; // next planned revision (IST)
  lastUpdated: string | null; // IST date the record was last refreshed by the dataset
  rates: Partial<Record<TollVehicleClass, TollRates>>;
  key: string; // pre-normalised search text
  nameKey: string;
}

/** Why a rate may or may not be applied automatically. Only OK rates are auto-filled. */
export type TollRateStatus = "OK" | "UNAVAILABLE" | "UNVERIFIED" | "OUTDATED" | "INACTIVE";
const STATUS_NOTE: Record<TollRateStatus, string> = {
  OK: "Rate from the NHAI fee schedule in the dataset",
  UNAVAILABLE: "No published rate for this vehicle class; enter the rate manually",
  UNVERIFIED: "State-highway rate from partial community data; verify before using",
  OUTDATED: "The dataset's rate period has ended; rates may have been revised, verify before using",
  INACTIVE: "Plaza is marked inactive in the dataset; verify before using",
};

export function rateStatus(p: TollPlaza, cls: TollVehicleClass, today: string): TollRateStatus {
  const r = p.rates[cls];
  if (!r || r.single === null) return "UNAVAILABLE";
  if (!p.active) return "INACTIVE";
  const trusted = p.confidence === "verified" || (p.sourceType === "nhai" && p.confidence === "complete");
  if (!trusted) return "UNVERIFIED";
  if (p.rateRevisionDate && p.rateRevisionDate < today) return "OUTDATED";
  return "OK";
}

// ------------------------------------------------------------------------------------------------ normalisation

type Raw = Record<string, unknown>;
/** Control characters and angle brackets become spaces (dataset text is shown in the UI). */
export const cleanText = (s: string) => [...s].map((c) => (c < " " || c === "\u007f" || c === "<" || c === ">" ? " " : c)).join("");
const str = (v: unknown, max = 200): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const t = cleanText(String(v)).replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};
/** A positive rupee amount, else null (missing / zero / garbage are all "no rate"). */
const rate = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 100_000 ? Math.round(n * 100) / 100 : null;
};
export const searchKey = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
const titleCase = (s: string | null) => (s ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : null);

export function normalizePlaza(r: Raw): TollPlaza | null {
  const id = Number(r.tollplaza_id);
  const name = str(r.tollplaza_name, 120);
  if (!Number.isInteger(id) || !name) return null;
  const rates: TollPlaza["rates"] = {};
  for (const cls of TOLL_VEHICLE_CLASSES) {
    const pre = CLASS_PREFIX[cls];
    rates[cls] = { single: rate(r[`${pre}_single`]), return: rate(r[`${pre}_return`]) };
  }
  const state = titleCase(str(r.state_name, 60));
  const nh = str(r.nh_no, 20);
  const location = str(r.location, 200);
  const chainage = str(r.chainage, 200);
  const confidence = r.data_confidence === "complete" || r.data_confidence === "verified" ? r.data_confidence : "partial";
  return {
    id, name, code: str(r.tollplaza_code, 30), state, nh, location, chainage,
    sourceType: r.data_source === "nhai" ? "nhai" : "state", confidence, active: r.active !== false,
    rateEffectiveDate: istDateOf(r.rate_effective_date), rateRevisionDate: istDateOf(r.rate_revision_date), lastUpdated: istDateOf(r.last_updated),
    rates,
    nameKey: searchKey(name),
    key: searchKey([name, state, nh ? `nh ${nh} nh${nh}` : "", location, chainage].filter(Boolean).join(" ")),
  };
}

export function normalizeDataset(raw: unknown): TollPlaza[] {
  if (!Array.isArray(raw)) throw new Error("Toll dataset is not a list");
  const out: TollPlaza[] = [];
  const seen = new Set<number>();
  for (const r of raw) {
    const p = r && typeof r === "object" ? normalizePlaza(r as Raw) : null;
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  if (out.length < 100) throw new Error(`Toll dataset looks incomplete (${out.length} usable plazas)`);
  return out;
}

// ------------------------------------------------------------------------------------------------ search

export interface TollSearchResult {
  id: number; name: string; code: string | null; state: string | null; nh: string | null; location: string | null; chainage: string | null;
  sourceType: "nhai" | "state"; confidence: string; active: boolean;
  rateEffectiveDate: string | null; rateRevisionDate: string | null; lastUpdated: string | null;
  vehicleClass: TollVehicleClass; rate: { single: number | null; return: number | null; status: TollRateStatus; note: string };
}

export function searchPlazas(plazas: TollPlaza[], q: string, cls: TollVehicleClass, opts: { limit?: number; today?: string } = {}): TollSearchResult[] {
  const query = searchKey(q);
  if (query.length < 2) return [];
  const tokens = query.split(" ");
  const today = opts.today ?? todayIst();
  const scored: { p: TollPlaza; s: number }[] = [];
  for (const p of plazas) {
    if (!tokens.every((t) => p.key.includes(t))) continue;
    let s = 0;
    if (p.nameKey === query) s += 100;
    else if (p.nameKey.startsWith(query)) s += 60;
    else if (p.nameKey.includes(query)) s += 40;
    for (const t of tokens) if (p.nameKey.split(" ").includes(t)) s += 8;
    if (p.sourceType === "nhai") s += 2; // prefer the official-schedule rows on ties
    scored.push({ p, s });
  }
  scored.sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name) || a.p.id - b.p.id);
  return scored.slice(0, opts.limit ?? 12).map(({ p }) => toResult(p, cls, today));
}

export function toResult(p: TollPlaza, cls: TollVehicleClass, today = todayIst()): TollSearchResult {
  const status = rateStatus(p, cls, today);
  const r = p.rates[cls] ?? { single: null, return: null };
  return {
    id: p.id, name: p.name, code: p.code, state: p.state, nh: p.nh, location: p.location, chainage: p.chainage,
    sourceType: p.sourceType, confidence: p.confidence, active: p.active,
    rateEffectiveDate: p.rateEffectiveDate, rateRevisionDate: p.rateRevisionDate, lastUpdated: p.lastUpdated,
    vehicleClass: cls, rate: { single: r.single, return: r.return, status, note: STATUS_NOTE[status] },
  };
}

// ------------------------------------------------------------------------------------------------ cached directory

interface Snapshot { plazas: TollPlaza[]; fetchedAt: number; datasetUpdated: string | null }
export interface TollDirectoryOptions {
  url: string;
  cacheFile: string | null;
  ttlMs: number;
  fetchJson?: (url: string) => Promise<unknown>;
  now?: () => number;
}
export interface TollSourceInfo { name: string; url: string; datasetUpdated: string | null; fetchedAt: string; stale: boolean }

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Toll dataset download failed (HTTP ${res.status})`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > 50_000_000) throw new Error("Toll dataset is unexpectedly large");
  return res.json();
}

export function createTollDirectory(o: TollDirectoryOptions) {
  const now = o.now ?? Date.now;
  const fetchJson = o.fetchJson ?? defaultFetchJson;
  let snap: Snapshot | null = null;
  let diskChecked = false;
  let inflight: Promise<Snapshot> | null = null;
  let lastFailure = 0;
  const RETRY_AFTER_FAILURE_MS = 5 * 60_000; // a failing source is not hammered on every keystroke

  const fresh = (s: Snapshot | null) => !!s && now() - s.fetchedAt < o.ttlMs;
  const latestUpdate = (plazas: TollPlaza[]) => plazas.reduce<string | null>((m, p) => (p.lastUpdated && (!m || p.lastUpdated > m) ? p.lastUpdated : m), null);

  async function readDisk(): Promise<Snapshot | null> {
    if (!o.cacheFile) return null;
    try {
      const j = JSON.parse(await readFile(o.cacheFile, "utf8"));
      if (!Array.isArray(j?.plazas) || typeof j.fetchedAt !== "number") return null;
      return { plazas: j.plazas, fetchedAt: j.fetchedAt, datasetUpdated: j.datasetUpdated ?? null };
    } catch {
      return null;
    }
  }
  async function writeDisk(s: Snapshot) {
    if (!o.cacheFile) return;
    try {
      await mkdir(dirname(o.cacheFile), { recursive: true });
      const tmp = `${o.cacheFile}.tmp`;
      await writeFile(tmp, JSON.stringify(s));
      await rename(tmp, o.cacheFile);
    } catch {
      /* the disk cache is an optimisation only */
    }
  }
  async function download(): Promise<Snapshot> {
    const plazas = normalizeDataset(await fetchJson(o.url));
    const s = { plazas, fetchedAt: now(), datasetUpdated: latestUpdate(plazas) };
    await writeDisk(s);
    return s;
  }

  /** Current snapshot; refreshes when older than the TTL and serves the old copy (flagged stale) if the source is down. */
  async function load(): Promise<{ snap: Snapshot; stale: boolean }> {
    if (!snap && !diskChecked) {
      diskChecked = true;
      snap = await readDisk();
    }
    if (fresh(snap)) return { snap: snap!, stale: false };
    if (snap && now() - lastFailure < RETRY_AFTER_FAILURE_MS) return { snap, stale: true };
    try {
      inflight ??= download().finally(() => (inflight = null));
      snap = await inflight;
      return { snap, stale: false };
    } catch (e) {
      lastFailure = now();
      if (snap) return { snap, stale: true };
      throw new AppError(`Toll rate source is unavailable right now (${(e as Error).message}). Enter the toll rate manually.`, 503);
    }
  }

  const info = (s: Snapshot, stale: boolean): TollSourceInfo => ({
    name: TOLL_SOURCE_NAME, url: o.url, datasetUpdated: s.datasetUpdated, fetchedAt: new Date(s.fetchedAt).toISOString(), stale,
  });

  return {
    async search(q: string, cls: TollVehicleClass, limit = 12) {
      const { snap: s, stale } = await load();
      return { source: info(s, stale), results: searchPlazas(s.plazas, q, cls, { limit }) };
    },
    /** One plaza by id, or null when unknown / the source cannot be loaded (callers must not fail a save on that). */
    async find(id: number, cls: TollVehicleClass): Promise<{ result: TollSearchResult; source: TollSourceInfo } | null> {
      try {
        const { snap: s, stale } = await load();
        const p = s.plazas.find((x) => x.id === id);
        return p ? { result: toResult(p, cls), source: info(s, stale) } : null;
      } catch {
        return null;
      }
    },
    /** Test hook. */
    reset() {
      snap = null;
      diskChecked = false;
      inflight = null;
      lastFailure = 0;
    },
  };
}

export type TollDirectory = ReturnType<typeof createTollDirectory>;

let shared: TollDirectory | null = null;
export const tollDirectory = (): TollDirectory =>
  (shared ??= createTollDirectory({ url: config.tolls.dataUrl, cacheFile: config.tolls.cacheFile, ttlMs: config.tolls.ttlMs }));
/** Tests swap the shared directory (e.g. for an offline fixture). */
export const setTollDirectory = (d: TollDirectory | null) => void (shared = d);
