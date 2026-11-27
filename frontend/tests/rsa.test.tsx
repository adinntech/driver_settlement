import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { NAV } from "../src/components/AppShell";
import { RSA_COLUMNS, RsaFilters, RsaProjectTable, emptyRsaFilters, rsaFiltersActive, rsaQuery } from "../src/components/RsaDashboard";
import {
  BudgetBody, DriverBody, EligibilityResult, ExpenseTable, PaymentDetail, PaymentFormPanel, PaymentHistoryTable, ProjectHeader, RsaActionBar,
} from "../src/components/RsaPayment";
import { homeFor } from "../src/utils/budgetDescribe";
import {
  amountPaise, emptyExpenseDraft, emptyPaymentForm, money, overlapWarnings, sanitizeAmount, toPaymentPayload, totals, validateDieselDraft, validateExpenseDraft, validatePaymentForm,
  type ExpenseRow, type PaymentForm, type RsaContext, type RsaOptions, type RsaPaymentRow, type RsaProjectRow,
} from "../src/utils/rsa";

const noop = () => {};
const options: RsaOptions = {
  expenseOptions: [
    { key: "OTHERS", label: "Others", descriptionRequired: true }, { key: "FUEL", label: "Fuel" }, { key: "FLEET_BALANCE", label: "Fleet Balance" }, { key: "TOLL", label: "Toll" },
    { key: "FOOD_ALLOWANCE", label: "Food Allowance" }, { key: "TRAVEL", label: "Travel" }, { key: "PERMIT", label: "Permit" }, { key: "SERVICE", label: "Service" },
  ],
  dieselPaymentModes: ["ePayment", "Cash", "Fuel Card"], paymentFor: [{ key: "ROADSHOW", label: "Roadshow" }, { key: "SIGNAGE", label: "Signage" }],
};
const ctx = (over: Partial<RsaContext> = {}): RsaContext => ({
  trackingVehicle: "t".repeat(24), allotment: "a".repeat(24), trackupNumber: "JS-22342/2026-27", pifNumber: "PIF-11111", projectType: "ROADSHOW", clientName: "KEN LIFESTYLES PRIVATE LIMITED-TN",
  projectName: "KEN Roadshow", vehicleNo: "TN58BK3088", driverNumber: "DR-4821", driverName: "SAMPATH M", campaignFromDate: "2026-11-24", campaignToDate: "2026-12-02", approvedBudgetAmount: 125000.5, budgetVersion: 2,
  vehicleAllottedAt: "2026-11-24T04:30:00.000Z", driverAssignedAt: "2026-11-24T04:31:00.000Z", allotmentStatus: "ACTIVE", paymentCount: 0, paymentStatus: "PENDING", lastPaymentAt: null,
  billNumber: null, paymentFor: "ROADSHOW", entryDateTime: "2026-11-24T06:30:00.000Z",
  vehicle: { _id: "v", vehicleNo: "TN58BK3088", make: "Tata", model: "Ace", type: "Dynamic" },
  driver: { _id: "d", driverNumber: "DR-4821", driverName: "SAMPATH M", driverType: "COMPANY_DRIVER", mobileNumber: "+91 9876543210" }, ...over,
});
const form = (over: Partial<PaymentForm> = {}): PaymentForm => ({ ...emptyPaymentForm(), ...over });
const exp = (key: string, label: string, amount: string, over: Partial<ExpenseRow> = {}): ExpenseRow => ({ id: `${key}${amount}`, optionKey: key, optionLabel: label, description: "", amount, deduct: false, isDefault: false, ...over });
const panel = (f: PaymentForm = form(), c: RsaContext = ctx()) => renderToStaticMarkup(<PaymentFormPanel ctx={c} options={options} form={f} onChange={noop} />);

// ================================================================== login / navigation
test("RSA is the fourth login: own home, own sidebar; the other three logins are unchanged", () => {
  assert.equal(homeFor("RSA"), "/rsa");
  assert.deepEqual(NAV.RSA.slice(0, 2), [{ href: "/rsa", label: "Payments" }, { href: "/rsa/clearance", label: "Vehicle & Driver Clearance" }]); // original entries first, unchanged
  assert.deepEqual(NAV.RSA.slice(2).map((n) => n.href), ["/rsa/on-road-vehicles", "/rsa/driver-payments", "/rsa/settlements/completed", "/rsa/iocl-data"]);
  assert.equal(homeFor("RSO"), "/rso"); // RSO is a separate login from RSOM
  assert.deepEqual(NAV.RSO.map((n) => n.href), ["/rso", "/rso/reports"]);
  assert.equal(homeFor("RSOP"), "/rsop");
  assert.equal(homeFor("RBP"), "/rbp");
  assert.equal(homeFor("RSOM"), "/rsom");
  assert.equal(homeFor("NOPE"), "/login");
  assert.deepEqual(NAV.RSOM, [{ href: "/rsom", label: "Budget Approvals" }, { href: "/rsom/payments", label: "Daily Payment Approvals" }]);
  assert.deepEqual(NAV.RBP.map((n) => n.label), ["Projects & Budgets", "Vehicle Management", "Driver Management", "Vehicle Deliver", "On Road Vehicles", "Driver Payments"]); // payments appended
  assert.deepEqual(NAV.RSOP.map((n) => n.label), ["Dashboard", "New Tracking Request"]);
  assert.ok(!NAV.RSA.some((n) => n.href.startsWith("/rbp") || n.href.startsWith("/rsop") || n.href.startsWith("/rsom"))); // no entry into other roles' pages
});

// ================================================================== amounts + calculation
test("numeric-only amounts: digits and one decimal point; letters and symbols never get in; decimals exact", () => {
  assert.equal(sanitizeAmount("500"), "500");
  assert.equal(sanitizeAmount("5a0b0"), "500");
  assert.equal(sanitizeAmount("₹1,000.50"), "1000.50");
  assert.equal(sanitizeAmount("-50"), "50");
  assert.equal(sanitizeAmount("12.345"), "12.34");
  assert.equal(sanitizeAmount("1.2.3"), "1.23");
  assert.equal(sanitizeAmount("abc"), "");
  for (const [raw, p] of [["", 0], ["0", 0], ["100", 10000], ["100.5", 10050], ["0.07", 7], ["19.99", 1999]] as const) assert.equal(amountPaise(raw), p, raw);
  for (const bad of ["abc", "-1", "1e3", "1.234", ".5", "5.", "1,000", "999999999999"]) assert.equal(amountPaise(bad), null, bad);
  assert.equal(money(120049), "₹1,200.49");
});

test("Total Payable = diesel + food + salary advance + expenses - deducted expenses", () => {
  const f = form({
    diesel: [{ id: "1", amount: "1000.50", mode: "ePayment", reference: "" }, { id: "2", amount: "199.99", mode: "", reference: "" }], foodAmount: "50", salaryAdvance: "1500",
    expenses: [exp("TOLL", "Toll", "333.33"), exp("OTHERS", "Others", "100", { deduct: true, description: "refund" })],
  });
  const t = totals(f);
  assert.deepEqual([t.diesel, t.expenseAdd, t.expenseDeduct, t.expenseNet, t.total], [120049, 33333, 10000, 23333, 120049 + 5000 + 150000 + 23333]);
  assert.equal(totals(emptyPaymentForm()).total, 0);
  assert.equal(totals(form({ foodAmount: "0.1", salaryAdvance: "0.2" })).total, 30); // 0.1 + 0.2 is exactly 0.30
});

test("expense row validation: category required, Others needs a description, amount > 0 numeric, duplicates refused (edit excluded)", () => {
  const ok = { ...emptyExpenseDraft("TOLL"), amount: "120.5" };
  assert.deepEqual(validateExpenseDraft(ok, options.expenseOptions, []), []);
  assert.ok(validateExpenseDraft({ ...ok, optionKey: "" }, options.expenseOptions, []).includes("Choose an expense category"));
  assert.ok(validateExpenseDraft({ ...ok, optionKey: "OTHERS" }, options.expenseOptions, []).some((m) => /Description is required for Others/.test(m)));
  assert.deepEqual(validateExpenseDraft({ ...ok, optionKey: "OTHERS", description: "Parking" }, options.expenseOptions, []), []);
  for (const o of options.expenseOptions) assert.deepEqual(validateExpenseDraft({ ...ok, optionKey: o.key, description: "x" }, options.expenseOptions, []), [], o.key); // all eight categories
  assert.ok(validateExpenseDraft({ ...ok, amount: "" }, options.expenseOptions, []).includes("Amount is required"));
  assert.ok(validateExpenseDraft({ ...ok, amount: "abc" }, options.expenseOptions, []).some((m) => /digits only/.test(m)));
  assert.ok(validateExpenseDraft({ ...ok, amount: "0" }, options.expenseOptions, []).some((m) => /greater than zero/.test(m)));
  assert.ok(validateExpenseDraft({ ...ok, description: "<b>" }, options.expenseOptions, []).some((m) => /invalid characters/.test(m)));
  const existing = [exp("TOLL", "Toll", "120.5", { id: "row1" })];
  assert.ok(validateExpenseDraft(ok, options.expenseOptions, existing).includes("This expense is already added"));
  assert.deepEqual(validateExpenseDraft(ok, options.expenseOptions, existing, "row1"), []); // editing the same row is not a duplicate
  assert.deepEqual(validateExpenseDraft({ ...ok, description: "second toll" }, options.expenseOptions, existing), []);
  assert.deepEqual(validateExpenseDraft({ ...ok, deduct: true }, options.expenseOptions, existing), []);
});

test("diesel entry validation and form-level rules", () => {
  assert.deepEqual(validateDieselDraft({ amount: "500", mode: "Cash", reference: "" }, options.dieselPaymentModes), []);
  assert.ok(validateDieselDraft({ amount: "", mode: "", reference: "" }, options.dieselPaymentModes).length > 0);
  assert.ok(validateDieselDraft({ amount: "abc", mode: "", reference: "" }, options.dieselPaymentModes).some((m) => /digits only/.test(m)));
  assert.ok(validateDieselDraft({ amount: "0", mode: "", reference: "" }, options.dieselPaymentModes).some((m) => /greater than zero/.test(m)));
  assert.ok(validateDieselDraft({ amount: "5", mode: "Bitcoin", reference: "" }, options.dieselPaymentModes).some((m) => /payment mode/.test(m)));
  assert.ok(validatePaymentForm(emptyPaymentForm()).some((m) => /at least one amount/.test(m)));
  assert.deepEqual(validatePaymentForm(form({ foodAmount: "100" })), []);
  assert.ok(validatePaymentForm(form({ foodAmount: "abc" })).some((m) => /Food Allowance must contain digits only/.test(m)));
  assert.ok(validatePaymentForm(form({ salaryAdvance: "1e3" })).some((m) => /Salary Advance must contain digits only/.test(m)));
  assert.ok(validatePaymentForm(form({ foodAmount: "10", expenses: [exp("TOLL", "Toll", "50", { deduct: true })] })).some((m) => /deductions are more/.test(m)));
  assert.equal(overlapWarnings(form({ foodAmount: "10", expenses: [exp("FOOD_ALLOWANCE", "Food Allowance", "5")] })).length, 1); // warned, not blocked
  assert.equal(overlapWarnings(form({ diesel: [{ id: "1", amount: "5", mode: "", reference: "" }], expenses: [exp("FUEL", "Fuel", "5")] })).length, 1);
  assert.equal(overlapWarnings(form({ foodAmount: "10", expenses: [exp("TOLL", "Toll", "5")] })).length, 0);
});

test("payload carries only the entered values and the key; no time, user, number, project or total is sent", () => {
  const f = form({
    cashInHand: true, foodAmount: " 150.25 ", salaryAdvance: "500", diesel: [{ id: "x", amount: "1000", mode: "ePayment", reference: " AXIS " }],
    expenses: [exp("TOLL", "Toll", "120", { description: " Salem ", isDefault: true }), exp("OTHERS", "Others", "20", { deduct: true, description: "refund" })],
  });
  const p = toPaymentPayload(f, "ROADSHOW", "key-123456789");
  assert.deepEqual(Object.keys(p).sort(), ["cashInHand", "dieselEntries", "expenses", "foodAmount", "idempotencyKey", "paymentFor", "salaryAdvance"]);
  assert.deepEqual(p.dieselEntries, [{ amount: "1000", mode: "ePayment", reference: "AXIS" }]);
  assert.deepEqual(p.expenses, [{ optionKey: "TOLL", description: "Salem", amount: "120", deduct: false, isDefault: true }, { optionKey: "OTHERS", description: "refund", amount: "20", deduct: true, isDefault: false }]);
  assert.equal(p.foodAmount, "150.25");
  assert.equal(p.cashInHand, true);
  assert.equal(toPaymentPayload(emptyPaymentForm(), "SIGNAGE", "k").cashInHand, false); // Cash In Hand is off unless ticked
});

// ================================================================== screen parts
test("project header shows job sheet, vehicle, client, driver and project type read-only; payment number is generated on save", () => {
  const html = renderToStaticMarkup(<ProjectHeader ctx={ctx()} />);
  for (const v of ["JobSheet No:", "JS-22342/2026-27", "Vehicle No:", "TN58BK3088", "Client Name:", "KEN LIFESTYLES PRIVATE LIMITED-TN", "Driver:", "DR-4821 · SAMPATH M", "Project Type:", "Roadshow", "Payment No:", "Generated on save"])
    assert.ok(html.includes(v), v);
  assert.ok(!html.includes("<input"));
});

test("payment form follows the reference layout: Payment For, dates and entry time read-only (no pickers), Cash In Hand, Diesel, Food, Salary Advance, expenses, totals", () => {
  const html = panel();
  const order = ["Payment For", "From Date", "To Date", "Entry Date &amp; Time", "Cash In Hand", "Fuel Cost", "Food Allowance", "Salary Advance", "Other Expenses", "Total Payable"].map((l) => html.indexOf(l));
  for (const h of ["<th>Detail</th>", "<th>Description</th>", "<th>Amount</th>", "<th>Deduct</th>", "<th>Actions</th>"]) assert.ok(html.includes(h), h);
  assert.ok(order.every((i) => i >= 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(!html.includes('type="date"') && !html.includes('type="datetime-local"') && !html.includes('type="time"')); // no date pickers anywhere on the entry form
  assert.match(html, /<select[^>]*disabled=""[^>]*aria-label="Payment For"|aria-label="Payment For"[^>]*disabled=""/); // cannot pick the wrong vertical
  assert.match(html, /<option value="ROADSHOW" selected="">Roadshow/);
  assert.ok(html.includes('data-field="from-date">24-Nov-2026') && html.includes('data-field="to-date">02-Dec-2026'));
  assert.ok(html.includes('data-field="entry-time"') && html.includes("recorded by the server"));
  assert.ok(!/<input[^>]*aria-label="Cash In Hand"[^>]*checked/.test(html)); // unchecked by default
  assert.ok(panel(form({ cashInHand: true })).match(/aria-label="Cash In Hand"/) && /checked=""[^>]*aria-label="Cash In Hand"|aria-label="Cash In Hand"[^>]*checked=""/.test(panel(form({ cashInHand: true }))));
  for (const l of ['aria-label="Fuel Cost"', 'aria-label="Add diesel entry"', 'aria-label="Food Allowance"', 'aria-label="Salary Advance"', 'aria-label="Expense Category"', 'aria-label="Is Default"', 'aria-label="Total Payable"', ">Add<", ">Delete<"])
    assert.ok(html.includes(l), l);
  assert.equal((html.match(/inputMode="decimal"/g) ?? []).length, 4); // diesel, food, salary advance, expense amount: numeric keyboards
});

test("Signage projects show Signage selected; the project type decides, never the user", () => {
  const html = panel(form(), ctx({ projectType: "SIGNAGE", paymentFor: "SIGNAGE", campaignFromDate: "2026-11-26", campaignToDate: "2026-12-03" }));
  assert.match(html, /<option value="SIGNAGE" selected="">Signage/);
  assert.ok(html.includes('data-field="from-date">26-Nov-2026') && html.includes('data-field="to-date">03-Dec-2026'));
  assert.ok(panel(form(), ctx({ campaignFromDate: null, campaignToDate: null })).includes('data-field="from-date">—'));
});

test("expense dropdown lists the eight configured categories in order; the list comes from configuration", () => {
  const html = panel();
  const sel = /aria-label="Expense Category">([\s\S]*?)<\/select>/.exec(html)?.[1] ?? "";
  assert.deepEqual([...sel.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1]), ["Others", "Fuel", "Fleet Balance", "Toll", "Food Allowance", "Travel", "Permit", "Service"]);
  const more: RsaOptions = { ...options, expenseOptions: [...options.expenseOptions, { key: "PARKING", label: "Parking" }] }; // a new category needs no form change
  const html2 = renderToStaticMarkup(<PaymentFormPanel ctx={ctx()} options={more} form={form()} onChange={noop} />);
  assert.ok(html2.includes(">Parking</option>"));
  assert.ok(html.includes("Description (required)")); // the first option, Others, needs a description
});

test("expense table: rows with Detail, Description, Amount, Deduct, Edit / Delete; empty state; no undefined", () => {
  const rows = [exp("TOLL", "Toll", "120.5", { description: "Salem toll" }), exp("OTHERS", "Others", "20", { deduct: true, description: "refund", isDefault: true })];
  const html = renderToStaticMarkup(<ExpenseTable rows={rows} selected={["TOLL120.5"]} onToggle={noop} onEdit={noop} onDelete={noop} />);
  for (const h of ["<th>Detail</th>", "<th>Description</th>", "<th>Amount</th>", "<th>Deduct</th>", "<th>Actions</th>"]) assert.ok(html.includes(h), h);
  for (const v of ["Toll", "Salem toll", "₹120.50", "Others", "refund", "₹20.00", "default"]) assert.ok(html.includes(v), v);
  assert.equal((html.match(/>Edit</g) ?? []).length, 2);
  assert.equal((html.match(/>Delete</g) ?? []).length, 2);
  assert.ok(html.includes("Yes")); // the deduct row
  assert.ok(!html.includes("undefined") && !html.includes("null"));
  assert.ok(renderToStaticMarkup(<ExpenseTable rows={[]} selected={[]} onToggle={noop} onEdit={noop} onDelete={noop} />).includes("No expense rows added"));
  const withRows = panel(form({ expenses: rows, foodAmount: "100" }));
  assert.ok(withRows.includes('aria-label="Expense Total"') && withRows.includes("₹100.50") && withRows.includes("₹200.50")); // expense net 100.5, payable 100 + 100.5
});

test("action bar: View Budget, View Driver, Check Advance Eligibility, Save, Close", () => {
  const html = renderToStaticMarkup(<RsaActionBar onBudget={noop} onDriver={noop} onEligibility={noop} onSave={noop} onClose={noop} />);
  for (const l of ["View Budget", "View Driver", "Check Advance Eligibility", ">Save<", ">Close<"]) assert.ok(html.includes(l), l);
  assert.ok(renderToStaticMarkup(<RsaActionBar onBudget={noop} onDriver={noop} onEligibility={noop} onSave={noop} onClose={noop} busy />).includes("Saving…"));
});

// ================================================================== history
const pay = (i: number, over: Partial<RsaPaymentRow> = {}): RsaPaymentRow => ({
  _id: `p${i}`.padEnd(24, "0"), paymentNumber: `PAY-00000${i}/2026-27`, trackupNumber: "JS-22342/2026-27", paymentFor: "ROADSHOW", entryDateTime: `2026-11-2${i}T04:30:00.000Z`, cashInHand: false, totalPayable: 1000 * i + 0.5,
  mode: "ePayment", bankName: null, chequeNo: null, createdBy: "RSA", paymentStatus: "ENTERED", foodAmount: 100, salaryAdvance: 0, dieselTotal: 900, expenseTotal: 0, deductTotal: 0,
  dieselEntries: [{ amount: 900, mode: "ePayment", reference: "AXIS IMPS", entryAt: `2026-11-2${i}T04:30:00.000Z` }], expenses: [], vehicleNo: "TN58BK3088", driverNumber: "DR-4821", driverName: "SAMPATH M",
  clientName: "KEN", campaignFromDate: "2026-11-24", campaignToDate: "2026-12-02", ...over,
});

test("payment history: reference columns plus number, entry time, user and status; latest first; empty values are dashes", () => {
  const html = renderToStaticMarkup(<PaymentHistoryTable items={[pay(3), pay(2, { mode: "—" }), pay(1, { cashInHand: true, mode: "Cash in Hand" })]} total={3} page={1} limit={20} onPage={noop} />);
  for (const h of ["<th>Date</th>", "<th>Payment No</th>", "<th>Amount</th>", "<th>Mode</th>", "<th>Mode of Payment</th>", "<th>Cheque/DD No</th>", "<th>By</th>", "<th>Status</th>"]) assert.ok(html.includes(h), h);
  for (const v of ["PAY-000003/2026-27", "₹3,000.50", "ePayment", "Cash in Hand", "RSA", "Entered", "23-Nov-2026"]) assert.ok(html.includes(v), v);
  assert.ok(html.indexOf("PAY-000003") < html.indexOf("PAY-000002") && html.indexOf("PAY-000002") < html.indexOf("PAY-000001")); // order preserved: newest on top
  assert.equal((html.match(/Expand ▼/g) ?? []).length, 3); // each row has an Expand button (no modal opens over the drawer)
  assert.ok(!html.includes("undefined") && !html.includes("null") && !html.includes("NaN"));
  assert.ok(html.includes("3 payment(s) · page 1 of 1"));
  const empty = renderToStaticMarkup(<PaymentHistoryTable items={[]} total={0} page={1} limit={20} onPage={noop} />);
  assert.ok(empty.includes("No payments yet") && !empty.includes("<table"));
  const p2 = renderToStaticMarkup(<PaymentHistoryTable items={[pay(1)]} total={45} page={3} limit={20} onPage={noop} />);
  assert.ok(p2.includes("page 3 of 3") && /<button[^>]*disabled=""[^>]*>Next/.test(p2));
});

test("payment detail shows every entered part with its own timestamps", () => {
  const html = renderToStaticMarkup(<PaymentDetail p={pay(2, { cashInHand: true, expenses: [{ optionKey: "TOLL", optionLabel: "Toll", description: null, amount: 120.5, deduct: false, isDefault: false }, { optionKey: "OTHERS", optionLabel: "Others", description: "refund", amount: 20, deduct: true, isDefault: false }] })} onClose={noop} />);
  for (const v of ["Payment PAY-000002/2026-27", "Created By", "RSA", "Cash In Hand", "Yes", "Food Allowance", "₹100.00", "Diesel entries", "AXIS IMPS", "Expenses", "Toll", "₹120.50", "refund", "Total Payable", "₹2,000.50"]) assert.ok(html.includes(v), v);
  assert.ok(!html.includes("undefined"));
});

// ================================================================== dashboard
const row = (over: Partial<RsaProjectRow> = {}): RsaProjectRow => ({
  trackingVehicle: "t".repeat(24), allotment: "a".repeat(24), trackupNumber: "JS-22342/2026-27", pifNumber: "PIF-11111", projectType: "ROADSHOW", clientName: "KEN LIFESTYLES", projectName: null,
  vehicleNo: "TN58BK3088", driverNumber: "DR-4821", driverName: "SAMPATH M", campaignFromDate: "2026-11-24", campaignToDate: "2026-12-02", approvedBudgetAmount: 125000.5, budgetVersion: 1,
  vehicleAllottedAt: null, driverAssignedAt: null, allotmentStatus: "ACTIVE", paymentCount: 0, paymentStatus: "PENDING", lastPaymentAt: null, ...over,
});

test("dashboard table: JS number, PIF, display number, type, client, vehicle, driver, campaign dates, budget, payment status, last payment", () => {
  assert.deepEqual([...RSA_COLUMNS].slice(0, 12), ["Trackup No (JS)", "PIF No", "Vertical", "Client / Billing Name", "Vehicle No", "Driver No", "Driver Name", "Campaign From", "Campaign To", "Approved Budget", "Payment Status", "Last Payment"]);
  const html = renderToStaticMarkup(<RsaProjectTable items={[row(), row({ trackingVehicle: "u".repeat(24), projectType: "SIGNAGE", paymentCount: 2, paymentStatus: "ENTERED", lastPaymentAt: "2026-11-24T06:30:00.000Z" })]} />);
  for (const v of ["JS-22342/2026-27", "PIF-11111", "4821", "Roadshow", "Signage", "KEN LIFESTYLES", "TN58BK3088", "DR-4821", "SAMPATH M", "24-Nov-2026", "02-Dec-2026", "₹1,25,000.50", "No entry yet", "Entered", "24-Nov-2026, 12:00 PM"])
    assert.ok(html.includes(v), v);
  assert.ok(html.includes(`href="/rsa/payment?id=${"t".repeat(24)}"`));
  assert.ok(!html.includes("undefined") && !html.includes("null"));
});

test("dashboard filters: mass search, project type, payment status, date range, clear; query is built for server-side paging", () => {
  const html = renderToStaticMarkup(<RsaFilters f={emptyRsaFilters()} onChange={noop} onClear={noop} />);
  for (const l of ['aria-label="Mass search"', 'aria-label="Vertical"', '>All Verticals<', 'aria-label="Payment status filter"', 'aria-label="Date range from"', 'aria-label="Date range to"', "Clear Filters", ">Roadshow<", ">Signage<"]) assert.ok(html.includes(l), l);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Clear Filters/);
  assert.equal(rsaFiltersActive(emptyRsaFilters()), false);
  const f = { q: " kens ", projectType: "SIGNAGE", paymentStatus: "PENDING", from: "2026-11-01", to: "2026-11-30" };
  assert.equal(rsaFiltersActive(f), true);
  assert.equal(rsaQuery(f, 2, 25), "q=kens&projectType=SIGNAGE&paymentStatus=PENDING&from=2026-11-01&to=2026-11-30&page=2&limit=25");
  assert.equal(rsaQuery(emptyRsaFilters(), 1, 10), "page=1&limit=10");
  assert.ok(!/<button[^>]*disabled=""[^>]*>Clear Filters/.test(renderToStaticMarkup(<RsaFilters f={f} onChange={noop} onClear={noop} />)));
});

// ================================================================== read-only panels
test("View Budget: approved amount, version, RSOM approval, version history; no inputs (read-only)", () => {
  const html = renderToStaticMarkup(<BudgetBody b={{ budgetNumber: "BUD-1", approvedAmount: 125000.5, approvedVersion: 2, currentVersion: 2, approvedBy: "RSOM", approvedAt: "2026-11-24T05:00:00.000Z", versions: [{ version: 2, total: 125000.5, updatedBy: "RBP", createdAt: "2026-11-24T04:00:00.000Z", approved: true }, { version: 1, total: 120000, updatedBy: "RBP", createdAt: "2026-11-23T04:00:00.000Z", approved: false }], events: [] }} />);
  for (const v of ["BUD-1", "₹1,25,000.50", "V2", "RSOM", "24-Nov-2026, 10:30 AM", "Version history", "V1", "₹1,20,000.00", "Approved", "Read-only"]) assert.ok(html.includes(v), v);
  assert.ok(!html.includes("<input") && !html.includes("<button") && !html.includes("<textarea"));
});

test("View Driver: details, masked bank number, availability, allotment and advance history; no inputs (read-only)", () => {
  const d = {
    driverNumber: "DR-4821", driverName: "SAMPATH M", driverType: "ACTING_DRIVER", mobileNumber: "+91 9876543210", perDaySalary: 370,
    bank: { accountName: "SAMPATH M", bankName: "SBI", accountNumberMasked: "XXXXXXXX9012", ifscCode: "SBIN0001234" },
    availability: { status: "IN_USE", projectName: "P", trackupNumber: "JS-1", projectFrom: "2026-11-24", projectTo: "2026-12-02" },
    advances: [{ _id: "a1", submittedAt: "2026-11-24T04:30:00.000Z", workingDays: 10, perDaySalary: 370, eligibleAdvanceAmount: 3700, finalAdvanceAmount: 1500, submittedBy: "RBP" }],
    allotment: { vehicleNo: "TN58BK3088", trackupNumber: "JS-1", allottedAt: "2026-11-24T04:30:00.000Z", driverAssignedAt: "2026-11-24T04:31:00.000Z", driverAssignedBy: "RBP", driverActive: true, driverReleasedAt: null },
  };
  const html = renderToStaticMarkup(<DriverBody d={d} />);
  for (const v of ["DR-4821", "SAMPATH M", "Acting Driver", "+91 9876543210", "₹370.00", "In Use – Another Project", "XXXXXXXX9012", "SBIN0001234", "TN58BK3088", "Assigned", "Advance history", "₹3,700.00", "₹1,500.00", "Read-only"]) assert.ok(html.includes(v), v);
  assert.ok(!html.includes("123456789012") && !html.includes("<input") && !html.includes("<button"));
  const bare = renderToStaticMarkup(<DriverBody d={{ ...d, availability: null, advances: [], bank: { accountName: null, bankName: null, accountNumberMasked: null, ifscCode: null }, perDaySalary: 0 }} />);
  assert.ok(bare.includes("No advances yet") && !bare.includes("undefined") && !bare.includes("null"));
});

test("Check Advance Eligibility result shows days, salary, eligible, half and the rounded-down advance", () => {
  const html = renderToStaticMarkup(<EligibilityResult r={{ driverNumber: "DR-4821", driverName: "SAMPATH M", workingDays: 10, perDaySalary: 370, eligibleAdvanceAmount: 3700, halfEligibleAmount: 1850, finalAdvanceAmount: 1500 }} />);
  for (const v of ["DR-4821 · SAMPATH M", "Overall Working Days", ">10<", "₹370.00", "Eligible Advance Amount", "₹3,700.00", "Half Eligible Amount", "₹1,850.00", "Final Rounded Advance Amount", "₹1,500.00"]) assert.ok(html.includes(v), v);
});
