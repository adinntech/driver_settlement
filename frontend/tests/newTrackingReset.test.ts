process.env.NEXT_PUBLIC_ROADSHOW = "on";
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

test("ROADSHOW off opens the Signage form directly; on keeps the type selection", () => {
  assert.ok(page.includes("{roadshowOn() ? <Wizard /> : <SignageOnly />}"));
  const only = page.slice(page.indexOf("function SignageOnly"), page.indexOf("function Wizard"));
  // the same form, no selection cards, and a finished form is discarded by remounting it
  assert.ok(only.includes("<SignageForm onReset={() => setRound((n) => n + 1)} />") && only.includes("key={round}"));
  assert.ok(!only.includes("type-pick") && !only.includes("RoadshowForm"));
  assert.ok(page.slice(page.indexOf("function Wizard")).includes('(["ROADSHOW", "SIGNAGE"] as ProjectType[])'));
});
