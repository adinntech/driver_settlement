import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AdvanceConfirm, AdvanceDetail, AdvanceForm, AdvanceHistoryTable } from "../src/components/DriverAdvance";
import DriverDetails from "../src/components/DriverDetails";
import type { Driver, DriverAdvanceRow } from "../src/types/domain";
import {
  advancePreview, calculateAdvance, hasSalary, newSubmissionKey, sanitizeWorkingDays, toAdvancePayload, validateAdvance,
} from "../src/utils/driverAdvance";

const noop = () => {};
const form = (salary: number | null | undefined, days: string, over: Partial<Parameters<typeof AdvanceForm>[0]> = {}) =>
  renderToStaticMarkup(<AdvanceForm salary={salary} days={days} onDays={noop} onSubmit={noop} {...over} />);

// ================================================================== calculation
test("working days x per day salary, half, rounded DOWN to the nearest 500 (specification examples)", () => {
  const rows: [number, number, number, number, number][] = [[10, 370, 3700, 1850, 1500], [10, 400, 4000, 2000, 2000], [10, 490, 4900, 2450, 2000], [10, 500, 5000, 2500, 2500], [10, 620, 6200, 3100, 3000]];
  for (const [d, s, eligible, half, advance] of rows) {
    const c = calculateAdvance(d, s);
    assert.deepEqual([c.eligible, c.half, c.advance], [eligible, half, advance], String(eligible));
    assert.equal(c.advance, Math.floor(eligible / 2 / 500) * 500);
  }
  assert.equal(calculateAdvance(7, 360).advance, 1000); // 1260 -> 1000, not the nearest 1500
  assert.equal(calculateAdvance(1, 999).advance, 0);
});

test("decimal salaries keep exact currency precision", () => {
  assert.equal(calculateAdvance(3, 0.1).eligible, 0.3);
  assert.equal(calculateAdvance(3, 370.55).eligible, 1111.65);
  assert.equal(calculateAdvance(20, 99.95).advance, 500); // 999.5 -> 500 (never rounded up)
  assert.equal(calculateAdvance(20, 100.05).advance, 1000);
  assert.equal(calculateAdvance(100, 19.99).eligible, 1999);
});

test("changing the working days recalculates every derived field automatically", () => {
  const at = (days: string) => advancePreview(days, 370);
  assert.deepEqual([at("10")?.eligible, at("10")?.advance], [3700, 1500]);
  assert.deepEqual([at("20")?.eligible, at("20")?.advance], [7400, 3500]);
  assert.deepEqual([at("5")?.eligible, at("5")?.advance], [1850, 500]);
  const html10 = form(370, "10");
  const html20 = form(370, "20");
  assert.ok(html10.includes("₹3,700.00") && html10.includes("₹1,500.00"));
  assert.ok(html20.includes("₹7,400.00") && html20.includes("₹3,500.00") && !html20.includes("₹3,700.00"));
});

// ================================================================== form behaviour
test("form: working days is the only editable field; per day salary, eligible amount and advance are read-only", () => {
  const html = form(370, "10");
  assert.equal((html.match(/readOnly=""/g) ?? []).length, 3);
  for (const l of ["Overall Working Days", "Per Day Salary", "Eligible Advance Amount", "Advance Amount", "₹370.00", "₹3,700.00", "₹1,500.00", "Submit Advance"]) assert.ok(html.includes(l), l);
  assert.match(html, /aria-label="Overall Working Days"/);
  assert.ok(!/<input[^>]*aria-label="Per Day Salary"[^>]*onChange/.test(html));
  assert.ok(html.includes("rounded down to ₹500"));
  assert.ok(!html.includes('data-note="no-salary"'));
  assert.ok(!/<button[^>]*disabled=""[^>]*>Submit Advance/.test(html)); // valid input: enabled
});

test("missing salary: a clear message, no calculated amounts, submission disabled", () => {
  for (const salary of [0, null, undefined, -5, Number.NaN]) {
    const html = form(salary, "10");
    assert.ok(html.includes('data-note="no-salary"') && html.includes("Driver salary is unavailable"), String(salary));
    assert.ok(!html.includes("₹3,700") && !html.includes("₹1,500"));
    assert.ok(/<button[^>]*disabled=""[^>]*>Submit Advance/.test(html));
    assert.equal(advancePreview("10", salary), null);
    assert.match(validateAdvance("10", salary)!, /salary is unavailable/);
  }
  assert.equal(hasSalary(370), true);
  assert.equal(hasSalary(0), false);
});

test("working days validation: positive whole numbers only; keyboard filter allows digits only", () => {
  for (const ok of ["1", "10", "31", "366"]) assert.equal(validateAdvance(ok, 370), null, ok);
  for (const bad of ["", "  ", "0", "00", "-5", "1.5", "abc", "10a", "1e2", "367", "٣"]) assert.notEqual(validateAdvance(bad, 370), null, JSON.stringify(bad));
  assert.match(validateAdvance("", 370)!, /required/);
  assert.match(validateAdvance("0", 370)!, /positive whole number/);
  assert.match(validateAdvance("500", 370)!, /cannot exceed 366/);
  assert.equal(sanitizeWorkingDays("1a0"), "10");
  assert.equal(sanitizeWorkingDays("-5"), "5");
  assert.equal(sanitizeWorkingDays("1.5"), "15");
  assert.equal(sanitizeWorkingDays("007"), "7");
  assert.equal(sanitizeWorkingDays("12345"), "123");
  assert.equal(sanitizeWorkingDays("abc"), "");
  assert.equal(advancePreview("0", 370), null);
  assert.equal(advancePreview("-3", 370), null);
  assert.ok(/<button[^>]*disabled=""[^>]*>Submit Advance/.test(form(370, "")));
  assert.ok(/<button[^>]*disabled=""[^>]*>Submit Advance/.test(form(370, "0")));
  assert.ok(form(370, "0").includes("positive whole number"));
});

test("too small an eligible amount (advance would be 0) cannot be submitted", () => {
  const html = form(100, "9"); // 900 / 2 = 450 -> 0
  assert.ok(/<button[^>]*disabled=""[^>]*>Submit Advance/.test(html));
  assert.ok(html.includes("too low for an advance"));
});

// ================================================================== submission
test("confirmation summary: driver number and name, working days, per day salary, eligible and final amounts", () => {
  const html = renderToStaticMarkup(<AdvanceConfirm driver={{ driverNumber: "DR-4821", driverName: "Murugan K" }} days="10" salary={370} onBack={noop} onConfirm={noop} />);
  for (const v of ["Confirm Advance", "DR-4821", "Murugan K", "Overall Working Days", ">10<", "₹370.00", "₹3,700.00", "Final Advance Amount", "₹1,500.00", "Confirm &amp; Submit", "recalculated and saved by the server"]) assert.ok(html.includes(v), v);
  assert.equal(renderToStaticMarkup(<AdvanceConfirm driver={{ driverNumber: "DR-1", driverName: "X" }} days="0" salary={370} onBack={noop} onConfirm={noop} />), ""); // invalid: nothing to confirm
  assert.ok(renderToStaticMarkup(<AdvanceConfirm driver={{ driverNumber: "DR-1", driverName: "X" }} days="10" salary={370} busy onBack={noop} onConfirm={noop} />).includes("Submitting…"));
});

test("the request carries only the working days and a submission key (no financial values from the browser)", () => {
  const p = toAdvancePayload(" 10 ", "key-123456789");
  assert.deepEqual(p, { workingDays: 10, idempotencyKey: "key-123456789" });
  assert.equal(typeof p.workingDays, "number");
  assert.deepEqual(Object.keys(p).sort(), ["idempotencyKey", "workingDays"]);
  const a = newSubmissionKey();
  const b = newSubmissionKey();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{8,64}$/); // accepted by the server's key rule
});

// ================================================================== history
const row = (i: number, over: Partial<DriverAdvanceRow> = {}): DriverAdvanceRow => ({
  _id: `a${i}`.padEnd(24, "0"), driver: "d".repeat(24), driverNumber: "DR-4821", driverName: "Murugan K", workingDays: 10, perDaySalary: 370, eligibleAdvanceAmount: 3700, calculatedHalfAmount: 1850,
  finalAdvanceAmount: 1500, roundingUnit: 500, roundingMethod: "FLOOR_TO_UNIT", submittedBy: "RBP", submittedAt: "2026-11-24T04:30:00.000Z", createdAt: "2026-11-24T04:30:00.000Z", ...over,
});

test("history table: columns, correct amounts, IST timestamps, View Details, latest first as delivered", () => {
  const items = [row(2, { workingDays: 5, perDaySalary: 400, eligibleAdvanceAmount: 2000, finalAdvanceAmount: 1000, submittedAt: "2026-11-25T09:15:00.000Z", submittedBy: "RBP" }), row(1)];
  const html = renderToStaticMarkup(<AdvanceHistoryTable items={items} total={2} page={1} limit={10} onPage={noop} onView={noop} />);
  for (const h of ["Date &amp; Time", "Working Days", "Per Day Salary", "Eligible Amount", "Advance Amount", "Submitted By", "Actions"]) assert.ok(html.includes(`<th>${h}</th>`), h);
  for (const v of ["₹400.00", "₹2,000.00", "₹1,000.00", "₹370.00", "₹3,700.00", "₹1,500.00", "25-Nov-2026, 02:45 PM", "24-Nov-2026, 10:00 AM", "RBP"]) assert.ok(html.includes(v), v);
  assert.ok(html.indexOf("25-Nov-2026") < html.indexOf("24-Nov-2026")); // order preserved: newest on top
  assert.equal((html.match(/View Details/g) ?? []).length, 2);
  assert.ok(html.includes("2 advance(s) · page 1 of 1") && !html.includes("undefined") && !html.includes("NaN"));
});

test("history empty state, and pagination controls follow the server totals", () => {
  const empty = renderToStaticMarkup(<AdvanceHistoryTable items={[]} total={0} page={1} limit={10} onPage={noop} onView={noop} />);
  assert.ok(empty.includes("No advances yet") && empty.includes("Advance History") && !empty.includes("<table"));
  const items = Array.from({ length: 10 }, (_, i) => row(i));
  const p1 = renderToStaticMarkup(<AdvanceHistoryTable items={items} total={23} page={1} limit={10} onPage={noop} onView={noop} />);
  assert.ok(p1.includes("23 advance(s) · page 1 of 3"));
  assert.match(p1, /<button[^>]*disabled=""[^>]*>Previous/);
  assert.ok(!/<button[^>]*disabled=""[^>]*>Next/.test(p1));
  const p3 = renderToStaticMarkup(<AdvanceHistoryTable items={items.slice(0, 3)} total={23} page={3} limit={10} onPage={noop} onView={noop} />);
  assert.ok(p3.includes("page 3 of 3") && /<button[^>]*disabled=""[^>]*>Next/.test(p3) && !/<button[^>]*disabled=""[^>]*>Previous/.test(p3));
});

test("advance details show the full record including the salary snapshot, half amount and rounding", () => {
  const html = renderToStaticMarkup(<AdvanceDetail a={row(1)} onClose={noop} />);
  for (const v of ["Advance Details", "DR-4821", "Murugan K", "Submitted By", "RBP", "24-Nov-2026, 10:00 AM", "Overall Working Days", "Per Day Salary (used)", "₹370.00", "Eligible Advance Amount", "₹3,700.00", "Half of Eligible Amount", "₹1,850.00", "Down to ₹500", "Final Advance Amount", "₹1,500.00"])
    assert.ok(html.includes(v), v);
  // a later salary change does not alter what an old record displays: it only ever shows its own snapshot
  const later = renderToStaticMarkup(<AdvanceDetail a={row(1, { perDaySalary: 370 })} onClose={noop} />);
  assert.ok(later.includes("₹370.00") && !later.includes("₹400.00"));
});

// ================================================================== regression: existing view page parts
test("existing driver details are unchanged by the advance feature (information, bank, availability still shown)", () => {
  const d: Driver = {
    _id: "a".repeat(24), driverNumber: "DR-4821", driverName: "Murugan K", driverType: "ACTING_DRIVER", address: "Anna Nagar", mobileNumber: "+91 9876543210", accountName: "Murugan K",
    accountNumber: "123456789012", ifscCode: "SBIN0001234", bankName: "SBI", licenceNumber: "TN07 20110012345", licenceType: "LMV", licenceExpiryDate: "2030-05-20", attachment: null, salary: 370,
    status: "ACTIVE", availability: { status: "AVAILABLE", availableFromDate: "2026-11-24", availableFromTime: "09:30", project: null, notAvailable: null },
    createdBy: "RBP", updatedBy: "RBP", createdAt: "2026-11-24T04:30:00.000Z", updatedAt: "2026-11-24T05:00:00.000Z",
  };
  const html = renderToStaticMarkup(<DriverDetails d={d} />);
  for (const v of ["Driver details", "DR-4821", "Acting Driver", "Bank details", "SBIN0001234", "Availability details", "Available Now", "Licence"]) assert.ok(html.includes(v), v);
  assert.ok(!html.includes("Advance Amount") && !html.includes("Advance History")); // the new sections live in their own component
});
