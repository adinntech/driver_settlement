/* eslint-disable @typescript-eslint/no-explicit-any */
import { SettlementPayment } from "../models/SettlementPayment.js";
import { AllotmentEvent } from "../models/VehicleAllotment.js";

/**
 * Travel Amount Deductions of Change Driver still owed by one driver (the one who was REPLACED). They are recovered once, as part of
 * Previous Salary Deduction, on that driver's next Final Settlement on any project.
 *  - claimed: a final that is not rejected lists the change events it recovers (data.driverChangeEvents); rejecting it frees them.
 *  - settlements saved before this carried "driverChangeTravel": the changes of that allotment up to their submission count as recovered.
 * Nothing is written here; the caller serialises read + save with a per-driver lock.
 */
export async function pendingDriverChange(driverId: string, exceptPaymentId?: string): Promise<{ amount: number; events: string[] }> {
  const [events, finals]: any[][] = await Promise.all([
    AllotmentEvent.find({ action: "DRIVER_CHANGED", "details.from.driverId": driverId }).sort({ createdAt: 1 }).lean(),
    SettlementPayment.find({ driver: driverId, category: "FINAL", status: { $ne: "REJECTED" }, ...(exceptPaymentId ? { _id: { $ne: exceptPaymentId } } : {}) })
      .select("allotment submittedAt data.driverChangeEvents data.deductions.driverChangeTravel").lean(),
  ]);
  const claimed = new Set<string>(finals.flatMap((p) => p.data?.driverChangeEvents ?? []));
  const old = finals.filter((p) => !p.data?.driverChangeEvents && Number(p.data?.deductions?.driverChangeTravel) > 0);
  const open = events.filter((e) =>
    Number(e.details?.travelAmountDeduction) > 0 && !claimed.has(String(e._id))
    && !old.some((p) => String(p.allotment) === String(e.allotment) && e.createdAt <= p.submittedAt));
  const paise = open.reduce((s, e) => s + Math.round(Number(e.details.travelAmountDeduction) * 100), 0);
  return { amount: paise / 100, events: open.map((e) => String(e._id)) };
}
