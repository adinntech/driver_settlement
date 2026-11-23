import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { NAV } from "../src/components/AppShell";
import DriverAvailability from "../src/components/DriverAvailability";
import DriverDetails, { DriverHistoryList } from "../src/components/DriverDetails";
import { DRIVER_LIST_COLUMNS, DriverFilters, DriverTable } from "../src/components/DriverList";
import { VEHICLE_TABS } from "../src/components/VehicleTabs";
import type { Driver, DriverAvailability as Av, DriverHistoryRow } from "../src/types/domain";
import {
  DRIVER_AV_LABEL, DRIVER_AV_STATUSES, DRIVER_AV_TONE, UNAVAILABLE_CATEGORIES, driverAvailabilityDates, driverProjectName, emptyDriverAvailability,
  fromDriverAvailability, historyValue, latestFirst, toDriverAvailabilityPayload, validateDriverAvailability, type DriverAvForm,
} from "../src/utils/driverAvailability";
import { emptyDriverForm, fromDriver, toDriverPayload, validateDriverForm } from "../src/utils/driverForm";
import { applyProject, type ProjectChoice } from "../src/utils/vehicleAvailability";

const noop = () => {};
const NOW = new Date("2026-11-24T06:30:00Z"); // 24-Nov-2026 12:00 IST
const render = (a: DriverAvForm) => renderToStaticMarkup(<DriverAvailability value={a} onChange={noop} />);
const av = (over: Partial<DriverAvForm> = {}): DriverAvForm => ({ ...emptyDriverAvailability(NOW), ...over });
const choice: ProjectChoice = {
  trackingProject: "a".repeat(24), trackingVehicle: "b".repeat(24), budget: "c".repeat(24), budgetVersion: 1, projectType: "SIGNAGE", projectName: "Pepsi India Signage – ZZ-77",
  clientName: "Pepsi India", trackupNumber: "JS-1/2026-27", pifNumber: "PIF-100", startDate: "2026-11-25", endDate: "2026-12-05", location: "Coimbatore", allocatedTo: null,
};
const inUseForm = (over: Partial<DriverAvForm["project"]> = {}): DriverAvForm => av({ status: "IN_USE", project: { ...applyProject(emptyDriverAvailability(NOW).project, choice), ...over } });
const naForm = (over: Partial<DriverAvForm["notAvailable"]> = {}): DriverAvForm => av({ status: "NOT_AVAILABLE", notAvailable: { reason: "Family function", category: "Personal Leave", fromDate: "2026-11-24", expectedAvailableDate: "", remarks: "", ...over } });

// ================================================================== sidebar
test("sidebar: RBP order is Projects & Budgets, Vehicle Management, Driver Management; RSOP and RSOM menus are unchanged", () => {
  assert.deepEqual(NAV.RBP, [
    { href: "/rbp", label: "Projects & Budgets" },
    { href: "/rbp/vehicles", label: "Vehicle Management" },
    { href: "/rbp/drivers", label: "Driver Management" },
  ]);
  assert.deepEqual(NAV.RSOP, [{ href: "/rsop", label: "Dashboard" }, { href: "/rsop/new", label: "New Tracking Request" }]);
  assert.deepEqual(NAV.RSOM, [{ href: "/rsom", label: "Budget Approvals" }]);
  for (const r of ["RSOP", "RSOM"] as const) assert.ok(!NAV[r].some((n) => /Driver/.test(n.label)), `${r} has no driver menu`); // authorised RBP users only
});

test("sidebar: Driver Management is removed from the Vehicle Management tabs; routes are not duplicated", () => {
  assert.ok(!VEHICLE_TABS.some((t) => /Driver/i.test(t.label) || /drivers/.test(t.href)));
  assert.equal(VEHICLE_TABS.length, 3);
  const hrefs = NAV.RBP.map((n) => n.href);
  assert.equal(new Set(hrefs).size, hrefs.length);
  assert.ok(!hrefs.some((h) => h.startsWith("/rbp/vehicles/drivers"))); // the old nested route is only a redirect (next.config.ts)
});

// ================================================================== status selection and dynamic fields
test("three statuses with the exact labels and colours; exactly one radio is selected", () => {
  assert.deepEqual(DRIVER_AV_STATUSES.map((s) => DRIVER_AV_LABEL[s]), ["Available Now", "In Use – Another Project", "Not Available"]);
  assert.deepEqual(DRIVER_AV_STATUSES.map((s) => DRIVER_AV_TONE[s]), ["green", "blue", "red"]);
  for (const s of DRIVER_AV_STATUSES) {
    const html = render(av({ status: s }));
    assert.equal((html.match(/name="driverAvailabilityStatus"/g) ?? []).length, 3);
    assert.equal((html.match(/name="driverAvailabilityStatus"[^>]*checked=""|checked=""[^>]*name="driverAvailabilityStatus"/g) ?? []).length, 1, s);
    assert.match(html, new RegExp(`value="${s}"[^>]*checked=""|checked=""[^>]*value="${s}"`));
  }
  const none = render(av({ status: "" }));
  assert.equal((none.match(/checked=""/g) ?? []).length, 0);
  assert.ok(!none.includes("data-panel")); // nothing shown until a status is chosen
});

test("Available Now shows From Date / Time (defaulting to now) and hides project and reason fields", () => {
  const f = emptyDriverAvailability(NOW);
  assert.deepEqual([f.status, f.availableFromDate, f.availableFromTime], ["AVAILABLE", "2026-11-24", "12:00"]);
  const html = render(f);
  assert.ok(html.includes('data-panel="available"'));
  assert.ok(html.includes("Available From Date") && html.includes("Available From Time"));
  assert.ok(!html.includes("Project From Date") && !html.includes("Unavailable Reason") && !html.includes("Trackup Number"));
});

test("In Use shows the project fields (type, name, client, trackup, PIF, from / to dates, remarks) and hides the reason fields", () => {
  const html = render(inUseForm());
  assert.ok(html.includes('data-panel="in-use"'));
  for (const l of ["Trackup Number", "PIF Number", "Project Type", "Project Name", "Client / Billing Name", "Project From Date", "Project To Date", "Additional Remarks"]) assert.ok(html.includes(l), l);
  assert.ok(!html.includes("Unavailable Reason") && !html.includes("Available From Time"));
  assert.ok(html.includes("Pepsi India") && html.includes("Pepsi India Signage – ZZ-77") && html.includes("JS-1/2026-27") && html.includes("PIF-100"));
  assert.match(html, /Project From Date[^>]*>|aria-label="Project From Date"/);
  assert.ok(html.includes('value="2026-11-25"') && html.includes('value="2026-12-05"'));
});

test("Not Available shows reason, category, from date, expected date and remarks; Other switches the label to a custom reason", () => {
  const html = render(naForm());
  assert.ok(html.includes('data-panel="not-available"'));
  for (const l of ["Reason Category", "Unavailable Reason", "Unavailable From Date", "Expected Available Date", "Additional Remarks"]) assert.ok(html.includes(l), l);
  for (const c of UNAVAILABLE_CATEGORIES) assert.ok(html.includes(`>${c}</option>`), c);
  assert.deepEqual(UNAVAILABLE_CATEGORIES, ["Personal Leave", "Medical Leave", "License Issue", "Vehicle/Project Related", "Other"]);
  assert.ok(!html.includes("Project From Date") && !html.includes("Available From Time"));
  assert.ok(!html.includes("Custom Reason"));
  assert.ok(render(naForm({ category: "Other" })).includes("Custom Reason"));
});

// ================================================================== validation
test("In Use validation: project, From and To dates required; invalid range rejected; a new past To date rejected", () => {
  const v = (a: DriverAvForm) => validateDriverAvailability(a, NOW);
  assert.deepEqual(v(inUseForm()), []);
  assert.ok(v(av({ status: "IN_USE" })).includes("Select an approved project by Trackup Number or PIF Number"));
  assert.ok(v(inUseForm({ startDate: "" })).includes("Project from date is required"));
  assert.ok(v(inUseForm({ endDate: "" })).includes("Project to date is required"));
  assert.ok(v(inUseForm({ startDate: "2026-12-10", endDate: "2026-12-01" })).includes("Project to date cannot be earlier than the from date"));
  assert.deepEqual(v(inUseForm({ startDate: "2026-11-24", endDate: "2026-11-24" })), []); // same day, equal to today: fine
  assert.ok(v(inUseForm({ startDate: "2026-11-01", endDate: "2026-11-10" })).includes("Project to date cannot be in the past"));
  assert.deepEqual(v({ ...inUseForm({ startDate: "2026-11-01", endDate: "2026-11-10" }), savedEndDate: "2026-11-10" }), []); // unchanged overdue date stays editable
  assert.ok(v(inUseForm({ endDate: "2026-02-31" })).some((m) => /not a valid date/.test(m)));
});

test("Not Available validation: reason and category mandatory; expected date cannot precede the from date; no auto-release rule on the form", () => {
  const v = (a: DriverAvForm) => validateDriverAvailability(a, NOW);
  assert.deepEqual(v(naForm()), []);
  assert.ok(v(naForm({ reason: "" })).includes("Unavailable reason is required"));
  assert.ok(v(naForm({ reason: "   " })).includes("Unavailable reason is required"));
  assert.ok(v(naForm({ category: "" })).includes("Reason category is required"));
  assert.ok(v(naForm({ category: "Holiday" })).includes("Reason category is not valid"));
  assert.deepEqual(v(naForm({ category: "Other", reason: "Gone to native place" })), []);
  assert.ok(v(naForm({ fromDate: "2026-11-24", expectedAvailableDate: "2026-11-20" })).some((m) => /before the unavailable from date/.test(m)));
  assert.deepEqual(v(naForm({ expectedAvailableDate: "2026-11-20", fromDate: "" })), []); // optional; a past expected date is not an error
});

test("status is required; Available Now needs both date and time or neither", () => {
  assert.deepEqual(validateDriverAvailability(av({ status: "" }), NOW), ["Driver status is required"]);
  assert.deepEqual(validateDriverAvailability(av(), NOW), []);
  assert.ok(validateDriverAvailability(av({ availableFromTime: "" }), NOW).some((m) => /both date and time/.test(m)));
  assert.ok(validateDriverForm({ ...emptyDriverForm(), driverName: "Murugan K", driverType: "COMPANY_DRIVER", mobile: "9876543210", availability: av({ status: "" }) }).includes("Driver status is required"));
  assert.deepEqual(validateDriverForm({ ...emptyDriverForm(), driverName: "Murugan K", driverType: "COMPANY_DRIVER", mobile: "9876543210" }), []); // existing form rules unchanged
});

// ================================================================== project auto-population, payload, persistence
test("selecting an approved project auto-populates its details and dates; changing the project clears them", () => {
  const p = applyProject(emptyDriverAvailability(NOW).project, choice);
  assert.deepEqual([p.trackupNumber, p.pifNumber, p.clientName, p.projectType, p.projectName, p.startDate, p.endDate, p.trackingProject],
    ["JS-1/2026-27", "PIF-100", "Pepsi India", "SIGNAGE", "Pepsi India Signage – ZZ-77", "2026-11-25", "2026-12-05", "a".repeat(24)]);
});

test("payload sends only the chosen status's fields (server fills the project details from the approved records)", () => {
  assert.deepEqual(Object.keys(toDriverAvailabilityPayload(av())).sort(), ["availableFromDate", "availableFromTime", "status"]);
  const inUse = toDriverAvailabilityPayload(inUseForm({ remarks: "peak" })) as { status: string; project: Record<string, string> };
  assert.equal(inUse.status, "IN_USE");
  assert.deepEqual(inUse.project, { trackupNumber: "JS-1/2026-27", pifNumber: "PIF-100", startDate: "2026-11-25", endDate: "2026-12-05", remarks: "peak" });
  const na = toDriverAvailabilityPayload(naForm({ remarks: "x" })) as Record<string, unknown>;
  assert.deepEqual(Object.keys(na).sort(), ["notAvailable", "status"]);
  assert.deepEqual(toDriverAvailabilityPayload(av({ status: "" })), { status: "" });
  // stale fields of the other statuses never leak into the payload
  const mixed = { ...inUseForm(), notAvailable: naForm().notAvailable };
  assert.ok(!("notAvailable" in toDriverAvailabilityPayload(mixed)));
  assert.equal(toDriverPayload({ ...emptyDriverForm(), driverName: "A B", driverType: "COMPANY_DRIVER", mobile: "9876543210" }, false).availability.status, "AVAILABLE");
});

const savedInUse: Av = {
  status: "IN_USE", project: { trackingProject: "a".repeat(24), trackingVehicle: "b".repeat(24), budget: "c".repeat(24), budgetVersion: 1, projectType: "SIGNAGE", projectName: "Pepsi India Signage – ZZ-77", clientName: "Pepsi India", trackupNumber: "JS-1/2026-27", pifNumber: "PIF-100", startDate: "2026-11-25", endDate: "2026-12-05", remarks: "peak" },
  notAvailable: null, lastStatusUpdatedBy: "RBP", lastStatusUpdatedAt: "2026-11-24T05:00:00.000Z",
};
const savedNa: Av = { status: "NOT_AVAILABLE", project: null, notAvailable: { reason: "Licence suspended", category: "License Issue", fromDate: "2026-11-20", expectedAvailableDate: "2026-12-01", remarks: "call RTO" } };
const savedAvailable: Av = { status: "AVAILABLE", availableFromDate: "2026-11-24", availableFromTime: "09:30", project: null, notAvailable: null };

test("edit restores the saved status and every conditional value, and saving again round-trips them", () => {
  const a = fromDriverAvailability(savedInUse, NOW);
  assert.equal(a.status, "IN_USE");
  assert.deepEqual([a.project.trackupNumber, a.project.pifNumber, a.project.startDate, a.project.endDate, a.project.remarks, a.savedEndDate], ["JS-1/2026-27", "PIF-100", "2026-11-25", "2026-12-05", "peak", "2026-12-05"]);
  const html = render(a);
  for (const v of ["Pepsi India", "JS-1/2026-27", "PIF-100", "2026-11-25", "2026-12-05", "peak"]) assert.ok(html.includes(v), v);
  assert.match(html, /value="IN_USE"[^>]*checked=""|checked=""[^>]*value="IN_USE"/);
  const n = fromDriverAvailability(savedNa, NOW);
  assert.deepEqual([n.status, n.notAvailable.reason, n.notAvailable.category, n.notAvailable.fromDate, n.notAvailable.expectedAvailableDate, n.notAvailable.remarks],
    ["NOT_AVAILABLE", "Licence suspended", "License Issue", "2026-11-20", "2026-12-01", "call RTO"]);
  const nh = render(n);
  assert.ok(nh.includes("Licence suspended") && nh.includes("call RTO") && nh.includes('value="2026-12-01"'));
  const av1 = fromDriverAvailability(savedAvailable, NOW);
  assert.deepEqual([av1.status, av1.availableFromDate, av1.availableFromTime], ["AVAILABLE", "2026-11-24", "09:30"]);
  assert.equal(validateDriverAvailability(a, NOW).length, 0);
  assert.deepEqual((toDriverAvailabilityPayload(a) as { project: unknown }).project, { trackupNumber: "JS-1/2026-27", pifNumber: "PIF-100", startDate: "2026-11-25", endDate: "2026-12-05", remarks: "peak" });
});

test("legacy drivers without availability load with no status chosen (never silently Available) and old shapes never crash", () => {
  for (const legacy of [undefined, null, {}, { status: null }, { status: "BOGUS" }] as unknown[]) assert.equal(fromDriverAvailability(legacy as Av, NOW).status, "");
  assert.equal(fromDriver({ driverName: "Old" }).availability.status, "");
  assert.ok(validateDriverForm({ ...fromDriver({ driverName: "Old Timer", driverType: "ACTING_DRIVER", mobileNumber: "+91 9876543210" }) }).includes("Driver status is required"));
});

// ================================================================== listing
const mkDriver = (over: Partial<Driver> = {}): Driver => ({
  _id: "a".repeat(24), driverNumber: "DR-4821", driverName: "Murugan K", driverType: "ACTING_DRIVER", address: "Anna Nagar", mobileNumber: "+91 9876543210",
  accountName: "Murugan K", accountNumber: "123456789012", ifscCode: "SBIN0001234", bankName: "SBI", licenceNumber: "TN07 20110012345", licenceType: "LMV",
  licenceExpiryDate: "2030-05-20", attachment: null, salary: 18500, status: "ACTIVE", availability: savedInUse,
  createdBy: "RBP", updatedBy: "RBP", createdAt: "2026-11-24T04:30:00.000Z", updatedAt: "2026-11-24T05:00:00.000Z", ...over,
});

test("listing shows only the essential columns: number, name, mobile, type, status, project, relevant date, View / Edit", () => {
  assert.deepEqual([...DRIVER_LIST_COLUMNS], ["Driver No", "Driver Name", "Mobile No", "Driver Type", "Availability Status", "Project Name", "Available From / To", "Actions"]);
  const html = renderToStaticMarkup(<DriverTable items={[mkDriver()]} />);
  for (const v of ["DR-4821", "Murugan K", "+91 9876543210", "Acting Driver", "In Use – Another Project", "Pepsi India Signage – ZZ-77", "25-Nov-2026 – 05-Dec-2026"]) assert.ok(html.includes(v), v);
  assert.ok(html.includes('href="/rbp/drivers/view?id=' + "a".repeat(24) + '"') && html.includes('href="/rbp/drivers/edit?id=' + "a".repeat(24) + '"'));
  assert.equal((html.match(/<th[ >]/g) ?? []).length, 8);
  // everything else stays out of the table (it is on the View page)
  for (const hidden of ["SBIN0001234", "123456789012", "TN07 20110012345", "Anna Nagar", "LMV", "18,500", "Salary", "Licence"]) assert.ok(!html.includes(hidden), hidden);
});

test("listing cells per status: project only when allocated; relevant date per status; legacy driver shows Not set", () => {
  assert.equal(driverProjectName(savedInUse), "Pepsi India Signage – ZZ-77");
  assert.equal(driverProjectName(savedNa), "—");
  assert.equal(driverProjectName(savedAvailable), "—");
  assert.equal(driverProjectName(undefined), "—");
  assert.match(driverAvailabilityDates(savedAvailable), /^From 24-Nov-2026, 09:30 AM$/);
  assert.equal(driverAvailabilityDates(savedInUse), "25-Nov-2026 – 05-Dec-2026");
  assert.match(driverAvailabilityDates(savedNa), /20-Nov-2026.*01-Dec-2026/);
  assert.equal(driverAvailabilityDates({ status: "NOT_AVAILABLE", notAvailable: { fromDate: "2026-11-20" } }), "Since 20-Nov-2026");
  assert.equal(driverAvailabilityDates(null), "—");
  const html = renderToStaticMarkup(<DriverTable items={[mkDriver({ availability: undefined }), mkDriver({ _id: "b".repeat(24), availability: savedNa }), mkDriver({ _id: "c".repeat(24), availability: savedAvailable })]} />);
  assert.ok(html.includes("Not set") && html.includes("badge-av-red") && html.includes("badge-av-green") && !html.includes("undefined") && !html.includes("null"));
});

test("filters: one mass search, one status filter (All + the three statuses), Clear Filters enabled only when something is applied", () => {
  const html = renderToStaticMarkup(<DriverFilters q="" status="" onQ={noop} onStatus={noop} onClear={noop} />);
  assert.equal((html.match(/aria-label="Mass search"/g) ?? []).length, 1);
  assert.equal((html.match(/<select/g) ?? []).length, 1);
  assert.deepEqual([...html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1]), ["All", "Available Now", "In Use – Another Project", "Not Available"]);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Clear Filters<\/button>/);
  const on = renderToStaticMarkup(<DriverFilters q="pepsi" status="IN_USE" onQ={noop} onStatus={noop} onClear={noop} />);
  assert.ok(!/disabled=""[^>]*>Clear Filters/.test(on));
  assert.match(on, /<option value="IN_USE" selected=""/);
  assert.ok(on.includes('value="pepsi"'));
  assert.ok(html.includes("project name") && html.includes("trackup / PIF"));
});

// ================================================================== view and history
test("view shows the complete details; only the fields of the current status", () => {
  const inUse = renderToStaticMarkup(<DriverDetails d={mkDriver()} />);
  for (const v of ["DR-4821", "Acting Driver", "+91 9876543210", "123456789012", "SBIN0001234", "TN07 20110012345", "Current Status", "In Use – Another Project", "Signage", "Pepsi India Signage – ZZ-77", "Pepsi India",
    "JS-1/2026-27", "PIF-100", "25-Nov-2026", "05-Dec-2026", "peak"]) assert.ok(inUse.includes(v), v);
  assert.ok(!inUse.includes("Unavailable Reason") && !inUse.includes("Expected Available Date") && !inUse.includes("Available From"));
  const na = renderToStaticMarkup(<DriverDetails d={mkDriver({ availability: savedNa })} />);
  for (const v of ["Not Available", "License Issue", "Licence suspended", "20-Nov-2026", "01-Dec-2026", "call RTO"]) assert.ok(na.includes(v), v);
  assert.ok(!na.includes("Project From Date") && !na.includes("Trackup Number"));
  const ok = renderToStaticMarkup(<DriverDetails d={mkDriver({ availability: savedAvailable })} />);
  assert.ok(ok.includes("Available From") && ok.includes("09:30 AM") && !ok.includes("Unavailable Reason") && !ok.includes("Project From Date"));
  const legacy = renderToStaticMarkup(<DriverDetails d={mkDriver({ availability: undefined })} />);
  assert.ok(legacy.includes("has not been set") && !legacy.includes("undefined"));
});

const H = (id: string, createdAt: string, over: Partial<DriverHistoryRow> = {}): DriverHistoryRow => ({ _id: id, action: "UPDATED", changes: [], username: "RBP", createdAt, ...over });
const rows: DriverHistoryRow[] = [
  H("1", "2026-11-20T04:00:00.000Z", { action: "CREATED" }),
  H("2", "2026-11-21T04:00:00.000Z", { action: "PROJECT_ASSIGNED", previousStatus: "AVAILABLE", newStatus: "IN_USE", changes: [{ field: "projectName", from: null, to: "KFC Roadshow" }, { field: "projectToDate", from: null, to: "2026-12-05" }] }),
  H("3", "2026-11-22T04:00:00.000Z", { action: "PROJECT_EXTENDED", previousStatus: "IN_USE", newStatus: "IN_USE", changes: [{ field: "projectToDate", from: "2026-12-05", to: "2026-12-12" }] }),
  H("4", "2026-11-23T04:00:00.000Z", { action: "MARKED_NOT_AVAILABLE", previousStatus: "IN_USE", newStatus: "NOT_AVAILABLE", reason: "Licence suspended", changes: [{ field: "unavailableReason", from: null, to: "Licence suspended" }] }),
  H("5", "2026-11-24T04:00:00.000Z", { action: "AUTO_AVAILABILITY_UPDATE", username: "SYSTEM", previousStatus: "IN_USE", newStatus: "AVAILABLE", reason: "Driver automatically marked Available after the project to date passed." }),
  H("6", "2026-11-24T05:00:00.000Z", { action: "AVAILABILITY_CONFIRMED", previousStatus: "NOT_AVAILABLE", newStatus: "AVAILABLE" }),
];

test("history: latest first, with action labels, previous / new status, previous / updated values, reason, who and when", () => {
  assert.deepEqual(latestFirst(rows).map((r) => r._id), ["6", "5", "4", "3", "2", "1"]);
  assert.deepEqual(latestFirst([...rows].reverse()).map((r) => r._id), ["6", "5", "4", "3", "2", "1"]); // independent of input order
  const html = renderToStaticMarkup(<DriverHistoryList rows={rows} />);
  const order = ["Availability Confirmed", "Automatically Marked Available", "Marked Not Available", "Project Extended", "Project Assigned", "Driver Created"].map((l) => html.indexOf(l));
  assert.ok(order.every((i) => i >= 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order); // newest on top
  for (const v of ["Previous status", "New status", "Previous value", "Updated value", "Project To Date", "05-Dec-2026", "12-Dec-2026", "Reason: Licence suspended", "SYSTEM", "RBP", "KFC Roadshow", "Not Available", "In Use – Another Project"]) assert.ok(html.includes(v), v);
  assert.ok(!html.includes("undefined") && !html.includes("null"));
  assert.ok(renderToStaticMarkup(<DriverHistoryList rows={[]} />).includes("No history yet"));
  assert.equal(historyValue(null), "—");
  assert.equal(historyValue("2026-11-24 12:00"), "24-Nov-2026, 12:00 PM");
  assert.equal(historyValue("COMPANY_DRIVER"), "Company Driver");
  const full = renderToStaticMarkup(<DriverDetails d={mkDriver()} history={rows} />);
  assert.ok(full.includes("Driver history") && full.includes("Automatically Marked Available"));
  assert.ok(!renderToStaticMarkup(<DriverDetails d={mkDriver()} />).includes("Driver history")); // history only when loaded
});
