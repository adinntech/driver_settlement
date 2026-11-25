import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { NAV } from "../src/components/AppShell";
import { ClearanceFiltersBar, ClearanceHistory, ClearanceStatusBadge, ClearanceSummaryCards, ClearanceTable, FinancialPanel, RBP_COLUMNS, RSA_COLUMNS } from "../src/components/Clearance";
import {
  clearanceFiltersActive, clearanceQuery, emptyClearanceFilters, financialLabel, outstandingText, validateRejection, REJECTION_REASONS,
  type ClearanceFinancial, type ClearanceHistoryRow, type ClearanceRow,
} from "../src/utils/clearance";

const noop = () => {};
const row = (over: Partial<ClearanceRow> = {}): ClearanceRow => ({
  _id: "c".repeat(24), trackupNumber: "JS-22342/2026-27", pifNumber: "PIF-11111", billNumber: null, projectType: "ROADSHOW", clientName: "KEN LIFESTYLES", vehicleNo: "TN58BK3088",
  driverNumber: "DR-4821", driverName: "SAMPATH M", outstandingAdvance: 0, financialStatus: "NO_ADVANCE", status: "YET_TO_APPROVE", version: 1, submittedAt: "2026-11-24T04:35:00.000Z",
  submittedBy: "RBP", reviewedAt: null, reviewedBy: null, rejectionReason: null, ...over,
});
const fin = (over: Partial<ClearanceFinancial> = {}): ClearanceFinancial => ({
  status: "NO_ADVANCE", totalAdvance: 0, totalSettled: 0, outstanding: 0, canApprove: true, message: "ok", settlementDataAvailable: true, advances: [], settlements: [], ...over,
});

test("sidebar: RSA gets Vehicle & Driver Clearance, RBP gets On-Road Vehicles last; RSOP / RSOM unchanged", () => {
  assert.deepEqual(NAV.RSA.map((n) => n.label), ["Payments", "Vehicle & Driver Clearance", "Driver Payments", "Payment Completed"]); // settlement pages appended
  assert.equal(NAV.RSA[1].href, "/rsa/clearance");
  assert.deepEqual(NAV.RBP.map((n) => n.label), ["Projects & Budgets", "Vehicle Management", "Driver Management", "Vehicle Deliver", "Driver Payments"]); // payments appended after the existing entries
  assert.equal(NAV.RBP[3].href, "/rbp/on-road");
  assert.deepEqual(NAV.RSOM, [{ href: "/rsom", label: "Budget Approvals" }, { href: "/rsom/payments", label: "Daily Payment Approvals" }]);
  assert.deepEqual(NAV.RSOP.map((n) => n.label), ["Dashboard", "New Tracking Request"]);
});

test("query string: every filter, search and page is sent to the server", () => {
  assert.equal(clearanceQuery(emptyClearanceFilters(), 1, 10), "page=1&limit=10");
  const q = new URLSearchParams(clearanceQuery({ q: " JS-1 ", status: "REJECTED", projectType: "SIGNAGE", from: "2026-11-01", to: "2026-11-30" }, 3, 25));
  assert.deepEqual(Object.fromEntries(q), { q: "JS-1", status: "REJECTED", projectType: "SIGNAGE", from: "2026-11-01", to: "2026-11-30", page: "3", limit: "25" });
  assert.equal(clearanceFiltersActive(emptyClearanceFilters()), false);
  assert.equal(clearanceFiltersActive({ ...emptyClearanceFilters(), status: "APPROVED" }), true);
});

test("outstanding advance: unverifiable is Not Available, never Rs 0", () => {
  assert.equal(outstandingText(null, "UNAVAILABLE"), "Not Available");
  assert.equal(outstandingText(0, "UNAVAILABLE"), "Not Available");
  assert.match(outstandingText(2000, "OUTSTANDING"), /2,000/);
  assert.match(outstandingText(0, "NO_ADVANCE"), /0/);
  assert.equal(financialLabel("UNAVAILABLE"), "Verification Data Unavailable");
  assert.equal(financialLabel("NO_ADVANCE"), "No Outstanding Advance");
  assert.equal(financialLabel("OUTSTANDING"), "Outstanding Advance");
});

test("rejection form rules: reason mandatory, Other needs an explanation, remarks length", () => {
  assert.deepEqual(validateRejection("", ""), ["Rejection reason is required"]);
  assert.equal(validateRejection("Nope", "").length, 1);
  assert.ok(validateRejection("Other", "x").some((e) => /detailed explanation/.test(e)));
  assert.deepEqual(validateRejection("Other", "Licence photo is unreadable"), []);
  assert.deepEqual(validateRejection("Outstanding Driver Advance", ""), []);
  assert.equal(validateRejection("Missing Documents", "x".repeat(501)).length, 1);
  assert.deepEqual([...REJECTION_REASONS], ["Outstanding Driver Advance", "Driver Financial Verification Failed", "Invalid Driver Details", "Invalid Vehicle Details", "Missing Documents", "Other"]);
});

test("RSA table: required columns, Review action, Not Available for unverified advance", () => {
  assert.deepEqual([...RSA_COLUMNS], ["Trackup Number", "PIF Number", "Project Type", "Client / Billing Name", "Vehicle Number", "Driver Number", "Driver Name", "Advance Amount", "Approval Status", "Allocated Date", "Actions"]);
  const html = renderToStaticMarkup(<ClearanceTable mode="RSA" hrefFor={(id) => `/rsa/clearance/review?id=${id}`} items={[row({ outstandingAdvance: null, financialStatus: "UNAVAILABLE" }), row({ _id: "d".repeat(24), status: "APPROVED" })]} />);
  assert.match(html, /JS-22342\/2026-27/);
  assert.match(html, /Review/);
  assert.match(html, /Not Available/);
  assert.match(html, /Waiting for RSA Approval/);
  assert.match(html, /Approved/);
  assert.match(html, /review\?id=c{24}/);
});

test("RBP table: delivery columns, View + Deliver actions only where allowed", () => {
  assert.deepEqual([...RBP_COLUMNS], ["Trackup Number", "Project Type", "Client / Billing Name", "Vehicle Number", "Driver Number", "Driver Name", "RSA Approval Status", "Delivery Status", "RSA Approved Date", "Delivered Date", "Actions"]);
  const items = [
    row({ _id: "a".repeat(24), status: "APPROVED", deliveryStatus: "YET_TO_DELIVER", approvedAt: "2026-11-24T05:30:00.000Z" }),
    row({ _id: "b".repeat(24), status: "APPROVED", deliveryStatus: "DELIVERED", approvedAt: "2026-11-24T05:30:00.000Z", deliveredAt: "2026-11-25T05:30:00.000Z" }),
    row({ _id: "c".repeat(24), status: "REJECTED", deliveryStatus: null }),
    row({ _id: "d".repeat(24), status: "YET_TO_APPROVE", deliveryStatus: null }),
  ];
  const html = renderToStaticMarkup(<ClearanceTable mode="RBP" hrefFor={(id) => `/rbp/on-road/view?id=${id}`} items={items} />);
  assert.equal((html.match(/>Deliver</g) ?? []).length, 1); // only the approved, undelivered row
  assert.match(html, /deliver\?id=a{24}/);
  assert.ok(!/deliver\?id=[bcd]{24}/.test(html)); // never for delivered, rejected or pending
  assert.equal((html.match(/>View</g) ?? []).length, 4);
  for (const t of ["Yet to Deliver", "Delivered", "Pending", "Approved", "Rejected", "24-Nov-2026", "25-Nov-2026"]) assert.match(html, new RegExp(t));
  assert.ok(!html.includes("PIF-11111")); // minimal columns
});

test("filters bar: mass search, status, project type, date range, Clear Filters", () => {
  const html = renderToStaticMarkup(<ClearanceFiltersBar f={emptyClearanceFilters()} onChange={noop} onClear={noop} searchHint="Search" />); // RSA variant
  for (const t of ["Mass search", "Status filter", "Project type filter", "Allocation date from", "Allocation date to", "Clear Filters", "Yet to Approve", "Approved", "Rejected"]) assert.match(html, new RegExp(t));
  assert.match(html, /disabled=""/); // Clear Filters is disabled while nothing is filtered
});

test("summary cards", () => {
  const html = renderToStaticMarkup(<ClearanceSummaryCards s={{ total: 9, yetToApprove: 4, approved: 3, rejected: 2 }} labels={["Total Allocations", "Yet to Approve", "Approved", "Rejected"]} />);
  for (const t of ["Total Allocations", "Yet to Approve", "Approved", "Rejected", ">9<", ">4<", ">3<", ">2<"]) assert.match(html, new RegExp(t));
});

test("financial panel: outstanding is highlighted, unavailable data blocks, clean driver shows No Outstanding Advance", () => {
  const out = renderToStaticMarkup(<FinancialPanel fin={fin({ status: "OUTSTANDING", totalAdvance: 5000, totalSettled: 3000, outstanding: 2000, canApprove: false, advances: [{ _id: "a", submittedAt: "2026-11-01T04:00:00.000Z", workingDays: 25, finalAdvanceAmount: 5000, submittedBy: "RBP" }] })} />);
  assert.match(out, /cl-flag bad/);
  assert.match(out, /Outstanding Advance/);
  assert.match(out, /5,000/);
  assert.match(out, /2,000/);
  const na = renderToStaticMarkup(<FinancialPanel fin={fin({ status: "UNAVAILABLE", totalAdvance: 5000, totalSettled: null, outstanding: null, canApprove: false, settlementDataAvailable: false, message: "Verification Data Unavailable: x" })} />);
  assert.match(na, /Verification Data Unavailable/);
  assert.match(na, /Not Available/);
  assert.match(na, /never assumed to be zero/);
  const ok = renderToStaticMarkup(<FinancialPanel fin={fin()} />);
  assert.match(ok, /cl-flag ok/);
  assert.match(ok, /No Outstanding Advance/);
});

test("history: version-wise rows in the given (latest first) order with IST times", () => {
  const rows: ClearanceHistoryRow[] = [
    { _id: "3", version: 2, action: "RESUBMITTED", username: "RBP", role: "RBP", at: "2026-11-24T06:05:00.000Z", details: { vehicleNo: "TN1", driverNumber: "DR-2", driverName: "B" } },
    { _id: "2", version: 1, action: "REJECTED", username: "RSA", role: "RSA", at: "2026-11-24T05:30:00.000Z", details: { reason: "Outstanding Driver Advance", financial: { status: "OUTSTANDING", outstanding: 2000 } } },
    { _id: "1", version: 1, action: "ALLOCATED", username: "RBP", role: "RBP", at: "2026-11-24T04:30:00.000Z", details: null },
  ];
  const html = renderToStaticMarkup(<ClearanceHistory rows={rows} />);
  assert.ok(html.indexOf("Resubmitted") < html.indexOf("Rejected") && html.indexOf("Rejected") < html.indexOf("Vehicle &amp; Driver Allocated"));
  assert.match(html, /V2/);
  assert.match(html, /Outstanding Driver Advance/);
  assert.match(html, /11:00 AM/); // 05:30Z is 11:00 AM IST
});

test("status badge labels", () => {
  assert.match(renderToStaticMarkup(<ClearanceStatusBadge status="YET_TO_APPROVE" />), /Waiting for RSA Approval/);
  assert.match(renderToStaticMarkup(<ClearanceStatusBadge status="APPROVED" />), /badge-cl-approved/);
  assert.match(renderToStaticMarkup(<ClearanceStatusBadge status="REJECTED" />), /badge-cl-rejected/);
});
