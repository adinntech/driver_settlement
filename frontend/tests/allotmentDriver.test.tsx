import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AllotmentDriverCell, AllotmentDriverSection } from "../src/components/AllotmentDriver";
import { Body, eventText } from "../src/components/AllotmentDetail";
import { AllotModal, AssignDriverModal, ChangeDriverModal } from "../src/components/AllotmentModals";
import DriverPicker, { DriverCard, DriverSuggestion } from "../src/components/DriverPicker";
import type { Allotment, AllotmentDetailData, AllotmentProject, AllotmentRef, AvailableDriver } from "../src/types/domain";
import {
  ALLOT_MODE_LABEL, EVENT_LABEL, emptyAllotForm, emptyChangeDriverForm, emptyDriverPick, selectDriver, toAllotPayload, toChangeDriverPayload, typeDriverName,
  typeDriverNumber, validateAllotForm, validateAssignDriverForm, validateChangeDriverForm, type AllotForm,
} from "../src/utils/allotment";

const noop = () => {};
const NOW = new Date("2026-11-24T06:30:00Z"); // 24-Nov-2026 12:00 IST
const drv = (over: Partial<AvailableDriver> = {}): AvailableDriver => ({ _id: "d".repeat(24), driverNumber: "DR-4821", driverName: "Murugan K", driverType: "ACTING_DRIVER", mobileNumber: "+91 9876543210", ...over });
const d2 = drv({ _id: "e".repeat(24), driverNumber: "DR-7310", driverName: "Selvam R", driverType: "COMPANY_DRIVER", mobileNumber: "+91 9000011111" });
const okForm = (over: Partial<AllotForm> = {}): AllotForm => ({
  ...emptyAllotForm(NOW), vehicleId: "v".repeat(24), vehicleNo: "TN01AA0001", nextAvailableDate: "2026-11-27", nextAvailableTime: "09:00", ...over,
});

// ================================================================== option A / option B
test("two allocation options with the exact labels; vehicle only is the default and needs no driver", () => {
  assert.deepEqual(ALLOT_MODE_LABEL, { VEHICLE_ONLY: "Allocate Vehicle Only", VEHICLE_DRIVER: "Allocate Vehicle with Driver" });
  const f = emptyAllotForm(NOW);
  assert.deepEqual([f.mode, f.driverId], ["VEHICLE_ONLY", ""]);
  assert.deepEqual(validateAllotForm(okForm(), NOW), []); // existing behaviour: no driver needed
  assert.deepEqual(validateAllotForm(okForm({ driverId: "" }), NOW), []);
});

test("vehicle + driver: a driver must be chosen from the suggestions; the payload carries the id only in that mode", () => {
  const e = validateAllotForm(okForm({ mode: "VEHICLE_DRIVER" }), NOW);
  assert.ok(e.some((m) => /Select an available driver/.test(m)));
  assert.deepEqual(validateAllotForm(okForm({ mode: "VEHICLE_DRIVER", driverId: d2._id }), NOW), []);
  assert.equal(toAllotPayload(okForm({ mode: "VEHICLE_DRIVER", driverId: d2._id }), "T-1").driverId, d2._id);
  // vehicle only: byte-for-byte the request it was before driver assignment existed (a stale driver id is never sent)
  const only = toAllotPayload(okForm({ mode: "VEHICLE_ONLY", driverId: d2._id }), "T-1");
  assert.ok(!("driverId" in only));
  assert.deepEqual(Object.keys(only).sort(), ["allottedDate", "allottedTime", "expectedReleaseDate", "expectedReleaseTime", "nextAvailableDate", "nextAvailableTime", "pifNumber", "remarks", "vehicleId"]);
  assert.ok(validateAllotForm(okForm({ mode: "VEHICLE_DRIVER", driverId: d2._id, vehicleId: "" }), NOW).includes("Select a vehicle")); // vehicle rules still apply
});

const project: AllotmentProject = {
  trackingProject: "p", trackingVehicle: "tv", budget: null, budgetVersion: 1, projectType: "SIGNAGE", projectName: "Pepsi Signage", clientName: "Pepsi India", trackupNumber: "T-1", pifNumber: "PIF-1",
  billNumber: null, startDate: "2026-11-25", endDate: "2026-12-05", location: null, vehicleCount: 1, budgetAmount: 1000, approvedAt: null, budgetStatus: "APPROVED", allotment: null,
};

test("allot dialog: clear choice between the two options; the driver section is optional and only a picker in option B", () => {
  const html = renderToStaticMarkup(<AllotModal project={project} onClose={noop} onDone={noop} />);
  assert.ok(html.includes("Driver Assignment (Optional)"));
  assert.ok(html.includes("Allocate Vehicle Only") && html.includes("Allocate Vehicle with Driver"));
  assert.equal((html.match(/name="allotMode"/g) ?? []).length, 2);
  assert.match(html, /value="VEHICLE_ONLY"[^>]*checked=""|checked=""[^>]*value="VEHICLE_ONLY"/); // default
  assert.ok(!/value="VEHICLE_DRIVER"[^>]*checked=""/.test(html));
  assert.ok(html.includes('data-note="driver-later"')); // option A: no driver fields, a hint about Assign Driver
  assert.ok(!html.includes("Driver Number") && !html.includes('aria-label="Driver Name"'));
  assert.ok(html.includes("Vehicle Number") && html.includes("Next Available") && html.includes("Confirm Vehicle Allotment")); // existing form intact
});

// ================================================================== autocomplete + two-way mapping
test("selecting a driver fills Driver Number, Driver Name, type and mobile from the same record", () => {
  const p = selectDriver(drv());
  assert.deepEqual([p.number, p.name, p.driver?._id, p.driver?.driverType, p.driver?.mobileNumber], ["DR-4821", "Murugan K", "d".repeat(24), "ACTING_DRIVER", "+91 9876543210"]);
  // whichever box found it (number or name), the result is the one record the server returned
  assert.deepEqual(selectDriver(drv()), p);
  const html = renderToStaticMarkup(<DriverPicker pick={p} onChange={noop} />);
  for (const v of ["DR-4821", "Murugan K", "Acting Driver", "+91 9876543210", 'data-section="selected-driver"', "Change driver"]) assert.ok(html.includes(v), v);
  assert.equal((html.match(/readOnly=""/g) ?? []).length, 2); // both boxes lock to the selected record
});

test("changing either box clears the stale dependent values; nothing typed becomes a driver without a resolved record", () => {
  const picked = selectDriver(drv());
  const a = typeDriverNumber("dr-73");
  assert.deepEqual(a, { number: "DR-73", name: "", driver: null }); // name from the previous selection is dropped
  const b = typeDriverName("Selvam");
  assert.deepEqual(b, { number: "", name: "Selvam", driver: null }); // number dropped
  assert.equal(typeDriverNumber("DR-4821 <x>").number, "DR-4821X");
  assert.equal(typeDriverName("Raj 99 <b>").name, "Raj  b");
  assert.equal(typeDriverNumber("x".repeat(40)).number.length, 12);
  assert.equal(picked.driver !== null && a.driver === null && b.driver === null, true);
  assert.deepEqual(emptyDriverPick(), { number: "", name: "", driver: null });
  // free text has no id, so it can never pass the form check
  assert.ok(validateAllotForm(okForm({ mode: "VEHICLE_DRIVER", driverId: "" }), NOW).length > 0);
  assert.deepEqual(validateAssignDriverForm(""), ["Select an available driver"]);
  assert.deepEqual(validateAssignDriverForm(d2._id), []);
});

test("suggestions show driver number, name, type and mobile; an unselected picker shows two search boxes and no card", () => {
  const s = renderToStaticMarkup(<DriverSuggestion d={d2} onPick={noop} />);
  for (const v of ["DR-7310", "Selvam R", "Company Driver", "+91 9000011111", 'role="option"']) assert.ok(s.includes(v), v);
  const card = renderToStaticMarkup(<DriverCard d={d2} />);
  for (const l of ["Driver Number", "Driver Name", "Driver Type", "Mobile Number"]) assert.ok(card.includes(l), l);
  const html = renderToStaticMarkup(<DriverPicker pick={emptyDriverPick()} onChange={noop} />);
  assert.ok(html.includes('aria-label="Driver Number"') && html.includes('aria-label="Driver Name"'));
  assert.ok(!html.includes("selected-driver") && !html.includes("readOnly"));
});

// ================================================================== assign later / change driver
const target = { _id: "a".repeat(24), vehicleNo: "TN01AA0001", trackupNumber: "T-1", pifNumber: "PIF-1", projectName: "Pepsi Signage" };
const current = { driverId: "d".repeat(24), driverNumber: "DR-4821", driverName: "Murugan K", driverType: "ACTING_DRIVER", mobileNumber: "+91 9876543210", assignedAt: "2026-11-24T04:30:00.000Z" };

test("assign driver dialog: vehicle and project read-only, available-driver autocomplete, confirm action", () => {
  const html = renderToStaticMarkup(<AssignDriverModal target={target} onClose={noop} onDone={noop} />);
  for (const v of ["Assign Driver · TN01AA0001", "TN01AA0001", "T-1 · PIF-1 · Pepsi Signage", "Available Now only", 'aria-label="Driver Number"', 'aria-label="Driver Name"']) assert.ok(html.includes(v), v);
});

test("change driver dialog: shows the current driver, mandatory reason, optional attachment and remarks", () => {
  const html = renderToStaticMarkup(<ChangeDriverModal target={target} current={current} onClose={noop} onDone={noop} />);
  for (const v of ["Change Driver · TN01AA0001", 'data-section="current-driver"', "DR-4821", "Murugan K", "Acting Driver", "+91 9876543210", "Replacement driver", "Change Reason", "Supporting Attachment", "Additional Remarks", "Optional · PDF"])
    assert.ok(html.includes(v), v);
  assert.ok(/Change Reason<span class="req"> \*<\/span>/.test(html)); // reason is marked mandatory
  assert.ok(!/Supporting Attachment<span class="req">/.test(html)); // attachment is optional
});

test("change driver validation: replacement and reason required, same driver refused, attachment optional; payload has no url", () => {
  const f = { ...emptyChangeDriverForm(), driverId: d2._id, reason: "Driver fell ill" };
  assert.deepEqual(validateChangeDriverForm(f, current.driverId), []);
  assert.ok(validateChangeDriverForm({ ...f, driverId: "" }, current.driverId).includes("Select the replacement driver"));
  assert.ok(validateChangeDriverForm({ ...f, reason: "" }, current.driverId).includes("Change reason is required"));
  assert.ok(validateChangeDriverForm({ ...f, reason: "   " }, current.driverId).includes("Change reason is required"));
  assert.ok(validateChangeDriverForm({ ...f, reason: "x".repeat(301) }, current.driverId).some((m) => /too long/.test(m)));
  assert.ok(validateChangeDriverForm({ ...f, driverId: current.driverId }, current.driverId).includes("Choose a different driver as the replacement"));
  const att = { storage: "local" as const, key: "k", name: "medical.pdf", size: 5, mimeType: "application/pdf", url: "http://x/files/k" };
  assert.deepEqual(validateChangeDriverForm({ ...f, attachments: [att] }, current.driverId), []);
  assert.ok(validateChangeDriverForm({ ...f, attachments: Array(6).fill(att) }, current.driverId).some((m) => /Too many attachments/.test(m)));
  assert.deepEqual(toChangeDriverPayload({ ...f, reason: "  Driver fell ill ", remarks: "from Salem", attachments: [att] }),
    { driverId: d2._id, reason: "Driver fell ill", remarks: "from Salem", travelAmountDeduction: 0, attachments: [{ storage: "local", key: "k", name: "medical.pdf", size: 5, mimeType: "application/pdf" }] });
  assert.deepEqual(toChangeDriverPayload(f).attachments, []);
});

// ================================================================== allotment list + detail
const ref = (driver: AllotmentRef["driver"]): AllotmentRef => ({ _id: "a".repeat(24), vehicleId: "v", vehicleNo: "TN01AA0001", allottedAt: "2026-11-24T04:30:00.000Z", expectedReleaseAt: null, nextAvailableAt: "2026-11-26T03:30:00.000Z", remarks: null, driver });

test("list cell: driver number / name / type when assigned, 'Driver not assigned' otherwise (also for older responses without the field)", () => {
  const yes = renderToStaticMarkup(<AllotmentDriverCell allotment={ref({ driverId: "d", driverNumber: "DR-4821", driverName: "Murugan K", driverType: "COMPANY_DRIVER", mobileNumber: null, assignedAt: null })} />);
  for (const v of ["DR-4821", "Murugan K", "Company Driver"]) assert.ok(yes.includes(v), v);
  for (const none of [ref(null), ref(undefined), null]) {
    const html = renderToStaticMarkup(<AllotmentDriverCell allotment={none} />);
    assert.ok(!html.includes("undefined") && !html.includes("null"));
  }
  assert.ok(renderToStaticMarkup(<AllotmentDriverCell allotment={ref(null)} />).includes("Driver not assigned"));
  assert.ok(renderToStaticMarkup(<AllotmentDriverCell allotment={ref(undefined)} />).includes("Driver not assigned"));
});

const base = {
  vehicle: "v1", vehicleNo: "TN01AA0001", vehicleMake: "Tata", vehicleModel: "Ace", clientName: "Pepsi India", projectName: "P", projectType: "SIGNAGE", trackupNumber: "T-1", pifNumber: "PIF-1", billNumber: "B-9",
  changeAttachments: [], createdBy: "RBP", updatedBy: "RBP", createdAt: "2026-11-24T04:30:00.000Z", updatedAt: "2026-11-24T05:00:00.000Z", allottedAt: "2026-11-24T04:30:00.000Z", nextAvailableAt: "2026-11-26T03:30:00.000Z",
};
const detail = (over: Partial<AllotmentDetailData> = {}, status: Allotment["status"] = "ACTIVE"): AllotmentDetailData => ({
  allotment: { ...base, _id: "a".repeat(24), status } as Allotment, original: { vehicleNo: "TN01AA0001" }, current: { vehicleNo: "TN01AA0001", status }, chain: [], vehicle: { vehicleNo: "TN01AA0001", availabilityStatus: "IN_USE" }, events: [], ...over,
});
const assignedDriver = { driverId: "d".repeat(24), active: true, driverNumber: "DR-4821", driverName: "Murugan K", driverType: "ACTING_DRIVER", mobileNumber: "+91 9876543210", assignedAt: "2026-11-24T04:30:00.000Z", assignedBy: "RBP", releasedAt: null, status: "IN_USE" };

test("detail without a driver: 'Driver Not Assigned' and an Assign Driver action (older allotments without the field behave the same)", () => {
  for (const d of [detail({ driver: null }), detail({})]) {
    const html = renderToStaticMarkup(<Body d={d} onAssign={noop} onChangeDriver={noop} />);
    assert.ok(html.includes("Driver Information") && html.includes("Driver Not Assigned"));
    assert.ok(html.includes("Assign Driver") && !html.includes("Change Driver") && !html.includes("View Driver Details"));
    assert.ok(!html.includes("undefined"));
  }
  const closed = renderToStaticMarkup(<Body d={detail({ driver: null }, "RELEASED")} onAssign={noop} />);
  assert.ok(closed.includes("Driver Not Assigned") && !closed.includes(">Assign Driver<")); // a closed allotment takes no driver
});

test("detail with a driver: number, name, type, mobile, assigned date/time, live driver status; Change Driver and View Driver Details", () => {
  const html = renderToStaticMarkup(<Body d={detail({ driver: assignedDriver })} onAssign={noop} onChangeDriver={noop} />);
  for (const v of ["DR-4821", "Murugan K", "Acting Driver", "+91 9876543210", "Driver Assigned", "24-Nov-2026, 10:00 AM", "RBP", "Driver Status", "In Use – Another Project", "Change Driver", "View Driver Details", `href="/rbp/drivers/view?id=${"d".repeat(24)}"`])
    assert.ok(html.includes(v), v);
  assert.ok(!html.includes(">Assign Driver<")); // it already has one
  // project and vehicle information are still all there
  for (const v of ["Pepsi India", "T-1", "PIF-1", "B-9", "Project Period", "TN01AA0001 · Tata Ace"]) assert.ok(html.includes(v), v);
  const released = renderToStaticMarkup(<AllotmentDriverSection d={detail({ driver: { ...assignedDriver, active: false, status: "AVAILABLE", releasedAt: "2026-11-26T03:30:00.000Z" } })} onAssign={noop} onChange={noop} />);
  assert.ok(released.includes("Released") && released.includes("View Driver Details") && released.includes(">Assign Driver<") && !released.includes(">Change Driver<")); // driver gone, another can be assigned
  const closed = renderToStaticMarkup(<AllotmentDriverSection d={detail({ driver: { ...assignedDriver, active: false } }, "RELEASED")} onAssign={noop} onChange={noop} />);
  assert.ok(!closed.includes(">Assign Driver<") && !closed.includes(">Change Driver<") && closed.includes("View Driver Details"));
});

test("timeline: driver events have labels and readable text; existing events unchanged", () => {
  for (const a of ["DRIVER_ASSIGNED", "DRIVER_CHANGED", "DRIVER_RELEASED"]) assert.ok(EVENT_LABEL[a], a);
  assert.equal(eventText("DRIVER_ASSIGNED", { driverNumber: "DR-1", driverName: "A B", later: true }), "DR-1 A B assigned (assigned later)");
  assert.equal(eventText("DRIVER_ASSIGNED", { driverNumber: "DR-1", driverName: "A B", later: false }), "DR-1 A B assigned with the vehicle");
  assert.equal(eventText("DRIVER_CHANGED", { from: { driverNumber: "DR-1" }, to: { driverNumber: "DR-2" }, reason: "ill" }), "DR-1 → DR-2. Reason: ill");
  assert.equal(eventText("DRIVER_RELEASED", { driverNumber: "DR-1", reason: "Released by RBP" }), "DR-1 released. Released by RBP");
  assert.equal(eventText("VEHICLE_CHANGED", { fromVehicleNo: "A", toVehicleNo: "B", reason: "x" }), "A → B. Reason: x");
  assert.equal(eventText("RELEASED", { reason: "Released by RBP" }), "Released by RBP");
  const html = renderToStaticMarkup(<Body d={detail({ driver: assignedDriver, events: [
    { _id: "2", action: "DRIVER_CHANGED", username: "RBP", createdAt: "2026-11-24T06:00:00.000Z", details: { from: { driverNumber: "DR-1" }, to: { driverNumber: "DR-4821" }, reason: "ill" } },
    { _id: "1", action: "ALLOTTED", username: "RBP", createdAt: "2026-11-24T04:30:00.000Z", details: { vehicleNo: "TN01AA0001" } },
  ] })} />);
  assert.ok(html.includes("Driver changed") && html.includes("Vehicle allotted") && !html.includes("undefined"));
});
