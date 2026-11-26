/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_approval";
process.env.JWT_SECRET = "test-secret";
process.env.RSOP_USERNAME = "RSOP";
process.env.RSOP_PASSWORD = "pass2";
process.env.RBP_USERNAME = "RBP";
process.env.RBP_PASSWORD = "123123";
process.env.RSOM_USERNAME = "RSOM";
process.env.RSOM_PASSWORD = "pass3";

import test from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import mongoose from "mongoose";
const { addDaysYmd: shiftDay, todayIst: todayYmd } = await import("../src/utils/dates.js");
/** Fixture dates relative to today: campaign start dates must be today or up to 7 days back. */
const day = (n: number) => shiftDay(todayYmd(), n);

const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { User } = await import("../src/models/User.js");
const { TrackingVehicle } = await import("../src/models/TrackingVehicle.js");
const { TrackingProject } = await import("../src/models/TrackingProject.js");
const { Budget, BudgetVersion } = await import("../src/models/Budget.js");
const { BudgetEvent, Notification } = await import("../src/models/Approval.js");

let server: Server;
let base = "";
{
  await connectDB();
  assert.match(mongoose.connection.name, /_test/, "refusing to drop a non-test database");
  await mongoose.connection.dropDatabase();
  await Promise.all([User, TrackingVehicle, TrackingProject, Budget, BudgetVersion, BudgetEvent, Notification].map((m: any) => m.init()));
  await seedUsers();
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
}

const call = async (path: string, method = "GET", body?: unknown, token?: string) => {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as { success: boolean; message: string; data: any } };
};
const login = async (role: string, u: string, p: string) =>
  (await call("/auth/login", "POST", { role, username: u, password: p })).body.data.token as string;

// one Project Code per client (a code belongs to one client's project)
const codeOf = (client: string) => String(10_000_000 + ([...client].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 90_000_000));
const signage = (client: string) => ({
  projectCode: codeOf(client), date: day(-3), client, jobSheetNumber: "22403", location: "RAMNAD",
  numberOfVehicles: 1, fromDate: day(-2), toDate: day(3),
});
const budgetBody = {
  mileage: 12, estimatedKmPerDay: 150, onRoadDate: day(-2), completionDate: day(3), sundayHalt: true, numberOfDays: 6, // Halt Food needs Sunday Halt
  dieselAmount: 5000, salaryAmount: 800, salaryUnit: "PER_DAY", foodAmount: 300, foodUnit: "PER_DAY", haltFood: 200,
  tolls: [{ location: "Salem", rate: 120 }], others: [{ description: "Parking", amount: 100 }],
  fromLocation: "Chennai", toLocation: "Madurai", totalKm: 900, upDownValue: 50,
};
let tokens: { rsop: string; rbp: string; rsom: string };
const T = async () => (tokens ??= { rsop: await login("RSOP", "RSOP", "pass2"), rbp: await login("RBP", "RBP", "123123"), rsom: await login("RSOM", "RSOM", "pass3") });

async function newBudget(client: string) {
  const t = await T();
  const p = (await call("/tracking", "POST", { projectType: "SIGNAGE", details: signage(client) }, t.rsop)).body.data;
  const vehicle = p.vehicles[0];
  const b = (await call("/budgets", "POST", { vehicleId: vehicle._id, ...budgetBody }, t.rbp)).body.data.budget;
  return { t, p, vehicle, b };
}

test("RSOM login works and role list includes RSOM", async () => {
  const roles = (await call("/auth/roles")).body.data;
  assert.equal(roles.RSOM.description, "Review and approve or reject budgets created by RBP.");
  const t = await T();
  assert.ok(t.rsom);
  assert.equal((await call("/auth/login", "POST", { role: "RSOM", username: "RSOM", password: "x" })).status, 401);
  assert.equal((await call("/auth/login", "POST", { role: "RBP", username: "RSOM", password: "pass3" })).status, 401); // wrong role
});

test("permissions: RSOM only approvals; RSOP/RBP cannot; RSOM cannot create tracking or edit budgets", async () => {
  const t = await T();
  assert.equal((await call("/approvals")).status, 401);
  assert.equal((await call("/approvals", "GET", undefined, t.rsop)).status, 403);
  assert.equal((await call("/approvals", "GET", undefined, t.rbp)).status, 403);
  assert.equal((await call("/approvals", "GET", undefined, t.rsom)).status, 200);
  assert.equal((await call("/tracking", "POST", { projectType: "SIGNAGE", details: signage("X") }, t.rsom)).status, 403);
  assert.equal((await call("/budgets/vehicle/abc", "GET", undefined, t.rsom)).status, 403);
  assert.equal((await call("/budgets/abc/submit", "POST", {}, t.rsom)).status, 403);
  const r = await call("/approvals/abc/approve", "POST", { version: 1 }, t.rbp);
  assert.equal(r.status, 403);
  assert.deepEqual(Object.keys(r.body).sort(), ["data", "message", "success"]);
});

test("draft budgets are hidden from RSOM; submit moves to PENDING, notifies RSOM, blocks editing", async () => {
  const { t, b, vehicle } = await newBudget("Draft Client");
  assert.equal((await call("/approvals/" + b._id, "GET", undefined, t.rsom)).status, 404);
  assert.equal((await call("/approvals", "GET", undefined, t.rsom)).body.data.items.filter((i: any) => i.budgetId === b._id).length, 0);

  const s = await call(`/budgets/${b._id}/submit`, "POST", { comment: "please review" }, t.rbp);
  assert.equal(s.status, 200);
  assert.equal(s.body.data.approvalStatus, "PENDING");
  assert.equal(s.body.data.submittedVersion, 1);
  assert.equal((await call(`/budgets/${b._id}/submit`, "POST", {}, t.rbp)).status, 409); // duplicate submit
  assert.equal((await call(`/budgets/${b._id}`, "PUT", { ...budgetBody, haltFood: 1 }, t.rbp)).status, 409); // locked while pending

  const n = (await call("/notifications", "GET", undefined, t.rsom)).body.data;
  const mine = n.items.find((x: any) => x.meta?.budgetId === b._id);
  assert.equal(mine.type, "BUDGET_SUBMITTED");
  assert.equal(mine.title, "A new budget is waiting for your approval");
  assert.equal(mine.link, `/rsom/review?budget=${b._id}`);
  assert.match(mine.message, /Submitted Client|Draft Client/);
  assert.ok(mine.message.includes(vehicle.trackupNumber) && mine.message.includes(vehicle.pifNumber) && mine.message.includes("Signage") && mine.message.includes("V1"));
  assert.equal(n.unread >= 1, true);
  // the submitting RBP does not get the RSOM notification
  assert.equal((await call("/notifications", "GET", undefined, t.rbp)).body.data.items.filter((x: any) => x.meta?.budgetId === b._id).length, 0);
});

test("listing, filters, pagination, stats and review detail for RSOM", async () => {
  const t = await T();
  const a = await newBudget("Alpha Foods");
  const c = await newBudget("Beta Motors");
  await call(`/budgets/${a.b._id}/submit`, "POST", {}, t.rbp);
  await call(`/budgets/${c.b._id}/submit`, "POST", {}, t.rbp);
  await call(`/approvals/${c.b._id}/approve`, "POST", { version: 1 }, t.rsom);

  const all = (await call("/approvals?limit=100", "GET", undefined, t.rsom)).body.data;
  const row = all.items.find((i: any) => i.budgetId === a.b._id);
  assert.equal(row.client, "Alpha Foods");
  assert.equal(row.trackupNumber, a.vehicle.trackupNumber);
  assert.equal(row.pifNumber, a.vehicle.pifNumber);
  assert.equal(row.projectType, "SIGNAGE");
  assert.equal(row.campaignFrom, day(-2));
  assert.equal(row.version, 1);
  assert.equal(row.status, "PENDING");
  assert.equal(row.submittedBy, "RBP");
  assert.ok(row.total > 0 && row.submittedAt);

  const f = async (qs: string) => (await call("/approvals?" + qs, "GET", undefined, t.rsom)).body.data;
  assert.ok((await f("client=alpha")).items.every((i: any) => /alpha/i.test(i.client)));
  assert.equal((await f("trackup=" + encodeURIComponent(a.vehicle.trackupNumber))).items.length, 1);
  assert.equal((await f("pif=" + a.vehicle.pifNumber)).items.length, 1);
  assert.ok((await f("status=APPROVED")).items.every((i: any) => i.status === "APPROVED"));
  assert.equal((await f("projectType=ROADSHOW")).total, 0);
  assert.equal((await f("from=2999-01-01")).total, 0);
  const p1 = await f("limit=1&page=1");
  assert.equal(p1.items.length, 1);
  assert.ok(p1.total >= 3);
  assert.notEqual((await f("limit=1&page=2")).items[0].budgetId, p1.items[0].budgetId);

  const st = (await call("/approvals/stats", "GET", undefined, t.rsom)).body.data;
  assert.equal(st.total, st.pending + st.approved + st.rejected);
  assert.ok(st.pending >= 2 && st.approved >= 1);

  const d = (await call("/approvals/" + a.b._id, "GET", undefined, t.rsom)).body.data;
  assert.equal(d.context.client, "Alpha Foods");
  assert.equal(d.context.displayNumber, a.vehicle.displayNumber);
  assert.equal(d.budget.data.tolls[0].location, "Salem");
  assert.equal(d.versions.length, 1);
  assert.deepEqual(d.events.map((e: any) => e.action), ["CREATED", "SUBMITTED"]);
  assert.equal(d.comparison, null);
});

test("approve: confirms version, records approver, notifies RBP, no duplicates, locks editing", async () => {
  const { t, b, vehicle } = await newBudget("Approve Client");
  await call(`/budgets/${b._id}/submit`, "POST", {}, t.rbp);
  assert.equal((await call(`/approvals/${b._id}/approve`, "POST", {}, t.rsom)).status, 409); // version required
  assert.equal((await call(`/approvals/${b._id}/approve`, "POST", { version: 7 }, t.rsom)).status, 409);

  const a = await call(`/approvals/${b._id}/approve`, "POST", { version: 1 }, t.rsom);
  assert.equal(a.status, 200);
  assert.equal(a.body.data.approvalStatus, "APPROVED");
  assert.equal(a.body.data.approvedVersion, 1);
  assert.equal(a.body.data.reviewedBy, "RSOM");
  assert.ok(a.body.data.reviewedAt);
  assert.equal(a.body.data.data.dieselAmount, 5000); // original budget untouched

  assert.equal((await call(`/approvals/${b._id}/approve`, "POST", { version: 1 }, t.rsom)).status, 409); // duplicate
  assert.equal((await call(`/approvals/${b._id}/reject`, "POST", { version: 1, reason: "x", fields: [{ field: "haltFood", comment: "y" }] }, t.rsom)).status, 409);
  assert.equal((await call(`/budgets/${b._id}`, "PUT", { ...budgetBody, haltFood: 1 }, t.rbp)).status, 409);
  assert.equal((await call(`/budgets/${b._id}/submit`, "POST", {}, t.rbp)).status, 409);

  const notes = (await call("/notifications", "GET", undefined, t.rbp)).body.data.items.filter((x: any) => x.meta?.budgetId === b._id);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].type, "BUDGET_APPROVED");
  assert.ok(notes[0].message.includes(`Your budget for ${vehicle.trackupNumber} has been approved by RSOM`));
  assert.ok(notes[0].message.includes("Approve Client") && notes[0].message.includes("V1") && notes[0].message.includes("₹"));
  assert.equal(notes[0].link, `/rbp/budget?vehicle=${vehicle._id}`);
  assert.equal(notes[0].meta.total, a.body.data.total);

  const ev = (await call(`/budgets/${b._id}/events`, "GET", undefined, t.rbp)).body.data;
  assert.deepEqual(ev.map((e: any) => [e.version, e.action, e.username]), [[1, "CREATED", "RBP"], [1, "SUBMITTED", "RBP"], [1, "APPROVED", "RSOM"]]);
  assert.ok(ev.every((e: any) => e.createdAt));
});

test("concurrent approve/reject: exactly one decision wins and only one notification is sent", async () => {
  const { t, b } = await newBudget("Race Client");
  await call(`/budgets/${b._id}/submit`, "POST", {}, t.rbp);
  const rejectBody = { version: 1, reason: "no", fields: [{ field: "haltFood", comment: "no" }] };
  const rs = await Promise.all([
    ...[1, 2, 3].map(() => call(`/approvals/${b._id}/approve`, "POST", { version: 1 }, t.rsom)),
    ...[1, 2].map(() => call(`/approvals/${b._id}/reject`, "POST", rejectBody, t.rsom)),
  ]);
  assert.equal(rs.filter((r) => r.status === 200).length, 1);
  assert.ok(rs.every((r) => r.status === 200 || r.status === 409));
  const evs = (await call(`/budgets/${b._id}/events`, "GET", undefined, t.rbp)).body.data.filter((e: any) => ["APPROVED", "REJECTED"].includes(e.action));
  assert.equal(evs.length, 1);
  const n = (await call("/notifications", "GET", undefined, t.rbp)).body.data.items.filter((x: any) => x.meta?.budgetId === b._id);
  assert.equal(n.length, 1);
});

test("RSOM can reject without a reason: stored as null, RBP still sees the flagged fields, resubmission works", async () => {
  const { t, b } = await newBudget("No Reason Client");
  await call(`/budgets/${b._id}/submit`, "POST", {}, t.rbp);
  const fields = [{ field: "tolls", comment: "Toll rate looks wrong" }];
  const r = await call(`/approvals/${b._id}/reject`, "POST", { version: 1, reason: "   ", fields }, t.rsom);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.approvalStatus, "REJECTED");
  assert.equal(r.body.data.rejection.reason, null);
  assert.deepEqual(r.body.data.rejection.fields, fields);
  const n = (await call("/notifications", "GET", undefined, t.rbp)).body.data.items.find((x: any) => x.meta?.budgetId === b._id && x.type === "BUDGET_REJECTED");
  assert.ok(n && !/Reason:/.test(n.message), "no empty Reason: in the notification");
  // RBP revises and resubmits as before
  assert.equal((await call(`/budgets/${b._id}`, "PUT", { ...budgetBody, tolls: [{ location: "Salem", rate: 150 }] }, t.rbp)).status, 200);
  assert.equal((await call(`/budgets/${b._id}/submit`, "POST", { comment: "Fixed toll" }, t.rbp)).status, 200);
  // RSOP / RBP can never reject (RSOM only)
  assert.equal((await call(`/approvals/${b._id}/reject`, "POST", { version: 2, fields }, t.rbp)).status, 403);
});

test("reject validation: fields and per-field comments are mandatory; the overall reason is optional", async () => {
  const { t, b } = await newBudget("Validate Client");
  await call(`/budgets/${b._id}/submit`, "POST", {}, t.rbp);
  const rej = (body: unknown) => call(`/approvals/${b._id}/reject`, "POST", body, t.rsom);
  const f = [{ field: "tolls", comment: "wrong" }];
  for (const [label, body, re] of [
    ["no fields", { version: 1, reason: "bad" }, /at least one field/],
    ["empty fields", { version: 1, reason: "bad", fields: [] }, /at least one field/],
    ["bad field", { version: 1, reason: "bad", fields: [{ field: "nope", comment: "x" }] }, /not a valid budget field/],
    ["no comment", { version: 1, reason: "bad", fields: [{ field: "tolls", comment: " " }] }, /Enter a comment/],
    ["duplicate field", { version: 1, reason: "bad", fields: [...f, ...f] }, /more than once/],
  ] as [string, unknown, RegExp][]) {
    const r = await rej(body);
    assert.equal(r.status, 400, label);
    assert.equal(r.body.success, false);
    assert.equal(r.body.data, null);
    assert.match(r.body.message, re, label);
  }
  const still = (await call("/approvals/" + b._id, "GET", undefined, t.rsom)).body.data.budget;
  assert.equal(still.approvalStatus, "PENDING"); // nothing changed by failed attempts
});

test("full reject -> correct -> resubmit -> approve cycle with history, notifications and comparison", async () => {
  const { t, b, vehicle } = await newBudget("Cycle Client");
  await call(`/budgets/${b._id}/submit`, "POST", {}, t.rbp);

  const fields = [{ field: "tolls", comment: "Toll rate looks wrong" }, { field: "haltFood", comment: "Needs revision" }, { field: "others", comment: "Add supporting details" }];
  const r = await call(`/approvals/${b._id}/reject`, "POST", { version: 1, reason: "Several amounts need correction", fields }, t.rsom);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.approvalStatus, "REJECTED");
  assert.equal(r.body.data.rejectedVersion, 1);
  assert.deepEqual(r.body.data.rejection.fields, fields); // multiple fields + per-field comments
  assert.equal(r.body.data.rejection.rejectedBy, "RSOM");
  assert.ok(r.body.data.rejection.rejectedAt);
  assert.equal(r.body.data.data.haltFood, 200); // original untouched

  // RBP sees rejection details on the budget + notification
  const seen = (await call(`/budgets/vehicle/${vehicle._id}`, "GET", undefined, t.rbp)).body.data.budget;
  assert.equal(seen.approvalStatus, "REJECTED");
  assert.equal(seen.rejection.reason, "Several amounts need correction");
  assert.deepEqual(seen.rejection.fields.map((x: any) => x.field), ["tolls", "haltFood", "others"]);
  const note = (await call("/notifications", "GET", undefined, t.rbp)).body.data.items.find((x: any) => x.meta?.budgetId === b._id);
  assert.equal(note.type, "BUDGET_REJECTED");
  assert.ok(note.message.includes(`Your budget for ${vehicle.trackupNumber} has been rejected by RSOM. Please review the rejection details.`));
  assert.ok(note.message.includes("Several amounts need correction") && note.message.includes("tolls") && note.message.includes("V1") && note.message.includes("Cycle Client"));

  // a rejected version can neither be approved nor resubmitted unchanged
  assert.equal((await call(`/approvals/${b._id}/approve`, "POST", { version: 1 }, t.rsom)).status, 409);
  assert.equal((await call(`/budgets/${b._id}/submit`, "POST", {}, t.rbp)).status, 409);

  // RBP corrects only some fields -> V2; non-rejected fields preserved
  const fixed = { ...budgetBody, haltFood: 250, tolls: [{ location: "Salem", rate: 90 }] };
  const e = await call(`/budgets/${b._id}`, "PUT", fixed, t.rbp);
  assert.equal(e.status, 200);
  assert.equal(e.body.data.currentVersion, 2);
  assert.equal(e.body.data.approvalStatus, "REJECTED"); // still rejected until resubmitted
  assert.equal(e.body.data.data.dieselAmount, 5000);
  const vs = (await call(`/budgets/${b._id}/versions`, "GET", undefined, t.rbp)).body.data;
  assert.equal(vs[0].data.haltFood, 200); // rejected V1 preserved
  assert.deepEqual(vs[1].changes.map((c: any) => c.field).sort(), ["haltFood", "tolls", "upDownValue"]); // Up/Down follows the tolls

  const rs = await call(`/budgets/${b._id}/submit`, "POST", { comment: "Fixed toll and halt food" }, t.rbp);
  assert.equal(rs.status, 200);
  assert.equal(rs.body.data.approvalStatus, "PENDING");
  assert.equal(rs.body.data.submittedVersion, 2);
  assert.equal(rs.body.data.resubmissionComment, "Fixed toll and halt food");

  const rsomNotes = (await call("/notifications", "GET", undefined, t.rsom)).body.data.items.filter((x: any) => x.meta?.budgetId === b._id);
  assert.deepEqual(rsomNotes.map((x: any) => x.type).sort(), ["BUDGET_RESUBMITTED", "BUDGET_SUBMITTED"]);
  assert.ok(rsomNotes.find((x: any) => x.type === "BUDGET_RESUBMITTED").message.includes("V2"));

  // RSOM compares rejected V1 vs resubmitted V2
  const d = (await call("/approvals/" + b._id, "GET", undefined, t.rsom)).body.data;
  assert.equal(d.comparison.fromVersion, 1);
  assert.equal(d.comparison.toVersion, 2);
  assert.deepEqual(d.comparison.changes.map((c: any) => c.field).sort(), ["haltFood", "tolls", "upDownValue"]); // RSOM also sees the recalculated Up/Down
  assert.equal(d.comparison.changes.find((c: any) => c.field === "haltFood").from, 200);
  assert.equal(d.comparison.changes.find((c: any) => c.field === "haltFood").to, 250);
  assert.equal(d.comparison.resubmissionComment, "Fixed toll and halt food");
  assert.equal(d.comparison.rejection.reason, "Several amounts need correction");

  // stale review of V1 is refused; V2 is approved
  assert.equal((await call(`/approvals/${b._id}/approve`, "POST", { version: 1 }, t.rsom)).status, 409);
  const ap = await call(`/approvals/${b._id}/approve`, "POST", { version: 2 }, t.rsom);
  assert.equal(ap.status, 200);
  assert.equal(ap.body.data.approvedVersion, 2);

  const ev = (await call(`/budgets/${b._id}/events`, "GET", undefined, t.rbp)).body.data;
  assert.deepEqual(ev.map((x: any) => `V${x.version} ${x.action} ${x.username}`), [
    "V1 CREATED RBP", "V1 SUBMITTED RBP", "V1 REJECTED RSOM", "V2 UPDATED RBP", "V2 RESUBMITTED RBP", "V2 APPROVED RSOM",
  ]);
  const rejected = ev.find((x: any) => x.action === "REJECTED");
  assert.equal(rejected.details.reason, "Several amounts need correction"); // history never overwritten
  assert.deepEqual(rejected.details.fields, fields);
  const resub = ev.find((x: any) => x.action === "RESUBMITTED");
  assert.deepEqual(resub.details.changesSinceRejected.map((c: any) => c.field).sort(), ["haltFood", "tolls", "upDownValue"]);
  assert.equal(resub.details.comment, "Fixed toll and halt food");

  // history rows cannot be rewritten
  await assert.rejects(BudgetEvent.updateOne({ budget: b._id }, { username: "x" }));
  await assert.rejects(BudgetEvent.deleteMany({ budget: b._id }));
});

test("notifications: own only, mark read, read-all, unread filter, no duplicates", async () => {
  const t = await T();
  const { b } = await newBudget("Notify Client");
  await call(`/budgets/${b._id}/submit`, "POST", {}, t.rbp);
  const rsomList = (await call("/notifications", "GET", undefined, t.rsom)).body.data;
  const n = rsomList.items.find((x: any) => x.meta?.budgetId === b._id);
  assert.equal(n.read, false);
  assert.equal((await call("/notifications/" + n._id + "/read", "POST", {}, t.rbp)).status, 404); // not theirs
  assert.equal((await call("/notifications/bad/read", "POST", {}, t.rsom)).status, 400);
  const r = await call("/notifications/" + n._id + "/read", "POST", {}, t.rsom);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.read, true);
  assert.ok(r.body.data.readAt);
  const unread = (await call("/notifications?unread=true", "GET", undefined, t.rsom)).body.data;
  assert.ok(unread.items.every((x: any) => !x.read));
  assert.ok(!unread.items.find((x: any) => x._id === n._id));
  const all = await call("/notifications/read-all", "POST", {}, t.rsom);
  assert.equal(all.status, 200);
  assert.equal((await call("/notifications", "GET", undefined, t.rsom)).body.data.unread, 0);
  assert.equal((await call("/notifications")).status, 401);
  assert.equal(await Notification.countDocuments({ dedupeKey: `SUB:${b._id}:1` }), 1); // one per recipient (single RSOM)
});

test("regression: RSOP flows, budget edit for drafts, tracking list approval status, old budgets still work", async () => {
  const t = await T();
  const { b, vehicle, p } = await newBudget("Regress Client");
  const list = (await call("/tracking?q=Regress", "GET", undefined, t.rsop)).body.data;
  assert.equal(list[0].vehicles[0].approvalStatus, "DRAFT");
  assert.match(vehicle.trackupNumber, /^JS-\d{5}\/\d{4}-\d{2}$/);
  // drafts remain freely editable and versioned
  const e = await call(`/budgets/${b._id}`, "PUT", { ...budgetBody, haltFood: 1 }, t.rbp);
  assert.equal(e.status, 200);
  assert.equal(e.body.data.currentVersion, 2);
  // a budget saved before approvals existed (no approvalStatus) behaves as DRAFT
  const p2 = (await call("/tracking", "POST", { projectType: "SIGNAGE", details: signage("Legacy Client") }, t.rsop)).body.data;
  const legacy = await Budget.create({
    budgetNumber: "BUD-333333", vehicle: p2.vehicles[0]._id, project: p2._id, data: { permitCharges: 5 }, total: 5,
    currentVersion: 1, createdBy: "RBP", updatedBy: "RBP",
  });
  await BudgetVersion.create({ budget: legacy._id, version: 1, data: { permitCharges: 5 }, total: 5, changes: [], updatedBy: "RBP" });
  assert.equal((await call("/tracking?q=Legacy", "GET", undefined, t.rsop)).body.data[0].vehicles[0].approvalStatus, "DRAFT");
  assert.equal((await call(`/budgets/${legacy._id}/submit`, "POST", {}, t.rbp)).status, 200);
  assert.equal((await call(`/approvals/${legacy._id}/approve`, "POST", { version: 1 }, t.rsom)).status, 200);
  assert.equal(p.vehicles.length, 1);
});

async function fullCycle(client: string) {
  const { t, b, vehicle } = await newBudget(client);
  const sleep = () => new Promise((r) => setTimeout(r, 15)); // distinct timestamps
  await sleep();
  await call(`/budgets/${b._id}/submit`, "POST", {}, t.rbp); await sleep();
  await call(`/approvals/${b._id}/reject`, "POST", { version: 1, reason: "fix", fields: [{ field: "haltFood", comment: "wrong" }] }, t.rsom); await sleep();
  await call(`/budgets/${b._id}`, "PUT", { ...budgetBody, haltFood: 250 }, t.rbp); await sleep();
  await call(`/budgets/${b._id}/submit`, "POST", { comment: "fixed" }, t.rbp); await sleep();
  await call(`/approvals/${b._id}/approve`, "POST", { version: 2 }, t.rsom);
  return { t, b, vehicle };
}

test("history APIs: default order unchanged (oldest first); order=desc returns latest first", async () => {
  const { t, b } = await fullCycle("Order Client");
  const asc = (await call(`/budgets/${b._id}/versions`, "GET", undefined, t.rbp)).body.data;
  assert.deepEqual(asc.map((v: any) => v.version), [1, 2]);
  const desc = (await call(`/budgets/${b._id}/versions?order=desc`, "GET", undefined, t.rbp)).body.data;
  assert.deepEqual(desc.map((v: any) => v.version), [2, 1]);
  assert.ok(new Date(desc[0].createdAt) >= new Date(desc[1].createdAt));

  const evAsc = (await call(`/budgets/${b._id}/events`, "GET", undefined, t.rbp)).body.data;
  const evDesc = (await call(`/budgets/${b._id}/events?order=desc`, "GET", undefined, t.rbp)).body.data;
  assert.deepEqual(evDesc.map((e: any) => e._id), [...evAsc].reverse().map((e: any) => e._id));
  assert.deepEqual(evDesc.map((e: any) => e.action), ["APPROVED", "RESUBMITTED", "UPDATED", "REJECTED", "SUBMITTED", "CREATED"]);
  for (let i = 1; i < evDesc.length; i++) assert.ok(new Date(evDesc[i - 1].createdAt) >= new Date(evDesc[i].createdAt));

  const d = (await call(`/approvals/${b._id}?order=desc`, "GET", undefined, t.rsom)).body.data;
  assert.deepEqual(d.versions.map((v: any) => v.version), [2, 1]);
  assert.equal(d.events[0].action, "APPROVED");
  assert.equal(d.comparison.fromVersion, 1); // comparison unaffected by ordering
  const dAsc = (await call(`/approvals/${b._id}`, "GET", undefined, t.rsom)).body.data;
  assert.deepEqual(dAsc.versions.map((v: any) => v.version), [1, 2]);
  assert.equal(dAsc.events[0].action, "CREATED");
});

test("activity timestamps: edit / submit / resubmit / approve / reject each tracked with their version", async () => {
  const t = await T();
  const { b, vehicle } = await newBudget("Activity Client");
  const none = (await call(`/budgets/vehicle/${vehicle._id}`, "GET", undefined, t.rbp)).body.data.activity;
  assert.equal(none.lastEdited.version, 1);
  assert.ok(none.createdAt && none.lastEdited.at);
  assert.equal(none.lastSubmitted, null);
  assert.equal(none.lastApproved, null);
  assert.equal(none.lastRejected, null);
  assert.equal(none.currentStatus, "DRAFT");

  await new Promise((r) => setTimeout(r, 15));
  await call(`/budgets/${b._id}`, "PUT", { ...budgetBody, haltFood: 1 }, t.rbp);
  const edited = (await call(`/budgets/vehicle/${vehicle._id}`, "GET", undefined, t.rbp)).body.data.activity;
  assert.equal(edited.lastEdited.version, 2);
  assert.ok(new Date(edited.lastEdited.at) > new Date(none.lastEdited.at));
  assert.equal(edited.createdAt, none.createdAt); // creation time never moves

  await call(`/budgets/${b._id}/submit`, "POST", {}, t.rbp);
  const sub = (await call(`/budgets/vehicle/${vehicle._id}`, "GET", undefined, t.rbp)).body.data.activity;
  assert.equal(sub.lastSubmitted.version, 2);
  assert.equal(sub.lastSubmitted.by, "RBP");
  assert.equal(sub.lastEdited.at, edited.lastEdited.at); // submit is not an edit
  assert.equal(sub.currentStatus, "PENDING");

  await new Promise((r) => setTimeout(r, 15));
  await call(`/approvals/${b._id}/reject`, "POST", { version: 2, reason: "r", fields: [{ field: "haltFood", comment: "c" }] }, t.rsom);
  const rej = (await call(`/approvals/${b._id}`, "GET", undefined, t.rsom)).body.data.activity;
  assert.equal(rej.lastRejected.version, 2);
  assert.equal(rej.lastRejected.by, "RSOM");
  assert.equal(rej.lastRejected.superseded, undefined);
  assert.equal(rej.lastApproved, null);
  assert.equal(rej.currentStatus, "REJECTED");

  await new Promise((r) => setTimeout(r, 15));
  await call(`/budgets/${b._id}`, "PUT", { ...budgetBody, haltFood: 2 }, t.rbp);
  await call(`/budgets/${b._id}/submit`, "POST", {}, t.rbp);
  const re = (await call(`/approvals/${b._id}`, "GET", undefined, t.rsom)).body.data.activity;
  assert.equal(re.lastResubmitted.version, 3);
  assert.equal(re.lastRejected.superseded, true); // old rejection must not look current
  assert.equal(re.lastRejected.at, rej.lastRejected.at); // historical timestamp untouched
  assert.equal(re.lastSubmitted.at, sub.lastSubmitted.at);
  assert.equal(re.currentStatus, "PENDING");

  await call(`/approvals/${b._id}/approve`, "POST", { version: 3 }, t.rsom);
  const ok = (await call(`/approvals/${b._id}`, "GET", undefined, t.rsom)).body.data.activity;
  assert.equal(ok.lastApproved.version, 3);
  assert.equal(ok.lastApproved.superseded, undefined);
  assert.equal(ok.lastRejected.superseded, true);
  assert.ok(new Date(ok.lastApproved.at) > new Date(ok.lastResubmitted.at));
  assert.equal(ok.currentStatus, "APPROVED");
  assert.equal(ok.lastEdited.version, 3);
  // every event keeps its own version and timestamp
  const ev = (await call(`/budgets/${b._id}/events`, "GET", undefined, t.rbp)).body.data;
  assert.equal(ev.find((e: any) => e.action === "REJECTED").version, 2);
  assert.equal(ev.find((e: any) => e.action === "REJECTED").createdAt, rej.lastRejected.at);
});

test("legacy budgets without any events or approval fields still produce a safe activity summary", async () => {
  const t = await T();
  const p = (await call("/tracking", "POST", { projectType: "SIGNAGE", details: signage("Old Client") }, t.rsop)).body.data;
  const b = await Budget.create({
    budgetNumber: "BUD-444444", vehicle: p.vehicles[0]._id, project: p._id, data: { permitCharges: 5 }, total: 5,
    currentVersion: 1, createdBy: "RBP", updatedBy: "RBP",
  });
  await BudgetVersion.create({ budget: b._id, version: 1, data: { permitCharges: 5 }, total: 5, changes: [], updatedBy: "RBP" });
  const r = await call(`/budgets/vehicle/${p.vehicles[0]._id}`, "GET", undefined, t.rbp);
  assert.equal(r.status, 200);
  const a = r.body.data.activity;
  assert.ok(a.createdAt);
  assert.equal(a.lastEdited.version, 1);
  assert.equal(a.lastSubmitted, null);
  assert.equal(a.lastApproved, null);
  assert.equal(a.currentStatus, "DRAFT");
  assert.deepEqual((await call(`/budgets/${b._id}/events?order=desc`, "GET", undefined, t.rbp)).body.data, []);
  assert.equal((await call(`/budgets/vehicle/${p.vehicles[0]._id}?order=desc`, "GET", undefined, t.rsom)).status, 403); // permissions unchanged
});

test("cleanup", async () => {
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
