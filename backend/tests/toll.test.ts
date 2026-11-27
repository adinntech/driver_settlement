import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTollDirectory, normalizeDataset, normalizePlaza, rateStatus, searchPlazas, toResult, TOLL_VEHICLE_CLASSES, type TollPlaza,
} from "../src/services/toll.service.js";
import { rateSourceOf, validateBudget } from "../src/validators/budget.validator.js";

/** Rows shaped exactly like data/latest.json of ForceGT/india-toll-plazas (field names and string-typed numbers). */
const nh = (id: number, name: string, state: string | null, nhNo: string, car: string | null, lcv: string | null, extra: Record<string, unknown> = {}) => ({
  data_source: "nhai", data_confidence: "complete", tollplaza_id: id, tollplaza_name: name, tollplaza_code: String(500000 + id), state_name: state,
  nh_no: nhNo, location: name, chainage: `Km ${id}.000 to Km ${id + 30}.000`,
  car_single: car, car_return: car ? String(Number(car) * 1.5) : null, lcv_single: lcv, lcv_return: lcv ? String(Number(lcv) * 1.5) : null,
  bus_single: "285", bus_return: "430", multiaxle_single: "310", axle_4_6_single: "450", axle_7_plus_single: "545", hcm_single: "450",
  rate_effective_date: "2026-03-31T18:30:00.000Z", rate_revision_date: "2027-03-30T18:30:00.000Z", active: true, last_updated: "2026-07-07T08:52:02.630Z",
  ...extra,
});
const filler = Array.from({ length: 120 }, (_, i) => nh(5000 + i, `Filler Plaza ${i}`, "RAJASTHAN", "52", "100", "160"));
const FIXTURE = [
  nh(1, "Krishnagiri", "TAMIL NADU", "44", "85", "135"),
  nh(2, "Krishnagiri Bypass", "TAMIL NADU", "48", "60", "100"),
  nh(3, "Vaniyambadi", "TAMIL NADU", "48", "115", "185"),
  nh(4, "Shahpura Toll Plaza", "RAJASTHAN", "48", "95", "150"),
  nh(5, "Shahpura Toll Plaza", "MADHYA PRADESH", "45", "70", "110"),
  { ...nh(6, "Ghat Road State Plaza", "TELANGANA", "SH1", null, null), data_source: "state", data_confidence: "partial", nh_no: null },
  { ...nh(7, "Partial With Rate", "GUJARAT", "SH9", "40", "65"), data_source: "state", data_confidence: "partial" },
  nh(8, "Closed Plaza", "KERALA", "66", "75", "120", { active: false }),
  nh(9, "Old Rates Plaza", "BIHAR", "19", "90", "140", { rate_revision_date: "2026-03-30T18:30:00.000Z" }),
  { ...nh(10, "Expressway Verified", "MAHARASHTRA", "", "320", null), data_source: "state", data_confidence: "verified" },
  nh(11, "Zero Rate Plaza", "ODISHA", "16", "0", "garbage"),
  ...filler,
];
const TODAY = "2026-11-25";
const plazas = normalizeDataset(FIXTURE);
const byId = (id: number) => plazas.find((p) => p.id === id) as TollPlaza;

test("normalisation: real field names, string rates parsed, dates converted to the IST calendar day (no one-day shift)", () => {
  const k = byId(1);
  assert.equal(k.name, "Krishnagiri");
  assert.equal(k.state, "Tamil Nadu");
  assert.equal(k.nh, "44");
  assert.deepEqual(k.rates.CAR, { single: 85, return: 127.5 });
  assert.deepEqual(k.rates.LCV, { single: 135, return: 202.5 });
  assert.equal(k.rates.BUS_TRUCK?.single, 285);
  // 2026-03-31T18:30Z is midnight 1 April in India: the FY rate start, not 31 March
  assert.equal(k.rateEffectiveDate, "2026-04-01");
  assert.equal(k.rateRevisionDate, "2027-03-31");
  assert.equal(k.lastUpdated, "2026-07-07");
  assert.equal(normalizePlaza({ tollplaza_name: "no id" }), null);
  // zero / garbage rates are "no rate", never a guessed number
  assert.deepEqual(byId(11).rates.CAR, { single: null, return: null });
  assert.deepEqual(byId(11).rates.LCV, { single: null, return: null });
});

test("normalisation rejects a non-list or near-empty dataset", () => {
  assert.throws(() => normalizeDataset({}), /not a list/);
  assert.throws(() => normalizeDataset(FIXTURE.slice(0, 5)), /incomplete/);
});

test("search: exact match first, then prefix; matches state and NH; multiple similar names all offered", () => {
  const r = searchPlazas(plazas, "krishnagiri", "LCV", { today: TODAY });
  assert.deepEqual(r.map((x) => x.id), [1, 2]); // exact name before "Krishnagiri Bypass"
  assert.deepEqual(searchPlazas(plazas, "krishnagiri nh 48", "LCV", { today: TODAY }).map((x) => x.id), [2]);
  assert.deepEqual(searchPlazas(plazas, "NH44", "LCV", { today: TODAY }).map((x) => x.id), [1]);
  assert.deepEqual(searchPlazas(plazas, "vaniyambadi tamil", "LCV", { today: TODAY }).map((x) => x.id), [3]);
  const same = searchPlazas(plazas, "Shahpura Toll Plaza", "CAR", { today: TODAY });
  assert.equal(same.length, 2); // same name in two states: the user picks by state / NH
  assert.deepEqual(new Set(same.map((x) => x.state)), new Set(["Rajasthan", "Madhya Pradesh"]));
  assert.deepEqual(searchPlazas(plazas, "k", "CAR"), []); // too short
  assert.deepEqual(searchPlazas(plazas, "no such plaza anywhere", "CAR"), []);
  assert.equal(searchPlazas(plazas, "filler", "CAR", { limit: 5 }).length, 5);
});

test("vehicle class selects the matching rate column (not always car)", () => {
  assert.equal(toResult(byId(1), "CAR", TODAY).rate.single, 85);
  assert.equal(toResult(byId(1), "LCV", TODAY).rate.single, 135);
  assert.equal(toResult(byId(1), "BUS_TRUCK", TODAY).rate.single, 285);
  assert.equal(toResult(byId(1), "AXLE_3", TODAY).rate.single, 310);
  assert.equal(toResult(byId(1), "LCV", TODAY).rate.return, 202.5);
  assert.equal(TOLL_VEHICLE_CLASSES.length, 7);
});

test("rate status: only complete, current, active NHAI (or verified) rates are OK", () => {
  assert.equal(rateStatus(byId(1), "LCV", TODAY), "OK");
  assert.equal(rateStatus(byId(6), "LCV", TODAY), "UNAVAILABLE"); // state row, no rate
  assert.equal(rateStatus(byId(7), "LCV", TODAY), "UNVERIFIED"); // partial community data
  assert.equal(rateStatus(byId(8), "LCV", TODAY), "INACTIVE");
  assert.equal(rateStatus(byId(9), "LCV", TODAY), "OUTDATED"); // rate period ended 2026-03-31
  assert.equal(rateStatus(byId(10), "CAR", TODAY), "OK"); // authoritative override
  assert.equal(rateStatus(byId(10), "LCV", TODAY), "UNAVAILABLE"); // no LCV rate published
  assert.equal(rateStatus(byId(11), "CAR", TODAY), "UNAVAILABLE");
  assert.match(toResult(byId(6), "LCV", TODAY).rate.note, /manually/);
});

test("directory: downloads once, serves searches from cache, refreshes after TTL", async () => {
  let calls = 0;
  let clock = 1_000_000;
  const dir = createTollDirectory({ url: "x", cacheFile: null, ttlMs: 60_000, now: () => clock, fetchJson: async () => (calls++, FIXTURE) });
  const a = await dir.search("krishnagiri", "LCV");
  await dir.search("vaniyambadi", "LCV");
  await dir.search("shahpura", "CAR");
  assert.equal(calls, 1);
  assert.equal(a.results[0].rate.single, 135);
  assert.equal(a.source.stale, false);
  assert.equal(a.source.datasetUpdated, "2026-07-07");
  assert.match(a.source.name, /ForceGT/);
  clock += 61_000;
  await dir.search("krishnagiri", "LCV");
  assert.equal(calls, 2);
});

test("directory: concurrent first searches share one download", async () => {
  let calls = 0;
  const dir = createTollDirectory({ url: "x", cacheFile: null, ttlMs: 60_000, fetchJson: async () => (calls++, await new Promise((r) => setTimeout(r, 20)), FIXTURE) });
  await Promise.all([dir.search("krish", "CAR"), dir.search("vani", "CAR"), dir.search("shah", "CAR")]);
  assert.equal(calls, 1);
});

test("directory: source down with no copy -> 503 asking for manual entry; with a copy -> stale data served", async () => {
  const down = createTollDirectory({ url: "x", cacheFile: null, ttlMs: 60_000, fetchJson: async () => { throw new Error("ECONNREFUSED"); } });
  await assert.rejects(down.search("krishnagiri", "LCV"), (e: Error & { statusCode?: number }) => /unavailable/.test(e.message) && /manually/.test(e.message));
  assert.equal(await down.find(1, "LCV"), null); // a budget save is never blocked by the source

  let clock = 0;
  let fail = false;
  const flaky = createTollDirectory({ url: "x", cacheFile: null, ttlMs: 1000, now: () => clock, fetchJson: async () => { if (fail) throw new Error("timeout"); return FIXTURE; } });
  await flaky.search("krishnagiri", "LCV");
  fail = true;
  clock += 5000;
  const r = await flaky.search("krishnagiri", "LCV");
  assert.equal(r.source.stale, true);
  assert.equal(r.results[0].id, 1);
});

test("directory: a bad download never replaces good data", async () => {
  let clock = 0;
  let payload: unknown = FIXTURE;
  const dir = createTollDirectory({ url: "x", cacheFile: null, ttlMs: 1000, now: () => clock, fetchJson: async () => payload });
  await dir.search("krishnagiri", "LCV");
  payload = { error: "rate limited" };
  clock += 5000;
  const r = await dir.search("krishnagiri", "LCV");
  assert.equal(r.source.stale, true);
  assert.equal(r.results.length, 2);
});

test("directory: disk cache survives a restart without downloading again", async () => {
  const dirPath = await mkdtemp(join(tmpdir(), "toll-"));
  try {
    const file = join(dirPath, "toll.json");
    let calls = 0;
    const opts = { url: "x", cacheFile: file, ttlMs: 3_600_000, fetchJson: async () => (calls++, FIXTURE) };
    await createTollDirectory(opts).search("krishnagiri", "LCV");
    const saved = JSON.parse(await readFile(file, "utf8"));
    assert.equal(saved.plazas.length, plazas.length);
    const restarted = createTollDirectory(opts);
    const r = await restarted.search("krishnagiri", "LCV");
    assert.equal(calls, 1);
    assert.equal(r.results[0].rate.single, 135);
  } finally {
    await rm(dirPath, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------------------------------------ budget toll rows

const base = { onRoadDate: "2026-12-01", completionDate: "2026-12-05", numberOfDays: 5 };
const ref = (over: Record<string, unknown> = {}) => ({
  id: 1, name: "Krishnagiri", state: "Tamil Nadu", nh: "44", source: "test", sourceType: "nhai", confidence: "complete",
  vehicleClass: "LCV", journey: "SINGLE", fetchedRate: 135, rateStatus: "OK", rateEffectiveDate: "2026-04-01", datasetUpdated: "2026-07-07", ...over,
});

test("budget toll rows: plaza link kept, rate origin derived (auto / edited / manual), legacy rows unchanged", () => {
  const v = validateBudget({
    ...base, tollVehicleClass: "LCV",
    tolls: [
      { location: "Krishnagiri · NH 44", rate: 135, plaza: ref() },
      { location: "Krishnagiri · NH 44", rate: 150, plaza: ref() },
      { location: "Ghat Road", rate: 55, plaza: ref({ id: 6, fetchedRate: null, rateStatus: "UNAVAILABLE" }) },
      { location: "Salem", rate: 80 },
    ],
  });
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.data.tolls.map((t) => t.rateSource), ["AUTO", "AUTO_EDITED", "MANUAL", undefined]);
  assert.deepEqual(v.data.tolls[3], { location: "Salem", rate: 80 }); // manual rows stay exactly as before
  assert.equal(v.data.tolls[0].plaza?.verified, false); // only the server marks a plaza verified
  assert.equal(v.data.tollVehicleClass, "LCV");
  // multiple tolls still add up
  assert.equal(v.data.tolls.reduce((s, t) => s + t.rate, 0), 420);
  assert.equal(rateSourceOf(10, null), "MANUAL");
});

test("budget toll rows: class required with a plaza, must match, and must be valid", () => {
  assert.match(validateBudget({ ...base, tolls: [{ location: "K", rate: 135, plaza: ref() }] }).errors.join(), /choose the toll vehicle class/);
  assert.match(validateBudget({ ...base, tollVehicleClass: "CAR", tolls: [{ location: "K", rate: 135, plaza: ref() }] }).errors.join(), /different vehicle class/);
  assert.match(validateBudget({ ...base, tollVehicleClass: "TRACTOR" }).errors.join(), /vehicle class is not valid/);
  assert.match(validateBudget({ ...base, tollVehicleClass: "LCV", tolls: [{ location: "K", rate: 1, plaza: { id: "x" } }] }).errors.join(), /reference is invalid/);
  assert.match(validateBudget({ ...base, tollVehicleClass: "LCV", tolls: [{ location: "K", rate: 1, plaza: ref({ fetchedRate: -4 }) }] }).errors.join(), /fetched toll rate is invalid/);
  assert.equal(validateBudget(base).data.tollVehicleClass, null); // older payloads without the field stay valid
});
