/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * `npm run seed:suspense`: one MOCK project vehicle for testing the Suspense Records popup and PDF: its own driver, vehicle, client
 * and approved budget, approved and paid Daily Payments of every kind, and no Final Settlement yet (so one can be raised).
 * Everything goes through the application services. Additive and re-runnable: fixed keys, nothing existing is changed or deleted.
 */
import mongoose from "mongoose";
import { config } from "../config/index.js";
import { connectDB } from "../db/connect.js";
import { SettlementPayment } from "../models/SettlementPayment.js";
import { TrackingProject } from "../models/TrackingProject.js";
import { VehicleAllotment } from "../models/VehicleAllotment.js";
import { allotVehicle } from "../services/allotment.service.js";
import { suspenseFor } from "../services/paymentDetailsPdf.service.js";
import { completeSettlement, reviewSettlement, submitSettlement } from "../services/settlement.service.js";
import { createTracking } from "../services/tracking.service.js";
import { addDays, todayYmd } from "../validators/vehicle.validator.js";
import { assertDevOnly, ensureBudget, ensureClearance, ensureDriver, ensureVehicle, initIndexes, loadActors, Tally } from "./devSeed.js";
const REQUEST = "mock:suspense:v1";
const d = (n) => addDays(todayYmd(), n);
const driver = {
    key: "MOCKSUSP", name: "MOCK Suspense Driver", type: "COMPANY_DRIVER", mobile: "9000099901", licence: "TN9920200099901", licenceType: "LMV + Transport",
    licenceExpiry: d(700), salary: 900, address: "1, Mock Street, Chennai 600001",
    bank: { accountName: "MOCK Suspense Driver", bankName: "MOCK Bank", accountNumber: "999900001111", ifsc: "MOCK0000001" }, state: "AVAILABLE",
};
const vehicle = {
    key: "MOCKSUSPV", vehicleNo: "TN99ZZ9901", make: "Tata", model: "Ace Gold", type: "Dynamic", year: 2024, purchaseDate: "2024-06-15", currentRunning: 5000,
    totalRunning: 20000, stepney: "Good", battery: "Good", fcDays: 300, insuranceDays: 300, permitDays: 300, specification: "MOCK vehicle for suspense testing", state: "AVAILABLE",
};
const expense = (optionKey, amount, description, deduct = false) => ({ optionKey, amount: String(amount), description, deduct });
/** One entry per Daily Payment: `day` is relative to today; `paid` ones also get RSA's payment entry. */
const DAILY = [
    { day: -5, paid: true, mode: "EPAYMENT", body: { salaryAdvance: "1500", dieselEntries: [{ amount: "2450.50", mode: "Cash", reference: "MOCK bunk Guindy" }], foodAmount: "350" } },
    { day: -4, paid: true, mode: "CHEQUE", body: { expenses: [expense("SERVICE", 800, "MOCK oil service"), expense("TOLL", 285, "MOCK toll plaza"), expense("PERMIT", 600, "MOCK permit")] } },
    { day: -3, paid: false, body: { foodAmount: "400", expenses: [expense("OTHERS", 250, "MOCK parking"), expense("OTHERS", 100, "MOCK excess recovery", true)] } },
    { day: -2, paid: false, body: { cashInHand: true, salaryAdvance: "1000", dieselEntries: [{ amount: "1800", mode: "Cash" }], expenses: [expense("TOLL", 190, "MOCK return toll")] } },
];
try {
    assertDevOnly(); // before any connection is opened
    await connectDB();
    console.log(`Adding the MOCK suspense scenario to "${mongoose.connection.name}"`);
    await initIndexes();
    const a = await loadActors();
    const t = new Tally();
    const driverDoc = await ensureDriver(driver, a.RBP, t);
    const vehicleDoc = await ensureVehicle(vehicle, a.RBP, t);
    const project = await createTracking(a.RSOP, {
        projectType: "SIGNAGE",
        requestId: REQUEST,
        details: {
            projectCode: "99000001", vehicleTypes: [{ code: "CENTRE_NO_ROOF", quantity: 1 }], date: d(-9), client: "MOCK Suspense Client", jobSheetNumber: "MOCK-SUSP-001",
            location: "MOCK Chennai", numberOfVehicles: 1, arrivedBudget: 50000, fromDate: d(-6), toDate: d(14), briefWorkDetails: "MOCK suspense test", siteDetails: "MOCK site",
        },
    }, { allowPastStart: true });
    // the stored project: on a re-run the dates are those of the first run
    const stored = await TrackingProject.findById(project._id).lean();
    const from = String(stored.details.fromDate);
    const day = (n) => addDays(from, n + 6);
    const tv = project.vehicles[0];
    await ensureBudget({
        v1: { mileage: 10, kmPerDay: 80, salaryPerDay: 900, foodPerDay: 300, haltFood: 0, from: "Chennai", to: "Madurai", upDownValue: 2000, tolls: [["MOCK Toll Plaza", 120]] },
        end: "APPROVED",
    }, tv, project, a, t);
    if (!(await VehicleAllotment.exists({ trackingVehicle: tv._id }))) {
        const end = String(stored.details.toDate);
        await allotVehicle({
            pifNumber: tv.pifNumber, vehicleId: String(vehicleDoc._id), driverId: String(driverDoc._id), remarks: "MOCK allotment",
            expectedReleaseDate: end, expectedReleaseTime: "21:00", nextAvailableDate: addDays(end, 1), nextAvailableTime: "09:00",
        }, a.RBP.username);
        t.add("allotments", true);
    }
    await ensureClearance({ outcome: "APPROVE", deliver: "MOCK handover" }, tv, a, t);
    for (const [i, p] of DAILY.entries()) {
        const date = day(p.day);
        const { payment, replay } = await submitSettlement("DAILY", String(tv._id), { ...p.body, fromDate: date, toDate: date, idempotencyKey: `mock-suspense-daily-${i + 1}` }, a.RBP.username);
        t.add("dailyPayments", !replay);
        if (payment.status === "PENDING")
            await reviewSettlement(payment._id, "APPROVE", { username: a.RSOM.username, role: "RSOM" }, {});
        const now = await SettlementPayment.findById(payment._id).lean();
        if (p.paid && now.status === "APPROVED")
            await completeSettlement(payment._id, { paymentMode: p.mode, paymentDate: todayYmd(), referenceDate: todayYmd(), referenceNumber: `MOCK-REF-${i + 1}`, bankName: "MOCK Bank" }, a.RSA.username);
    }
    const al = await VehicleAllotment.findOne({ trackingVehicle: tv._id }).sort({ createdAt: -1 }).lean();
    const suspense = await suspenseFor(String(tv._id), String(al.driver), from);
    console.log("Created:", t.created, "\nAlready there:", t.existing);
    console.log({ client: stored.clientName, trackupNumber: tv.trackupNumber, pifNumber: tv.pifNumber, jobSheetNumber: stored.details.jobSheetNumber, vehicleNo: al.vehicleNo, driver: `${al.driverNumber} ${al.driverName}`, campaign: `${from} to ${stored.details.toDate}` });
    console.table((await SettlementPayment.find({ trackingVehicle: tv._id }).sort({ fromDate: 1 }).lean()).map((p) => ({ payment: p.paymentNumber, category: p.category, date: p.fromDate, status: p.status, amount: p.amount })));
    console.table(suspense.rows);
    console.log(`Expected popup / PDF total: ${suspense.total.toFixed(2)} (${suspense.rows.length} rows)`);
}
catch (e) {
    console.error(`\nMOCK suspense seed failed (${config.env}): ${e instanceof Error ? e.stack : String(e)}`);
    process.exitCode = 1;
}
finally {
    await mongoose.disconnect();
}
