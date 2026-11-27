/**
 * Vehicle types RSOP can request (frontend/src/utils/vehicleTypes.ts holds the same list).
 * Records keep the code and name they were saved with, so a type removed from this list still displays; it just cannot be picked.
 * The two TATA_ codes are renamed types: their codes are kept and db/vehicleTypeNames.ts updates the saved names.
 */
export const REQUEST_VEHICLE_TYPES = [
  { code: "CENTRE_NO_ROOF", name: "Centre Portion Without Roof" },
  { code: "CENTRE_TRIANGLE_ROOF", name: "Centre Portion Triangle Roof" },
  { code: "L_BOX_ROOF", name: "L Model Box Roof" },
  { code: "L_TRIANGLE_ROOF", name: "L Model Triangle Roof" },
  { code: "L_NO_ROOF", name: "L Model Without Roof" },
  { code: "LED_7X5", name: "7×5 LED" },
  { code: "TATA_ACE_9FT_2S_LED", name: "2 Sided LED" },
  { code: "TATA_ULTRA_19FT_3S_LED", name: "3 Sided LED" },
  { code: "INNOVATION", name: "Innovation" },
] as const;

export interface VehicleTypeQty { code: string; name: string; quantity: number }

/** Checks the requested [{ code, quantity }] against the vehicle count. Names and order always come from the list above. */
export function parseVehicleTypes(input: unknown, count: number): { errors: string[]; items: VehicleTypeQty[] } {
  const fail = (m: string) => ({ errors: [m], items: [] as VehicleTypeQty[] });
  if (!Array.isArray(input) || input.length === 0) return fail("Select the vehicle types");
  const picked = new Map<string, number>();
  for (const row of input) {
    const { code, quantity } = (row ?? {}) as { code?: unknown; quantity?: unknown };
    if (typeof code !== "string" || !REQUEST_VEHICLE_TYPES.some((t) => t.code === code)) return fail("Unknown vehicle type");
    if (picked.has(code)) return fail("A vehicle type is listed more than once");
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) return fail("Vehicle type quantity must be a whole number of at least 1");
    picked.set(code, quantity);
  }
  const total = [...picked.values()].reduce((a, b) => a + b, 0);
  if (total !== count) return fail(`Vehicle type quantities (${total}) must equal the number of vehicles (${count})`);
  return { errors: [], items: REQUEST_VEHICLE_TYPES.filter((t) => picked.has(t.code)).map((t) => ({ code: t.code, name: t.name, quantity: picked.get(t.code)! })) };
}
