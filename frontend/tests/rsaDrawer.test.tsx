process.env.NEXT_PUBLIC_ROADSHOW = "on";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { RsaHistoryTable } from "../src/components/RsaHistory";
import { PaymentHistoryTable, RsaDrawer } from "../src/components/RsaPayment";
import type { RsaPaymentRow } from "../src/utils/rsa";

const noop = () => {};
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const pay = (i: number): RsaPaymentRow => ({
  _id: `p${i}`.padEnd(24, "0"), paymentNumber: `PAY-00000${i}/2026-27`, trackupNumber: "JS-1/2026-27", paymentFor: "ROADSHOW", entryDateTime: `2026-11-2${i}T04:30:00.000Z`, cashInHand: true, totalPayable: 500 * i,
  mode: "Cash in Hand", bankName: null, chequeNo: null, createdBy: "RSA", paymentStatus: "ENTERED", foodAmount: 0, salaryAdvance: 0, dieselTotal: 0, expenseTotal: 0, deductTotal: 0, dieselEntries: [], expenses: [],
  vehicleNo: "TN58BK3088", driverNumber: "DR-1", driverName: "X", clientName: "KEN", campaignFromDate: null, campaignToDate: null,
});

test("entry form uses the full width; Payment History is a top-right button that opens a right-side drawer (page fades) with a Close button", () => {
  const screen = src("components/RsaPayment.tsx");
  assert.ok(!screen.includes("rsa-split") && !screen.includes("rsa-right") && !screen.includes("rsa-left")); // no side-by-side column any more
  assert.ok(screen.includes("rsa-full") && screen.includes("rsa-top")); // the form card spans the whole width
  assert.ok(screen.includes("Payment History") && screen.includes("setHistoryOpen(true)") && screen.includes("{historyOpen && ("));
  const css = src("app/globals.css");
  assert.ok(css.includes(".rsa-history-btn") && !css.includes(".rsa-split"));
  for (const k of [".rsa-scrim", ".rsa-drawer", "@keyframes rsa-fade", "@keyframes rsa-slide", "prefers-reduced-motion"]) assert.ok(css.includes(k), k);
  assert.match(css, /\.rsa-drawer \{[^}]*right: 0[^}]*height: 100%/); // pinned to the right edge, full height
});

test("the form itself still has every field and button (only the layout changed)", () => {
  const screen = src("components/RsaPayment.tsx");
  for (const k of ["PaymentFormPanel", "ExpenseTable", "RsaActionBar", "View Budget", "View Driver", "Check Advance Eligibility", "Total Payable", "Cash In Hand", "Salary Advance", "Fuel Cost", "onSaved", "hist.reload()"]) assert.ok(screen.includes(k), k);
});

test("drawer: faded backdrop, titled dialog, Close button; the history inside shows its table (latest first) or the empty state", () => {
  const html = renderToStaticMarkup(<RsaDrawer title="Payment History" onClose={noop}><PaymentHistoryTable items={[pay(2), pay(1)]} total={2} page={1} limit={20} onPage={noop} /></RsaDrawer>);
  for (const v of ['data-section="history-drawer"', 'class="rsa-scrim"', 'role="dialog"', 'aria-label="Payment History"', "Close payment history", ">Close<", "PAY-000002/2026-27", "PAY-000001/2026-27"]) assert.ok(html.includes(v), v);
  assert.ok(html.indexOf("PAY-000002") < html.indexOf("PAY-000001"));
  const empty = renderToStaticMarkup(<RsaDrawer title="Payment History" onClose={noop}><PaymentHistoryTable items={[]} total={0} page={1} limit={20} onPage={noop} /></RsaDrawer>);
  assert.ok(empty.includes("No payments yet") && empty.includes(">Close<"));
  assert.ok(!renderToStaticMarkup(<RsaHistoryTable items={[]} onView={noop} />).includes("history-drawer")); // the landing history table is not a drawer
});
