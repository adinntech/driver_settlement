import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import VehicleAvailability, { AvBadge } from "../src/components/VehicleAvailability";
import {
  AV_LABEL, AV_TONE, ISSUE_CATEGORIES, applyProject, typeProjectRef, emptyAvailability, expectedReleaseText, formatAt, formatLabelAt, fromAvailability,
  issueReasonText, nextAvailableText, toAvailabilityPayload, unlinkProject, validateAvailability, type AvForm, type ProjectChoice,
} from "../src/utils/vehicleAvailability";
import { FIELD_LABEL, HISTORY_LABEL, fmtValue } from "../src/utils/vehicleForm";

const NOW = new Date("2026-11-24T06:30:00Z"); // 24-Nov-2026, 12:00 IST
const noop = () => {};
const render = (a: AvForm) => renderToStaticMarkup(<VehicleAvailability value={a} onChange={noop} />);
const inUse = (over: Partial<AvForm> = {}): AvForm => ({
  ...emptyAvailability(NOW), status: "IN_USE",
  project: { ...emptyAvailability(NOW).project, trackingProject: "a".repeat(24), trackingVehicle: "c".repeat(24), trackupNumber: "TRK-9", pifNumber: "PIF-9", projectType: "ROADSHOW", projectName: "KFC Roadshow", clientName: "KFC", startDate: "2026-11-25", endDate: "2026-11-30" },
  expectedReleaseDate: "2026-11-25", expectedReleaseTime: "20:00", nextAvailableDate: "2026-11-26", nextAvailableTime: "09:00", ...over,
});
const issue = (over: Partial<AvForm["issue"]> = {}): AvForm => ({
  ...emptyAvailability(NOW), status: "ISSUE", issue: { ...emptyAvailability(NOW).issue, category: "Engine Problem", description: "Overheating", ...over },
});
const choice: ProjectChoice = {
  trackingProject: "a".repeat(24), trackingVehicle: "c".repeat(24), budget: "d".repeat(24), budgetVersion: 2, projectType: "SIGNAGE",
  projectName: "Pepsi India Signage – JS-77", clientName: "Pepsi India", trackupNumber: "TRK-1", pifNumber: "PIF-1", startDate: "2026-12-01", endDate: "2026-12-09", location: "Coimbatore", allocatedTo: null,
};

test("status options, tones and labels: Available Now green, In Use blue, Vehicle Issue red", () => {
  assert.deepEqual(AV_LABEL, { AVAILABLE: "Available Now", IN_USE: "In Use – Another Project", ISSUE: "Vehicle Issue" });
  assert.deepEqual(AV_TONE, { AVAILABLE: "green", IN_USE: "blue", ISSUE: "red" });
  assert.match(renderToStaticMarkup(<AvBadge status="IN_USE" />), /badge-av-blue/);
  assert.match(renderToStaticMarkup(<AvBadge status="ISSUE" />), /badge-av-red/);
  assert.match(renderToStaticMarkup(<AvBadge status="AVAILABLE" />), /badge-av-green/);
  assert.match(renderToStaticMarkup(<AvBadge status={null} />), /Not set/);
  const html = render(emptyAvailability(NOW));
  for (const l of ["Available Now", "In Use – Another Project", "Vehicle Issue", "Vehicle Status"]) assert.ok(html.includes(l), l);
});

test("new vehicle defaults to Available Now at the current IST date & time", () => {
  const a = emptyAvailability(NOW);
  assert.equal(a.status, "AVAILABLE");
  assert.equal(a.availableFromDate, "2026-11-24");
  assert.equal(a.availableFromTime, "12:00");
  assert.deepEqual(validateAvailability(a, false, NOW), []);
});

test("conditional fields: Available Now shows only availability; In Use shows project fields; Issue shows issue fields", () => {
  const av = render(emptyAvailability(NOW));
  assert.ok(av.includes('data-panel="available"') && av.includes("Available From"));
  assert.ok(!av.includes("Project Allocation Details") && !av.includes("Vehicle Issue Details"));

  const use = render(inUse());
  assert.ok(use.includes('data-panel="in-use"'));
  for (const l of ["Project Allocation Details", "Trackup Number", "PIF Number", "Client / Billing Name", "Project Type", "Project Name", "Project Period", "Expected Release", "Next Available", "Additional Remarks", "Only approved projects are available for vehicle allocation."])
    assert.ok(use.includes(l), l);
  assert.ok(use.includes("25-Nov-2026 – 30-Nov-2026")); // project period from the approved project
  assert.ok(!use.includes('data-panel="available"') && !use.includes("Issue Category"));

  const iss = render(issue());
  assert.ok(iss.includes('data-panel="issue"'));
  for (const l of ["Issue Category", "Issue Description / Reason", "Issue Reported", "Expected Repair Completion", "Garage / Service Centre", "Repair Remarks", "Issue Status"])
    assert.ok(iss.includes(l), l);
  for (const c of ISSUE_CATEGORIES) assert.ok(iss.includes(`>${c}</option>`), c);
  assert.ok(!iss.includes("Project Allocation Details") && !iss.includes("Available From"));

  const none = render({ ...emptyAvailability(NOW), status: "" });
  assert.ok(!none.includes("data-panel"));
});

test("a linked project shows its trackup / PIF pair, locks the original details and offers Change project", () => {
  const linked = inUse({ project: applyProject(inUse().project, choice) });
  const html = render(linked);
  assert.ok(html.includes("Linked to approved project") && html.includes("TRK-1") && html.includes("PIF-1") && html.includes("Change project"));
  assert.match(html, /readOnly=""[^>]*value="Pepsi India"|value="Pepsi India"[^>]*readOnly=""/); // auto-filled and read only
  assert.match(html, /value="Signage"/);
  assert.match(html, /value="Pepsi India Signage – JS-77"/);
  const typing = render(inUse({ project: { ...inUse().project, trackingProject: "", trackupNumber: "TRK-" } }));
  assert.ok(!typing.includes("Linked to approved project")); // typed but not yet matched: not linked
});

test("typing a trackup / PIF clears the previous project's values (no stale dependants); changing the project clears everything but remarks", () => {
  const linked = applyProject({ ...inUse().project, remarks: "r" }, choice);
  const t = typeProjectRef(linked, "pifNumber", "pif-9 ");
  assert.equal(t.pifNumber, "PIF-9 ");
  for (const k of ["trackingProject", "trackingVehicle", "budget", "projectName", "clientName", "projectType", "trackupNumber", "startDate", "endDate", "location"] as const) assert.equal(t[k], "", k);
  assert.equal(t.budgetVersion, null);
  assert.equal(t.remarks, "r");
  assert.equal(typeProjectRef(linked, "trackupNumber", "ab<script>").trackupNumber, "ABSCRIPT"); // keyboard sanitiser
  assert.equal(typeProjectRef(linked, "trackupNumber", "x".repeat(60)).trackupNumber.length, 40);
});

test("selecting an existing project auto-populates its details; RBP keeps own location / remarks; unlink returns to manual", () => {
  const cur = { ...inUse().project, location: "Madurai", remarks: "needs ladder" };
  const p = applyProject(cur, choice);
  assert.equal(p.trackingProject, choice.trackingProject);
  assert.equal(p.projectName, "Pepsi India Signage – JS-77");
  assert.equal(p.clientName, "Pepsi India");
  assert.equal(p.trackupNumber, "TRK-1");
  assert.equal(p.pifNumber, "PIF-1");
  assert.equal(p.startDate, "2026-12-01");
  assert.equal(p.endDate, "2026-12-09");
  assert.equal(p.location, "Madurai"); // not overwritten
  assert.equal(p.remarks, "needs ladder");
  assert.equal(applyProject({ ...cur, location: "" }, choice).location, "Coimbatore");
  assert.equal(p.trackingVehicle, choice.trackingVehicle);
  assert.equal(p.budget, choice.budget);
  assert.equal(p.budgetVersion, 2);
  const u = unlinkProject(p);
  assert.equal(u.trackingProject, "");
  assert.equal(u.trackupNumber, "");
  assert.equal(u.pifNumber, "");
  assert.equal(u.projectName, ""); // nothing stale survives a project change
  assert.equal(u.clientName, "");
  assert.equal(u.remarks, "needs ladder");
});

test("validation: In Use needs an approved (linked) project and a next available date AND time", () => {
  assert.deepEqual(validateAvailability(inUse(), false, NOW), []);
  assert.ok(validateAvailability(inUse({ nextAvailableDate: "" }), false, NOW).includes("Next available date is required"));
  assert.ok(validateAvailability(inUse({ nextAvailableTime: "" }), false, NOW).includes("Next available time is required"));
  const noProject = validateAvailability({ ...inUse(), project: emptyAvailability(NOW).project }, false, NOW);
  assert.ok(noProject.includes("Select an approved project by Trackup Number or PIF Number"));
  const typedOnly = inUse(); typedOnly.project = { ...typedOnly.project, trackingProject: "", trackupNumber: "TRK-X" }; // typed but not matched to an approved project
  assert.ok(validateAvailability(typedOnly, false, NOW).includes("Select an approved project by Trackup Number or PIF Number"));
  assert.deepEqual(validateAvailability(typedOnly, true, NOW), []); // a draft can keep it incomplete
  assert.ok(validateAvailability(inUse({ expectedReleaseTime: "" }), false, NOW).some((e) => /both date and time/.test(e)));
  assert.ok(validateAvailability(inUse({ nextAvailableDate: "2026-11-25", nextAvailableTime: "19:00" }), false, NOW).some((e) => /before the expected release/.test(e)));
  assert.ok(validateAvailability(inUse({ nextAvailableDate: "2026-02-31" }), false, NOW).some((e) => /not a valid date/.test(e)));
  assert.ok(validateAvailability(inUse({ nextAvailableTime: "25:00" }), false, NOW).some((e) => /not a valid time/.test(e)));
  const badRange = inUse(); badRange.project = { ...badRange.project, startDate: "2026-12-05", endDate: "2026-12-01" };
  assert.ok(validateAvailability(badRange, false, NOW).some((e) => /end date cannot be before/.test(e)));
});

test("validation: Vehicle Issue needs a reason and category; repair date is optional", () => {
  assert.deepEqual(validateAvailability(issue(), false, NOW), []);
  assert.ok(validateAvailability(issue({ description: "  " }), false, NOW).includes("Issue description / reason is required"));
  assert.ok(validateAvailability(issue({ category: "" }), false, NOW).includes("Issue category is required"));
  assert.deepEqual(validateAvailability(issue({ expectedRepairDate: "", expectedRepairTime: "" }), false, NOW), []);
  assert.ok(validateAvailability(issue({ expectedRepairTime: "10:00" }), false, NOW).some((e) => /date is required when a time/.test(e)));
  assert.ok(validateAvailability(issue({ reportedDate: "2026-11-24", reportedTime: "10:00", expectedRepairDate: "2026-11-24", expectedRepairTime: "09:00" }), false, NOW).some((e) => /before the issue was reported/.test(e)));
  assert.ok(validateAvailability(issue({ reportedDate: "2026-11-25" }), false, NOW).some((e) => /in the future/.test(e)));
});

test("validation: a status is needed on final save; a draft only checks formats", () => {
  const blank: AvForm = { ...emptyAvailability(NOW), status: "" };
  assert.ok(validateAvailability(blank, false, NOW).includes("Vehicle status is required"));
  assert.deepEqual(validateAvailability(blank, true, NOW), []);
  assert.deepEqual(validateAvailability(inUse({ nextAvailableDate: "", nextAvailableTime: "", expectedReleaseDate: "", expectedReleaseTime: "" }), true, NOW), []);
  assert.deepEqual(validateAvailability(issue({ description: "" }), true, NOW), []);
  assert.ok(validateAvailability(inUse({ nextAvailableDate: "bad" }), true, NOW).length > 0);
});

test("payload keeps only the chosen status's fields; switching status in the form loses nothing until saved", () => {
  let a = inUse({ project: applyProject(inUse().project, choice), nextAvailableDate: "2026-12-10" });
  a = { ...a, issue: { ...a.issue, description: "typed earlier" } };
  const use = toAvailabilityPayload(a) as Record<string, unknown>;
  assert.equal(use.status, "IN_USE");
  assert.deepEqual(Object.keys(use.project as object).sort(), ["location", "pifNumber", "remarks", "trackupNumber"]); // the server fills the rest from the approved records
  assert.equal((use.project as Record<string, unknown>).trackupNumber, "TRK-1");
  assert.equal((use.project as Record<string, unknown>).pifNumber, "PIF-1");
  assert.ok(!("issue" in use));
  // switch to issue and back: the project details are still in the form
  const toIssue: AvForm = { ...a, status: "ISSUE" };
  const iss = toAvailabilityPayload(toIssue) as Record<string, unknown>;
  assert.ok(!("project" in iss));
  assert.equal((iss.issue as Record<string, unknown>).description, "typed earlier");
  const back: AvForm = { ...toIssue, status: "IN_USE" };
  assert.equal(back.project.projectName, a.project.projectName);
  assert.equal(back.nextAvailableDate, "2026-12-10");
  assert.deepEqual(toAvailabilityPayload({ ...a, status: "AVAILABLE" }), { status: "AVAILABLE", availableFromDate: a.availableFromDate, availableFromTime: a.availableFromTime });
  assert.deepEqual(toAvailabilityPayload({ ...a, status: "" }), { status: "" });
  assert.ok(!("projectName" in ((toAvailabilityPayload(inUse()) as Record<string, unknown>).project as object))); // names are never sent: they cannot be forged
});

test("edit restores every saved conditional field; legacy records start unchosen, never silently Available", () => {
  const saved = {
    status: "IN_USE", availableFromDate: null, availableFromTime: null,
    project: { trackingProject: "a".repeat(24), projectType: "SIGNAGE", projectName: "P", clientName: "C", trackupNumber: "TRK-1", pifNumber: "PIF-1", startDate: "2026-12-01", endDate: "2026-12-09", location: "Chennai", remarks: "r" },
    expectedReleaseDate: "2026-12-08", expectedReleaseTime: "18:00", nextAvailableDate: "2026-12-09", nextAvailableTime: "10:00", issue: null,
  };
  const f = fromAvailability(saved, NOW);
  assert.equal(f.status, "IN_USE");
  assert.equal(f.project.trackupNumber, "TRK-1");
  assert.equal(f.project.trackingProject, "a".repeat(24));
  assert.equal(f.expectedReleaseTime, "18:00");
  assert.equal(f.nextAvailableDate, "2026-12-09");
  const iss = fromAvailability({ status: "ISSUE", issue: { category: "Other", description: "d", reportedDate: "2026-11-20", reportedTime: "09:00", issueStatus: "IN_REPAIR", garage: "G" } }, NOW);
  assert.equal(iss.status, "ISSUE");
  assert.equal(iss.issue.issueStatus, "IN_REPAIR");
  assert.equal(iss.issue.reportedDate, "2026-11-20");
  for (const legacy of [undefined, null, {}, { status: "WEIRD" }]) assert.equal(fromAvailability(legacy, NOW).status, "", String(legacy));
  assert.ok(validateAvailability(fromAvailability(undefined, NOW), false, NOW).includes("Vehicle status is required"));
});

test("listing text: next available / expected release / issue reason; example from the brief", () => {
  const v = { availability: { status: "IN_USE", project: { projectName: "KFC Roadshow" }, expectedReleaseDate: "2026-11-25", expectedReleaseTime: "20:00", nextAvailableDate: "2026-11-26", nextAvailableTime: "09:00" } };
  assert.equal(expectedReleaseText(v), "25-Nov-2026, 08:00 PM");
  assert.equal(nextAvailableText(v), "26-Nov-2026, 09:00 AM");
  assert.equal(issueReasonText(v), "—");
  const bad = { availability: { status: "ISSUE", issue: { category: "Battery Problem", description: "Dead", expectedRepairDate: "2026-12-01", expectedRepairTime: null } } };
  assert.equal(issueReasonText(bad), "Battery Problem: Dead");
  assert.equal(nextAvailableText(bad), "01-Dec-2026");
  assert.equal(nextAvailableText({ availability: { status: "ISSUE", issue: { description: "x" } } }), "Not known");
  assert.equal(nextAvailableText({ availability: { status: "AVAILABLE" } }), "Now");
  assert.equal(nextAvailableText({}), "—");
  assert.equal(expectedReleaseText({ availability: { status: "AVAILABLE" } }), "—");
  assert.equal(formatAt("2026-11-26", "00:05"), "26-Nov-2026, 12:05 AM");
  assert.equal(formatAt("2026-11-26", "12:00"), "26-Nov-2026, 12:00 PM");
  assert.equal(formatAt(null, "10:00"), "—");
  assert.equal(formatLabelAt("2026-11-25 20:00"), "25-Nov-2026, 08:00 PM");
  assert.equal(formatLabelAt("2026-11-25"), "25-Nov-2026");
});

test("history labels and values for the new actions never show undefined", () => {
  for (const a of ["MARKED_AVAILABLE", "PROJECT_ASSIGNED", "PROJECT_UPDATED", "RELEASE_CHANGED", "ISSUE_REPORTED", "ISSUE_UPDATED", "REPAIR_DATE_CHANGED", "ISSUE_RESOLVED", "AUTO_AVAILABILITY_UPDATE"])
    assert.ok(HISTORY_LABEL[a], a);
  for (const f of ["availabilityStatus", "projectName", "nextAvailable", "expectedRelease", "issueDescription", "expectedRepair"]) assert.ok(FIELD_LABEL[f], f);
  assert.equal(fmtValue("availabilityStatus", "IN_USE"), "In Use – Another Project");
  assert.equal(fmtValue("availabilityStatus", null), "—");
  assert.equal(fmtValue("projectType", "ROADSHOW"), "Roadshow");
  assert.equal(fmtValue("nextAvailable", "2026-11-26 09:00"), "26-Nov-2026, 09:00 AM");
  assert.equal(fmtValue("projectEnd", "2026-12-09"), "09-Dec-2026");
  assert.equal(fmtValue("issueStatus", "IN_REPAIR"), "In Repair");
  assert.equal(fmtValue("issueDescription", "Engine"), "Engine");
  assert.equal(fmtValue("make", "Tata"), "Tata"); // existing formatting untouched
  assert.equal(fmtValue("oilTopUpOn", "2026-10-01"), "01-Oct-2026");
});
