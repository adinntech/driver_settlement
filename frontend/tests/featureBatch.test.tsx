import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import RbpApprovalPanel from "../src/components/RbpApprovalPanel";
import DriverFormView from "../src/components/DriverFormView";
import { BulkImportDialog, importFileError } from "../src/components/BulkImport";
import { MultiPhotoPicker } from "../src/components/DeliveryForm";
import { dailyPaymentText } from "../src/components/OnRoadVehicles";
import type { Budget } from "../src/types/domain";
import { addDaysYmd, earliestStartYmd, startDateError } from "../src/utils/dates";
import { MAX_ADDITIONAL_PHOTOS, validateDeliveryForm } from "../src/utils/delivery";
import { emptyDriverForm } from "../src/utils/driverForm";
import { dailyPaymentHref, onRoadBase } from "../src/utils/settlement";

const noop = () => {};
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// ------------------------------------------------------------------ campaign start date window
test("campaign start date: today back to 7 days ago; older and future dates are refused (same rule as the server)", () => {
  const today = "2026-11-26";
  assert.equal(earliestStartYmd(today), "2026-11-19");
  assert.equal(startDateError(today, "Start date", today), "");
  assert.equal(startDateError("2026-11-19", "Start date", today), ""); // exactly 7 days back
  assert.equal(startDateError("2026-11-18", "Start date", today), "Start date cannot be more than 7 days in the past");
  assert.equal(startDateError("2026-11-27", "From date", today), "From date cannot be in the future");
  assert.equal(addDaysYmd("2026-03-01", -7), "2026-02-22"); // month / leap boundaries
  // both forms default to today and bound the picker to the window (Reporting date stays inside the campaign)
  const page = src("app/rsop/new/page.tsx");
  assert.ok(page.includes('startDate: todayIst()'));
  assert.ok(page.includes("min={minStart} max={earlierOf(today, f.endDate)}"));
  assert.ok(page.includes('useFormState({ date: today, fromDate: today })'));
  assert.ok(page.includes("min={minStart} max={earlierOf(today, f.toDate)}"));
});

// ------------------------------------------------------------------ budget: no separate send action
const budget = (over: Partial<Budget> = {}): Budget => ({
  _id: "b1", budgetNumber: "BUD-1", currentVersion: 1, approvalStatus: "DRAFT", data: {}, total: 100, createdBy: "RBP", updatedBy: "RBP",
  createdAt: "2026-11-25T00:00:00Z", updatedAt: "2026-11-25T00:00:00Z", ...over,
} as unknown as Budget);

test("approval panel shows status and rejection details only: no Submit / Resubmit button; Save & Submit lives in the form", () => {
  for (const st of ["DRAFT", "REJECTED", "PENDING", "APPROVED"]) {
    const html = renderToStaticMarkup(<RbpApprovalPanel budget={budget({ approvalStatus: st, rejectedVersion: 1, rejection: st === "REJECTED" ? { version: 1, reason: null, fields: [{ field: "tolls", comment: "Fix" }], rejectedBy: "RSOM", rejectedAt: "2026-11-25T00:00:00Z" } : undefined } as Partial<Budget>)} />);
    assert.ok(!/Submit for Approval<\/button>|Resubmit to RSOM<\/button>/.test(html), st);
    if (st === "REJECTED") {
      assert.ok(html.includes("Toll Detail") && html.includes("Fix"));
      assert.ok(!html.includes("<strong>Reason:</strong>"), "an empty optional reason is not shown");
    }
  }
  const form = src("app/rbp/budget/page.tsx");
  assert.ok(form.includes("Save &amp; Submit for Approval") && form.includes('setConfirm("SAVE")') && form.includes('setConfirm("SUBMIT")'));
  assert.ok(form.includes("/submit`") && form.includes("no changes to save")); // unchanged draft / revised rejected version submits as is
  // RSOM: the rejection reason is optional
  const review = src("app/rsom/review/page.tsx");
  assert.ok(review.includes("Rejection reason (optional)") && !review.includes('"Rejection reason is required"'));
});

// ------------------------------------------------------------------ driver details lock
test("driver form: a saved driver's details are disabled, only bank details stay editable; a new driver is fully editable", () => {
  const f = { ...emptyDriverForm(), driverName: "Murugan K", mobile: "9876543210", driverType: "COMPANY_DRIVER" as const };
  const edit = renderToStaticMarkup(<DriverFormView value={f} onChange={noop} driverNumber="DR-1234" isEdit onSave={noop} onClose={noop} />);
  const disabled = (label: string, html: string) => new RegExp(`aria-label="${label}"[^>]*disabled=""|disabled=""[^>]*aria-label="${label}"`).test(html);
  for (const l of ["Name", "Address", "Mobile number \\(\\+91\\)", "Licence No", "Licence Type", "Licence Expiry Date", "Salary", "Browse attachment"]) assert.ok(disabled(l, edit), `${l} locked`);
  for (const l of ["Account Name", "Account No", "IFSC Code", "Bank Name"]) assert.ok(!disabled(l, edit), `${l} editable`);
  assert.ok(edit.includes("Driver details are locked after saving"));
  const create = renderToStaticMarkup(<DriverFormView value={f} onChange={noop} driverNumber={null} isEdit={false} onSave={noop} onClose={noop} />);
  assert.ok(!create.includes('disabled=""') || !disabled("Name", create));
  assert.ok(!create.includes("Driver details are locked"));
});

// ------------------------------------------------------------------ delivery: additional photos
test("delivery: optional additional photos (max 10, same file rules); picker renders previews and the count", () => {
  const jpg = { name: "a.jpg", type: "image/jpeg", size: 1000 };
  assert.deepEqual(validateDeliveryForm("Handed over to driver", jpg, jpg, []), []);
  assert.deepEqual(validateDeliveryForm("Handed over to driver", jpg, jpg, [jpg, { ...jpg, name: "b.png", type: "image/png" }]), []);
  assert.ok(validateDeliveryForm("Handed over to driver", jpg, jpg, [{ name: "x.pdf", type: "application/pdf", size: 10 }]).some((e) => /Additional photo 1 must be a JPG/.test(e)));
  assert.ok(validateDeliveryForm("Handed over to driver", jpg, jpg, Array(MAX_ADDITIONAL_PHOTOS + 1).fill(jpg)).some((e) => /max 10/.test(e)));
  const empty = renderToStaticMarkup(<MultiPhotoPicker files={[]} onChange={noop} camera />);
  assert.ok(empty.includes("Additional Photos (optional)") && empty.includes("No additional photos.") && empty.includes("0/10") && empty.includes("multiple"));
  const view = src("components/ClearanceDetailView.tsx");
  assert.ok(view.includes("additionalPhotos ?? []") && view.includes("Additional Photo ${i + 1}"));
});

// ------------------------------------------------------------------ Excel import
test("Excel import: file checks before upload; dialog offers the template and keeps Import disabled until a clean check", () => {
  assert.equal(importFileError(null), "Choose an Excel file (.xlsx)");
  assert.equal(importFileError({ name: "drivers.csv", size: 10 }), "Only Excel .xlsx files can be imported");
  assert.equal(importFileError({ name: "d.xlsx", size: 0 }), "The file is empty");
  assert.equal(importFileError({ name: "d.xlsx", size: 11 * 1024 * 1024 }), "The file is too large (maximum 10 MB)");
  assert.equal(importFileError({ name: "Vehicles.XLSX", size: 2048 }), null);
  for (const kind of ["vehicles", "drivers"] as const) {
    const html = renderToStaticMarkup(<BulkImportDialog kind={kind} onClose={noop} onImported={noop} />);
    assert.ok(html.includes(`Import ${kind} from Excel`) && html.includes("Download Template") && html.includes("Choose Excel File"));
    assert.match(html, /<button[^>]*disabled=""[^>]*>Import<\/button>/);
  }
  assert.ok(src("app/rbp/vehicles/page.tsx").includes('<BulkImportButton kind="vehicles"'));
  assert.ok(src("app/rbp/drivers/page.tsx").includes('<BulkImportButton kind="drivers"'));
});

// ------------------------------------------------------------------ On Road Vehicles
test("On Road Vehicles: per-role tab and the existing daily payment form (returns to the tab); button moved off Driver Payments", () => {
  assert.equal(onRoadBase("RBP"), "/rbp/on-road-vehicles");
  assert.equal(onRoadBase("RSA"), "/rsa/on-road-vehicles");
  assert.equal(dailyPaymentHref("RBP", "abc"), "/rbp/payments/daily?tv=abc&from=on-road");
  assert.equal(dailyPaymentHref("RSA", "abc"), "/rsa/driver-payments/daily?tv=abc&from=on-road");
  assert.equal(dailyPaymentText({ count: 0, pending: 0, rejected: 0, lastPaidUpTo: null }), "No daily payments yet");
  assert.equal(dailyPaymentText({ count: 3, pending: 1, rejected: 1, lastPaidUpTo: "2026-11-25" }), "3 payments · 1 pending RSOM · 1 rejected · up to 25-Nov-2026");
  const list = src("components/settlement/DriverPaymentsPages.tsx");
  assert.ok(!list.includes("+ Daily Vehicle Payment") && list.includes("+ Final Driver Settlement"));
});

test("On Road Vehicles regression: the page loads the list endpoint (no payment id) and each row links by its own project vehicle", () => {
  const page = src("components/OnRoadVehicles.tsx");
  assert.ok(page.includes("useApi<{ items: OnRoadRow[]; total: number; page: number; limit: number }>(`/settlements/on-road?${qs}`)"));
  assert.ok(!/settlements\/\$\{[^}]*(_id|paymentId|id)\}/.test(page), "never fetches /settlements/:id");
  assert.ok(page.includes("dailyPaymentHref(role, r.trackingVehicle)"));
  assert.ok(page.includes("projectType: type") && page.includes("q: dq.trim()")); // filters are sent to the server
  // the daily form reads the project vehicle (tv) from the link and returns to On Road Vehicles
  assert.ok(src("components/settlement/PaymentForms.tsx").includes('useSearchParams().get("from") === "on-road"'));
});
