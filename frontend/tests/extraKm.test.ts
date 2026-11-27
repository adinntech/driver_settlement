import test from "node:test";
import assert from "node:assert/strict";
import { allowanceText, extraKmError, kmAllowance, kmText, kmUsage, parseKmPerDay } from "../src/utils/kmAllowance";
import * as server from "../../backend/src/utils/kmAllowance";

test("Extra KM Allotted input (KM per day): required when Yes, > 0, up to 2 decimals, capped", () => {
  assert.equal(extraKmError("20"), null);
  assert.equal(extraKmError("12.5"), null);
  assert.match(extraKmError("")!, /required/);
  assert.match(extraKmError("  ")!, /required/);
  for (const bad of ["0", "abc", "1.234", "-3", "1e3"]) assert.match(extraKmError(bad)!, /greater than 0/, bad);
  assert.match(extraKmError("10001")!, /cannot be more than 10000 KM per day/);
});

test("Yes / No and per-day totals", () => {
  assert.equal(kmAllowance("90 KM per day", 10, false, "50").extraKmAllotted, 0); // No -> 0 whatever was typed
  assert.equal(kmAllowance("90 KM per day", 10, false, "50").totalAllowedKm, 900);
  const a = kmAllowance("90 KM per day", 10, true, "20");
  assert.deepEqual([a.allowedKmPerDay, a.totalAllowedKm], [110, 1100]); // (90 + 20) x 10
  assert.equal(kmAllowance("90", 9, true, 20).totalAllowedKm, 990); // Sunday halt: 9 days
  assert.equal(kmAllowance("90", 1, true, 20).totalAllowedKm, 110);
  assert.equal(kmAllowance("as per client", 10, true, "20").totalAllowedKm, null);
});

test("frontend preview matches the server rule exactly", () => {
  const cases: [unknown, number, boolean, number][] = [["90 KM per day", 10, true, 20], ["62.5", 7, false, 0], ["1,200 km", 3, true, 45.5], ["none", 5, true, 10], ["80", 26, true, 15]];
  for (const [km, days, yes, extra] of cases) {
    const a = kmAllowance(km, days, yes, extra);
    assert.deepEqual(a, server.kmAllowanceOf("ROADSHOW", { kmAllotted: km, numberOfDays: days, extraKmAllowed: yes ? "YES" : "NO", extraKmAllotted: extra }), String(km));
    for (const actual of [0, 850, 1000, 1100, 1500]) assert.deepEqual(kmUsage(a, actual), server.kmUsage(a, actual));
  }
  for (const v of ["90 KM per day", "", "0", "1,200", 12]) assert.equal(parseKmPerDay(v), server.parseKmPerDay(v));
});

test("display text", () => {
  assert.equal(allowanceText(kmAllowance("90", 10, true, "20")), "(90 + 20 extra) km/day x 10 days = 1,100 km");
  assert.equal(allowanceText(kmAllowance("90", 10, false, "")), "90 km/day x 10 days = 900 km");
  assert.equal(allowanceText(null), "-");
  assert.equal(kmText(null), "-");
});
