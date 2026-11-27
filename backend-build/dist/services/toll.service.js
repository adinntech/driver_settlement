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
export const TOLL_VEHICLE_CLASSES = ["CAR", "LCV", "BUS_TRUCK", "AXLE_3", "AXLE_4_6", "AXLE_7_PLUS", "HCM_EME"];
/** NHAI fee-rule vehicle categories (as printed on NHAI fee plates). */
export const TOLL_VEHICLE_CLASS_LABEL = {
    CAR: "Car / Jeep / Van",
    LCV: "LCV / Light Goods Vehicle / Mini Bus",
    BUS_TRUCK: "Bus / Truck (2 axle)",
    AXLE_3: "3 Axle Commercial Vehicle",
    AXLE_4_6: "4 to 6 Axle Vehicle",
    AXLE_7_PLUS: "7 or more Axle Vehicle",
    HCM_EME: "HCM / EME",
};
const CLASS_PREFIX = {
    CAR: "car", LCV: "lcv", BUS_TRUCK: "bus", AXLE_3: "multiaxle", AXLE_4_6: "axle_4_6", AXLE_7_PLUS: "axle_7_plus", HCM_EME: "hcm",
};
export const isTollVehicleClass = (v) => TOLL_VEHICLE_CLASSES.includes(v);
export const TOLL_SOURCE_NAME = "India Toll Plaza dataset (ForceGT/india-toll-plazas; NH rates from NHAI RajMargyatra)";
const STATUS_NOTE = {
    OK: "Rate from the NHAI fee schedule in the dataset",
    UNAVAILABLE: "No published rate for this vehicle class; enter the rate manually",
    UNVERIFIED: "State-highway rate from partial community data; verify before using",
    OUTDATED: "The dataset's rate period has ended; rates may have been revised, verify before using",
    INACTIVE: "Plaza is marked inactive in the dataset; verify before using",
};
export function rateStatus(p, cls, today) {
    const r = p.rates[cls];
    if (!r || r.single === null)
        return "UNAVAILABLE";
    if (!p.active)
        return "INACTIVE";
    const trusted = p.confidence === "verified" || (p.sourceType === "nhai" && p.confidence === "complete");
    if (!trusted)
        return "UNVERIFIED";
    if (p.rateRevisionDate && p.rateRevisionDate < today)
        return "OUTDATED";
    return "OK";
}
/** Control characters and angle brackets become spaces (dataset text is shown in the UI). */
export const cleanText = (s) => [...s].map((c) => (c < " " || c === "\u007f" || c === "<" || c === ">" ? " " : c)).join("");
const str = (v, max = 200) => {
    if (typeof v !== "string" && typeof v !== "number")
        return null;
    const t = cleanText(String(v)).replace(/\s+/g, " ").trim();
    return t ? t.slice(0, max) : null;
};
/** A positive rupee amount, else null (missing / zero / garbage are all "no rate"). */
const rate = (v) => {
    if (v === null || v === undefined || v === "")
        return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n < 100_000 ? Math.round(n * 100) / 100 : null;
};
export const searchKey = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
const titleCase = (s) => (s ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : null);
export function normalizePlaza(r) {
    const id = Number(r.tollplaza_id);
    const name = str(r.tollplaza_name, 120);
    if (!Number.isInteger(id) || !name)
        return null;
    const rates = {};
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
export function normalizeDataset(raw) {
    if (!Array.isArray(raw))
        throw new Error("Toll dataset is not a list");
    const out = [];
    const seen = new Set();
    for (const r of raw) {
        const p = r && typeof r === "object" ? normalizePlaza(r) : null;
        if (!p || seen.has(p.id))
            continue;
        seen.add(p.id);
        out.push(p);
    }
    if (out.length < 100)
        throw new Error(`Toll dataset looks incomplete (${out.length} usable plazas)`);
    return out;
}
export function searchPlazas(plazas, q, cls, opts = {}) {
    const query = searchKey(q);
    if (query.length < 2)
        return [];
    const tokens = query.split(" ");
    const today = opts.today ?? todayIst();
    const scored = [];
    for (const p of plazas) {
        if (!tokens.every((t) => p.key.includes(t)))
            continue;
        let s = 0;
        if (p.nameKey === query)
            s += 100;
        else if (p.nameKey.startsWith(query))
            s += 60;
        else if (p.nameKey.includes(query))
            s += 40;
        for (const t of tokens)
            if (p.nameKey.split(" ").includes(t))
                s += 8;
        if (p.sourceType === "nhai")
            s += 2; // prefer the official-schedule rows on ties
        scored.push({ p, s });
    }
    scored.sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name) || a.p.id - b.p.id);
    return scored.slice(0, opts.limit ?? 12).map(({ p }) => toResult(p, cls, today));
}
export function toResult(p, cls, today = todayIst()) {
    const status = rateStatus(p, cls, today);
    const r = p.rates[cls] ?? { single: null, return: null };
    return {
        id: p.id, name: p.name, code: p.code, state: p.state, nh: p.nh, location: p.location, chainage: p.chainage,
        sourceType: p.sourceType, confidence: p.confidence, active: p.active,
        rateEffectiveDate: p.rateEffectiveDate, rateRevisionDate: p.rateRevisionDate, lastUpdated: p.lastUpdated,
        vehicleClass: cls, rate: { single: r.single, return: r.return, status, note: STATUS_NOTE[status] },
    };
}
async function defaultFetchJson(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { accept: "application/json" } });
    if (!res.ok)
        throw new Error(`Toll dataset download failed (HTTP ${res.status})`);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > 50_000_000)
        throw new Error("Toll dataset is unexpectedly large");
    return res.json();
}
export function createTollDirectory(o) {
    const now = o.now ?? Date.now;
    const fetchJson = o.fetchJson ?? defaultFetchJson;
    let snap = null;
    let diskChecked = false;
    let inflight = null;
    let lastFailure = 0;
    const RETRY_AFTER_FAILURE_MS = 5 * 60_000; // a failing source is not hammered on every keystroke
    const fresh = (s) => !!s && now() - s.fetchedAt < o.ttlMs;
    const latestUpdate = (plazas) => plazas.reduce((m, p) => (p.lastUpdated && (!m || p.lastUpdated > m) ? p.lastUpdated : m), null);
    async function readDisk() {
        if (!o.cacheFile)
            return null;
        try {
            const j = JSON.parse(await readFile(o.cacheFile, "utf8"));
            if (!Array.isArray(j?.plazas) || typeof j.fetchedAt !== "number")
                return null;
            return { plazas: j.plazas, fetchedAt: j.fetchedAt, datasetUpdated: j.datasetUpdated ?? null };
        }
        catch {
            return null;
        }
    }
    async function writeDisk(s) {
        if (!o.cacheFile)
            return;
        try {
            await mkdir(dirname(o.cacheFile), { recursive: true });
            const tmp = `${o.cacheFile}.tmp`;
            await writeFile(tmp, JSON.stringify(s));
            await rename(tmp, o.cacheFile);
        }
        catch {
            /* the disk cache is an optimisation only */
        }
    }
    async function download() {
        const plazas = normalizeDataset(await fetchJson(o.url));
        const s = { plazas, fetchedAt: now(), datasetUpdated: latestUpdate(plazas) };
        await writeDisk(s);
        return s;
    }
    /** Current snapshot; refreshes when older than the TTL and serves the old copy (flagged stale) if the source is down. */
    async function load() {
        if (!snap && !diskChecked) {
            diskChecked = true;
            snap = await readDisk();
        }
        if (fresh(snap))
            return { snap: snap, stale: false };
        if (snap && now() - lastFailure < RETRY_AFTER_FAILURE_MS)
            return { snap, stale: true };
        try {
            inflight ??= download().finally(() => (inflight = null));
            snap = await inflight;
            return { snap, stale: false };
        }
        catch (e) {
            lastFailure = now();
            if (snap)
                return { snap, stale: true };
            throw new AppError(`Toll rate source is unavailable right now (${e.message}). Enter the toll rate manually.`, 503);
        }
    }
    const info = (s, stale) => ({
        name: TOLL_SOURCE_NAME, url: o.url, datasetUpdated: s.datasetUpdated, fetchedAt: new Date(s.fetchedAt).toISOString(), stale,
    });
    return {
        async search(q, cls, limit = 12) {
            const { snap: s, stale } = await load();
            return { source: info(s, stale), results: searchPlazas(s.plazas, q, cls, { limit }) };
        },
        /** One plaza by id, or null when unknown / the source cannot be loaded (callers must not fail a save on that). */
        async find(id, cls) {
            try {
                const { snap: s, stale } = await load();
                const p = s.plazas.find((x) => x.id === id);
                return p ? { result: toResult(p, cls), source: info(s, stale) } : null;
            }
            catch {
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
let shared = null;
export const tollDirectory = () => (shared ??= createTollDirectory({ url: config.tolls.dataUrl, cacheFile: config.tolls.cacheFile, ttlMs: config.tolls.ttlMs }));
/** Tests swap the shared directory (e.g. for an offline fixture). */
export const setTollDirectory = (d) => void (shared = d);
