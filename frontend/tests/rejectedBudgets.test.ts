import test from "node:test";
import assert from "node:assert/strict";
import { matchesStatus, STATUS_FILTERS } from "../src/utils/projectStatus";
import { canEdit, canSelfCorrect } from "../src/utils/budgetDescribe";
import { unviewedRejection } from "../src/utils/rejectionViews";
import type { Project } from "../src/types/domain";

const project = (...vehicles: [string, string | null][]) =>
  ({ vehicles: vehicles.map(([budgetStatus, approvalStatus]) => ({ budgetStatus, approvalStatus })) }) as unknown as Project;

test("status filters", () => {
  assert.deepEqual(STATUS_FILTERS.map((s) => s.label), ["All", "Pending Approval", "Rejected", "Approved", "Partially Budgeted", "Budget Created"]);
  const mixed = project(["CREATED", "REJECTED"], ["PENDING", null]);
  const full = project(["CREATED", "PENDING"], ["CREATED", "APPROVED"]);
  const matching = (p: Project) => STATUS_FILTERS.filter((s) => matchesStatus(p, s.value)).map((s) => s.label);
  assert.deepEqual(matching(mixed), ["All", "Rejected", "Partially Budgeted"]);
  assert.deepEqual(matching(full), ["All", "Pending Approval", "Approved", "Budget Created"]);
  assert.deepEqual(matching(project(["PENDING", null])), ["All"]);
});

test("only an unseen current rejection is marked as viewed", () => {
  assert.equal(unviewedRejection({ approvalStatus: "REJECTED", rejectedVersion: 2 }), 2);
  assert.equal(unviewedRejection({ approvalStatus: "REJECTED", rejectedVersion: 3, rejectionViewedVersion: 2 }), 3);
  assert.equal(unviewedRejection({ approvalStatus: "REJECTED", rejectedVersion: 2, rejectionViewedVersion: 2 }), null);
  assert.equal(unviewedRejection({ approvalStatus: "APPROVED", rejectedVersion: 2 }), null);
  assert.equal(unviewedRejection(null), null);
});

test("a reason is asked only to correct a first submission that RSOM has not reviewed", () => {
  assert.equal(canSelfCorrect({ approvalStatus: "PENDING" }), true);
  assert.equal(canSelfCorrect({ approvalStatus: "PENDING", selfRevisedVersion: 2 }), false);
  assert.equal(canSelfCorrect({ approvalStatus: "PENDING", rejectedVersion: 1 }), false);
  for (const approvalStatus of ["DRAFT", "REJECTED", "APPROVED"]) assert.equal(canSelfCorrect({ approvalStatus }), false);
  assert.equal(canEdit("REJECTED"), true);
  assert.equal(canEdit("APPROVED"), false);
});
