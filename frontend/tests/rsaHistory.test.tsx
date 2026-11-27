import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { RsaProjectTable } from "../src/components/RsaDashboard";
import {
  HISTORY_COLUMNS, HistoryEmpty, RsaHistoryFilters, RsaHistoryTable, RsaPager, RsaSummaryCards, emptyHistoryFilters, historyFiltersActive, historyQuery, type RsaSummary,
} from "../src/components/RsaHistory";
import { PaymentDetail } from "../src/components/RsaPayment";
import type { RsaPaymentRow, RsaProjectRow } from "../src/utils/rsa";

const noop = () => {};
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const pay = (i: number, over: Partial<RsaPaymentRow> = {}): RsaPaymentRow => ({
  _id: `p${i}`.padEnd(24, "0"), paymentNumber: `PAY-00000${i}/2026-27`, trackupNumber: `JS-1000${i}/2026-27`, paymentFor: i % 2 ? "SIGNAGE" : "ROADSHOW", entryDateTime: `2026-11-2${i}T04:30:00.000Z`, cashInHand: false,
  totalPayable: 1000 * i + 0.5, mode: "ePayment", bankName: null, chequeNo: null, createdBy: "RSA", paymentStatus: "ENTERED", foodAmount: 100, salaryAdvance: 0, dieselTotal: 900, expenseTotal: 0, deductTotal: 0,
  dieselEntries: [], expenses: [], vehicleNo: "TN58BK3088", driverNumber: "DR-4821", driverName: "SAMPATH M", clientName: "KEN LIFESTYLES", campaignFromDate: "2026-11-24", campaignToDate: "2026-12-02",
  pifNumber: "PIF-11111", billNumber: "B-77", ...over,
});
const summary: RsaSummary = { totalEntries: 12, totalAmount: 154321.75, roadshowCount: 5, roadshowAmount: 54321.25, signageCount: 7, signageAmount: 100000.5, recentPaymentAt: "2026-11-24T06:30:00.000Z", createdByOptions: ["RSA"] };

// ================================================================== landing page flow
test("landing page is the payment history; the entry form is not part of it and opens only through + Enter Payment", () => {
  const page = src("app/rsa/page.tsx");
  assert.ok(page.includes('href="/rsa/new"') && page.includes("+ Enter Payment")); // top-right button
  assert.ok(!page.includes("PaymentFormPanel") && !page.includes("RsaPaymentScreen") && !page.includes("payment-form")); // form is not on the landing page
  assert.ok(page.includes("RsaHistoryTable") && page.includes("RsaSummaryCards") && page.includes("RsaHistoryFilters") && page.includes("RsaPager"));
  assert.ok(page.includes("/rsa/payments?") && page.includes("/rsa/payments/summary")); // server-side list + totals
  assert.ok(page.includes("useDebounce(f.q)")); // debounced search
  assert.ok(page.includes("setPage(1)")); // filter changes go back to page 1
  const table = renderToStaticMarkup(<RsaHistoryTable items={[pay(1)]} onView={noop} />);
  assert.ok(!table.includes('data-section="payment-form"') && !table.includes("Total Payable</label>"));
});

test("+ Enter Payment: project selection first (eligible projects only), then the form page; saving returns to the history", () => {
  const pick = src("app/rsa/new/page.tsx");
  assert.ok(pick.includes("/rsa/projects?") && pick.includes('actionLabel="Select"')); // the eligibility-filtered list
  assert.ok(pick.includes("Back to payment entries") && pick.includes('href="/rsa"'));
  assert.ok(!pick.includes("PaymentFormPanel")); // the form is not shown while choosing
  const row: RsaProjectRow = {
    trackingVehicle: "t".repeat(24), allotment: "a".repeat(24), trackupNumber: "JS-22342/2026-27", pifNumber: "PIF-1", projectType: "ROADSHOW", clientName: "KEN", projectName: null,
    vehicleNo: "TN58BK3088", driverNumber: "DR-1", driverName: "SAMPATH M", campaignFromDate: "2026-11-24", campaignToDate: "2026-12-02", approvedBudgetAmount: 1000, budgetVersion: 1,
    vehicleAllottedAt: null, driverAssignedAt: null, allotmentStatus: "ACTIVE", paymentCount: 0, paymentStatus: "PENDING", lastPaymentAt: null,
  };
  const html = renderToStaticMarkup(<RsaProjectTable items={[row]} actionLabel="Select" />);
  assert.ok(html.includes(`href="/rsa/payment?id=${"t".repeat(24)}"`) && html.includes(">Select<"));
  assert.ok(renderToStaticMarkup(<RsaProjectTable items={[row]} />).includes(">Payment Entry<")); // default label unchanged
  const form = src("app/rsa/payment/page.tsx");
  assert.ok(form.includes("onSaved={() => router.push(\"/rsa\")}") && form.includes("onClose={() => router.push(\"/rsa\")}"));
  const screen = src("components/RsaPayment.tsx");
  assert.ok(screen.includes("onSaved") && screen.includes("hist.reload()")); // save -> caller returns to the history, which loads fresh data
  assert.ok(screen.includes("key.current = newSubmissionKey()") && screen.includes("if (inflight.current) return")); // duplicate-click protection is intact
});

// ================================================================== summary cards
test("summary cards show the five real totals; amounts in the app currency format; empty values are dashes", () => {
  const html = renderToStaticMarkup(<RsaSummaryCards s={summary} />);
  for (const v of ["Total Payment Entries", ">12<", "Total Payment Amount", "₹1,54,321.75", "Roadshow Payments", ">5<", "₹54,321.25", "Signage Payments", ">7<", "₹1,00,000.50", "Recent Payment Date", "24-Nov-2026, 12:00 PM"])
    assert.ok(html.includes(v), v);
  const empty = renderToStaticMarkup(<RsaSummaryCards s={{ ...summary, totalEntries: 0, totalAmount: 0, roadshowCount: 0, roadshowAmount: 0, signageCount: 0, signageAmount: 0, recentPaymentAt: null }} />);
  assert.ok(empty.includes("₹0.00") && empty.includes(">—<") && !empty.includes("undefined") && !empty.includes("NaN"));
});

// ================================================================== filters
test("filters: one mass search, Payment For, status, payment date range, created by (only when several users), Clear Filters", () => {
  const html = renderToStaticMarkup(<RsaHistoryFilters f={emptyHistoryFilters()} onChange={noop} onClear={noop} createdByOptions={["RSA"]} />);
  for (const l of ['aria-label="Mass search"', 'aria-label="Vertical"', '>All Verticals<', 'aria-label="Payment status filter"', 'aria-label="Payment date from"', 'aria-label="Payment date to"', "Clear Filters", ">Roadshow<", ">Signage<"]) assert.ok(html.includes(l), l);
  assert.equal((html.match(/aria-label="Mass search"/g) ?? []).length, 1);
  assert.ok(html.includes("payment no") && html.includes("expense description") && html.includes("vehicle") && html.includes("driver") && html.includes("PIF"));
  assert.ok(!html.includes('aria-label="Created by filter"')); // a single RSA user: nothing to choose
  const multi = renderToStaticMarkup(<RsaHistoryFilters f={emptyHistoryFilters()} onChange={noop} onClear={noop} createdByOptions={["RSA", "RSA2"]} />);
  assert.ok(multi.includes('aria-label="Created by filter"') && multi.includes(">RSA2<"));
  assert.match(html, /<button[^>]*disabled=""[^>]*>Clear Filters/);
});

test("Clear Filters: enabled only while a filter is applied, and resets every filter", () => {
  assert.equal(historyFiltersActive(emptyHistoryFilters()), false);
  for (const k of ["q", "paymentFor", "from", "to", "createdBy", "paymentStatus"] as const) assert.equal(historyFiltersActive({ ...emptyHistoryFilters(), [k]: "x" }), true, k);
  assert.equal(historyFiltersActive({ ...emptyHistoryFilters(), q: "   " }), false); // a blank search is not a filter
  const on = renderToStaticMarkup(<RsaHistoryFilters f={{ ...emptyHistoryFilters(), paymentFor: "SIGNAGE", q: "ken" }} onChange={noop} onClear={noop} createdByOptions={[]} />);
  assert.ok(!/<button[^>]*disabled=""[^>]*>Clear Filters/.test(on));
  assert.match(on, /<option value="SIGNAGE" selected="">Signage/);
  assert.ok(on.includes('value="ken"'));
  assert.deepEqual(emptyHistoryFilters(), { q: "", paymentFor: "", from: "", to: "", createdBy: "", paymentStatus: "" });
});

test("filters are combined into one server request together with the page and page size", () => {
  const f = { q: " kens ", paymentFor: "SIGNAGE", from: "2026-11-01", to: "2026-11-30", createdBy: "RSA", paymentStatus: "ENTERED" };
  assert.equal(historyQuery(f, 2, 25), "q=kens&paymentFor=SIGNAGE&from=2026-11-01&to=2026-11-30&createdBy=RSA&paymentStatus=ENTERED&page=2&limit=25");
  assert.equal(historyQuery(emptyHistoryFilters(), 1, 10), "page=1&limit=10");
  assert.equal(historyQuery({ ...emptyHistoryFilters(), q: "a&b=c" }, 1, 10), "q=a%26b%3Dc&page=1&limit=10"); // search text can never inject extra parameters
  assert.equal(historyQuery({ ...emptyHistoryFilters(), paymentFor: "ROADSHOW" }, 3, 50), "paymentFor=ROADSHOW&page=3&limit=50"); // a filter change resets page to 1 in the page; the query keeps whatever page it is given
});

// ================================================================== table, empty, pagination
test("history table: the twelve requested columns with correct values; order as delivered (latest first); no undefined", () => {
  assert.deepEqual([...HISTORY_COLUMNS], ["Payment Number", "Trackup Number", "PIF Number", "Vertical", "Client / Billing Name", "Vehicle Number", "Driver Name", "From Date", "To Date", "Total Payable", "Entry Date & Time", "Created By", "Actions"]);
  const html = renderToStaticMarkup(<RsaHistoryTable items={[pay(3), pay(2), pay(1, { driverName: null, clientName: null, campaignFromDate: null, campaignToDate: null })]} onView={noop} />);
  for (const h of HISTORY_COLUMNS.filter((c) => c !== "Actions")) assert.ok(html.includes(`<th>${h.replace(/&/g, "&amp;")}</th>`), h);
  for (const v of ["PAY-000003/2026-27", "JS-10003/2026-27", "Signage", "Roadshow", "KEN LIFESTYLES", "TN58BK3088", "SAMPATH M", "24-Nov-2026", "02-Dec-2026", "₹3,000.50", "23-Nov-2026, 10:00 AM", "RSA"]) assert.ok(html.includes(v), v);
  assert.ok(html.indexOf("PAY-000003") < html.indexOf("PAY-000002") && html.indexOf("PAY-000002") < html.indexOf("PAY-000001"));
  assert.equal((html.match(/View Details/g) ?? []).length, 3);
  assert.ok(!html.includes("undefined") && !html.includes("null") && !html.includes("NaN"));
  assert.ok(html.includes("table-wrap")); // horizontally scrollable on small screens
});

test("empty states: no payments at all vs. no match for the filters; nothing rendered as a table", () => {
  const none = renderToStaticMarkup(<HistoryEmpty filtered={false} />);
  assert.ok(none.includes("No payment entries yet") && none.includes("+ Enter Payment") && !none.includes("<table"));
  const filtered = renderToStaticMarkup(<HistoryEmpty filtered />);
  assert.ok(filtered.includes("No payments match your filters") && filtered.includes("clear the filters"));
});

test("pagination: total count, page x of y, page size choices, Previous / Next disabled at the ends; zero records handled", () => {
  const mid = renderToStaticMarkup(<RsaPager total={95} page={5} limit={10} onPage={noop} onLimit={noop} />);
  assert.ok(mid.includes("95 payment(s) · page 5 of 10") && !/<button[^>]*disabled=""/.test(mid));
  for (const n of [10, 25, 50, 100]) assert.ok(mid.includes(`<option value="${n}"`), String(n));
  const first = renderToStaticMarkup(<RsaPager total={95} page={1} limit={10} onPage={noop} onLimit={noop} />);
  assert.match(first, /<button[^>]*disabled=""[^>]*>Previous/);
  assert.ok(!/<button[^>]*disabled=""[^>]*>Next/.test(first));
  const last = renderToStaticMarkup(<RsaPager total={95} page={10} limit={10} onPage={noop} onLimit={noop} />);
  assert.match(last, /<button[^>]*disabled=""[^>]*>Next/);
  const zero = renderToStaticMarkup(<RsaPager total={0} page={1} limit={10} onPage={noop} onLimit={noop} />);
  assert.ok(zero.includes("0 payment(s) · page 1 of 1") && /<button[^>]*disabled=""[^>]*>Previous/.test(zero) && /<button[^>]*disabled=""[^>]*>Next/.test(zero));
});

// ================================================================== view details
test("View Details shows the complete saved payment: project, vehicle, driver, campaign, diesel, food, advance, expenses, deductions, total, time, user, status", () => {
  const html = renderToStaticMarkup(<PaymentDetail onClose={noop} p={pay(2, {
    cashInHand: true, foodAmount: 150.25, salaryAdvance: 500, dieselTotal: 1200.5, expenseTotal: 120.1, deductTotal: 20, totalPayable: 1950.85,
    dieselEntries: [{ amount: 1000.5, mode: "ePayment", reference: "AXIS IMPS", entryAt: "2026-11-22T04:30:00.000Z" }, { amount: 200, mode: null, reference: null, entryAt: "2026-11-22T04:30:00.000Z" }],
    expenses: [{ optionKey: "TOLL", optionLabel: "Toll", description: "Salem toll", amount: 120.1, deduct: false, isDefault: false }, { optionKey: "OTHERS", optionLabel: "Others", description: "refund", amount: 20, deduct: true, isDefault: false }],
  })} />);
  for (const v of ["Payment PAY-000002/2026-27", "Trackup Number", "JS-10002/2026-27", "PIF Number", "PIF-11111", "Bill Number", "B-77", "Client / Billing Name", "KEN LIFESTYLES", "Campaign Period", "24-Nov-2026 – 02-Dec-2026",
    "TN58BK3088", "DR-4821 · SAMPATH M", "Roadshow", "Cash In Hand", "Yes", "Food Allowance", "₹150.25", "Salary Advance", "₹500.00", "Diesel entries", "AXIS IMPS", "₹1,000.50", "Expenses", "Toll", "Salem toll",
    "Expenses (added)", "₹120.10", "Deductions", "₹20.00", "refund", "Total Payable", "₹1,950.85", "Entry Date &amp; Time", "22-Nov-2026, 10:00 AM", "Created By", "RSA", "Status", "Entered"]) assert.ok(html.includes(v), v);
  assert.ok(!html.includes("undefined") && !html.includes("NaN"));
  const bare = renderToStaticMarkup(<PaymentDetail onClose={noop} p={pay(1, { pifNumber: null, billNumber: undefined, driverNumber: null, driverName: null, campaignFromDate: null, campaignToDate: null })} />);
  assert.ok(!bare.includes("undefined") && !bare.includes("null")); // missing values are shown as dashes
});

// ================================================================== regression: payment form pieces are untouched
test("regression: the payment entry form, its totals and the sidebar are unchanged", () => {
  const screen = src("components/RsaPayment.tsx");
  for (const k of ["PaymentFormPanel", "ProjectHeader", "ExpenseTable", "RsaActionBar", "View Budget", "View Driver", "Check Advance Eligibility", "Total Payable", "Cash In Hand", "Salary Advance", "Fuel Cost"]) assert.ok(screen.includes(k), k);
  assert.ok(src("utils/rsa.ts").includes("diesel + food + salary advance + expenses - expenses marked Deduct")); // the formula note is intact
  assert.ok(src("components/AppShell.tsx").includes('{ href: "/rsa", label: "Payments" },')); // Payments stays the first RSA entry (Vehicle & Driver Clearance is added after it)
});
