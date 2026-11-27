/* eslint-disable @typescript-eslint/no-explicit-any */
import { deflateSync, crc32 } from "node:zlib";
import { config } from "../config/index.js";
import { Budget, BudgetVersion } from "../models/Budget.js";
import { BudgetEvent, Notification } from "../models/Approval.js";
import { Clearance, ClearanceEvent } from "../models/Clearance.js";
import { DeliveryEvent, VehicleDelivery } from "../models/Delivery.js";
import { Driver, DriverHistory } from "../models/Driver.js";
import { DriverAdvance } from "../models/DriverAdvance.js";
import { Counter, RsaPayment } from "../models/RsaPayment.js";
import { TrackingProject } from "../models/TrackingProject.js";
import { TrackingVehicle } from "../models/TrackingVehicle.js";
import { User } from "../models/User.js";
import { Vehicle, VehicleHistory } from "../models/Vehicle.js";
import { AllotmentEvent, VehicleAllotment } from "../models/VehicleAllotment.js";
import type { RoleKey } from "../config/roles.js";
import { submitAdvance } from "../services/advance.service.js";
import { allotVehicle, changeVehicle, extendAllotment, releaseAllotment } from "../services/allotment.service.js";
import { assignDriver, changeDriver } from "../services/allotmentDriver.service.js";
import { approveBudget, rejectBudget, submitBudget } from "../services/approval.service.js";
import { seedUsers } from "../services/auth.service.js";
import { createBudget, updateBudget } from "../services/budget.service.js";
import { approveClearance, rejectClearance, resubmitClearance, syncClearances } from "../services/clearance.service.js";
import { deliverVehicle, uploadDeliveryPhoto } from "../services/delivery.service.js";
import { createDriver } from "../services/driver.service.js";
import { createPayment } from "../services/rsa.service.js";
import { SettlementPayment, SettlementPaymentEvent } from "../models/SettlementPayment.js";
import { seedSettlements } from "./devSeed.settlements.js";
import { createTracking } from "../services/tracking.service.js";
import { createVehicle, updateVehicle } from "../services/vehicle.service.js";
import { addDays, todayYmd } from "../validators/vehicle.validator.js";
import {
  DRIVERS, ISSUE_FOR_V04, ISSUE_FOR_V16, PROJECTS, SEED_TAG, VEHICLES,
  type AllotPlan, type BudgetParams, type BudgetPlan, type ClearancePlan, type DriverSpec, type PaymentPlan, type ProjectSpec, type VehiclePlan, type VehicleSpec,
} from "./devSeed.data.js";

/**
 * Seeds the 10 development projects through the application's own services, so every validation, calculation, state rule,
 * history row and notification is the real one. Nothing is deleted or overwritten, and every step first checks whether its
 * result already exists, so the command can be re-run (or resumed after a failure) safely.
 */

export interface Actor { id: string; username: string }
export type Actors = Record<RoleKey, Actor>;

export interface SeedReport {
  created: Record<string, number>;
  existing: Record<string, number>;
  /** one row per project vehicle: handy for the CLI summary */
  vehicles: { project: string; client: string; index: number; trackupNumber: string; pifNumber: string }[];
}

// ---------------------------------------------------------------- safety

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Hosts named in a MongoDB connection string (credentials and options are never looked at beyond the host part). */
export function mongoHosts(uri: string): string[] | null {
  const m = /^mongodb(\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/i.exec(uri);
  if (!m || m[1]) return null; // mongodb+srv is always a remote cluster
  return m[2].split(",").map((h) => h.replace(/:\d+$/, "").toLowerCase());
}

/** The seed is for development databases only. Throws (before anything is touched) when the environment is not one. */
export function assertDevOnly(): void {
  if (config.env !== "development" && config.env !== "test")
    throw new Error(`Refusing to seed: NODE_ENV is "${config.env}". The dev seed only runs when NODE_ENV is "development" (or "test").`);
  const hosts = mongoHosts(config.mongoUri);
  const local = !!hosts && hosts.length > 0 && hosts.every((h) => LOCAL_HOSTS.has(h));
  if (!local && process.env.DEV_SEED_ALLOW_REMOTE_DB !== "true")
    throw new Error("Refusing to seed: MONGO_URI does not point at a local MongoDB. Set DEV_SEED_ALLOW_REMOTE_DB=true only if this really is a throw-away development database.");
  if (config.storage.type !== "local")
    throw new Error(`Refusing to seed: STORAGE_TYPE is "${config.storage.type}". Delivery photos would be uploaded to cloud storage; use STORAGE_TYPE=local for the dev seed.`);
}

// ---------------------------------------------------------------- bookkeeping

const today = todayYmd();
const d = (n: number) => addDays(today, n);

export class Tally {
  created: Record<string, number> = {};
  existing: Record<string, number> = {};
  add(kind: string, wasCreated: boolean) {
    const t = wasCreated ? this.created : this.existing;
    t[kind] = (t[kind] ?? 0) + 1;
  }
}

export async function loadActors(): Promise<Actors> {
  await seedUsers(); // creates only the env-configured logins that are missing; never touches an existing user
  const out: Partial<Actors> = {};
  for (const role of ["RSOP", "RBP", "RSOM", "RSA"] as RoleKey[]) {
    const u: any = await User.findOne({ role }).sort({ createdAt: 1 }).lean();
    if (!u) throw new Error(`No ${role} user exists. Set ${role}_USERNAME and ${role}_PASSWORD in backend/.env (or create the login) and run again.`);
    out[role] = { id: String(u._id), username: u.username };
  }
  return out as Actors;
}

// ---------------------------------------------------------------- drivers

const driverInput = (s: DriverSpec) => {
  const av =
    s.state === "NOT_AVAILABLE"
      ? { status: "NOT_AVAILABLE", notAvailable: { reason: "Medical leave: recovering after a minor surgery", category: "Medical Leave", fromDate: d(-4), expectedAvailableDate: d(10), remarks: "Doctor's note submitted to the depot" } }
      : s.state === "INACTIVE"
        ? { status: "NOT_AVAILABLE", notAvailable: { reason: "Resigned from the company", category: "Other", fromDate: d(-20), remarks: "Exit formalities completed" } }
        : { status: "AVAILABLE", availableFromDate: d(-60), availableFromTime: "09:00" };
  return {
    driverName: s.name, driverType: s.type, address: s.address, mobileNumber: s.mobile,
    accountName: s.bank.accountName, bankName: s.bank.bankName, accountNumber: s.bank.accountNumber, ifscCode: s.bank.ifsc,
    licenceNumber: s.licence, licenceType: s.licenceType, licenceExpiryDate: s.licenceExpiry, salary: s.salary,
    ...(s.state === "INACTIVE" ? { status: "INACTIVE" } : {}), availability: av,
  };
};

export async function ensureDriver(s: DriverSpec, rbp: Actor, t: Tally): Promise<any> {
  const found: any = await Driver.findOne({ mobileDigits: s.mobile }).lean();
  if (found) { t.add("drivers", false); return found; }
  const created = await createDriver(driverInput(s), rbp.username);
  t.add("drivers", true);
  return created;
}

async function ensureAdvances(s: DriverSpec, driver: any, rbp: Actor, t: Tally) {
  for (const [i, days] of (s.advances ?? []).entries()) {
    const key = `devseed-adv-${s.key}-${i + 1}`;
    const had = await DriverAdvance.exists({ driver: driver._id, idempotencyKey: key });
    await submitAdvance(String(driver._id), { workingDays: days, idempotencyKey: key }, rbp.username);
    t.add("driverAdvances", !had);
  }
}

// ---------------------------------------------------------------- vehicles

const vehicleBase = (s: VehicleSpec) => ({
  vehicleNo: s.vehicleNo, make: s.make, model: s.model, type: s.type, yearOfManufacture: s.year, purchaseDate: s.purchaseDate,
  currentRunning: s.currentRunning, totalRunning: s.totalRunning, stepneyStatus: s.stepney, batteryStatus: s.battery,
  oilTopUpOn: d(-35), greasePackingOn: d(-50), generalCheckUpOn: d(-20),
  fc: [{ nextRenewalDate: d(s.fcDays - 365), attachment: null }, { nextRenewalDate: d(s.fcDays), attachment: null }],
  insurance: [{ nextRenewalDate: d(s.insuranceDays - 365), attachment: null }, { nextRenewalDate: d(s.insuranceDays), attachment: null }],
  rtoPermission: [{ nextRenewalDate: d(s.permitDays), attachment: null }],
  policePermission: [{ nextRenewalDate: d(s.permitDays - 60), attachment: null }],
  permit: [{ nextRenewalDate: d(s.permitDays), attachment: null }],
  condition: s.state === "ISSUE" ? "Under repair" : "Good", specification: s.specification,
});

const issueBlock = (i: typeof ISSUE_FOR_V16, reportedDaysAgo: number | null) => ({
  status: "ISSUE",
  issue: {
    category: i.category, description: i.description, garage: i.garage, repairRemarks: i.repairRemarks, issueStatus: "IN_REPAIR",
    ...(reportedDaysAgo === null ? {} : { reportedDate: d(-reportedDaysAgo), reportedTime: "16:20" }),
    expectedRepairDate: d(i.expectedRepairInDays), expectedRepairTime: "18:00",
  },
});

export async function ensureVehicle(s: VehicleSpec, rbp: Actor, t: Tally): Promise<any> {
  const found: any = await Vehicle.findOne({ vehicleNo: s.vehicleNo }).lean();
  if (found) { t.add("vehicles", false); return found; }
  const base = vehicleBase(s);
  const input =
    s.state === "DRAFT" ? { ...base, saveAs: "DRAFT" }
      : s.state === "ISSUE" ? { ...base, availability: issueBlock(ISSUE_FOR_V16, 2) }
        : { ...base, availability: { status: "AVAILABLE", availableFromDate: d(-60), availableFromTime: "09:00" } };
  const created = await createVehicle(input, rbp.username);
  t.add("vehicles", true);
  return created;
}

/** The replaced vehicle is reported as faulty (through the normal Vehicle Management update), once. */
async function reportReplacedVehicleIssue(s: VehicleSpec, rbp: Actor, t: Tally) {
  const v: any = await Vehicle.findOne({ vehicleNo: s.vehicleNo }).lean();
  if (!v) return;
  if (await VehicleHistory.exists({ vehicle: v._id, action: "ISSUE_REPORTED" })) return;
  if (v.availability?.status !== "AVAILABLE") return; // still allotted, or someone already changed it by hand
  await updateVehicle(String(v._id), { ...vehicleBase(s), availability: issueBlock(ISSUE_FOR_V04, null) }, rbp.username);
  t.add("vehicleIssues", true);
}

// ---------------------------------------------------------------- budgets

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A valid budget form payload for a project vehicle; the day count and dates come from the stored RSOP entry. */
function budgetInput(p: BudgetParams, project: any) {
  const x = project.details ?? {};
  const road = project.projectType === "ROADSHOW";
  const days = Number(road ? x.numberOfDays : x.totalDaysOfWork);
  const totalKm = round2(p.kmPerDay * days);
  const rate = p.dieselRate ?? 92;
  return {
    mileage: p.mileage, estimatedKmPerDay: p.kmPerDay,
    onRoadDate: road ? x.reportingDate : x.fromDate, completionDate: road ? x.endDate : x.toDate, sundayHalt: road && x.sundayHalt === "YES", numberOfDays: days,
    dieselAmount: Math.round((totalKm / p.mileage) * rate), salaryAmount: p.salaryPerDay, salaryUnit: "PER_DAY", foodAmount: p.foodPerDay, foodUnit: "PER_DAY",
    haltFood: p.haltFood, tolls: p.tolls.map(([location, r]) => ({ location, rate: r })),
    others: (p.others ?? []).map(([description, amount]) => ({ description, amount })),
    fromLocation: p.from, toLocation: p.to, totalKm, fuelRate: rate, // Up/Down is calculated on the server from KM, mileage, rate and tolls
    otherDetails: [{ name: "Diesel rate", value: `Rs ${rate} per litre` }, { name: "Budget basis", value: `${days} campaign days at ${p.kmPerDay} km per day` }],
  };
}

export async function ensureBudget(plan: BudgetPlan, tv: any, project: any, a: Actors, t: Tally): Promise<void> {
  let budget: any = await Budget.findOne({ vehicle: tv._id }).lean();
  if (!budget) {
    const r = await createBudget(String(tv._id), budgetInput(plan.v1, project), a.RBP.username);
    budget = r.budget;
    t.add("budgets", true);
  } else t.add("budgets", false);
  const id = String(budget._id);
  const has = (action: string, version: number) => BudgetEvent.exists({ budget: id, version, action });
  const fresh = async () => (await Budget.findById(id).lean()) as any;

  if (plan.end === "DRAFT") return;
  if (!(await has("SUBMITTED", 1))) { await submitBudget(id, a.RBP.username, plan.submitComment); t.add("budgetSubmissions", true); }
  if (plan.rejectV1 && !(await has("REJECTED", 1))) {
    await rejectBudget(id, { version: 1, reason: plan.rejectV1.reason, fields: plan.rejectV1.fields }, a.RSOM.username);
    t.add("budgetRejections", true);
  }
  if (plan.v2) {
    if ((await fresh()).currentVersion < 2) {
      await updateBudget(id, budgetInput({ ...plan.v1, ...plan.v2 }, project), a.RBP.username);
      t.add("budgetRevisions", true);
    }
    if (!(await has("RESUBMITTED", 2))) { await submitBudget(id, a.RBP.username, plan.resubmitComment); t.add("budgetSubmissions", true); }
  }
  if (plan.end === "APPROVED") {
    const version = plan.v2 ? 2 : 1;
    if (!(await has("APPROVED", version))) { await approveBudget(id, version, a.RSOM.username); t.add("budgetApprovals", true); }
  }
}

// ---------------------------------------------------------------- allotments

const projectEnd = (p: any) => (p.projectType === "ROADSHOW" ? p.details.endDate : p.details.toDate) as string;

async function ensureAllotment(plan: AllotPlan, tv: any, project: any, a: Actors, t: Tally): Promise<void> {
  const rbp = a.RBP.username;
  const vehicleOf = async (key: string) => {
    const spec = VEHICLES.find((v) => v.key === key)!;
    return (await Vehicle.findOne({ vehicleNo: spec.vehicleNo }).lean()) as any;
  };
  const driverOf = async (key: string) => {
    const spec = DRIVERS.find((x) => x.key === key)!;
    return (await Driver.findOne({ mobileDigits: spec.mobile }).lean()) as any;
  };
  const chain = async (): Promise<any[]> => VehicleAllotment.find({ trackingVehicle: tv._id }).sort({ createdAt: 1, _id: 1 }).lean();
  const current = async () => { const rows = await chain(); return rows.find((r) => r.status === "ACTIVE") ?? rows[rows.length - 1]; };
  const end = projectEnd(project);

  if ((await chain()).length === 0) {
    const veh = await vehicleOf(plan.vehicle);
    const drv = plan.driver ? await driverOf(plan.driver) : null;
    await allotVehicle({
      trackupNumber: tv.trackupNumber, pifNumber: tv.pifNumber, vehicleId: String(veh._id), ...(drv ? { driverId: String(drv._id) } : {}),
      remarks: plan.remarks, expectedReleaseDate: end, expectedReleaseTime: "21:00", nextAvailableDate: addDays(end, 1), nextAvailableTime: "09:00",
    }, rbp);
    t.add("allotments", true);
  } else t.add("allotments", false);

  let a0 = await current();
  const ids = async () => (await chain()).map((r) => r._id);
  const logged = async (action: string) => !!(await AllotmentEvent.exists({ allotment: { $in: await ids() }, action }));

  if (plan.extendByDays && a0.status === "ACTIVE" && !(await logged("EXTENDED"))) {
    await extendAllotment(String(a0._id), {
      expectedReleaseDate: addDays(end, plan.extendByDays), expectedReleaseTime: "21:00",
      nextAvailableDate: addDays(end, plan.extendByDays + 1), nextAvailableTime: "09:00", reason: "Campaign extended by the client",
    }, rbp);
    t.add("allotmentExtensions", true);
    a0 = await current();
  }
  if (plan.changeVehicleTo && a0.status === "ACTIVE" && (await chain()).length === 1) {
    const repl = await vehicleOf(plan.changeVehicleTo.vehicle);
    await changeVehicle(String(a0._id), { vehicleId: String(repl._id), reason: plan.changeVehicleTo.reason, remarks: plan.changeVehicleTo.remarks }, rbp);
    t.add("vehicleChanges", true);
    a0 = await current();
    const original = VEHICLES.find((v) => v.key === plan.vehicle)!;
    if (original.key === "V04") await reportReplacedVehicleIssue(original, a.RBP, t);
  }
  if (plan.assignLaterDriver && a0.status === "ACTIVE" && !a0.driver) {
    const drv = await driverOf(plan.assignLaterDriver);
    await assignDriver(String(a0._id), { driverId: String(drv._id), remarks: "Driver assigned after licence and availability check" }, rbp);
    t.add("driverAssignments", true);
    a0 = await current();
  }
  if (plan.changeDriverTo && a0.status === "ACTIVE" && a0.activeDriver && !(await logged("DRIVER_CHANGED"))) {
    const drv = await driverOf(plan.changeDriverTo.driver);
    await changeDriver(String(a0._id), {
      driverId: String(drv._id), reason: plan.changeDriverTo.reason, remarks: plan.changeDriverTo.remarks, travelAmountDeduction: plan.changeDriverTo.travelDeduction,
    }, rbp);
    t.add("driverChanges", true);
  }
}

// ---------------------------------------------------------------- clearance + delivery

/** A small valid PNG (solid vertical gradient) so the delivery photos are real, viewable image files. */
export function makePng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    const shade = 0.45 + 0.55 * (y / h);
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = Math.round(rgb[0] * shade);
      raw[row + 2 + x * 3] = Math.round(rgb[1] * shade);
      raw[row + 3 + x * 3] = Math.round(rgb[2] * shade);
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const photo = (name: string, rgb: [number, number, number]) => { const buffer = makePng(480, 300, rgb); return { originalname: name, mimetype: "image/png", size: buffer.length, buffer }; };

export async function ensureClearance(plan: ClearancePlan, tv: any, a: Actors, t: Tally): Promise<void> {
  const had = await Clearance.exists({ trackingVehicle: tv._id });
  await syncClearances({ trackingVehicle: tv._id }); // the real allotment -> clearance submission (RBP -> RSA)
  let c: any = await Clearance.findOne({ trackingVehicle: tv._id }).lean();
  if (!c) throw new Error(`No clearance was created for ${tv.trackupNumber}; check that it has an allotment with a driver and an approved budget`);
  t.add("clearances", !had);

  const reload = async () => (c = await Clearance.findOne({ trackingVehicle: tv._id }).lean());
  if (plan.outcome === "APPROVE" && c.status === "YET_TO_APPROVE") {
    await approveClearance(String(c._id), { version: c.currentVersion }, a.RSA.username);
    t.add("clearanceApprovals", true);
  }
  if ((plan.outcome === "REJECT" || plan.outcome === "REJECT_RESUBMIT") && c.status === "YET_TO_APPROVE" && c.currentVersion === 1) {
    await rejectClearance(String(c._id), { version: 1, reason: plan.reason, remarks: plan.remarks ?? null, attachments: [] }, a.RSA.username);
    t.add("clearanceRejections", true);
    await reload();
  }
  if (plan.outcome === "REJECT_RESUBMIT" && c.status === "REJECTED") {
    await resubmitClearance(String(c._id), { remarks: plan.resubmitRemarks }, a.RBP.username);
    t.add("clearanceResubmissions", true);
  }
  await reload();
  if (plan.deliver && c.status === "APPROVED" && c.deliveryStatus !== "DELIVERED") {
    const label = String(tv.pifNumber).replace(/[^A-Za-z0-9]+/g, "-");
    const speedo = await uploadDeliveryPhoto(String(c._id), "speedometer", photo(`speedometer-${label}.png`, [40, 90, 160]), a.RBP.username);
    const proof = await uploadDeliveryPhoto(String(c._id), "evidence", photo(`handover-${label}.png`, [60, 140, 90]), a.RBP.username);
    await deliverVehicle(String(c._id), { version: c.currentVersion, description: plan.deliver, speedometerPhoto: { key: speedo.key }, evidencePhoto: { key: proof.key } }, a.RBP.username);
    t.add("deliveries", true);
  }
}

// ---------------------------------------------------------------- payments + release

export async function ensurePayment(p: PaymentPlan, tv: any, project: any, a: Actors, t: Tally): Promise<void> {
  const idempotencyKey = `devseed-${p.key}`;
  const had = await RsaPayment.exists({ trackingVehicle: tv._id, idempotencyKey });
  await createPayment(String(tv._id), {
    paymentFor: project.projectType, cashInHand: p.cashInHand ?? false, idempotencyKey,
    dieselEntries: (p.diesel ?? []).map((x) => ({ amount: x.amount, mode: x.mode, reference: x.reference })),
    foodAmount: p.food ?? 0, salaryAdvance: p.salaryAdvance ?? 0,
    expenses: (p.expenses ?? []).map((e) => ({ optionKey: e.optionKey, description: e.description, amount: e.amount, deduct: e.deduct ?? false })),
  }, a.RSA.username);
  t.add("rsaPayments", !had);
}

async function ensureRelease(plan: AllotPlan, tv: any, a: Actors, t: Tally): Promise<void> {
  if (!plan.release) return;
  const active: any = await VehicleAllotment.findOne({ trackingVehicle: tv._id, status: "ACTIVE" }).lean();
  if (!active) return;
  await releaseAllotment(String(active._id), { remarks: plan.release }, a.RBP.username);
  t.add("allotmentReleases", true);
}

// ---------------------------------------------------------------- orchestration

async function seedVehiclePlan(plan: VehiclePlan, tv: any, project: any, a: Actors, t: Tally) {
  if (plan.budget) await ensureBudget(plan.budget, tv, project, a, t);
  if (plan.allot) await ensureAllotment(plan.allot, tv, project, a, t);
  if (plan.clearance) await ensureClearance(plan.clearance, tv, a, t);
  for (const p of plan.payments ?? []) await ensurePayment(p, tv, project, a, t);
  if (plan.allot) await ensureRelease(plan.allot, tv, a, t);
}

async function ensureProject(spec: ProjectSpec, a: Actors, t: Tally) {
  const requestId = `${SEED_TAG}:${spec.key}`;
  const had = await TrackingProject.exists({ requestId });
  const loaded: any = await createTracking(a.RSOP, { projectType: spec.type, details: spec.details, requestId }, { allowPastStart: true }); // idempotent on requestId; seed campaigns may have started already
  t.add("projects", !had);
  return loaded;
}

/** Builds every unique index first (they are the final guard against duplicate vehicle / driver / project assignments). */
export async function initIndexes(): Promise<void> {
  await Promise.all([
    User, TrackingProject, TrackingVehicle, Budget, BudgetVersion, BudgetEvent, Notification, Vehicle, VehicleHistory, VehicleAllotment, AllotmentEvent,
    Driver, DriverHistory, DriverAdvance, RsaPayment, Counter, Clearance, ClearanceEvent, VehicleDelivery, DeliveryEvent, SettlementPayment, SettlementPaymentEvent,
  ].map((m: any) => m.init()));
}

/** Runs the whole seed against the currently connected database. */
export async function seedDevData(log: (m: string) => void = () => {}): Promise<SeedReport> {
  assertDevOnly();
  await initIndexes();
  const t = new Tally();
  const a = await loadActors();

  log("Drivers…");
  for (const s of DRIVERS) {
    const driver = await ensureDriver(s, a.RBP, t);
    await ensureAdvances(s, driver, a.RBP, t);
  }
  log("Vehicles…");
  for (const s of VEHICLES) await ensureVehicle(s, a.RBP, t);

  const report: SeedReport = { created: {}, existing: {}, vehicles: [] };
  for (const spec of PROJECTS) {
    log(`${spec.key} ${spec.clientName}…`);
    const project = await ensureProject(spec, a, t);
    for (const [i, plan] of spec.vehicles.entries()) {
      const tv: any = project.vehicles[i];
      if (!tv) throw new Error(`${spec.key} has no project vehicle ${i + 1}; the stored project does not match the seed definition`);
      report.vehicles.push({ project: spec.key, client: spec.clientName, index: i + 1, trackupNumber: tv.trackupNumber, pifNumber: tv.pifNumber });
      await seedVehiclePlan(plan, tv, project, a, t);
    }
  }
  log("Settlement payments…");
  await seedSettlements((kind, wasCreated) => t.add(kind, wasCreated));
  report.created = t.created;
  report.existing = t.existing;
  return report;
}

