import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import DriverDetails from "../src/components/DriverDetails";
import DriverFormView from "../src/components/DriverFormView";
import { VEHICLE_TABS, VehicleTabsView, activeTab } from "../src/components/VehicleTabs";
import type { Driver } from "../src/types/domain";
import {
  DRIVER_TYPE_OPTIONS, emptyDriverForm, fromDriver, licenceKey, sanitizeDigits, sanitizeIfsc, sanitizeLicence, sanitizeName, sanitizeSalary,
  toDriverPayload, validateDriverForm, type DriverFormState,
} from "../src/utils/driverForm";

const noop = () => {};
const ok = (over: Partial<DriverFormState> = {}): DriverFormState => ({
  ...emptyDriverForm(), driverName: "Murugan K", driverType: "COMPANY_DRIVER", mobile: "9876543210", ...over,
});
const render = (f: DriverFormState, driverNumber: string | null = null, isEdit = false) =>
  renderToStaticMarkup(<DriverFormView value={f} onChange={noop} driverNumber={driverNumber} isEdit={isEdit} onSave={noop} onClose={noop} />);

test("Driver Management is no longer a Vehicle Management tab (it has its own sidebar menu)", () => {
  assert.deepEqual(VEHICLE_TABS.map((t) => t.label), ["Vehicle Management", "Vehicle Allotment", "Allotment History"]);
  assert.deepEqual(VEHICLE_TABS.map((t) => t.href), ["/rbp/vehicles", "/rbp/vehicles/allotment", "/rbp/vehicles/allotment-history"]);
  for (const [path, tab] of [
    ["/rbp/vehicles", "/rbp/vehicles"], ["/rbp/vehicles/edit", "/rbp/vehicles"], ["/rbp/vehicles/allotment", "/rbp/vehicles/allotment"],
    ["/rbp/vehicles/allotment-history", "/rbp/vehicles/allotment-history"],
  ] as const) assert.equal(activeTab(path), tab, path);
  const html = renderToStaticMarkup(<VehicleTabsView active="/rbp/vehicles" />);
  assert.ok(!html.includes("Driver Management"));
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
});

test("form shows the screenshot fields in order, the read-only Driver No, and no Branch field", () => {
  const html = render(ok());
  const labels = ["Driver No", "Name", "Address", "Mobile No", "Account Name", "Account No", "IFSC Code", "Bank Name", "Licence No", "Licence Type", "Licence Expiry Date", "Attachment", "Driver Type", "Salary"];
  let at = -1;
  for (const l of labels) {
    const i = html.indexOf(`<label>${l}`, at + 1);
    assert.ok(i > at, `${l} present and in order`);
    at = i;
  }
  assert.ok(!/Brnach|Branch/i.test(html)); // the Branch field is ignored
  assert.ok(html.includes("Generated on save")); // new driver: number is produced by the server
  assert.ok(html.includes('type="date"'));
  assert.ok(html.includes('type="file"') && html.includes("hidden"));
  assert.ok(html.includes(">...<") && html.includes(">V<")); // browse and view buttons like the screen
  assert.ok(html.includes("+91")); // mobile uses the +91 input
  assert.ok(html.includes(">Save<") && html.includes(">Close<"));
  assert.ok(!html.includes("undefined"));
});

test("Driver Number is shown, never editable, in edit mode", () => {
  const html = render(ok(), "DR-3836", true);
  assert.ok(html.includes("DR-3836"));
  assert.ok(!/<input[^>]*value="DR-3836"/.test(html)); // plain text, not an input
  assert.ok(!html.includes("Generated on save"));
  assert.ok(html.includes("Status")); // status is only offered while editing
  assert.ok(!render(ok()).includes('aria-label="Status"'));
});

test("Driver Type radios: Company Driver / Acting Driver, exactly one selected, restored on edit", () => {
  assert.deepEqual(DRIVER_TYPE_OPTIONS.map((o) => o.label), ["Company Driver", "Acting Driver"]);
  // only the Driver Type group is looked at: the availability status section has radios of its own
  const group = (html: string) => html.slice(html.indexOf('aria-label="Driver Type"'), html.indexOf('aria-label="Driver Type"') + 700).split("</div>")[0];
  const none = group(render({ ...ok(), driverType: "" }));
  assert.equal((none.match(/type="radio"/g) ?? []).length, 2);
  assert.equal((none.match(/checked=""/g) ?? []).length, 0);
  assert.ok(!none.includes('type="checkbox"'));
  const company = group(render(ok({ driverType: "COMPANY_DRIVER" })));
  assert.equal((company.match(/checked=""/g) ?? []).length, 1);
  assert.match(company, /value="COMPANY_DRIVER"[^>]*checked=""|checked=""[^>]*value="COMPANY_DRIVER"/);
  const acting = group(render(ok({ driverType: "ACTING_DRIVER" })));
  assert.equal((acting.match(/checked=""/g) ?? []).length, 1);
  assert.match(acting, /value="ACTING_DRIVER"[^>]*checked=""|checked=""[^>]*value="ACTING_DRIVER"/);
  assert.ok(acting.includes('name="driverType"')); // one group: the browser allows a single choice
  // the saved value comes back when editing
  assert.equal(fromDriver({ driverType: "ACTING_DRIVER" }).driverType, "ACTING_DRIVER");
  assert.equal(fromDriver({ driverType: "COMPANY_DRIVER" }).driverType, "COMPANY_DRIVER");
  assert.equal(fromDriver({}).driverType, "");
});

test("validation: required fields, phone, licence, IFSC, account, date, salary", () => {
  assert.deepEqual(validateDriverForm(ok()), []);
  const e = validateDriverForm(emptyDriverForm());
  for (const m of ["Driver name is required", "Driver type is required", "Mobile number is required"]) assert.ok(e.includes(m), m);
  assert.ok(validateDriverForm(ok({ driverType: "" })).includes("Driver type is required"));
  for (const bad of ["98765", "5876543210", "abcdefghij"]) assert.ok(validateDriverForm(ok({ mobile: bad })).some((m) => /valid 10-digit/.test(m)), bad);
  assert.ok(validateDriverForm(ok({ driverName: "R2D2" })).some((m) => /letters, spaces/.test(m)));
  assert.ok(validateDriverForm(ok({ driverName: "A" })).some((m) => /letters, spaces/.test(m)));
  assert.deepEqual(validateDriverForm(ok({ driverName: "Mary-Ann O'Neil Jr." })), []);
  assert.ok(validateDriverForm(ok({ accountNumber: "12345" })).some((m) => /6 to 20 digits/.test(m)));
  assert.ok(validateDriverForm(ok({ ifscCode: "SBIN1234" })).some((m) => /IFSC/.test(m)));
  assert.deepEqual(validateDriverForm(ok({ ifscCode: "SBIN0001234", accountNumber: "123456789" })), []);
  assert.ok(validateDriverForm(ok({ licenceNumber: "12345" })).some((m) => /Licence number is not valid/.test(m)));
  assert.deepEqual(validateDriverForm(ok({ licenceNumber: "TN07 2011 0012345" })), []);
  assert.deepEqual(validateDriverForm(ok({ licenceNumber: "tn07-20110012345" })), []);
  assert.ok(validateDriverForm(ok({ licenceExpiryDate: "2030-02-31" })).some((m) => /valid date/.test(m)));
  assert.deepEqual(validateDriverForm(ok({ licenceExpiryDate: "2030-05-20" })), []);
  assert.ok(validateDriverForm(ok({ salary: "-1" })).some((m) => /Salary/.test(m)));
  assert.deepEqual(validateDriverForm(ok({ salary: "18500.50" })), []);
  assert.equal(licenceKey("tn07 2011-0012345"), "TN0720110012345");
});

test("keyboard sanitisers stop invalid characters without over-restricting", () => {
  assert.equal(sanitizeName("Ravi 2 Kumar!@#"), "Ravi  Kumar");
  assert.equal(sanitizeName("Mary-Ann O'Neil Jr."), "Mary-Ann O'Neil Jr.");
  assert.equal(sanitizeDigits("12ab34-56"), "123456");
  assert.equal(sanitizeIfsc("sbin 0001234!"), "SBIN0001234");
  assert.equal(sanitizeIfsc("SBIN00012345678"), "SBIN0001234");
  assert.equal(sanitizeLicence("tn07 2011-0012345@"), "TN07 2011-0012345");
  assert.equal(sanitizeSalary("1a8,5.5.0"), "185.50");
  assert.equal(sanitizeSalary("12.345"), "12.34");
  assert.equal(sanitizeSalary("-5"), "5");
});

test("payload: +91 mobile, driver type, no driver number, attachment without url; status only when editing", () => {
  const att = { storage: "local" as const, key: "driver_settlement/vehicles/2026/k", name: "l.pdf", size: 5, mimeType: "application/pdf", url: "http://x/files/k" };
  const p = toDriverPayload(ok({ attachment: att, salary: "100" }), false);
  assert.equal(p.mobileNumber, "+91 9876543210");
  assert.equal(p.driverType, "COMPANY_DRIVER");
  assert.ok(!("driverNumber" in p));
  assert.ok(!("status" in p));
  assert.deepEqual(p.attachment, { storage: "local", key: att.key, name: "l.pdf", size: 5, mimeType: "application/pdf" });
  assert.equal(toDriverPayload(ok({ status: "INACTIVE" }), true).status, "INACTIVE");
  assert.equal(toDriverPayload(ok(), false).attachment, null);
});

const driver: Driver = {
  _id: "a".repeat(24), driverNumber: "DR-4821", driverName: "Murugan K", driverType: "ACTING_DRIVER", address: "Anna Nagar", mobileNumber: "+91 9876543210",
  accountName: "Murugan K", accountNumber: "123456789012", ifscCode: "SBIN0001234", bankName: "SBI", licenceNumber: "TN07 20110012345", licenceType: "LMV",
  licenceExpiryDate: "2030-05-20", attachment: { storage: "local", key: "k", name: "licence.pdf", size: 1, mimeType: "application/pdf", url: "http://x/files/k" },
  salary: 18500, status: "ACTIVE", createdBy: "RBP", updatedBy: "RBP", createdAt: "2026-11-24T04:30:00.000Z", updatedAt: "2026-11-24T05:00:00.000Z",
};

test("edit restores every saved value; view shows the complete details", () => {
  const f = fromDriver(driver);
  assert.deepEqual([f.driverName, f.address, f.mobile, f.accountNumber, f.ifscCode, f.bankName, f.licenceNumber, f.licenceType, f.licenceExpiryDate, f.salary, f.status],
    ["Murugan K", "Anna Nagar", "9876543210", "123456789012", "SBIN0001234", "SBI", "TN07 20110012345", "LMV", "2030-05-20", "18500", "ACTIVE"]);
  assert.equal(f.attachment?.name, "licence.pdf");
  const html = render(f, driver.driverNumber, true);
  for (const v of ["DR-4821", "Murugan K", "Anna Nagar", "9876543210", "123456789012", "SBIN0001234", "SBI", "TN07 20110012345", "LMV", "2030-05-20", "18500", "licence.pdf"]) assert.ok(html.includes(v), v);
  assert.match(html, /value="ACTING_DRIVER"[^>]*checked=""|checked=""[^>]*value="ACTING_DRIVER"/);
  assert.ok(html.includes('href="http://x/files/k"')); // V opens the attachment
  const view = renderToStaticMarkup(<DriverDetails d={driver} />);
  for (const v of ["DR-4821", "Murugan K", "Acting Driver", "+91 9876543210", "Anna Nagar", "123456789012", "SBIN0001234", "SBI", "TN07 20110012345", "LMV", "20-May-2030", "licence.pdf", "Active", "RBP"]) assert.ok(view.includes(v), v);
  assert.ok(!view.includes("undefined"));
  assert.equal(fromDriver({}).status, "ACTIVE"); // old / empty records load safely
});
