import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Body, DriverChanges, eventText } from "../src/components/AllotmentDetail";
import { AssignDriverModal, ChangeDriverModal } from "../src/components/AllotmentModals";
import { DriverBankPanel } from "../src/components/DriverBank";
import type { Allotment, AllotmentDetailData } from "../src/types/domain";
import { emptyChangeDriverForm, toChangeDriverPayload, validateChangeDriverForm } from "../src/utils/allotment";
import {
  bankChanged, bankFormFrom, deductionValue, emptyBankForm, formatDeduction, maskAccount, sanitizeBankText, sanitizeDeduction, sanitizeDigits, sanitizeIfsc, toBankPayload,
  validateBankForm, validateDeduction, type BankView,
} from "../src/utils/driverBank";

const noop = () => {};
const view = (over: Partial<BankView> = {}): BankView => ({
  driverId: "d".repeat(24), driverNumber: "DR-4821", driverName: "Murugan K", accountName: "Murugan K", bankName: "State Bank of India", accountNumber: "123456789012", ifscCode: "SBIN0001234",
  accountNumberMasked: "XXXXXXXX9012", hasBankDetails: true, ...over,
});
const panel = (bank: BankView, over: Partial<Parameters<typeof DriverBankPanel>[0]> = {}) =>
  renderToStaticMarkup(<DriverBankPanel bank={bank} editing={false} form={bankFormFrom(bank)} onEdit={noop} onChange={noop} onSave={noop} onCancel={noop} {...over} />);

// ================================================================== bank details (assign / change)
test("saved bank details auto-populate read-only: holder, bank, masked account number, IFSC, with Edit Bank Details", () => {
  const html = panel(view());
  for (const v of ["Bank Details · DR-4821", "Account Holder Name", "Murugan K", "Bank Name", "State Bank of India", "Account Number", "XXXXXXXX9012", "IFSC Code", "SBIN0001234", "Edit Bank Details"]) assert.ok(html.includes(v), v);
  assert.ok(!html.includes("123456789012")); // the full number is not shown in the normal view
  assert.ok(!html.includes("Save Bank Details"));
  assert.ok(html.includes('data-mode="view"'));
  assert.ok(!/branch/i.test(html)); // no invented bank fields
});

test("missing bank details: a clear note, an Add action, and the driver can still be assigned without them", () => {
  const html = panel(view({ accountName: null, bankName: null, accountNumber: null, ifscCode: null, accountNumberMasked: null, hasBankDetails: false }));
  assert.ok(html.includes('data-mode="empty"') && html.includes("assign without them") && html.includes("Add Bank Details"));
  assert.ok(!html.includes("undefined") && !html.includes("null"));
  assert.deepEqual(validateBankForm(emptyBankForm()), []); // nothing is mandatory
  assert.deepEqual(bankFormFrom(null), emptyBankForm());
});

test("edit mode: four editable fields, Save Bank Details and Cancel, loaded with the saved values (full number only here)", () => {
  const html = panel(view(), { editing: true });
  for (const l of ['aria-label="Account Holder Name"', 'aria-label="Bank Name"', 'aria-label="Account Number"', 'aria-label="IFSC Code"', "Save Bank Details", ">Cancel<"]) assert.ok(html.includes(l), l);
  for (const v of ['value="Murugan K"', 'value="State Bank of India"', 'value="123456789012"', 'value="SBIN0001234"']) assert.ok(html.includes(v), v);
  assert.ok(!html.includes("Edit Bank Details") && html.includes('data-mode="edit"'));
  assert.ok(panel(view(), { editing: true, errors: ["IFSC code is not valid (e.g. SBIN0001234)"] }).includes("IFSC code is not valid"));
  assert.ok(panel(view(), { editing: true, saving: true }).includes("Saving…"));
});

test("cancel restores the saved values; an untouched form is not a change; trimmed / upper-cased payload", () => {
  const saved = bankFormFrom(view());
  const edited = { ...saved, bankName: "HDFC Bank", accountNumber: "999900001111" };
  assert.equal(bankChanged(saved, edited), true);
  assert.equal(bankChanged(saved, bankFormFrom(view())), false); // Cancel = go back to bankFormFrom(saved): identical
  assert.deepEqual(bankFormFrom(view()), saved);
  assert.equal(bankChanged(saved, { ...saved, bankName: "  State Bank of India " }), false);
  assert.deepEqual(toBankPayload({ accountName: " A B ", bankName: " X ", accountNumber: " 123456 ", ifscCode: "sbin0001234" }), { accountName: "A B", bankName: "X", accountNumber: "123456", ifscCode: "SBIN0001234" });
});

test("each driver's panel is built from that driver's own record: switching driver never carries the previous values over", () => {
  const first = view();
  const second = view({ driverId: "e".repeat(24), driverNumber: "DR-7310", accountName: "Selvam R", bankName: "ICICI", accountNumber: "444455556666", accountNumberMasked: "XXXXXXXX6666", ifscCode: "ICIC0002222" });
  const a = panel(first, { editing: true });
  const b = panel(second, { editing: true, form: bankFormFrom(second) });
  assert.ok(a.includes(`data-driver="${"d".repeat(24)}"`) && b.includes(`data-driver="${"e".repeat(24)}"`));
  for (const v of ["Murugan K", "123456789012", "State Bank of India", "value=\"SBIN0001234\""]) assert.ok(!b.includes(v), `${v} must not leak into the replacement's panel`);
  for (const v of ["Selvam R", "444455556666", "ICICI", "ICIC0002222"]) assert.ok(b.includes(v), v);
  assert.deepEqual(bankFormFrom(second), { accountName: "Selvam R", bankName: "ICICI", accountNumber: "444455556666", ifscCode: "ICIC0002222" });
});

test("bank validation mirrors the server; keyboard sanitisers; masking", () => {
  assert.deepEqual(validateBankForm(bankFormFrom(view())), []);
  assert.ok(validateBankForm({ ...bankFormFrom(view()), accountNumber: "12345" }).includes("Account number must be 6 to 20 digits"));
  assert.ok(validateBankForm({ ...bankFormFrom(view()), ifscCode: "SBIN1234" }).some((m) => /IFSC/.test(m)));
  assert.ok(validateBankForm({ ...bankFormFrom(view()), bankName: "x".repeat(81) }).some((m) => /too long/.test(m)));
  assert.equal(sanitizeDigits("12ab-34"), "1234");
  assert.equal(sanitizeIfsc("sbin 0001234!"), "SBIN0001234");
  assert.equal(sanitizeBankText("State <b>Bank"), "State bBank");
  assert.equal(maskAccount("123456789012"), "XXXXXXXX9012");
  assert.equal(maskAccount("1234"), "XXXX");
  assert.equal(maskAccount(null), "—");
});

// ================================================================== dialogs
const target = { _id: "a".repeat(24), vehicleNo: "TN01AA0001", trackupNumber: "T-1", projectName: "Pepsi Signage" };
const current = { driverId: "d".repeat(24), driverNumber: "DR-4821", driverName: "Murugan K", driverType: "ACTING_DRIVER", mobileNumber: "+91 9876543210", assignedAt: null };

test("Assign Driver dialog: no bank panel until a driver is chosen; existing dialog parts unchanged", () => {
  const html = renderToStaticMarkup(<AssignDriverModal target={target} onClose={noop} onDone={noop} />);
  assert.ok(!html.includes("Bank Details") && !html.includes("Travel Amount Deduction")); // deduction is Change Driver only
  for (const v of ["Assign Driver · TN01AA0001", 'aria-label="Driver Number"', 'aria-label="Driver Name"', "Assign Driver</button>"]) assert.ok(html.includes(v), v);
});

test("Change Driver dialog: current driver read-only, replacement search, Travel Amount Deduction, reason mandatory, attachment optional", () => {
  const html = renderToStaticMarkup(<ChangeDriverModal target={target} current={current} onClose={noop} onDone={noop} />);
  for (const v of ['data-section="current-driver"', "Replacement driver", "Travel Amount Deduction", 'aria-label="Travel Amount Deduction"', 'inputMode="decimal"', 'placeholder="0"', "Change Reason", "Supporting Attachment", "Additional Remarks"]) assert.ok(html.includes(v), v);
  assert.ok(/Change Reason<span class="req"> \*<\/span>/.test(html));
  assert.ok(!/Travel Amount Deduction<span class="req">/.test(html) && !/Supporting Attachment<span class="req">/.test(html)); // both optional
  assert.ok(html.includes("no budget or salary is changed"));
  assert.ok(!html.includes("Bank Details")); // appears once a replacement is selected
});

// ================================================================== travel amount deduction
test("deduction keyboard filter: digits and one decimal point only; letters, symbols and minus never get in", () => {
  assert.equal(sanitizeDeduction("500"), "500");
  assert.equal(sanitizeDeduction("5a0b0"), "500");
  assert.equal(sanitizeDeduction("₹1,000"), "1000");
  assert.equal(sanitizeDeduction("-50"), "50");
  assert.equal(sanitizeDeduction("12.345"), "12.34");
  assert.equal(sanitizeDeduction("1.2.3"), "1.23");
  assert.equal(sanitizeDeduction("abc"), "");
  assert.equal(sanitizeDeduction("5e2"), "52");
  assert.ok(sanitizeDeduction("1".repeat(30)).length <= 10);
});

test("deduction validation: empty / zero / decimals fine; letters, negatives, symbols and over-limit rejected", () => {
  for (const ok of ["", "  ", "0", "0.00", "500", "500.5", "250.50", "9999999.99"]) assert.equal(validateDeduction(ok), null, ok);
  for (const bad of ["abc", "5a", "-5", "5e2", "1,000", "₹500", "5.", ".5", "1.234", "10000000", "1 0"]) assert.notEqual(validateDeduction(bad), null, bad);
  assert.match(validateDeduction("abc")!, /digits only/);
  assert.match(validateDeduction("10000000")!, /cannot exceed/);
  assert.equal(deductionValue(""), 0);
  assert.equal(deductionValue("0"), 0);
  assert.equal(deductionValue("250.50"), 250.5);
  assert.equal(deductionValue("abc"), 0); // never coerced from bad text
  assert.equal(formatDeduction(500), "₹500.00"); // same currency format as the rest of the app (formatInr)
  assert.ok(formatDeduction(500).includes("500") && formatDeduction(500).includes("₹"));
  assert.ok(formatDeduction(null).includes("0"));
});

test("change driver form: deduction validated with the rest, defaults to 0, sent as a number; existing rules unchanged", () => {
  const f = { ...emptyChangeDriverForm(), driverId: "e".repeat(24), reason: "Driver fell ill" };
  assert.equal(emptyChangeDriverForm().travelAmountDeduction, "");
  assert.deepEqual(validateChangeDriverForm(f, current.driverId), []);
  assert.deepEqual(validateChangeDriverForm({ ...f, travelAmountDeduction: "500" }, current.driverId), []);
  assert.ok(validateChangeDriverForm({ ...f, travelAmountDeduction: "abc" }, current.driverId).some((m) => /digits only/.test(m)));
  assert.ok(validateChangeDriverForm({ ...f, travelAmountDeduction: "-5" }, current.driverId).some((m) => /digits only/.test(m)));
  assert.ok(validateChangeDriverForm({ ...f, reason: "", travelAmountDeduction: "5" }, current.driverId).includes("Change reason is required")); // reason still mandatory
  assert.ok(validateChangeDriverForm({ ...f, driverId: current.driverId }, current.driverId).includes("Choose a different driver as the replacement"));
  assert.equal(toChangeDriverPayload(f).travelAmountDeduction, 0);
  assert.equal(toChangeDriverPayload({ ...f, travelAmountDeduction: "250.50" }).travelAmountDeduction, 250.5);
  assert.equal(typeof toChangeDriverPayload({ ...f, travelAmountDeduction: "500" }).travelAmountDeduction, "number");
});

// ================================================================== history display
const base = {
  vehicle: "v1", vehicleNo: "TN01AA0001", clientName: "Pepsi India", projectName: "P", projectType: "SIGNAGE", trackupNumber: "T-1", pifNumber: "PIF-1", changeAttachments: [], createdBy: "RBP", updatedBy: "RBP",
  createdAt: "2026-11-24T04:30:00.000Z", updatedAt: "2026-11-24T05:00:00.000Z", allottedAt: "2026-11-24T04:30:00.000Z", nextAvailableAt: "2026-11-26T03:30:00.000Z",
};
const events = [
  { _id: "e2", action: "DRIVER_CHANGED", username: "RBP", createdAt: "2026-11-24T06:00:00.000Z",
    details: { from: { driverNumber: "DR-1234", driverName: "First F" }, to: { driverNumber: "DR-5678", driverName: "Second S" }, reason: "Driver replacement", remarks: "from Salem", travelAmountDeduction: 500, attachments: [{ key: "k", name: "proof.pdf" }] } },
  { _id: "e1", action: "DRIVER_CHANGED", username: "RBP", createdAt: "2026-11-24T05:00:00.000Z",
    details: { from: { driverNumber: "DR-1", driverName: "A" }, to: { driverNumber: "DR-2", driverName: "B" }, reason: "No deduction" } }, // older record without the field
];
const detail: AllotmentDetailData = {
  allotment: { ...base, _id: "a".repeat(24), status: "ACTIVE" } as Allotment, original: { vehicleNo: "TN01AA0001" }, current: { vehicleNo: "TN01AA0001", status: "ACTIVE" },
  chain: [], vehicle: { vehicleNo: "TN01AA0001", availabilityStatus: "IN_USE" }, events,
};

test("allotment detail lists every driver change with previous / replacement driver, reason, Travel Amount Deduction, time and user", () => {
  const html = renderToStaticMarkup(<Body d={detail} />);
  for (const v of ["Driver changes", 'data-section="driver-changes"', "Previous Driver", "Replacement Driver", "DR-1234 · First F", "DR-5678 · Second S", "Driver replacement — from Salem", "Travel Amount Deduction", "proof.pdf", "RBP", "24-Nov-2026, 11:30 AM"])
    assert.ok(html.includes(v), v);
  assert.ok(html.includes(`data-deduction="true">₹500.00`), "500 shown in the app currency format");
  assert.ok(html.includes(`data-deduction="true">₹0.00`), "older changes without a deduction show 0");
  assert.ok(html.indexOf("DR-5678") < html.indexOf("DR-2")); // newest first
  assert.ok(!html.includes("undefined") && !html.includes("NaN"));
  assert.equal(renderToStaticMarkup(<DriverChanges events={[]} />), ""); // nothing to show before any change
  assert.ok(!renderToStaticMarkup(<Body d={{ ...detail, events: [] }} />).includes("Driver changes"));
});

test("timeline text: deduction and bank updates are described; earlier texts unchanged", () => {
  assert.equal(eventText("DRIVER_CHANGED", { from: { driverNumber: "DR-1" }, to: { driverNumber: "DR-2" }, reason: "ill", travelAmountDeduction: 500 }), `DR-1 → DR-2. Reason: ill. Travel amount deduction: ${formatDeduction(500)}`);
  assert.equal(eventText("DRIVER_CHANGED", { from: { driverNumber: "DR-1" }, to: { driverNumber: "DR-2" }, reason: "ill", travelAmountDeduction: 0 }), "DR-1 → DR-2. Reason: ill");
  assert.equal(eventText("DRIVER_CHANGED", { from: { driverNumber: "DR-1" }, to: { driverNumber: "DR-2" }, reason: "ill" }), "DR-1 → DR-2. Reason: ill");
  assert.equal(eventText("DRIVER_BANK_UPDATED", { driverNumber: "DR-7", changes: [{ field: "bankName" }, { field: "ifscCode" }] }), "DR-7 bank details updated (bankName, ifscCode)");
  assert.equal(eventText("DRIVER_ASSIGNED", { driverNumber: "DR-1", driverName: "A B", later: false }), "DR-1 A B assigned with the vehicle");
  assert.equal(eventText("RELEASED", { reason: "Released by RBP" }), "Released by RBP");
});
