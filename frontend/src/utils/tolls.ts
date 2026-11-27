import { formatDate } from "./format";

/** NHAI fee-rule vehicle classes (same keys as the server's TOLL_VEHICLE_CLASSES). */
export const TOLL_VEHICLE_CLASSES = [
  { key: "CAR", label: "Car / Jeep / Van", hint: "Private non-commercial car, jeep or van" },
  { key: "LCV", label: "LCV / Light Goods Vehicle / Mini Bus", hint: "e.g. Tata Ace, Intra, 407 Gold, Mahindra Bolero Pickup / Maxitruck / Jeeto, Ashok Leyland Dost, Force Traveller, Isuzu D-Max" },
  { key: "BUS_TRUCK", label: "Bus / Truck (2 axle)", hint: "e.g. Eicher Pro 3015, Tata 407 ladder truck and other 2-axle trucks above the LCV range" },
  { key: "AXLE_3", label: "3 Axle Commercial Vehicle", hint: "" },
  { key: "AXLE_4_6", label: "4 to 6 Axle Vehicle", hint: "" },
  { key: "AXLE_7_PLUS", label: "7 or more Axle Vehicle", hint: "" },
  { key: "HCM_EME", label: "HCM / EME", hint: "Heavy construction machinery / earth moving equipment" },
] as const;
export type TollVehicleClass = (typeof TOLL_VEHICLE_CLASSES)[number]["key"];
export const tollClassLabel = (k: string | null | undefined) => TOLL_VEHICLE_CLASSES.find((c) => c.key === k)?.label ?? "";

export type TollJourney = "SINGLE" | "RETURN";
export type TollRateStatus = "OK" | "UNAVAILABLE" | "UNVERIFIED" | "OUTDATED" | "INACTIVE";

export interface TollSearchResult {
  id: number; name: string; code: string | null; state: string | null; nh: string | null; location: string | null; chainage: string | null;
  sourceType: "nhai" | "state"; confidence: string; active: boolean;
  rateEffectiveDate: string | null; rateRevisionDate: string | null; lastUpdated: string | null;
  vehicleClass: TollVehicleClass;
  rate: { single: number | null; return: number | null; status: TollRateStatus; note: string };
}
export interface TollSourceInfo { name: string; url: string; datasetUpdated: string | null; fetchedAt: string; stale: boolean }
export interface TollSearchResponse { source: TollSourceInfo | null; results: TollSearchResult[] }

/** Plaza details stored with a toll row (the server re-reads them from its directory on save). */
export interface TollPlazaRef {
  id: number; name: string; state: string | null; nh: string | null; source: string; sourceType: "nhai" | "state"; confidence: string;
  vehicleClass: TollVehicleClass; journey: TollJourney; fetchedRate: number | null; rateStatus: TollRateStatus | string;
  rateEffectiveDate: string | null; datasetUpdated: string | null; verified?: boolean;
}

/** "Krishnagiri · NH 44 · Tamil Nadu" */
export const plazaLabel = (p: { name: string; nh?: string | null; state?: string | null }) =>
  [p.name, p.nh ? `NH ${p.nh}` : "", p.state ?? ""].filter(Boolean).join(" · ");

export const journeyRate = (r: TollSearchResult, j: TollJourney) => (j === "RETURN" ? r.rate.return : r.rate.single);

/** Only a published, current, complete-schedule rate is filled in automatically. Everything else needs the user. */
export const canAutoFill = (r: TollSearchResult, j: TollJourney) => r.rate.status === "OK" && journeyRate(r, j) !== null;

export function plazaRef(r: TollSearchResult, j: TollJourney, source: TollSourceInfo | null): TollPlazaRef {
  const fetched = journeyRate(r, j);
  return {
    id: r.id, name: r.name, state: r.state, nh: r.nh, source: source?.name ?? "Toll directory", sourceType: r.sourceType, confidence: r.confidence,
    vehicleClass: r.vehicleClass, journey: j, fetchedRate: fetched, rateStatus: fetched === null ? "UNAVAILABLE" : r.rate.status,
    rateEffectiveDate: r.rateEffectiveDate, datasetUpdated: source?.datasetUpdated ?? r.lastUpdated,
  };
}

/** Row patch after picking a plaza: the rate is filled only when it can be trusted; otherwise it is left for manual entry. */
export function applyPlaza(r: TollSearchResult, j: TollJourney, source: TollSourceInfo | null): { location: string; rate: string; plaza: TollPlazaRef } {
  const fetched = journeyRate(r, j);
  return { location: plazaLabel(r).slice(0, 120), rate: canAutoFill(r, j) && fetched !== null ? String(fetched) : "", plaza: plazaRef(r, j, source) };
}

export type RateOrigin = "AUTO" | "AUTO_EDITED" | "MANUAL";
export function rateOrigin(rate: string, plaza?: TollPlazaRef | null): RateOrigin {
  if (!plaza || plaza.fetchedRate === null) return "MANUAL";
  return rate !== "" && Number(rate) === plaza.fetchedRate ? "AUTO" : "AUTO_EDITED";
}

export const STATUS_TEXT: Record<string, string> = {
  OK: "Published NHAI rate",
  UNAVAILABLE: "Rate not available, enter manually",
  UNVERIFIED: "Unverified state-highway data",
  OUTDATED: "Rate period ended, may be revised",
  INACTIVE: "Plaza marked inactive",
};

/** Source line shown under the toll table. */
export function sourceLine(s: TollSourceInfo | null): string {
  if (!s) return "";
  return `Source: ${s.name}${s.datasetUpdated ? ` · data updated ${formatDate(s.datasetUpdated)}` : ""}${s.stale ? " · could not refresh, showing the last saved copy" : ""}`;
}
