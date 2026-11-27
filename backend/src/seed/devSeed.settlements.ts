/* eslint-disable @typescript-eslint/no-explicit-any */
import { User } from "../models/User.js";
import { SettlementPayment } from "../models/SettlementPayment.js";
import type { RoleKey } from "../config/roles.js";
import { completeSettlement, listEligibleProjects, reviewSettlement, settlementContext, submitSettlement } from "../services/settlement.service.js";

/**
 * Development-only: daily vehicle payments and final driver settlements in every workflow state, created through the real
 * services (validation, numbering, history, notifications). Idempotent: fixed submission keys, and a review / completion step
 * only runs while the entry is still in the state that step expects.
 */
type Plan = {
  daily: { offset: number; days: number; outcome: "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED" }[];
  final?: "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED";
};
const PLANS: Plan[] = [
  { daily: [{ offset: 0, days: 3, outcome: "COMPLETED" }, { offset: 3, days: 3, outcome: "APPROVED" }], final: "COMPLETED" },
  { daily: [{ offset: 0, days: 5, outcome: "APPROVED" }], final: "APPROVED" },
  { daily: [{ offset: 0, days: 2, outcome: "PENDING" }], final: "PENDING" },
  { daily: [{ offset: 0, days: 4, outcome: "REJECTED" }], final: "REJECTED" },
  { daily: [{ offset: 0, days: 3, outcome: "APPROVED" }, { offset: 3, days: 2, outcome: "PENDING" }] },
  { daily: [{ offset: 0, days: 2, outcome: "COMPLETED" }], final: "APPROVED" },
];

const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

async function actor(role: RoleKey) {
  const u: any = await User.findOne({ role }).sort({ createdAt: 1 }).lean();
  return u ? { username: u.username as string, role } : null;
}

export async function seedSettlements(add: (kind: string, created: boolean) => void): Promise<void> {
  const [rbp, rsom, rso, rsa] = await Promise.all([actor("RBP"), actor("RSOM"), actor("RSO"), actor("RSA")]);
  if (!rbp || !rsom || !rsa) return;
  const eligible = (await listEligibleProjects({ limit: 100 })).items.sort((x: any, y: any) => String(x.trackupNumber).localeCompare(String(y.trackupNumber)) || String(x.pifNumber).localeCompare(String(y.pifNumber)));

  for (const [i, plan] of PLANS.entries()) {
    const row: any = eligible[i];
    if (!row) break;
    const ctx = await settlementContext(row.trackingVehicle);
    // legacy records have their own Trackup Number (keys unchanged); a shared one needs the PIF to stay unique
    const ref = eligible.filter((x: any) => x.trackupNumber === row.trackupNumber).length > 1 ? `${ctx.trackupNumber}-${ctx.pifNumber}` : ctx.trackupNumber;
    const from = ctx.campaign.fromDate;
    if (!from) continue;

    for (const [j, dp] of plan.daily.entries()) {
      const key = `devseed-settle-${ref}-daily${j + 1}`.replace(/[^A-Za-z0-9_-]/g, "-");
      const had = await SettlementPayment.exists({ idempotencyKey: key });
      const fromDate = addDays(from, dp.offset);
      const { payment } = await submitSettlement("DAILY", row.trackingVehicle, {
        paymentFor: ctx.projectType, fromDate, toDate: addDays(fromDate, dp.days - 1), cashInHand: j === 0,
        dieselEntries: [{ amount: String(1800 + 350 * dp.days), mode: j === 0 ? "Cash" : "Fuel Card" }], foodAmount: String(250 * dp.days), salaryAdvance: j === 0 ? "1000" : "0",
        expenses: [{ optionKey: "TOLL", description: "NH toll plaza", amount: String(95 * dp.days) }, ...(dp.days > 3 ? [{ optionKey: "OTHERS", description: "Late reporting fine", amount: "200", deduct: true }] : [])],
        idempotencyKey: key,
      }, rbp.username);
      add("dailyPayments", !had);
      await settle(payment, dp.outcome, { rsom, rso, rsa }, "Toll receipts missing for two days; please attach and resubmit");
    }

    if (plan.final) {
      const key = `devseed-settle-${ref}-final`.replace(/[^A-Za-z0-9_-]/g, "-");
      const had = await SettlementPayment.exists({ idempotencyKey: key });
      if (!had && ctx.existingFinal) continue; // a final settlement for this driver was already entered by hand: never add a second one
      const p = ctx.prefill as any;
      const total = Math.max(3, Number(ctx.campaign.totalDays) || 10);
      const onRoad = Math.max(1, Math.min(total - 2, 12));
      const mileage = Number(p.fixedMileage) || 8;
      const km = onRoad * (Number(p.estimatedKmPerDay) || 80);
      const { payment } = await submitSettlement("FINAL", row.trackingVehicle, {
        jsNumber: p.jsNumber ?? undefined, location: p.location ?? undefined, reportingDate: ctx.campaign.reportingDate ?? from,
        estimatedKmPerDay: String(p.estimatedKmPerDay || 80), fixedMileage: String(mileage), openingKm: "48210", closingKm: String(48210 + km), dieselCost: "94.72",
        ioclLitres: String(Math.round((km / mileage) * 1.04 * 100) / 100), ioclKms: String(km - 20), estimatedBudget: String(p.estimatedBudget || 0), estimatedKm: String(p.estimatedKm || km),
        estimatedFuel: String(p.estimatedFuel || Math.round((km / mileage) * 100) / 100), perDaySalary: String(p.perDaySalary || 800), perDayFood: String(p.perDayFood || 250),
        travelPay: "1200", onRoadDays: String(onRoad), onRoadSundays: total - onRoad >= 2 ? "1" : "0",
        suspenseAmount: String(Math.min(Number(p.suspenseAmount) || 0, 2000)),
        expenses: [
          { category: "TOLL", description: "Mumbai-Pune expressway", quantity: "4", cost: "320" },
          { category: "PERMIT", description: "State entry permit", quantity: "1", cost: "1500" },
          { category: "SERVICE", description: "Brake pad replacement", quantity: "1", cost: "2400", approved: "2000" },
          { category: "OTHERS", description: "Parking at venue", quantity: String(onRoad), cost: "50" },
        ],
        driverChangeAmount: String(p.driverChangeAmount || 0),
        deductions: { mileageShort: "350", vehicleDamage: i === 0 ? "500" : "0", previousSalary: String(p.driverChangeAmount || 0), other: "0" },
        idempotencyKey: key,
      }, rbp.username);
      add("finalSettlements", !had);
      await settle(payment, plan.final, { rsom, rso, rsa }, "Closing KM does not match the speedometer photo; please recheck");
    }
  }
}

async function settle(p: any, outcome: Plan["final"], who: { rsom: any; rso: any; rsa: any }, rejectReason: string) {
  const approver = p.category === "DAILY" ? who.rsom : who.rso;
  if (!approver) return; // RSO login not configured: finals stay pending
  if (p.status === "PENDING" && p.version === 1 && outcome !== "PENDING")
    p = await reviewSettlement(p._id, outcome === "REJECTED" ? "REJECT" : "APPROVE", approver, outcome === "REJECTED" ? { reason: rejectReason } : { comment: "Verified against bills" });
  if (p.status === "APPROVED" && outcome === "COMPLETED")
    await completeSettlement(p._id, {
      referenceNumber: `UTR${p.paymentNumber.replace(/\D/g, "").slice(0, 12)}`, paymentDate: todayIst(), referenceDate: todayIst(), paymentMode: "EPAYMENT", bankName: "HDFC Bank, Fort Branch",
      transactionDetails: `NEFT UTR HDFCN${p.paymentNumber.replace(/\D/g, "")}`, remarks: "Batch paid by accounts",
    }, who.rsa.username);
}
