process.env.NEXT_PUBLIC_ROADSHOW = "on";
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import Select from "../src/components/ui/Select";
import DateInput, { displayDate } from "../src/components/ui/DateInput";

const noop = () => {};

test("Select: styled combobox trigger + hidden native select kept in sync (value, options, label, disabled)", () => {
  const html = renderToStaticMarkup(
    <Select value="SIGNAGE" onChange={noop} aria-label="Project type filter">
      <option value="">All</option>
      <option value="ROADSHOW">Roadshow</option>
      <option value="SIGNAGE">Signage</option>
    </Select>,
  );
  assert.match(html, /role="combobox"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /<option value="SIGNAGE" selected="">Signage<\/option>/);
  assert.match(html, /class="ui-select-value">Signage</);
  assert.ok(html.includes('aria-label="Project type filter"'));
  assert.match(html, /aria-label="Clear selection"/, "a chosen value can be cleared when an empty option exists");
  const dis = renderToStaticMarkup(<Select value="ROADSHOW" disabled aria-label="Payment For"><option value="ROADSHOW">Roadshow</option></Select>);
  assert.match(dis, /<select[^>]*disabled=""[^>]*aria-label="Payment For"/);
  assert.ok(!dis.includes("Clear selection"));
});

test("Select: empty value shows the placeholder option text; fragments and mapped options are collected", () => {
  const html = renderToStaticMarkup(
    <Select value="" onChange={noop}>
      <option value="">Select…</option>
      <>{["A", "B"].map((x) => <option key={x} value={x}>{x}</option>)}</>
    </Select>,
  );
  assert.match(html, /ui-select-value is-placeholder">Select…</);
  assert.equal((html.match(/<option /g) ?? []).length, 3);
});

test("DateInput: shows the app date format, keeps YYYY-MM-DD in a native date input with min / max", () => {
  const html = renderToStaticMarkup(<DateInput value="2026-11-25" min="2026-11-01" max="2026-12-31" onChange={noop} aria-label="From date" />);
  assert.ok(html.includes('type="date"'));
  assert.match(html, /value="2026-11-25"/);
  assert.match(html, /min="2026-11-01"/);
  assert.match(html, /max="2026-12-31"/);
  assert.match(html, />25-Nov-2026</);
  assert.match(html, /aria-haspopup="dialog"/);
  const empty = renderToStaticMarkup(<DateInput value="" onChange={noop} />);
  assert.match(empty, /is-placeholder">dd-mmm-yyyy</);
  assert.equal(displayDate("2026-01-05"), "05-Jan-2026");
  assert.equal(displayDate("bad"), "");
});
