import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// No DOM test library in this package, so the wiring that allows a second project is checked in the source.
const page = readFileSync(new URL("../src/app/rsop/new/page.tsx", import.meta.url), "utf8");

test("closing the success modal returns to project selection so a second project can be created", () => {
  for (const wiring of [
    "const reset = () => setType(null);",
    "<RoadshowForm onReset={reset} /> : <SignageForm onReset={reset} />",
    'useSubmit("ROADSHOW", onReset)',
    'useSubmit("SIGNAGE", onReset)',
    'title="Tracking numbers created" wide onClose={onReset}',
    // Go to dashboard discards the finished form too: the router would otherwise show it again on return.
    'onReset(); router.push("/rsop");',
  ])
    assert.ok(page.includes(wiring), wiring);
});
