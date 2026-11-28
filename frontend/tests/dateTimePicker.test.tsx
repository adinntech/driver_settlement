import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import DateTimePicker from "../src/components/ui/DateTimePicker";
import DateInput, { displayDateTime, to12, to24 } from "../src/components/ui/DateInput";

const noop = () => {};

test("12 hour AM/PM conversion round-trips every minute of the day", () => {
  for (let n = 0; n < 24 * 60; n++) {
    const t = `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
    const p = to12(t)!;
    assert.equal(to24(p.h, p.m, p.ap), t);
  }
  assert.deepEqual([to24(12, 0, "AM"), to24(12, 0, "PM"), to24(1, 5, "PM")], ["00:00", "12:00", "13:05"]);
  assert.deepEqual([to12(""), to12("25:00")], [null, null]);
});

test("saved values show as one date-time, exactly as stored (no timezone shift)", () => {
  assert.equal(displayDateTime("2026-11-28", "10:27"), "28-Nov-2026, 10:27 AM");
  assert.equal(displayDateTime("2026-11-28", "00:00"), "28-Nov-2026, 12:00 AM");
  assert.equal(displayDateTime("2026-11-28", ""), "28-Nov-2026, --:-- --");
  assert.equal(displayDateTime("", ""), "");
  const html = renderToStaticMarkup(<DateTimePicker date="2026-11-28" time="23:45" onChange={noop} label="Expected release" />);
  assert.ok(html.includes("28-Nov-2026, 11:45 PM") && html.includes('aria-label="Expected release date and time: 28-Nov-2026, 11:45 PM"'));
  assert.equal((html.match(/<button/g) ?? []).length, 1); // one combined control
  assert.ok(!html.includes('type="time"'));
});

test("date-only fields are unchanged", () => {
  const html = renderToStaticMarkup(<DateInput value="2026-11-28" onChange={noop} aria-label="Campaign Start Date" />);
  assert.ok(html.includes(">28-Nov-2026<") && !html.includes("AM") && !html.includes("ui-datetime"));
});

test("no screen keeps a separate time input", () => {
  for (const f of ["AllotmentModals", "VehicleAvailability", "DriverAvailability"])
    assert.ok(!readFileSync(new URL(`../src/components/${f}.tsx`, import.meta.url), "utf8").includes('type="time"'), f);
});
