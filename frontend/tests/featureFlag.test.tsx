process.env.NEXT_PUBLIC_ROADSHOW = "on";
import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import VerticalSelect from "../src/components/ui/VerticalSelect";
import { RsaSummaryCards } from "../src/components/RsaHistory";
import { roadshowOn } from "../src/utils/features";

const summary = { totalEntries: 2, totalAmount: 100, roadshowCount: 1, roadshowAmount: 50, signageCount: 1, signageAmount: 50, recentPaymentAt: null, enteredBy: [] } as never;
const html = () => renderToStaticMarkup(<><VerticalSelect value="" onChange={() => {}} /><RsaSummaryCards s={summary} /></>);

test("Roadshow options and cards follow NEXT_PUBLIC_ROADSHOW; off by default", () => {
  for (const v of [undefined, "off", "yes"]) {
    if (v === undefined) delete process.env.NEXT_PUBLIC_ROADSHOW;
    else process.env.NEXT_PUBLIC_ROADSHOW = v;
    assert.equal(roadshowOn(), false);
    assert.ok(!html().includes("Roadshow") && html().includes("Signage"), String(v));
  }
  process.env.NEXT_PUBLIC_ROADSHOW = "on";
  assert.ok(html().includes('value="ROADSHOW"') && html().includes("Roadshow Payments"));
});

// The dashboard loads its data through hooks, so its conditional wiring is checked in the source.
test("RSOP dashboard: the Vertical column and filter exist only with ROADSHOW on", () => {
  const page = readFileSync(new URL("../src/app/rsop/page.tsx", import.meta.url), "utf8");
  for (const wiring of [
    "{roadshowOn() && <VerticalSelect ", "{roadshowOn() && <th>Vertical</th>}", "{roadshowOn() && <td><span className={`type type-",
    "<td colSpan={roadshowOn() ? 9 : 8}>", // the expanded row spans every column in both modes
  ])
    assert.ok(page.includes(wiring), wiring);
});
