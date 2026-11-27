/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * `npm run seed:mock`: extra development data to work with: 10 projects x 5 vehicles, 50 fleet vehicles and 50 drivers,
 * spread over every workflow stage. Everything goes through the application services (same validations, histories and
 * notifications). Additive and re-runnable: nothing is deleted, and existing records are left as they are.
 */
import mongoose from "mongoose";
import { config } from "../config/index.js";
import { connectDB } from "../db/connect.js";
import { Budget } from "../models/Budget.js";
import { VehicleAllotment } from "../models/VehicleAllotment.js";
import { allotVehicle, releaseAllotment } from "../services/allotment.service.js";
import { createTracking } from "../services/tracking.service.js";
import { addDays, todayYmd } from "../validators/vehicle.validator.js";
import { assertDevOnly, ensureBudget, ensureClearance, ensureDriver, ensurePayment, ensureVehicle, initIndexes, loadActors, Tally } from "./devSeed.js";
import type { BudgetPlan, DriverSpec, VehicleSpec } from "./devSeed.data.js";
import { seedSettlements } from "./devSeed.settlements.js";

const d = (n: number) => addDays(todayYmd(), n);
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

// ---- 50 drivers (the first 25 go on projects) and 50 fleet vehicles (the first 25 go on projects)
const NAMES = ["Arun", "Bala", "Chandran", "Dinesh", "Elango", "Farooq", "Gopal", "Hari", "Imran", "Jeeva", "Kannan", "Lokesh", "Mani", "Naveen", "Prabhu", "Ramesh", "Saravanan", "Tamil", "Uday", "Vignesh", "Yusuf", "Anand", "Baskar", "David", "Ganesan"];
const drivers: DriverSpec[] = Array.from({ length: 50 }, (_, i) => {
  const name = `${NAMES[i % 25]} ${i < 25 ? "Kumar" : "Raj"}`;
  return {
    key: `M${pad(i + 1)}`, name, type: i % 3 === 0 ? "ACTING_DRIVER" : "COMPANY_DRIVER", mobile: `90000100${pad(i)}`,
    licence: `TN99202000100${pad(i)}`, licenceType: "LMV + Transport", licenceExpiry: d(200 + i * 20), salary: 750 + (i % 6) * 40, address: `${i + 1}, Mock Street, Chennai 600001`,
    bank: { accountName: name, bankName: "State Bank of India", accountNumber: `3000010000${pad(i)}`, ifsc: "SBIN0000001" },
    // unallotted drivers: some on leave, some resigned
    state: i >= 40 && i < 45 ? "NOT_AVAILABLE" : i >= 45 && i < 48 ? "INACTIVE" : "AVAILABLE",
  };
});
const MODELS = [["Tata", "Ace Gold"], ["Tata", "407 Gold"], ["Mahindra", "Bolero Pickup"], ["Eicher", "Pro 2049"], ["Ashok Leyland", "Dost+"]];
const vehicles: VehicleSpec[] = Array.from({ length: 50 }, (_, i) => ({
  key: `MV${pad(i + 1)}`, vehicleNo: `TN99MK${1001 + i}`, make: MODELS[i % 5][0], model: MODELS[i % 5][1], type: i % 4 === 0 ? "Utility" : "Dynamic",
  year: 2021 + (i % 4), purchaseDate: `${2021 + (i % 4)}-06-15`, currentRunning: 5000 + i * 311, totalRunning: 20000 + i * 977, stepney: "Good", battery: i % 9 === 0 ? "Weak" : "Good",
  fcDays: i % 11 === 0 ? -10 : 60 + i * 6, insuranceDays: i % 13 === 0 ? 15 : 90 + i * 5, permitDays: 300, specification: "Mock fleet vehicle",
  // unallotted vehicles: some with a reported issue, some still drafts
  state: i >= 40 && i < 45 ? "ISSUE" : i >= 45 && i < 48 ? "DRAFT" : "AVAILABLE",
}));

// ---- 10 projects, 5 vehicles each (two or three vehicle types per project)
const CLIENTS = ["Aachi Masala", "Cavin Kare", "Hatsun Dairy", "Naga Foods", "Ramraj Cotton", "TVS Motor", "Sakthi Masala", "Pothys Retail", "Annapoorna Foods", "Lalitha Jewellery"];
const CITIES = ["Chennai", "Madurai", "Salem", "Coimbatore", "Trichy"];
const TYPES = [["CENTRE_NO_ROOF", "CENTRE_TRIANGLE_ROOF"], ["L_BOX_ROOF", "TATA_ACE_9FT_2S_LED"], ["L_TRIANGLE_ROOF", "TATA_ULTRA_19FT_3S_LED", "CENTRE_NO_ROOF"]];

function project(p: number) {
  const road = p % 2 === 0;
  const codes = TYPES[p % 3];
  const vehicleTypes = codes.map((code, i) => ({ code, quantity: codes.length === 2 ? [2, 3][i] : [2, 2, 1][i] }));
  const common = { projectCode: `7700000${p}`, vehicleTypes };
  const from = -(p % 4);
  return road
    ? {
        type: "ROADSHOW",
        details: {
          ...common, billingName: CLIENTS[p], stateCode: "33", numberOfVans: 5, startDate: d(from), endDate: d(14 + p), reportingDate: d(from), sundayHalt: "NO",
          reportingLocations: [CITIES[p % 5], CITIES[(p + 1) % 5]], reportingPerson: "Mock Coordinator", contactNumber: "98400 00000", kmAllotted: "80 KM per day", extraKmAllowed: "NO", timing: "8 Hours",
        },
      }
    : {
        type: "SIGNAGE",
        details: {
          ...common, date: d(from - 3), client: CLIENTS[p], jobSheetNumber: `MOCK-${100 + p}`, location: CITIES[p % 5], numberOfVehicles: 5, arrivedBudget: 50000,
          fromDate: d(from), toDate: d(14 + p), briefWorkDetails: "Mock signage work", siteDetails: "Mock sites",
        },
      };
}

// ---- stages for the 50 project vehicles: [stage, how many]
const STAGES = [
  ["NO_BUDGET", 6], ["BUDGET_DRAFT", 5], ["BUDGET_PENDING", 5], ["BUDGET_REJECTED", 4], ["BUDGET_APPROVED", 5],
  ["VEHICLE_ONLY", 4], ["CLEARANCE_PENDING", 4], ["CLEARANCE_REJECTED", 3], ["READY_TO_DELIVER", 5], ["ON_ROAD", 6], ["COMPLETED", 3],
] as const;
type Stage = (typeof STAGES)[number][0];
const stageList: Stage[] = STAGES.flatMap(([s, n]) => Array<Stage>(n).fill(s));

function budgetPlan(stage: Stage, i: number): BudgetPlan | null {
  if (stage === "NO_BUDGET") return null;
  const v1 = {
    mileage: 10, kmPerDay: 80, salaryPerDay: 800 + (i % 5) * 25, foodPerDay: 280, haltFood: 0, from: CITIES[i % 5], to: CITIES[(i + 2) % 5], upDownValue: 2000,
    tolls: [["Mock Toll Plaza", 120]] as [string, number][],
  };
  if (stage === "BUDGET_DRAFT") return { v1, end: "DRAFT" };
  if (stage === "BUDGET_PENDING") return { v1, end: "PENDING" };
  if (stage === "BUDGET_REJECTED") return { v1, end: "REJECTED", rejectV1: { reason: "Please correct the toll amount.", fields: [{ field: "tolls", comment: "Add the missing plaza." }] } };
  return { v1, end: "APPROVED" };
}

try {
  assertDevOnly(); // before any connection is opened
  await connectDB();
  console.log(`Adding mock data to "${mongoose.connection.name}"`);
  await initIndexes();
  const a = await loadActors();
  const t = new Tally();
  const driverDocs: any[] = [];
  for (const s of drivers) driverDocs.push(await ensureDriver(s, a.RBP, t));
  const vehicleDocs: any[] = [];
  for (const s of vehicles) vehicleDocs.push(await ensureVehicle(s, a.RBP, t));

  const projects: any[] = [];
  for (let p = 0; p < 10; p++) {
    const spec = project(p);
    const requestId = `mock:v1:${p}`;
    projects.push(await createTracking(a.RSOP, { projectType: spec.type, details: spec.details, requestId }, { allowPastStart: true }));
  }

  let slot = 0; // next fleet vehicle / driver for an allotment
  for (let i = 0; i < 50; i++) {
    const p = i % 10; // spread the stages over all projects
    const proj = projects[p];
    const tv = proj.vehicles[Math.floor(i / 10)];
    const stage = stageList[i];
    const plan = budgetPlan(stage, i);
    if (!plan) continue;
    await ensureBudget(plan, tv, proj, a, t);
    const index = STAGES.slice(0, 5).reduce((s, [, n]) => s + n, 0);
    if (i < index) continue;
    slot = i - index;
    const rows: any[] = await VehicleAllotment.find({ trackingVehicle: tv._id }).lean();
    if (!rows.length) {
      const end = String(proj.projectType === "ROADSHOW" ? proj.details.endDate : proj.details.toDate);
      await allotVehicle({
        pifNumber: tv.pifNumber, vehicleId: String(vehicleDocs[slot]._id), ...(stage === "VEHICLE_ONLY" ? {} : { driverId: String(driverDocs[slot]._id) }),
        remarks: "Mock allotment", expectedReleaseDate: end, expectedReleaseTime: "21:00", nextAvailableDate: addDays(end, 1), nextAvailableTime: "09:00",
      }, a.RBP.username);
      t.add("allotments", true);
    }
    if (stage === "VEHICLE_ONLY") continue;
    await ensureClearance(
      stage === "CLEARANCE_PENDING" ? { outcome: "PENDING" }
        : stage === "CLEARANCE_REJECTED" ? { outcome: "REJECT", reason: "Missing Documents", remarks: "Permit copy is missing." }
          : { outcome: "APPROVE", ...(stage === "READY_TO_DELIVER" ? {} : { deliver: "Mock handover at depot" }) },
      tv, a, t,
    );
    if (stage === "ON_ROAD" || stage === "COMPLETED")
      await ensurePayment({ key: `mock-${i}`, diesel: [{ amount: 3000 + i * 10, mode: "Cash" }], food: 900 }, tv, proj, a, t);
    if (stage === "COMPLETED") {
      const active: any = await VehicleAllotment.findOne({ trackingVehicle: tv._id, status: "ACTIVE" }).lean();
      if (active) await releaseAllotment(String(active._id), { remarks: "Mock campaign finished" }, a.RBP.username);
    }
  }
  await seedSettlements((kind, created) => t.add(kind, created)); // daily / final settlements in various approval states

  console.log("Created:", t.created);
  console.log("Already there:", t.existing);
  console.log("Budgets by status:", await Budget.aggregate([{ $group: { _id: "$approvalStatus", n: { $sum: 1 } } }]));
} catch (e) {
  console.error(`\nMock seed failed (${config.env}): ${e instanceof Error ? e.stack : String(e)}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
