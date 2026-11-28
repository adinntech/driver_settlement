import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivitySummary, ApprovalHistory, ApprovalHistorySection, VersionHistory } from "../src/components/HistorySections";
import type { Activity, BudgetEvent, BudgetVersion } from "../src/types/domain";
import { approvalEvents, sortEventsDesc, sortVersionsDesc, statusAfter, versionStatus, versionSubmittedAt } from "../src/utils/history";

const data = (haltFood: number) => ({
  schemaVersion: 2, mileage: 12, onRoadDate: "2026-10-21", completionDate: "2026-10-26", sundayHalt: false, numberOfDays: 6,
  dieselAmount: 5000, salaryAmount: 800, salaryUnit: "PER_DAY", foodAmount: 300, foodUnit: "PER_DAY", haltFood,
  tolls: [{ location: "Salem", rate: 120 }, { location: "Madurai", rate: 80 }], others: [{ description: "Parking", amount: 100 }],
  otherDetails: [{ name: "Accommodation", value: "5000" }], fromLocation: "Chennai", toLocation: "Madurai",
  computed: { dieselValue: 5000, salaryValue: 4800, foodValue: 1800, tollAmount: 200, totalValue: 12000 + haltFood },
});
const ver = (n: number, iso: string, haltFood: number, changes: BudgetVersion["changes"] = []): BudgetVersion => ({
  _id: `v${n}`, version: n, data: data(haltFood), total: 12000 + haltFood, changes, updatedBy: "RBP", createdAt: iso,
});
const ev = (id: string, version: number, action: BudgetEvent["action"], iso: string, user = "RBP", details: BudgetEvent["details"] = null): BudgetEvent => ({
  _id: id, version, action, username: user, role: user, details, createdAt: iso,
});

// deliberately shuffled input: the UI must order by real timestamps, newest first
const versions = [
  ver(2, "2026-11-23T06:00:00.000Z", 250, [{ field: "haltFood", from: 200, to: 250 }]),
  ver(4, "2026-11-23T09:00:00.000Z", 400, [{ field: "haltFood", from: 300, to: 400 }]),
  ver(1, "2026-11-23T05:00:00.000Z", 200),
  ver(3, "2026-11-23T07:30:00.000Z", 300, [{ field: "haltFood", from: 250, to: 300 }]),
];
const events: BudgetEvent[] = [
  ev("e3", 1, "REJECTED", "2026-11-23T05:30:00.000Z", "RSOM", { reason: "Amounts wrong", fields: [{ field: "haltFood", comment: "Needs revision" }, { field: "tolls", comment: "Rate wrong" }], total: 12200 }),
  ev("e1", 1, "CREATED", "2026-11-23T05:00:00.000Z"),
  ev("e2", 1, "SUBMITTED", "2026-11-23T05:10:00.000Z"),
  ev("e4", 2, "UPDATED", "2026-11-23T06:00:00.000Z"),
  ev("e5", 2, "RESUBMITTED", "2026-11-23T06:10:00.000Z", "RBP", { comment: "Fixed", changesSinceRejected: [{ field: "haltFood", from: 200, to: 250 }], rejectedVersion: 1 }),
  ev("e6", 2, "APPROVED", "2026-11-23T06:40:00.000Z", "RSOM", { total: 12250 }),
  ev("e7", 3, "UPDATED", "2026-11-23T07:30:00.000Z"),
];

test("versions sort latest first by timestamp, version breaks ties", () => {
  assert.deepEqual(sortVersionsDesc(versions).map((v) => v.version), [4, 3, 2, 1]);
  const tie = [ver(1, "2026-11-23T05:00:00.000Z", 1), ver(2, "2026-11-23T05:00:00.000Z", 2)];
  assert.deepEqual(sortVersionsDesc(tie).map((v) => v.version), [2, 1]);
  // timestamp wins over the version label
  const odd = [ver(5, "2026-11-23T05:00:00.000Z", 1), ver(6, "2026-11-23T04:00:00.000Z", 2)];
  assert.deepEqual(sortVersionsDesc(odd).map((v) => v.version), [5, 6]);
  assert.deepEqual(sortVersionsDesc([]), []);
});

test("events sort latest first; approval history keeps only approval actions and all older records", () => {
  assert.deepEqual(sortEventsDesc(events).map((e) => e._id), ["e7", "e6", "e5", "e4", "e3", "e2", "e1"]);
  const a = approvalEvents(events);
  assert.deepEqual(a.map((e) => e.action), ["APPROVED", "RESUBMITTED", "REJECTED", "SUBMITTED"]);
  assert.equal(a.length, 4); // nothing dropped
  assert.deepEqual(events.map((e) => e._id), ["e3", "e1", "e2", "e4", "e5", "e6", "e7"]); // input untouched
});

test("version status comes from recorded history; unknown stays null (never guessed)", () => {
  assert.equal(versionStatus(1, events), "REJECTED");
  assert.equal(versionStatus(2, events), "APPROVED");
  assert.equal(versionStatus(3, events), "DRAFT");
  assert.equal(versionStatus(4, events), null);
  assert.equal(statusAfter("RESUBMITTED"), "PENDING");
  assert.equal(versionSubmittedAt(1, events), "2026-11-23T05:10:00.000Z");
  assert.equal(versionSubmittedAt(2, events), "2026-11-23T06:10:00.000Z");
  assert.equal(versionSubmittedAt(3, events), null);
});

test("version history: V4 first, latest expanded, older collapsed, no undefined", () => {
  const html = renderToStaticMarkup(<VersionHistory versions={versions} events={events} currentVersion={4} />);
  const order = [...html.matchAll(/hist-title">V(\d)</g)].map((m) => Number(m[1]));
  assert.deepEqual(order, [4, 3, 2, 1]);
  const expanded = [...html.matchAll(/aria-expanded="(true|false)"/g)].map((m) => m[1]);
  assert.deepEqual(expanded, ["true", "false", "false", "false"]);
  assert.equal((html.match(/hist-content/g) ?? []).length, 1); // only the latest renders its details
  assert.ok(html.includes("Salem") && html.includes("Madurai")); // multiple location / rate entries
  assert.ok(html.includes("Accommodation: 5000")); // dynamic other details
  assert.ok(html.includes("Parking")); // others
  assert.ok(html.includes("Not available")); // V4 has no recorded status
  assert.ok(!/undefined|\[object Object\]|NaN/.test(html), "no placeholder garbage");
  for (const label of ["Total Budget", "Updated By", "Last Edited"]) assert.ok(html.includes(label), label);
  assert.ok(html.includes("Submitted")); // V1/V2 show a submitted time when it exists
});

test("version history: a new latest version resets which cards are expanded", () => {
  // VersionHistory has no hooks, so its element can be inspected directly. A changed list key remounts every card.
  const listKey = (v: BudgetVersion[]) => VersionHistory({ versions: v, events, currentVersion: 4 }).key;
  const before = versions.filter((v) => v.version < 4);
  assert.notEqual(listKey(before), listKey(versions));
  assert.equal(listKey(versions), listKey([...versions].reverse())); // a plain refetch keeps what the user opened
});

test("approval history: latest action first and expanded; older ones collapsed", () => {
  const html = renderToStaticMarkup(<ApprovalHistory events={events} />);
  const titles = [...html.matchAll(/hist-title">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(titles, ["Approved", "Resubmitted", "Rejected", "Submitted for Approval"]);
  assert.deepEqual([...html.matchAll(/aria-expanded="(true|false)"/g)].map((m) => m[1]), ["true", "false", "false", "false"]);
  assert.ok(html.includes("Approved amount"));
  assert.ok(!/undefined|\[object Object\]/.test(html));
  assert.equal(renderToStaticMarkup(<ApprovalHistory events={[]} />).includes("No approval activity yet."), true);
});

test("a rejection is rendered with reason, fields and per-field comments when expanded", () => {
  const rejectedOnly = events.filter((e) => e._id === "e3" || e._id === "e1");
  const html = renderToStaticMarkup(<ApprovalHistory events={rejectedOnly} />);
  for (const t of ["Amounts wrong", "Halt Food", "Needs revision", "Toll Detail", "Rate wrong", "Rejected amount"]) assert.ok(html.includes(t), t);
});

test("activity summary: role-specific labels, missing entries hidden, old decision flagged, legacy safe", () => {
  const a: Activity = {
    createdAt: "2026-11-23T05:00:00.000Z", createdBy: "RBP", currentStatus: "PENDING",
    lastEdited: { at: "2026-11-23T07:30:00.000Z", by: "RBP", version: 3 },
    lastSubmitted: { at: "2026-11-23T05:10:00.000Z", by: "RBP", version: 1 },
    lastResubmitted: { at: "2026-11-23T07:40:00.000Z", by: "RBP", version: 3 },
    lastApproved: null,
    lastRejected: { at: "2026-11-23T05:30:00.000Z", by: "RSOM", version: 1, superseded: true },
  };
  const rbp = renderToStaticMarkup(<ActivitySummary activity={a} role="RBP" />);
  for (const l of ["Budget Created", "Last Edited", "Last Submitted", "Last Resubmitted", "Last Rejected"]) assert.ok(rbp.includes(l), l);
  assert.ok(!rbp.includes("Last Approved")); // never happened
  assert.ok(rbp.includes("earlier decision")); // not shown as the current state
  assert.ok(rbp.includes("23-Nov-2026, 01:00 PM")); // 07:30 UTC in IST
  const rsom = renderToStaticMarkup(<ActivitySummary activity={a} role="RSOM" />);
  for (const l of ["Submitted for Approval", "Resubmitted", "Rejected"]) assert.ok(rsom.includes(l), l);
  const legacy = renderToStaticMarkup(<ActivitySummary activity={{ ...a, createdAt: null, lastEdited: null, lastSubmitted: null, lastResubmitted: null, lastRejected: null }} role="RBP" />);
  assert.ok(legacy.includes("Not available"));
  assert.ok(!/undefined|Invalid Date/.test(legacy));
  assert.equal(renderToStaticMarkup(<ActivitySummary activity={null} role="RBP" />), "");
});

test("Approval history starts collapsed: only the heading and its arrow", () => {
  const html = renderToStaticMarkup(<ApprovalHistorySection><ApprovalHistory events={events} /></ApprovalHistorySection>);
  assert.ok(html.includes("Approval history") && html.includes('aria-expanded="false"') && html.includes("▸"));
  assert.ok(!html.includes("hist-item"));
});
