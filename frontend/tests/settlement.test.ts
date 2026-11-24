import test from "node:test";
import assert from "node:assert/strict";
import { actionsFor, emptyQueueFilters, finalFormFrom, finalPayload, finalTotals, queueQuery, validateFinalForm, type FinalForm, type SettlementContext } from "../src/utils/settlement";

const ctx = {
  trackingVehicle: "a".repeat(24), trackupNumber: "TRK-1", pifNumber: "PIF-1", clientName: "Client", projectType: "ROADSHOW", vehicleNo: "MH12AB1234", driverNumber: "DR-1", driverName: "Ravi",
  approvedBudgetAmount: 50000, budgetVersion: 1, campaign: { fromDate: "2026-11-01", toDate: "2026-11-30", totalDays: 30, location: "Pune", jsNumber: "JS-9", reportingDate: "2026-11-01" },
  bank: { accountName: null, bankName: null, ifscCode: null, accountMasked: null }, existingFinal: null,
  prefill: { jsNumber: "JS-9", location: "Pune", fixedMileage: 8, perDaySalary: 800, perDayFood: 250, haltDayPay: 300, driverChangeTravel: 750, suspenseAmount: 1000 },
} as unknown as SettlementContext;

const form = (patch: Partial<FinalForm["n"]> = {}, rest: Partial<FinalForm> = {}): FinalForm => {
  const f = finalFormFrom(ctx);
  return { ...f, ...rest, n: { ...f.n, openingKm: "10000", closingKm: "10800", dieselCost: "95.50", ioclLitres: "110", onRoadDays: "20", onRoadSundays: "3", haltDays: "2", travelPay: "1500", ...patch } };
};

test("final form is prefilled from the project context", () => {
  const f = finalFormFrom(ctx);
  assert.equal(f.jsNumber, "JS-9");
  assert.equal(f.n.perDaySalary, "800");
  assert.equal(f.deductions.driverChangeTravel, "750");
  assert.equal(f.n.suspenseAmount, "1000");
});

test("final totals mirror the server calculation (paise)", () => {
  const f = form({}, { expenses: [{ id: "1", category: "TOLL", description: "", quantity: "4", cost: "150", approved: "" }, { id: "2", category: "SERVICE", description: "Oil", quantity: "1", cost: "1200", approved: "1000" }] });
  const t = finalTotals(f);
  assert.equal(t.resultKm, 800);
  assert.equal(t.variationLitres, 10);
  assert.equal(t.mileageShortSuggested, 95500);
  const earnings = (20 * 800 + 3 * 800 + 23 * 250 + 2 * 300 + 1500) * 100;
  assert.equal(t.earningsTotal, earnings);
  assert.equal(t.claimed, 180000);
  assert.equal(t.approved, 160000);
  assert.equal(t.rejected, 20000);
  assert.equal(t.totalDeduction, 75000);
  assert.equal(t.net, earnings + 160000 - 75000 - 100000);
});

test("final form validation", () => {
  assert.deepEqual(validateFinalForm(form(), 30), []);
  assert.match(validateFinalForm(form({ closingKm: "9000" }), 30).join(), /Closing KM/);
  assert.match(validateFinalForm(form({ onRoadDays: "40" }), 30).join(), /cannot exceed/);
  assert.match(validateFinalForm(form({ fixedMileage: "" }), 30).join(), /Fixed Mileage/);
  assert.match(validateFinalForm(form({}, { expenses: [{ id: "1", category: "OTHERS", description: "", quantity: "1", cost: "10", approved: "" }] }), 30).join(), /description is required/);
  assert.match(validateFinalForm(form({}, { expenses: [{ id: "1", category: "TOLL", description: "", quantity: "1", cost: "10", approved: "20" }] }), 30).join(), /cannot be more than the claimed/);
  assert.match(validateFinalForm(form({ suspenseAmount: "9999999" }), 30).join(), /more than the gross/);
  const p = finalPayload(form(), "key12345");
  assert.equal(p.idempotencyKey, "key12345");
  assert.equal((p as Record<string, unknown>).onRoadDays, "20");
});

test("role actions follow the approval rules", () => {
  const daily = { status: "PENDING", approver: "RSOM", category: "DAILY" } as const;
  const final = { status: "PENDING", approver: "RSO", category: "FINAL" } as const;
  assert.equal(actionsFor("RSOM", daily).canDecide, true);
  assert.equal(actionsFor("RSO", daily).canDecide, false);
  assert.equal(actionsFor("RSO", final).canDecide, true);
  assert.equal(actionsFor("RSOM", final).canDecide, false);
  assert.equal(actionsFor("RSA", { ...final, status: "APPROVED" }).canComplete, true);
  assert.equal(actionsFor("RSA", { ...final, status: "APPROVED" }).canPdf, true);
  assert.equal(actionsFor("RSO", final).canPdf, false, "no salary PDF before approval");
  assert.equal(actionsFor("RBP", { ...daily, status: "REJECTED" }).canResubmit, true);
});

test("queue query keeps category, status, search and sorting", () => {
  const q = new URLSearchParams(queueQuery({ ...emptyQueueFilters("FINAL", "APPROVED"), q: " Ravi " }, 2, 25));
  assert.equal(q.get("category"), "FINAL");
  assert.equal(q.get("status"), "APPROVED");
  assert.equal(q.get("q"), "Ravi");
  assert.equal(q.get("page"), "2");
  assert.equal(q.get("sort"), "submittedAt");
});

test("Driver Payments is shared: RBP and RSA enter and correct the same records under their own routes", async () => {
  const { paymentsBase, ENTRY_ROLES } = await import("../src/utils/settlement");
  const { NAV } = await import("../src/components/AppShell");
  assert.deepEqual([...ENTRY_ROLES], ["RBP", "RSA"]);
  assert.equal(paymentsBase("RBP"), "/rbp/payments");
  assert.equal(paymentsBase("RSA"), "/rsa/driver-payments");
  assert.ok(NAV.RBP.some((n) => n.href === "/rbp/payments" && n.label === "Driver Payments"));
  assert.ok(NAV.RSA.some((n) => n.href === "/rsa/driver-payments" && n.label === "Driver Payments"));
  const rejected = { status: "REJECTED", approver: "RSOM", category: "DAILY" } as const;
  assert.equal(actionsFor("RSA", rejected).canResubmit, true, "RSA can correct a rejected shared entry");
  assert.equal(actionsFor("RBP", rejected).canResubmit, true);
  assert.equal(actionsFor("RSOM", rejected).canResubmit, false);
  assert.equal(actionsFor("RBP", { ...rejected, status: "APPROVED" }).canComplete, false, "completion stays with RSA");
});
