import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { VehicleTypeModal } from "../src/components/VehicleTypePicker";
import { REQUEST_VEHICLE_TYPES, stepSelection, sumVehicleTypes, toVehicleTypes, vehicleCardDetails, vehicleTypesError,vehicleTypesText } from "../src/utils/vehicleTypes";

test("+/- never exceeds the vehicle count or goes below zero", () => {
  let s = stepSelection({}, "CENTRE_NO_ROOF", 1, 2);
  s = stepSelection(s, "CENTRE_TRIANGLE_ROOF", 1, 2);
  assert.equal(stepSelection(s, "CENTRE_NO_ROOF", 1, 2), s);
  assert.deepEqual(stepSelection(s, "CENTRE_TRIANGLE_ROOF", -1, 2), { CENTRE_NO_ROOF: 1 });
  assert.deepEqual(stepSelection({}, "CENTRE_NO_ROOF", -1, 2), {});
  assert.equal(vehicleTypesError(s, 2), null);
  assert.match(vehicleTypesError(s, 3)!, /must equal/);
  assert.equal(vehicleTypesError({}, 3), "Select the vehicle types");
});

test("text and totals across requests under one Project Code", () => {
  const list = toVehicleTypes({ CENTRE_NO_ROOF: 2 });
  assert.equal(vehicleTypesText(sumVehicleTypes([list, list, undefined])), "4 × Centre Portion Without Roof");
  assert.equal(vehicleTypesText(undefined), "");
});

test("a vehicle card shows only its own type, Roadshow and Signage", () => {
  const vehicleTypes = toVehicleTypes({ CENTRE_NO_ROOF: 2, CENTRE_TRIANGLE_ROOF: 1 });
  for (const details of [{ numberOfVans: 3, vehicleTypes }, { numberOfVehicles: 3, vehicleTypes }]) {
    const [count] = Object.entries(details)[0];
    assert.deepEqual(vehicleCardDetails(details, "Centre Portion Triangle Roof"), [[count, 3], ["vehicleType", "Centre Portion Triangle Roof"]]);
    assert.deepEqual(vehicleCardDetails(details, null), [[count, 3]]); // never falls back to the project total
  }
});

test("the nine names, in order; a retired type in an old request still shows and adds up", () => {
  assert.deepEqual(REQUEST_VEHICLE_TYPES.map((t) => t.name), ["Centre Portion Without Roof", "Centre Portion Triangle Roof", "L Model Box Roof", "L Model Triangle Roof", "L Model Without Roof", "7×5 LED", "2 Sided LED", "3 Sided LED", "Innovation"]);
  const old = [{ code: "RETIRED", name: "Old Van", quantity: 2 }, { code: "TATA_ACE_9FT_2S_LED", name: "Tata Ace 9 Ft 2 Sides LED", quantity: 1 }];
  assert.equal(vehicleTypesText(sumVehicleTypes([old, old])), "2 × 2 Sided LED, 4 × Old Van");
});

test("the list matches the server's", () => {
  const server = readFileSync(new URL("../../backend/src/utils/vehicleTypes.ts", import.meta.url), "utf8");
  for (const t of REQUEST_VEHICLE_TYPES) assert.ok(server.includes(`{ code: "${t.code}", name: "${t.name}" }`), t.code);
});

test("popup: nine cards, remaining count, Done only when complete", () => {
  const html = (value: Record<string, number>) => renderToStaticMarkup(<VehicleTypeModal count={2} value={value} onChange={() => {}} onClose={() => {}} />);
  assert.equal(html({}).match(/data-code=/g)?.length, 9);
  assert.ok(html({ CENTRE_NO_ROOF: 1 }).includes("1 remaining"));
  assert.match(html({}), /class="btn btn-primary" disabled="">Done/);
  assert.match(html({ CENTRE_NO_ROOF: 2 }), /class="btn btn-primary">Done/);
});
