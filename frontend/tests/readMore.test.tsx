import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import ReadMore, { isClipped } from "../src/components/ui/ReadMore";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

test("Read more is offered only when the two-line box hides text", () => {
  assert.equal(isClipped({ scrollHeight: 40, clientHeight: 40 }), false);
  assert.equal(isClipped({ scrollHeight: 41, clientHeight: 40 }), false); // sub-pixel rounding
  assert.equal(isClipped({ scrollHeight: 60, clientHeight: 40 }), true);
});

test("collapsed by default with the full text and formatting kept; no toggle before it is measured", () => {
  const html = renderToStaticMarkup(<ReadMore><strong>Reason:</strong> {"A long reason ".repeat(20)}</ReadMore>);
  assert.ok(html.includes("read-more-text clamped"));
  assert.ok(html.includes("<strong>Reason:</strong>") && html.includes("A long reason ".repeat(20)));
  assert.ok(!html.includes("Read more"));
  assert.ok(read("app/globals.css").includes("-webkit-line-clamp: 2"));
});

test("RBP and RSOM reason / remark views use the shared component", () => {
  for (const file of [
    "app/rsom/review/page.tsx", "app/rbp/budget/page.tsx", "app/rbp/vehicles/page.tsx", "app/rbp/vehicles/view/page.tsx",
    "components/RbpApprovalPanel.tsx", "components/HistorySections.tsx", "components/settlement/PaymentQueue.tsx", "components/settlement/PaymentForms.tsx",
    "components/Clearance.tsx", "components/ClearanceDetailView.tsx", "components/AllotmentDetail.tsx", "components/DriverDetails.tsx",
  ])
    assert.match(read(file), /<ReadMore[ >]/, file);
});
