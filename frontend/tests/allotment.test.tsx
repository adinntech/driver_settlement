import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AllotModal, ChangeModal, ExtendModal, ProjectSummary, ReleaseModal } from "../src/components/AllotmentModals";
import { Body, eventText } from "../src/components/AllotmentDetail";
import VehiclePicker from "../src/components/VehiclePicker";
import { VEHICLE_TABS, VehicleTabsView, activeTab } from "../src/components/VehicleTabs";
import type { Allotment, AllotmentDetailData, AllotmentProject } from "../src/types/domain";
import {
  emptyAllotForm, emptyChangeForm, fmtInstant, instantToIst, projectPeriod, scheduleFromAllotment, toAllotPayload, toChangePayload,
  validateAllotForm, validateChangeForm, validateSchedule,
} from "../src/utils/allotment";

const NOW = new Date("2026-11-24T06:30:00Z"); // 24-Nov-2026, 12:00 IST
const noop = () => {};
const project: AllotmentProject = {
  trackingProject: "a".repeat(24), trackingVehicle: "b".repeat(24), budget: "c".repeat(24), budgetVersion: 1, projectType: "SIGNAGE",
  projectName: "Pepsi India Signage – JS-1", clientName: "Pepsi India", trackupNumber: "JS-22351/2026-27", pifNumber: "PIF-25797", billNumber: null,
  startDate: "2026-12-01", endDate: "2026-12-09", location: "Salem", vehicleCount: 3, budgetAmount: 125000, approvedAt: "2026-11-20T06:00:00.000Z",
  budgetStatus: "APPROVED", allotment: null,
};
const allotted: AllotmentProject = {
  ...project,
  allotment: { _id: "d".repeat(24), vehicleId: "e".repeat(24), vehicleNo: "TN58BM6554", allottedAt: "2026-11-24T04:30:00.000Z", expectedReleaseAt: null, nextAvailableAt: "2026-11-26T03:30:00.000Z", remarks: null },
};
const okForm = () => ({
  ...emptyAllotForm(NOW), vehicleId: "f".repeat(24), vehicleNo: "TN01AB1234",
  expectedReleaseDate: "2026-11-25", expectedReleaseTime: "20:00", nextAvailableDate: "2026-11-26", nextAvailableTime: "09:00",
});

test("three tabs: Vehicle Management, Vehicle Allotment, Allotment History; the right one is highlighted", () => {
  assert.deepEqual(VEHICLE_TABS.map((t) => t.label), ["Vehicle Management", "Vehicle Allotment", "Allotment History"]); // Driver Management is a separate sidebar menu
  for (const [path, tab] of [
    ["/rbp/vehicles", "/rbp/vehicles"], ["/rbp/vehicles/edit", "/rbp/vehicles"], ["/rbp/vehicles/view", "/rbp/vehicles"],
    ["/rbp/vehicles/allotment", "/rbp/vehicles/allotment"], ["/rbp/vehicles/allotment-history", "/rbp/vehicles/allotment-history"],
  ] as const) assert.equal(activeTab(path), tab, path);
  const html = renderToStaticMarkup(<VehicleTabsView active="/rbp/vehicles/allotment" />);
  for (const l of ["Vehicle Management", "Vehicle Allotment", "Allotment History"]) assert.ok(html.includes(l), l);
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(html, /class="v-tab active"[^>]*href="\/rbp\/vehicles\/allotment"|href="\/rbp\/vehicles\/allotment"[^>]*class="v-tab active"|class="v-tab active"[^>]*aria-current/);
});

test("allot form: defaults the allotment moment to now (IST); a vehicle, next available date AND time are mandatory", () => {
  const f = emptyAllotForm(NOW);
  assert.deepEqual([f.allottedDate, f.allottedTime], ["2026-11-24", "12:00"]);
  assert.deepEqual(validateAllotForm(okForm(), NOW), []);
  const e = validateAllotForm(emptyAllotForm(NOW), NOW);
  for (const m of ["Select a vehicle", "Next available date is required", "Next available time is required"]) assert.ok(e.includes(m), m);
  assert.ok(validateAllotForm({ ...okForm(), nextAvailableTime: "" }, NOW).includes("Next available time is required"));
});

test("allot form: invalid periods are rejected", () => {
  const v = (over: object) => validateAllotForm({ ...okForm(), ...over }, NOW);
  assert.ok(v({ allottedDate: "2026-11-25" }).some((m) => /cannot be in the future/.test(m)));
  assert.ok(v({ allottedDate: "2026-02-31" }).some((m) => /Allotment date & time is invalid/.test(m)));
  assert.ok(v({ expectedReleaseTime: "" }).some((m) => /both date and time/.test(m)));
  assert.ok(v({ expectedReleaseDate: "2026-11-23", expectedReleaseTime: "10:00" }).some((m) => /before the allotment/.test(m)));
  assert.ok(v({ nextAvailableDate: "2026-11-25", nextAvailableTime: "19:00" }).some((m) => /before the expected release/.test(m)));
  assert.ok(v({ nextAvailableDate: "2026-11-20", nextAvailableTime: "10:00", expectedReleaseDate: "", expectedReleaseTime: "" }).some((m) => /before the allotment/.test(m)));
  assert.ok(v({ nextAvailableDate: "2026-02-31" }).some((m) => /not a valid date/.test(m)));
  assert.ok(v({ nextAvailableTime: "25:00" }).some((m) => /not a valid time/.test(m)));
  assert.deepEqual(v({ expectedReleaseDate: "", expectedReleaseTime: "" }), []); // expected release is optional
  assert.ok(v({ allottedDate: "2026-11-20", allottedTime: "10:00", expectedReleaseDate: "", expectedReleaseTime: "", nextAvailableDate: "2026-11-23", nextAvailableTime: "10:00" }).some((m) => /in the past/.test(m)));
});

test("allot payload sends the trackup number of the chosen project vehicle and the typed values only", () => {
  const p = toAllotPayload(okForm(), "JS-22351/2026-27");
  assert.deepEqual(Object.keys(p).sort(), ["allottedDate", "allottedTime", "expectedReleaseDate", "expectedReleaseTime", "nextAvailableDate", "nextAvailableTime", "remarks", "trackupNumber", "vehicleId"]);
  assert.equal(p.trackupNumber, "JS-22351/2026-27"); // PIF / names are never sent: the server maps them
});

test("allot dialog shows the mapped project identifiers read-only, the vehicle autocomplete, schedule fields and the confirm button", () => {
  const html = renderToStaticMarkup(<AllotModal project={project} onClose={noop} onDone={noop} />);
  for (const l of ["Allot Vehicle", "Pepsi India", "Signage", "Pepsi India Signage – JS-1", "JS-22351/2026-27", "PIF-25797", "Bill Number", "Project Start Date", "Project End Date", "Project Period",
    "Vehicle Number", "Allotment Date &amp; Time", "Expected Release", "Next Available", "Remarks", "Confirm Vehicle Allotment", "01-Dec-2026 – 09-Dec-2026"])
    assert.ok(html.includes(l), l);
  assert.ok(html.includes("Available Now vehicles only"));
  assert.ok(!/<input[^>]*value="JS-22351\/2026-27"[^>]*>/.test(html)); // identifiers are shown as text, not as editable inputs
  assert.ok(!html.includes("undefined"));
  const summary = renderToStaticMarkup(<ProjectSummary p={project} />);
  assert.ok(summary.includes("—")); // bill number "where available"
});

test("vehicle picker: Available Now only, shows make / model of the selected vehicle, can be changed", () => {
  const empty = renderToStaticMarkup(<VehiclePicker value={null} onPick={noop} onClear={noop} />);
  assert.ok(empty.includes('aria-label="Vehicle Number"') && empty.includes("Available Now vehicles only"));
  const picked = renderToStaticMarkup(<VehiclePicker value={{ _id: "x", vehicleNo: "TN01AB1234", make: "Tata", model: "Ace", type: "Dynamic" }} onPick={noop} onClear={noop} />);
  assert.ok(picked.includes("TN01AB1234") && picked.includes("Tata · Ace · Dynamic") && picked.includes("Change"));
});

test("change vehicle: current vehicle read-only, replacement picker, mandatory reason, optional attachments", () => {
  const html = renderToStaticMarkup(<ChangeModal project={allotted} onClose={noop} onDone={noop} />);
  for (const l of ["Change Vehicle", "Current Vehicle Number", "Replacement Vehicle Number", "Change Reason", "Supporting Attachment", "Additional Remarks", "Optional"]) assert.ok(html.includes(l), l);
  assert.match(html, /value="TN58BM6554"/);
  assert.ok(html.includes('type="file"') && html.includes("multiple"));
  const f = emptyChangeForm();
  assert.ok(validateChangeForm(f).includes("Select the replacement vehicle"));
  assert.ok(validateChangeForm(f).includes("Change reason is required"));
  const ok = { ...f, vehicleId: "z".repeat(24), vehicleNo: "TN02", reason: "Breakdown" };
  assert.deepEqual(validateChangeForm(ok, "y".repeat(24)), []); // attachments optional
  assert.ok(validateChangeForm({ ...ok, vehicleId: "y".repeat(24) }, "y".repeat(24)).some((m) => /different vehicle/.test(m)));
  assert.ok(validateChangeForm({ ...ok, reason: "   " }).includes("Change reason is required"));
  assert.ok(validateChangeForm({ ...ok, reason: "x".repeat(301) }).some((m) => /too long/.test(m)));
  const att = { storage: "local" as const, key: "driver_settlement/vehicles/2026/k", name: "a.pdf", size: 5, mimeType: "application/pdf", url: "http://x/files/k" };
  assert.ok(validateChangeForm({ ...ok, attachments: Array(6).fill(att) }).some((m) => /Too many attachments/.test(m)));
  const p = toChangePayload({ ...ok, remarks: "r", attachments: [att] });
  assert.deepEqual(p.attachments, [{ storage: "local", key: att.key, name: "a.pdf", size: 5, mimeType: "application/pdf" }]); // url never sent back
  assert.equal(p.reason, "Breakdown");
});

test("extend / release dialogs show the current allotment", () => {
  const ext = renderToStaticMarkup(<ExtendModal project={allotted} onClose={noop} onDone={noop} />);
  assert.ok(ext.includes("Extend Allotment") && ext.includes("TN58BM6554") && ext.includes("Next Available") && ext.includes('value="2026-11-26"') && ext.includes('value="09:00"'));
  const rel = renderToStaticMarkup(<ReleaseModal project={allotted} onClose={noop} onDone={noop} />);
  assert.ok(rel.includes("Release Vehicle") && rel.includes("Available Now"));
  assert.deepEqual(scheduleFromAllotment({ expectedReleaseAt: null, nextAvailableAt: "2026-11-26T03:30:00.000Z" }), { expectedReleaseDate: "", expectedReleaseTime: "", nextAvailableDate: "2026-11-26", nextAvailableTime: "09:00" });
  assert.deepEqual(validateSchedule({ expectedReleaseDate: "", expectedReleaseTime: "", nextAvailableDate: "2026-12-01", nextAvailableTime: "10:00" }, null), []);
  assert.ok(validateSchedule({ expectedReleaseDate: "", expectedReleaseTime: "", nextAvailableDate: "", nextAvailableTime: "" }, null).length >= 2);
});

test("IST display of stored instants and period text", () => {
  assert.deepEqual(instantToIst("2026-11-24T04:30:00.000Z"), { date: "2026-11-24", time: "10:00" });
  assert.equal(instantToIst(null), null);
  assert.equal(instantToIst("garbage"), null);
  assert.equal(fmtInstant("2026-11-24T04:30:00.000Z"), "24-Nov-2026, 10:00 AM");
  assert.equal(fmtInstant(null), "—");
  assert.equal(projectPeriod("2026-12-01", "2026-12-09", (d) => d), "2026-12-01 – 2026-12-09");
  assert.equal(projectPeriod(null, null), "—");
});

test("allotment detail: project info, original / current vehicle, changes with reasons and attachments, newest-first timeline", () => {
  const base = { vehicle: "v1", clientName: "Pepsi India", projectName: "P", projectType: "SIGNAGE", trackupNumber: "T-1", pifNumber: "PIF-1", changeAttachments: [], createdBy: "RBP", updatedBy: "RBP", createdAt: "2026-11-24T04:30:00.000Z", updatedAt: "2026-11-24T05:00:00.000Z", allottedAt: "2026-11-24T04:30:00.000Z", nextAvailableAt: "2026-11-26T03:30:00.000Z" };
  const oldRow = { ...base, _id: "o", vehicleNo: "TN01AA0001", status: "CHANGED" } as Allotment;
  const newRow = {
    ...base, _id: "n", vehicleNo: "TN02BB0002", status: "ACTIVE", previousAllotment: "o", changedFromVehicleNo: "TN01AA0001", changeReason: "Engine failure",
    changedAt: "2026-11-24T05:00:00.000Z", changeAttachments: [{ storage: "local", key: "k", name: "photo.pdf", size: 1, mimeType: "application/pdf", url: "http://x/files/k" }],
  } as Allotment;
  const d: AllotmentDetailData = {
    allotment: newRow, original: { vehicleNo: "TN01AA0001" }, current: { vehicleNo: "TN02BB0002", status: "ACTIVE" }, chain: [oldRow, newRow],
    vehicle: { vehicleNo: "TN02BB0002", availabilityStatus: "IN_USE" },
    events: [
      { _id: "e2", action: "VEHICLE_CHANGED", username: "RBP", createdAt: "2026-11-24T05:00:00.000Z", details: { fromVehicleNo: "TN01AA0001", toVehicleNo: "TN02BB0002", reason: "Engine failure" } },
      { _id: "e1", action: "ALLOTTED", username: "RBP", createdAt: "2026-11-24T04:30:00.000Z", details: { vehicleNo: "TN01AA0001" } },
    ],
  };
  const html = renderToStaticMarkup(<Body d={d} />);
  for (const l of ["Original Vehicle", "TN01AA0001", "Current Vehicle", "TN02BB0002", "Engine failure", "photo.pdf", "Activity timeline", "Vehicle changed", "Vehicle allotted", "T-1", "PIF-1"])
    assert.ok(html.includes(l), l);
  assert.ok(html.indexOf("Vehicle changed") < html.lastIndexOf("Vehicle allotted")); // newest first
  assert.ok(!html.includes("undefined"));
  assert.equal(eventText("VEHICLE_CHANGED", { fromVehicleNo: "A", toVehicleNo: "B", reason: "x" }), "A → B. Reason: x");
  assert.equal(eventText("ALLOTTED", { vehicleNo: "B", replacing: "A" }), "B allotted, replacing A");
  assert.equal(eventText("RELEASED", { reason: "Released by RBP" }), "Released by RBP");
  assert.equal(eventText("EXTENDED", { reason: "client asked" }), "Schedule changed: client asked");
  const noChange = renderToStaticMarkup(<Body d={{ ...d, allotment: oldRow, chain: [oldRow], events: [] }} />);
  assert.ok(noChange.includes("has not been changed"));
});
