/** Same list as backend/src/utils/vehicleTypes.ts (the server validates against its own copy). */
export const REQUEST_VEHICLE_TYPES = [
  { code: "CENTRE_NO_ROOF", name: "Centre Portion Without Roof", size: "small", sides: 0 },
  { code: "CENTRE_TRIANGLE_ROOF", name: "Centre Portion Triangle Roof", size: "small", sides: 0 },
  { code: "L_BOX_ROOF", name: "L Model Box Roof", size: "small", sides: 0 },
  { code: "L_TRIANGLE_ROOF", name: "L Model Triangle Roof", size: "small", sides: 0 },
  { code: "L_NO_ROOF", name: "L Model Without Roof", size: "small", sides: 0 },
  { code: "LED_7X5", name: "7×5 LED", size: "small", sides: 1 },
  { code: "TATA_ACE_9FT_2S_LED", name: "2 Sided LED", size: "small", sides: 2 },
  { code: "TATA_ULTRA_19FT_3S_LED", name: "3 Sided LED", size: "large", sides: 3 },
  { code: "INNOVATION", name: "Innovation", size: "small", sides: 0 },
] as const;

export type VehicleTypeSelection = Record<string, number>;
export interface VehicleTypeQty { code: string; name: string; quantity: number }

export const selectedTotal = (s: VehicleTypeSelection) => Object.values(s).reduce((a, b) => a + b, 0);

/** One step of the +/- buttons: never below 0, and never above the number of vehicles in total. */
export function stepSelection(s: VehicleTypeSelection, code: string, delta: 1 | -1, count: number): VehicleTypeSelection {
  const next = (s[code] ?? 0) + delta;
  if (next < 0 || (delta > 0 && selectedTotal(s) >= count)) return s;
  const out = { ...s, [code]: next };
  if (!next) delete out[code];
  return out;
}

export const toVehicleTypes = (s: VehicleTypeSelection): VehicleTypeQty[] =>
  REQUEST_VEHICLE_TYPES.filter((t) => s[t.code] > 0).map((t) => ({ code: t.code, name: t.name, quantity: s[t.code] }));

export function vehicleTypesError(s: VehicleTypeSelection, count: number): string | null {
  const total = selectedTotal(s);
  if (total === count) return null;
  return total ? `Vehicle type quantities (${total}) must equal the number of vehicles (${count})` : "Select the vehicle types";
}

const isQty = (x: unknown): x is VehicleTypeQty => !!x && typeof x === "object" && "name" in x && "quantity" in x;

/** "2 × 7×5 LED, 1 × ..." ("" when there is nothing, e.g. requests saved before vehicle types). */
export const vehicleTypesText = (v: unknown) => (Array.isArray(v) ? v.filter(isQty).map((x) => `${x.quantity} × ${x.name}`).join(", ") : "");

/**
 * Request details as shown on one vehicle's card: the project-wide type quantities are replaced by that vehicle's own type
 * (left out for vehicles saved before vehicle types).
 */
export const vehicleCardDetails = (details: Record<string, unknown>, vehicleType?: string | null): [string, unknown][] =>
  Object.entries(details).flatMap(([k, v]): [string, unknown][] =>
    k !== "vehicleTypes" ? [[k, v]] : vehicleType ? [["vehicleType", vehicleType]] : [],
  );

/** Adds up the types of several requests under one Project Code. Types no longer offered keep their saved name, listed last. */
export function sumVehicleTypes(lists: unknown[]): VehicleTypeQty[] {
  const total = new Map<string, VehicleTypeQty>();
  for (const list of lists)
    if (Array.isArray(list))
      for (const x of list.filter(isQty)) {
        const current = REQUEST_VEHICLE_TYPES.find((t) => t.code === x.code);
        const seen = total.get(x.code);
        total.set(x.code, { code: x.code, name: current?.name ?? x.name, quantity: (seen?.quantity ?? 0) + x.quantity });
      }
  const rank = (code: string) => { const i = REQUEST_VEHICLE_TYPES.findIndex((t) => t.code === code); return i < 0 ? REQUEST_VEHICLE_TYPES.length : i; };
  return [...total.values()].sort((a, b) => rank(a.code) - rank(b.code));
}
