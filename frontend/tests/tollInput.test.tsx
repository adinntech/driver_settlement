import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import TollPlazaInput from "../src/components/TollPlazaInput";
import DateInput from "../src/components/ui/DateInput";

const noop = () => {};

test("TollPlazaInput: an accessible combobox that keeps the typed value (manual entry always possible)", () => {
  const html = renderToStaticMarkup(<TollPlazaInput value="Salem bypass" index={0} vehicleClass="LCV" journey="SINGLE" onType={noop} onPick={noop} />);
  assert.match(html, /role="combobox"/);
  assert.match(html, /aria-autocomplete="list"/);
  assert.match(html, /value="Salem bypass"/);
  assert.match(html, /aria-label="Toll location 1"/);
  assert.match(html, /Search toll plaza 1/);
  const noClass = renderToStaticMarkup(<TollPlazaInput value="" index={1} vehicleClass="" journey="SINGLE" onType={noop} onPick={noop} />);
  assert.match(noClass, /placeholder="Location 2"/); // no lookup without a vehicle class
});

test("DateInput: a saved value outside min / max is kept and flagged, never rewritten", () => {
  const html = renderToStaticMarkup(<DateInput value="2026-11-20" min="2026-12-01" max="2026-12-10" onChange={noop} aria-label="On Road Date" />);
  assert.match(html, /is-invalid/);
  assert.match(html, /20-Nov-2026/);
  const ok = renderToStaticMarkup(<DateInput value="2026-12-05" min="2026-12-01" max="2026-12-10" onChange={noop} aria-label="On Road Date" />);
  assert.doesNotMatch(ok, /is-invalid/);
});
