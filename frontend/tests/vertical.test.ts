process.env.NEXT_PUBLIC_ROADSHOW = "on";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { VERTICAL_OPTIONS, verticalLabel } from "../src/utils/vertical";
import { emptyQueueFilters, exportQuery, queueQuery } from "../src/utils/settlement";
import { ioclQuery } from "../src/utils/iocl";

test("exactly the three options, All Verticals first", () => {
  assert.deepEqual(VERTICAL_OPTIONS.map((o) => [o.value, o.label]), [["", "All Verticals"], ["ROADSHOW", "Roadshow"], ["SIGNAGE", "Signage"]]);
  assert.deepEqual(["ROADSHOW", "SIGNAGE", null].map(verticalLabel), ["Roadshow", "Signage", "—"]);
});

test("the filter travels with the list, its pages and the filtered export", () => {
  const f = { ...emptyQueueFilters("DAILY", "APPROVED"), projectType: "SIGNAGE", q: "kfc" };
  assert.match(queueQuery(f, 2, 10), /projectType=SIGNAGE.*page=2/);
  assert.match(exportQuery(f), /projectType=SIGNAGE/);
  assert.ok(!queueQuery(emptyQueueFilters(), 1, 10).includes("projectType"));
  assert.match(ioclQuery({ from: "", to: "", vehicleNo: "", product: "", projectType: "ROADSHOW" }), /projectType=ROADSHOW/);
});

test("every list screen offers the shared Vertical filter and column", () => {
  const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
  const screens = [
    "app/rsop/page.tsx", "app/rbp/page.tsx", "app/rbp/vehicles/page.tsx", "app/rbp/vehicles/allotment/page.tsx", "app/rbp/vehicles/allotment-history/page.tsx", "app/rbp/drivers/page.tsx",
    "app/rsom/page.tsx", "app/rso/reports/page.tsx", "components/Clearance.tsx", "components/OnRoadVehicles.tsx", "components/settlement/PaymentQueue.tsx", "components/settlement/PaymentForms.tsx",
    "components/RsaDashboard.tsx", "components/RsaHistory.tsx", "components/IoclData.tsx",
  ];
  for (const p of screens) assert.ok(src(p).includes("<VerticalSelect"), `${p}: filter`);
  assert.ok(readdirSync(new URL("../src/components", import.meta.url)).length > 0);
  for (const p of ["components/BulkPaymentModal.tsx", "components/settlement/BulkApproveModal.tsx", "components/settlement/BulkEntryModal.tsx", "components/DriverList.tsx"]) assert.match(src(p), /Vertical/, `${p}: column`);
});
