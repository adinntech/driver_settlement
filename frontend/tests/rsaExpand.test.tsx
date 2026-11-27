import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { PaymentDetailBody, PaymentHistoryTable } from "../src/components/RsaPayment";
import type { RsaPaymentRow } from "../src/utils/rsa";

const noop = () => {};
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const pay = (i: number, over: Partial<RsaPaymentRow> = {}): RsaPaymentRow => ({
  _id: `p${i}`.padEnd(24, "0"), paymentNumber: `PAY-00000${i}/2026-27`, trackupNumber: "JS-69478/2026-27", paymentFor: "ROADSHOW", entryDateTime: "2026-11-24T04:12:00.000Z", cashInHand: true, totalPayable: 500,
  mode: "Cash in Hand", bankName: null, chequeNo: null, createdBy: "RSA", paymentStatus: "ENTERED", foodAmount: 100, salaryAdvance: 100, dieselTotal: 150, expenseTotal: 150, deductTotal: 0,
  dieselEntries: [{ amount: 150, mode: null, reference: null, entryAt: "2026-11-24T04:12:00.000Z" }],
  expenses: [{ optionKey: "FLEET_BALANCE", optionLabel: "Fleet Balance", description: "sdfds", amount: 150, deduct: false, isDefault: false }],
  vehicleNo: "TN58BK3088", driverNumber: "DR-9838", driverName: "sathish kumar", clientName: "Aavin", campaignFromDate: "2026-11-29", campaignToDate: "2026-12-13", pifNumber: "PIF-92359", billNumber: null, ...over,
});
const table = (items: RsaPaymentRow[], open: string[] = []) =>
  renderToStaticMarkup(<PaymentHistoryTable items={items} total={items.length} page={1} limit={20} onPage={noop} initiallyOpen={open} />);

test("history rows show an Expand button (not View); the details are collapsed by default", () => {
  const html = table([pay(1), pay(2)]);
  assert.equal((html.match(/Expand ▼/g) ?? []).length, 2);
  assert.ok(!html.includes(">View<") && !html.includes("Collapse"));
  assert.ok(!html.includes('data-section="payment-detail-body"') && !html.includes("Diesel entries") && !html.includes("Fleet Balance")); // nothing expanded yet
  assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 2);
  assert.ok(html.includes("PAY-000001/2026-27") && html.includes("₹500.00")); // the summary columns are still there
});

test("expanding a row shows its complete details right under it with a Collapse button; the other rows stay collapsed", () => {
  const a = pay(1);
  const b = pay(2);
  const html = table([a, b], [a._id]);
  assert.equal((html.match(/Collapse ▲/g) ?? []).length, 1);
  assert.equal((html.match(/Expand ▼/g) ?? []).length, 1);
  assert.equal((html.match(/data-section="payment-detail-body"/g) ?? []).length, 1);
  assert.match(html, /aria-expanded="true"/);
  assert.ok(html.includes(`id="pay-${a._id}"`) && html.includes(`aria-controls="pay-${a._id}"`));
  for (const v of ["Payment Number", "Trackup Number", "JS-69478/2026-27", "PIF Number", "PIF-92359", "Client / Billing Name", "Aavin", "Campaign Period", "29-Nov-2026 – 13-Dec-2026", "DR-9838 · sathish kumar", "Food Allowance", "Salary Advance",
    "Expenses (added)", "Deductions", "Diesel entries", "Expenses", "Fleet Balance", "sdfds", "Total Payable", "Status", "Entered"]) assert.ok(html.includes(v), v);
  // the detail row sits directly after its own row (before the next payment)
  assert.ok(html.indexOf(`id="pay-${a._id}"`) < html.indexOf("PAY-000002/2026-27"));
  assert.ok(html.includes('colSpan="10"') || html.includes('colspan="10"'));
  const both = table([a, b], [a._id, b._id]);
  assert.equal((both.match(/data-section="payment-detail-body"/g) ?? []).length, 2); // several rows can be open
});

test("collapsed again = details gone (state is per row and toggles)", () => {
  const src2 = src("components/RsaPayment.tsx");
  assert.ok(src2.includes("const toggle = (id: string) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]))"));
  assert.ok(src2.includes("{isOpen && (") && src2.includes('{isOpen ? "Collapse ▲" : "Expand ▼"}'));
  assert.equal((table([pay(1)], []).match(/payment-detail-body/g) ?? []).length, 0);
});

test("no modal opens over the drawer any more: the history drawer uses inline expansion only", () => {
  const screen = src("components/RsaPayment.tsx");
  assert.ok(!screen.includes("setDetail") && !screen.includes("<PaymentDetail p={detail}")); // the old overlay (which opened behind the drawer) is gone
  assert.ok(screen.includes("<PaymentHistoryTable items={hist.data.items}") && !/PaymentHistoryTable[^>]*onView/.test(screen));
  assert.ok(src("app/globals.css").includes(".rsa-detail-row"));
  // the landing history page (no drawer behind it) still uses its modal
  assert.ok(src("app/rsa/page.tsx").includes("PaymentDetail p={view}"));
});

test("detail body copes with missing values and plain payments (no undefined / null text)", () => {
  const html = renderToStaticMarkup(<PaymentDetailBody p={pay(3, { pifNumber: null, billNumber: undefined, dieselEntries: [], expenses: [], driverNumber: null, driverName: null, campaignFromDate: null, campaignToDate: null, clientName: null })} />);
  assert.ok(!html.includes("undefined") && !html.includes("null") && !html.includes("NaN"));
  assert.ok(!html.includes("Diesel entries") && !html.includes("<h4 class=\"sub\">Expenses</h4>")); // empty sections are not rendered
  assert.ok(html.includes("Payment Number") && html.includes("Total Payable"));
});
