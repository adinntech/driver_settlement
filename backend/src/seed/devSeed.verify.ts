/* eslint-disable @typescript-eslint/no-explicit-any */
import { Budget, BudgetVersion } from "../models/Budget.js";
import { Clearance } from "../models/Clearance.js";
import { VehicleDelivery } from "../models/Delivery.js";
import { Driver } from "../models/Driver.js";
import { DriverAdvance } from "../models/DriverAdvance.js";
import { Notification } from "../models/Approval.js";
import { RsaPayment } from "../models/RsaPayment.js";
import { TrackingProject } from "../models/TrackingProject.js";
import { TrackingVehicle } from "../models/TrackingVehicle.js";
import { User } from "../models/User.js";
import { Vehicle } from "../models/Vehicle.js";
import { VehicleAllotment } from "../models/VehicleAllotment.js";
import type { RoleKey } from "../config/roles.js";
import { computeBudget, type BudgetInput } from "../validators/budget.validator.js";
import { DRIVERS, PROJECTS, SEED_TAG, VEHICLES, type ProjectSpec, type VehiclePlan } from "./devSeed.data.js";

/**
 * Checks the seeded data the way the four users see it: it signs in as RSOP, RBP, RSOM and RSA through the real HTTP API and
 * compares what each login can see with what the seed defined, then checks cross-record integrity directly in the database.
 * Read-only.
 */

type SeedRole = Exclude<RoleKey, "RSO">; // the seed covers the four project roles; RSO only sees settlement payments
export type Creds = Record<SeedRole, { username: string; password: string }>;
export interface Check { scope: string; name: string; ok: boolean; detail?: string }
export interface VerifyResult {
  checks: Check[];
  /** project key -> role -> number of that project's vehicles the login can see */
  visibility: Record<string, Record<SeedRole, number>>;
  failed: Check[];
}

const ROLES: SeedRole[] = ["RSOP", "RBP", "RSOM", "RSA"];
const round2 = (n: number) => Math.round(n * 100) / 100;

const expectBudget = (p: VehiclePlan): string | null => (p.budget ? p.budget.end : null);
const expectClearance = (p: VehiclePlan): string | null =>
  !p.clearance ? null : p.clearance.outcome === "APPROVE" ? "APPROVED" : p.clearance.outcome === "REJECT" ? "REJECTED" : "YET_TO_APPROVE";
const hasDriver = (p: VehiclePlan) => !!(p.allot?.driver || p.allot?.assignLaterDriver);

export async function verifyDevSeed(base: string, creds: Creds): Promise<VerifyResult> {
  const checks: Check[] = [];
  const check = (scope: string, name: string, ok: boolean, detail?: string) => checks.push({ scope, name, ok, ...(ok || !detail ? {} : { detail }) });
  const eq = (scope: string, name: string, actual: unknown, expected: unknown) =>
    check(scope, name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

  const call = async (token: string | null, path: string) => {
    const res = await fetch(base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const body: any = await res.json().catch(() => null);
    return { status: res.status, data: body?.data as any };
  };
  const tokens = {} as Record<SeedRole, string>;
  for (const role of ROLES) {
    const res = await fetch(`${base}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, username: creds[role].username, password: creds[role].password }),
    });
    const body: any = await res.json().catch(() => null);
    check(role, "login succeeds", res.status === 200 && !!body?.data?.token, `HTTP ${res.status}`);
    tokens[role] = body?.data?.token ?? "";
  }
  if (ROLES.some((r) => !tokens[r])) return { checks, visibility: {}, failed: checks.filter((c) => !c.ok) };

  const visibility: VerifyResult["visibility"] = Object.fromEntries(PROJECTS.map((p) => [p.key, { RSOP: 0, RBP: 0, RSOM: 0, RSA: 0 }]));

  // ---------------------------------------------------------------- RSOP and RBP: the tracking list
  const requestIds = new Map(PROJECTS.map((p) => [`${SEED_TAG}:${p.key}`, p]));
  const tvOf = new Map<string, { spec: ProjectSpec; plan: VehiclePlan; index: number; tv: any }>(); // tv id -> seed definition
  for (const role of ["RSOP", "RBP"] as const) {
    const r = await call(tokens[role], "/tracking");
    check(role, "tracking list loads", r.status === 200, `HTTP ${r.status}`);
    const rows: any[] = r.data ?? [];
    for (const spec of PROJECTS) {
      const row = rows.find((x) => x.requestId === `${SEED_TAG}:${spec.key}`);
      check(role, `${spec.key} ${spec.clientName} is visible`, !!row);
      if (!row) continue;
      eq(`${role}/${spec.key}`, "project type and vehicle count", [row.projectType, row.clientName, row.vehicles.length], [spec.type, spec.clientName, spec.vehicles.length]);
      for (const [i, plan] of spec.vehicles.entries()) {
        const tv = row.vehicles[i];
        eq(`${role}/${spec.key}#${i + 1}`, "budget approval status", tv.approvalStatus, expectBudget(plan));
        if (role === "RSOP") tvOf.set(String(tv._id), { spec, plan, index: i + 1, tv });
      }
      visibility[spec.key][role] = row.vehicles.length;
    }
    check(role, "no seeded project is duplicated", [...requestIds.keys()].every((k) => rows.filter((x) => x.requestId === k).length === 1));
  }

  // ---------------------------------------------------------------- RBP: budgets, allotments, on-road (clearance + delivery)
  for (const [tvId, { spec, plan, index }] of tvOf) {
    const scope = `RBP/${spec.key}#${index}`;
    if (!plan.budget) {
      const r = await call(tokens.RBP, `/budgets/vehicle/${tvId}`);
      eq(scope, "no budget yet", r.data?.budget ?? null, null);
      continue;
    }
    const r = await call(tokens.RBP, `/budgets/vehicle/${tvId}`);
    const b = r.data?.budget;
    check(scope, "budget loads", r.status === 200 && !!b, `HTTP ${r.status}`);
    if (!b) continue;
    eq(scope, "budget status", b.approvalStatus, plan.budget.end);
    eq(scope, "budget version (revisions)", b.currentVersion, plan.budget.v2 ? 2 : 1);
    const data = b.data as BudgetInput & { computed: Record<string, number> };
    const days = data.numberOfDays;
    const parts = [data.dieselAmount, data.salaryUnit === "PER_DAY" ? data.salaryAmount * days : data.salaryAmount, data.foodUnit === "PER_DAY" ? data.foodAmount * days : data.foodAmount,
      data.haltFood, data.tolls.reduce((s, t) => s + t.rate, 0), data.others.reduce((s, o) => s + o.amount, 0), data.upDownValue];
    const manual = round2(parts.reduce((s, x) => s + x, 0));
    eq(scope, "budget total = sum of its components", b.total, manual);
    eq(scope, "budget total = application calculation", b.total, computeBudget(data).totalValue);
    check(scope, "budget total is a positive INR amount", b.total > 0, String(b.total));
    const v = await call(tokens.RBP, `/budgets/${b._id}/versions`);
    eq(scope, "version history is complete", (v.data ?? []).map((x: any) => x.version), plan.budget.v2 ? [1, 2] : [1]);
    const last = (v.data ?? []).at(-1);
    eq(scope, "latest version total matches the budget", last?.total, b.total);
  }

  const allots = await call(tokens.RBP, "/vehicle-allotments?limit=100");
  check("RBP", "allotment list loads", allots.status === 200, `HTTP ${allots.status}`);
  const onRoad = await call(tokens.RBP, "/on-road-vehicles?limit=100");
  check("RBP", "on-road list loads", onRoad.status === 200, `HTTP ${onRoad.status}`);
  const rsaList = await call(tokens.RSA, "/rsa-clearances?limit=100");
  check("RSA", "clearance list loads", rsaList.status === 200, `HTTP ${rsaList.status}`);
  const eligible = await call(tokens.RSA, "/rsa/projects?limit=100");
  check("RSA", "payment projects list loads", eligible.status === 200, `HTTP ${eligible.status}`);
  const approvals = await call(tokens.RSOM, "/approvals?limit=100");
  check("RSOM", "approval list loads", approvals.status === 200, `HTTP ${approvals.status}`);

  const bySpec = (rows: any[] | undefined, pif: string, key = "pifNumber") => (rows ?? []).filter((x) => x[key] === pif);
  const rbpClearances = new Map<string, any>();

  for (const [tvId, { spec, plan, index, tv }] of tvOf) {
    const scope = `${spec.key}#${index}`;
    const pif = tv.pifNumber as string; // the Trackup Number is shared between vehicles

    // RBP: allotments (the full chain, newest first)
    const rows = bySpec(allots.data?.items, pif);
    if (plan.allot) {
      const expectedRows = 1 + (plan.allot.changeVehicleTo ? 1 : 0);
      eq(`RBP/${scope}`, "allotment rows (original + replacement)", rows.length, expectedRows);
      const active = rows.filter((x) => x.status === "ACTIVE");
      eq(`RBP/${scope}`, "active allotments", active.length, plan.allot.release ? 0 : 1);
      if (plan.allot.release) eq(`RBP/${scope}`, "released allotment", rows.filter((x) => x.status === "RELEASED").length, 1);
      const current = rows.find((x) => x.status === "ACTIVE") ?? rows.find((x) => x.status === "RELEASED");
      const finalVehicle = VEHICLES.find((v) => v.key === (plan.allot!.changeVehicleTo?.vehicle ?? plan.allot!.vehicle))!;
      eq(`RBP/${scope}`, "current vehicle", current?.vehicleNo, finalVehicle.vehicleNo);
      const finalDriver = DRIVERS.find((x) => x.key === (plan.allot!.changeDriverTo?.driver ?? plan.allot!.driver ?? plan.allot!.assignLaterDriver));
      eq(`RBP/${scope}`, "current driver", current?.driverNumber ? current.driverName : null, finalDriver ? finalDriver.name : null);
    } else eq(`RBP/${scope}`, "no allotment", rows.length, 0);

    // RBP on-road + RSA clearance: same underlying record
    const exp = expectClearance(plan);
    const cRbp = bySpec(onRoad.data?.items, pif)[0];
    const cRsa = bySpec(rsaList.data?.items, pif)[0];
    if (exp) {
      check(`RBP/${scope}`, "on-road row exists", !!cRbp);
      check(`RSA/${scope}`, "clearance row exists", !!cRsa);
      eq(`RBP/${scope}`, "clearance status", cRbp?.status, exp);
      eq(`RSA/${scope}`, "clearance status", cRsa?.status, exp);
      if (exp === "APPROVED") {
        eq(`RBP/${scope}`, "delivery status", cRbp?.deliveryStatus, plan.clearance!.deliver ? "DELIVERED" : "YET_TO_DELIVER");
        eq(`RSA/${scope}`, "delivery status", cRsa?.deliveryStatus, plan.clearance!.deliver ? "DELIVERED" : "YET_TO_DELIVER");
      }
      if (plan.clearance!.outcome === "REJECT_RESUBMIT") eq(`RBP/${scope}`, "resubmitted as version 2", cRbp?.version, 2);
      if (cRsa) {
        const detail = await call(tokens.RSA, `/rsa-clearances/${cRsa._id}`);
        check(`RSA/${scope}`, "clearance detail loads", detail.status === 200, `HTTP ${detail.status}`);
        if (plan.clearance!.outcome === "PENDING" && DRIVERS.find((x) => x.key === plan.allot?.driver)?.advances)
          eq(`RSA/${scope}`, "advance verification blocks approval", detail.data?.canApprove, false);
      }
      if (cRbp) rbpClearances.set(tvId, cRbp);
    } else {
      check(`RBP/${scope}`, "no clearance row", !cRbp);
    }

    // RSOM: every submitted budget
    const submitted = plan.budget && plan.budget.end !== "DRAFT";
    const aRow = bySpec(approvals.data?.items, pif)[0];
    if (submitted) {
      check(`RSOM/${scope}`, "budget is in the approval list", !!aRow);
      eq(`RSOM/${scope}`, "approval status", aRow?.status, plan.budget!.end);
      if (aRow) {
        const dr = await call(tokens.RSOM, `/approvals/${aRow.budgetId}`);
        check(`RSOM/${scope}`, "review detail loads", dr.status === 200, `HTTP ${dr.status}`);
        eq(`RSOM/${scope}`, "review shows the whole history", (dr.data?.versions ?? []).length, plan.budget!.v2 ? 2 : 1);
        visibility[spec.key].RSOM += 1;
      }
    } else check(`RSOM/${scope}`, "draft / missing budget is not shown to RSOM", !aRow);

    // RSA: payment-eligible projects (approved budget + allotment with a driver) and their payment history
    const eligibleRow = bySpec(eligible.data?.items, pif)[0];
    const shouldBeEligible = plan.budget?.end === "APPROVED" && hasDriver(plan);
    eq(`RSA/${scope}`, "eligible for payment entry", !!eligibleRow, shouldBeEligible);
    if (eligibleRow) {
      visibility[spec.key].RSA += 1;
      const pay = await call(tokens.RSA, `/rsa/projects/${tvId}/payments`);
      eq(`RSA/${scope}`, "payment entries", pay.data?.total, plan.payments?.length ?? 0);
      const ctx = await call(tokens.RSA, `/rsa/projects/${tvId}`);
      check(`RSA/${scope}`, "project payment screen loads", ctx.status === 200, `HTTP ${ctx.status}`);
      eq(`RSA/${scope}`, "approved budget amount shown", ctx.data?.approvedBudgetAmount, (await Budget.findOne({ vehicle: tvId }).lean() as any)?.total);
    }
  }

  // RBP: lists of vehicles and drivers
  const vList = await call(tokens.RBP, "/vehicles?limit=100");
  const dList = await call(tokens.RBP, "/drivers?limit=100");
  for (const v of VEHICLES) check("RBP", `vehicle ${v.vehicleNo} is listed`, (vList.data?.items ?? []).some((x: any) => x.vehicleNo === v.vehicleNo));
  for (const x of DRIVERS) check("RBP", `driver ${x.name} is listed`, (dList.data?.items ?? []).some((y: any) => y.mobileDigits === x.mobile));

  // every project must be reachable by all four logins
  for (const spec of PROJECTS)
    for (const role of ROLES) check(`${role}/${spec.key}`, `${spec.clientName}: at least one vehicle visible`, visibility[spec.key][role] > 0, "not visible");

  // ---------------------------------------------------------------- notifications reached the roles that act on the workflow
  for (const role of ["RBP", "RSOM", "RSA"] as const) {
    const n = await call(tokens[role], "/notifications");
    check(role, "has workflow notifications", (n.data?.items ?? []).length > 0, "none");
  }

  await integrity(check, eq);
  return { checks, visibility, failed: checks.filter((c) => !c.ok) };
}

// ---------------------------------------------------------------- database integrity

async function integrity(check: (s: string, n: string, ok: boolean, d?: string) => void, eq: (s: string, n: string, a: unknown, e: unknown) => void) {
  const S = "integrity";
  const projects: any[] = await TrackingProject.find({ requestId: new RegExp(`^${SEED_TAG}:`) }).lean();
  eq(S, "10 seeded projects", projects.length, 10);
  const projectIds = projects.map((p) => p._id);
  const tvs: any[] = await TrackingVehicle.find({ project: { $in: projectIds } }).lean();
  eq(S, "seeded project vehicles", tvs.length, PROJECTS.reduce((s, p) => s + p.vehicles.length, 0));
  const tvIds = tvs.map((x) => x._id);
  const tvSet = new Set(tvIds.map(String));
  const unique = (xs: unknown[]) => new Set(xs.map(String)).size === xs.length;
  check(S, "PIF numbers are unique", unique(tvs.map((x) => x.pifNumber)));

  // budgets: references, totals, versions
  const budgets: any[] = await Budget.find({ project: { $in: projectIds } }).lean();
  for (const b of budgets) {
    const versions: any[] = await BudgetVersion.find({ budget: b._id }).sort({ version: 1 }).lean();
    const ok = versions.length === b.currentVersion && versions.every((v, i) => v.version === i + 1 && v.total === computeBudget(v.data).totalValue);
    check(S, `budget ${b.budgetNumber}: versions and totals are consistent`, ok && b.total === computeBudget(b.data).totalValue && tvSet.has(String(b.vehicle)));
    if (b.approvalStatus === "APPROVED") check(S, `budget ${b.budgetNumber}: approved version is the current version`, b.approvedVersion === b.currentVersion && versions.at(-1)?.total === b.total);
    const tv = tvs.find((x) => String(x._id) === String(b.vehicle));
    check(S, `budget ${b.budgetNumber}: tracking vehicle marked CREATED`, tv?.budgetStatus === "CREATED");
  }

  // allotments: no duplicate vehicle / driver / project-vehicle assignment, references exist
  const allots: any[] = await VehicleAllotment.find({ trackingVehicle: { $in: tvIds } }).lean();
  const active = allots.filter((a) => a.status === "ACTIVE");
  check(S, "no vehicle is on two active allotments", unique(active.map((a) => a.vehicle)));
  check(S, "no project vehicle has two active allotments", unique(active.map((a) => a.trackingVehicle)));
  const withDriver = active.filter((a) => a.activeDriver);
  check(S, "no driver is on two active allotments", unique(withDriver.map((a) => a.activeDriver)));
  const allAllots: any[] = await VehicleAllotment.find({ status: "ACTIVE" }).lean();
  check(S, "no vehicle / driver is double-assigned anywhere in the database", unique(allAllots.map((a) => a.vehicle)) && unique(allAllots.filter((a) => a.activeDriver).map((a) => a.activeDriver)));
  for (const a of allots) {
    const [v, d, b] = await Promise.all([Vehicle.exists({ _id: a.vehicle }), a.driver ? Driver.exists({ _id: a.driver }) : true, Budget.exists({ _id: a.budget, approvalStatus: "APPROVED" })]);
    check(S, `allotment ${a.trackupNumber} (${a.vehicleNo}): references are valid and budget approved`, !!v && !!d && !!b && tvSet.has(String(a.trackingVehicle)));
  }
  // vehicles / drivers marked In Use must match the active allotments exactly
  const seededNos = VEHICLES.map((v) => v.vehicleNo);
  const inUse: any[] = await Vehicle.find({ vehicleNo: { $in: seededNos }, "availability.status": "IN_USE" }).lean();
  eq(S, "vehicles In Use = active allotments", inUse.map((v) => v.vehicleNo).sort(), active.map((a) => a.vehicleNo).sort());
  for (const a of active) {
    const v = inUse.find((x) => String(x._id) === String(a.vehicle));
    check(S, `vehicle ${a.vehicleNo} In Use on ${a.trackupNumber}`, v?.availability?.project?.trackupNumber === a.trackupNumber);
  }
  const mobiles = DRIVERS.map((x) => x.mobile);
  const drvInUse: any[] = await Driver.find({ mobileDigits: { $in: mobiles }, "availability.status": "IN_USE" }).lean();
  eq(S, "drivers In Use = active allotments with a driver", drvInUse.map((x) => String(x._id)).sort(), withDriver.map((a) => String(a.activeDriver)).sort());

  // clearances, deliveries, advances, payments
  const clears: any[] = await Clearance.find({ trackingVehicle: { $in: tvIds } }).lean();
  eq(S, "clearances (one per allotment with a driver)", clears.length, PROJECTS.flatMap((p) => p.vehicles).filter((v) => v.clearance).length);
  for (const c of clears) {
    const [al, ve, dr] = await Promise.all([VehicleAllotment.exists({ _id: c.allotment }), Vehicle.exists({ _id: c.vehicle }), Driver.exists({ _id: c.driver })]);
    check(S, `clearance ${c.trackupNumber}: references are valid`, !!al && !!ve && !!dr);
    if (c.deliveryStatus === "DELIVERED") {
      const dv: any = await VehicleDelivery.findOne({ clearance: c._id, approvalVersion: c.currentVersion }).lean();
      check(S, `delivery ${c.trackupNumber}: record and both photos exist`, !!dv && !!dv.speedometerPhoto?.key && !!dv.evidencePhoto?.key);
    }
  }
  // a driver with an advance on record must never be on an APPROVED clearance (the system could not verify it)
  const advDrivers = new Set((await DriverAdvance.distinct("driver", { driver: { $in: (await Driver.find({ mobileDigits: { $in: mobiles } }).select("_id").lean()).map((x: any) => x._id) } })).map(String));
  check(S, "no approved clearance belongs to a driver with an unverified advance", clears.filter((c) => c.status === "APPROVED").every((c) => !advDrivers.has(String(c.driver))));
  const advances: any[] = await DriverAdvance.find({ driver: { $in: [...advDrivers] } }).lean();
  eq(S, "driver advances", advances.length, DRIVERS.reduce((s, x) => s + (x.advances?.length ?? 0), 0));
  check(S, "advance amounts follow the rule (half of working days x salary, rounded down to 500)", advances.every((a) => a.finalAdvanceAmount === Math.floor(a.workingDays * a.perDaySalary / 2 / 500) * 500 && a.finalAdvanceAmount > 0));
  const pays: any[] = await RsaPayment.find({ trackingVehicle: { $in: tvIds } }).lean();
  eq(S, "RSA payments", pays.length, PROJECTS.flatMap((p) => p.vehicles).reduce((s, v) => s + (v.payments?.length ?? 0), 0));
  for (const p of pays) {
    const diesel = (p.dieselEntries ?? []).reduce((s: number, x: any) => s + x.amount, 0);
    const total = round2(diesel + p.foodAmount + p.salaryAdvance + p.expenseTotal - p.deductTotal);
    check(S, `payment ${p.paymentNumber}: total payable = diesel + food + advance + expenses - deductions`, total === p.totalPayable && p.dieselTotal === round2(diesel), `${total} vs ${p.totalPayable}`);
  }
  check(S, "payment numbers are unique", unique(pays.map((p) => p.paymentNumber)));
  check(S, "all four seed logins exist", (await User.countDocuments({ role: { $in: ["RSOP", "RBP", "RSOM", "RSA"] } })) >= 4);
  const unreadOk = (await Notification.countDocuments()) > 0;
  check(S, "notifications were generated by the workflow", unreadOk);
}
