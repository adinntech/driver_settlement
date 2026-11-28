import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// No DOM test library: the wiring is checked in the source (the counting rules are tested in the backend).
const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

test("Vehicle Deliver shows the unread rejection badge to RBP, and only opening a detail marks it viewed", () => {
  assert.ok(src("components/AppShell.tsx").includes('n.href === "/rbp/on-road" && <RejectedBadge path="/on-road-vehicles/rejections/unviewed"'));
  assert.ok(src("components/RejectedBadge.tsx").includes("if (count < 1) return null;"));
  assert.ok(src("components/ClearanceDetailView.tsx").includes('const unseen = mode === "RBP" &&'));
  assert.ok(!src("app/rbp/on-road/page.tsx").includes("markAllocationRejectionViewed"));
});
