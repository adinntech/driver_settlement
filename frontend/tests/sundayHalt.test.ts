process.env.NEXT_PUBLIC_ROADSHOW = "on";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isSunday, sundayHaltError } from "../src/utils/dates";

test("Sunday Halt rule: only a Sunday with Sunday Halt Yes is refused", () => {
  assert.equal(isSunday("2026-11-29"), true);
  for (const v of ["2026-11-28", "2026-11-30", "", "nope"]) assert.equal(isSunday(v), false);
  assert.equal(sundayHaltError("2026-11-29", "End date", true), "End date cannot be a Sunday when Sunday Halt is Yes");
  assert.equal(sundayHaltError("2026-11-29", "End date", false), "");
  assert.equal(sundayHaltError("2026-11-30", "End date", true), "");
});

test("the Roadshow form blocks and validates both dates", () => {
  const page = readFileSync(new URL("../src/app/rsop/new/page.tsx", import.meta.url), "utf8");
  assert.equal(page.split("isDayBlocked={noSunday}").length - 1, 2);
  assert.ok(page.includes("e.push(...[endSunday, reportingSunday].filter(Boolean));"));
});
