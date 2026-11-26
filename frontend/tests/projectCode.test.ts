import test from "node:test";
import assert from "node:assert/strict";
import { groupByProjectCode, projectCodeError } from "../src/utils/projectCode";
import type { Project, Vehicle } from "../src/types/domain";

test("Project Code input: exactly 8 digits", () => {
  assert.equal(projectCodeError("12345678"), null);
  assert.equal(projectCodeError("00000001"), null);
  assert.equal(projectCodeError(""), "Project Code is required");
  assert.equal(projectCodeError(undefined), "Project Code is required");
  for (const bad of ["1234567", "123456789", "1234567a", "ABCDEFGH", "1234-678", "12 34567", "１２３４５６７８"])
    assert.equal(projectCodeError(bad), "Project Code must be exactly 8 digits (0-9 only)", bad);
});

let n = 0;
// (types/domain.ts declares two `Vehicle` interfaces that TypeScript merges; only the tracking fields matter here)
const veh = (i: number, budget: "PENDING" | "CREATED" = "PENDING") => ({
  _id: `v${++n}`, project: "", vehicleIndex: i, trackupNumber: `T${n}`, pifNumber: `P${n}`, displayNumber: `D${n}`, budgetStatus: budget, createdAt: "2026-11-01T00:00:00Z",
}) as unknown as Vehicle;
const proj = (id: string, type: Project["projectType"], code: string | undefined, created: string, vehicles: Vehicle[], dates: [string, string] = ["2026-12-01", "2026-12-10"]): Project => ({
  _id: id, projectType: type, clientName: "KFC", projectCode: code, vehicleCount: vehicles.length, createdByName: "RSOP", createdAt: created, vehicles,
  details: type === "ROADSHOW" ? { startDate: dates[0], endDate: dates[1] } : { fromDate: dates[0], toDate: dates[1] },
});

test("grouping: one row per code and type; vehicles keep their own numbers; legacy requests stay separate", () => {
  const list = [ // newest first, as the API returns them
    proj("r3", "ROADSHOW", "12345678", "2026-11-03T00:00:00Z", [veh(1, "CREATED"), veh(2)], ["2026-12-05", "2026-12-20"]),
    proj("s1", "SIGNAGE", "12345678", "2026-11-02T12:00:00Z", [veh(1)]),
    proj("old", "ROADSHOW", undefined, "2026-10-01T00:00:00Z", [veh(1)]),
    proj("old2", "ROADSHOW", undefined, "2026-09-01T00:00:00Z", [veh(1)]),
    proj("r1", "ROADSHOW", "12345678", "2026-11-01T00:00:00Z", Array.from({ length: 10 }, (_, i) => veh(i + 1))),
  ];
  const g = groupByProjectCode(list);
  assert.deepEqual(g.map((x) => x.key), ["ROADSHOW:12345678", "SIGNAGE:12345678", "request:old", "request:old2"]);
  const road = g[0];
  assert.equal(road.vehicleCount, 12);
  assert.equal(road.requests.length, 2);
  assert.equal(road.budgetsCreated, 1);
  assert.deepEqual([road.startDate, road.endDate], ["2026-12-01", "2026-12-20"]); // whole project span
  assert.equal(road.lastCreatedAt, "2026-11-03T00:00:00Z");
  // oldest request first, then vehicle number; positions run 1..12
  assert.deepEqual(road.rows.map((r) => r.p._id), [...Array(10).fill("r1"), "r3", "r3"]);
  assert.deepEqual(road.rows.map((r) => r.position), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.equal(new Set(road.rows.map((r) => r.v.trackupNumber)).size, 12);
  assert.equal(g[1].vehicleCount, 1); // the Signage project with the same code is separate
  assert.equal(g[2].projectCode, null);
  assert.equal(groupByProjectCode([]).length, 0);
});
