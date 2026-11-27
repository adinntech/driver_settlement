import { EXPENSE_OPTIONS } from "../config/rsaOptions.js";
import { MAX_AMOUNT_PAISE, calculatePayable, parseAmountPaise, rupees, validatePaymentInput } from "./rsaPayment.js";
import { kmUsage } from "./kmAllowance.js";
const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** Printable text: no angle brackets and no control characters. */
const SAFE_TEXT = { test: (t) => t.length > 0 && ![...t].some((ch) => ch === "<" || ch === ">" || ch < " " || ch === "\u007f") };
const blank = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const isDate = (v) => typeof v === "string" && YMD.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const r2 = (n) => Math.round(n * 100) / 100;
/** Inclusive day count between two YYYY-MM-DD dates. */
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
export function validateDailyInput(input, bounds = {}) {
    const b = (input && typeof input === "object" && !Array.isArray(input) ? input : {});
    const errors = [];
    if (!isDate(b.fromDate))
        errors.push("From Date must be a valid date");
    if (!isDate(b.toDate))
        errors.push("To Date must be a valid date");
    if (isDate(b.fromDate) && isDate(b.toDate) && b.toDate < b.fromDate)
        errors.push("To Date cannot be before From Date");
    const unchanged = b.fromDate === bounds.previous?.fromDate && b.toDate === bounds.previous?.toDate;
    const { campaignFrom: cf, campaignTo: ct } = bounds;
    if (!unchanged && isDate(b.fromDate) && isDate(cf) && b.fromDate < cf)
        errors.push("From Date cannot be before the campaign start date");
    if (!unchanged && isDate(b.toDate) && isDate(ct) && b.toDate > ct)
        errors.push("To Date cannot be after the campaign end date");
    if (isDate(b.fromDate) && isDate(b.toDate) && b.toDate >= b.fromDate && daysBetween(b.fromDate, b.toDate) > 62)
        errors.push("A daily payment can cover at most 62 days");
    const v = validatePaymentInput(b);
    errors.push(...v.errors);
    if (errors.length || !v.data)
        return { errors, data: null };
    return { errors, data: { ...v.data, fromDate: b.fromDate, toDate: b.toDate } };
}
export function dailyData(d) {
    const t = calculatePayable(d);
    return {
        paymentFor: d.paymentFor, fromDate: d.fromDate, toDate: d.toDate, cashInHand: d.cashInHand,
        dieselEntries: d.diesel.map((x) => ({ amount: rupees(x.amountPaise), mode: x.mode, reference: x.reference })),
        foodAmount: rupees(d.foodPaise), salaryAdvance: rupees(d.salaryAdvancePaise),
        expenses: d.expenses.map((e) => ({ optionKey: e.optionKey, optionLabel: e.optionLabel, description: e.description, amount: rupees(e.amountPaise), deduct: e.deduct, isDefault: e.isDefault })),
        dieselTotal: rupees(t.dieselP), expenseTotal: rupees(t.expenseAddP), deductTotal: rupees(t.expenseDeductP),
        total: rupees(t.dieselP + d.foodPaise + d.salaryAdvancePaise + t.expenseAddP), totalPayable: rupees(t.totalP),
    };
}
// ------------------------------------------------------------------------------------------------------------- final settlement
export const FINAL_EXPENSE_CATEGORIES = EXPENSE_OPTIONS.filter((o) => ["FUEL", "FLEET_BALANCE", "TOLL", "FOOD_ALLOWANCE", "TRAVEL", "PERMIT", "SERVICE", "OTHERS"].includes(o.key));
export const DEDUCTION_KEYS = ["mileageShort", "vehicleDamage", "previousSalary", "other"];
export const DEDUCTION_LABELS = {
    mileageShort: "Mileage Shortage Deduction", vehicleDamage: "Vehicle Damage Deduction", previousSalary: "Previous Salary Deduction", other: "Other Deduction",
};
/**
 * Lines of a SAVED settlement, for the salary statement: older ones also stored the driver-change amount as its own line, and keep
 * showing it. New ones carry it inside Previous Salary Deduction.
 */
export const savedDeductionLines = (d) => ["mileageShort", "driverChangeTravel", "vehicleDamage", "previousSalary", "other"]
    .filter((k) => k !== "driverChangeTravel" || d[k] !== undefined)
    .map((k) => [k === "driverChangeTravel" ? "Driver Change Travel Amount Deduction" : DEDUCTION_LABELS[k], Number(d[k]) || 0]);
/** Number fields of the final form: [key, label]. Values are non-negative with up to 2 decimals (kept in hundredths). */
const NUMBER_FIELDS = [
    ["estimatedKmPerDay", "Estimated KM Per Day"], ["fixedMileage", "Fixed Mileage"], ["openingKm", "Opening KM"], ["closingKm", "Closing KM"],
    ["dieselCost", "Fuel Cost (per litre)"], ["ioclLitres", "IOCL card usage (litres)"], ["ioclKms", "IOCL card usage (KMs)"],
    ["estimatedBudget", "Estimated Budget"], ["estimatedKm", "Estimated KM"], ["estimatedFuel", "Estimated Fuel"],
    ["perDaySalary", "Per Day Salary"], ["perDayFood", "Per Day Food"], ["travelPay", "Travel Pay"], ["travelKm", "Travel KM"], ["travelRate", "Travel rate per KM"],
    ["onRoadDays", "On Road Days"], ["onRoadSundays", "On Road Sunday"],
    ["suspenseAmount", "Suspense Amount"],
];
/**
 * The campaign period of one final settlement: the project's own dates unless they were changed on the form. A changed period
 * affects this settlement only (never the project), and its day count replaces the project's.
 */
export function finalPeriod(input, campaign) {
    const b = (input && typeof input === "object" ? input : {});
    const pick = (v, fallback) => (blank(v) ? fallback : v);
    const fromDate = pick(b.campaignFrom, campaign.fromDate);
    const toDate = pick(b.campaignTo, campaign.toDate);
    const changed = fromDate !== campaign.fromDate || toDate !== campaign.toDate;
    const same = { fromDate: campaign.fromDate, toDate: campaign.toDate, totalDays: campaign.totalDays, days: daysBetween(campaign.fromDate, campaign.toDate) };
    if (!changed)
        return { errors: [], period: same };
    const errors = [];
    if (!isDate(fromDate))
        errors.push("Campaign Start Date must be a valid date");
    if (!isDate(toDate))
        errors.push("Campaign End Date must be a valid date");
    if (errors.length)
        return { errors, period: same };
    const days = daysBetween(fromDate, toDate);
    if (days < 1)
        errors.push("Campaign End Date cannot be before the Start Date");
    else if (days > 366)
        errors.push("The campaign period cannot be longer than 366 days");
    return { errors, period: { fromDate: fromDate, toDate: toDate, totalDays: days, days } };
}
const KEY = /^[A-Za-z0-9_-]{8,64}$/;
export function validateFinalInput(input, ctx) {
    const b = (input && typeof input === "object" && !Array.isArray(input) ? input : {});
    const errors = [];
    const num = (raw, label) => {
        const r = parseAmountPaise(raw);
        if (r.error)
            errors.push(`${label} ${r.error}`);
        return r.paise ?? 0;
    };
    const text = (v, label, max, required = false) => {
        if (blank(v)) {
            if (required)
                errors.push(`${label} is required`);
            return null;
        }
        if (typeof v !== "string")
            return (errors.push(`${label} is invalid`), null);
        const t = v.trim().replace(/\s+/g, " ");
        if (t.length > max)
            errors.push(`${label} is too long (max ${max})`);
        else if (!SAFE_TEXT.test(t))
            errors.push(`${label} contains invalid characters`);
        return t;
    };
    const n = {};
    for (const [k, label] of NUMBER_FIELDS)
        n[k] = num(b[k], label);
    for (const k of ["onRoadDays", "onRoadSundays"])
        if (n[k] % 100 !== 0)
            errors.push(`${NUMBER_FIELDS.find((f) => f[0] === k)[1]} must be a whole number`);
    // Travel Pay = KM x rate when they are given (the typed amount is then ignored); without them the amount stands as before
    if (n.travelKm || n.travelRate) {
        if (!n.travelKm || !n.travelRate)
            errors.push("Enter both the Travel KM and the rate per KM");
        n.travelPay = Math.round((n.travelKm * n.travelRate) / 100);
        if (n.travelPay > MAX_AMOUNT_PAISE)
            errors.push("Travel Pay is too large");
    }
    if (!n.fixedMileage)
        errors.push("Fixed Mileage must be greater than zero");
    if (n.closingKm < n.openingKm)
        errors.push("Closing KM cannot be less than Opening KM");
    if (!n.onRoadDays && !n.onRoadSundays)
        errors.push("Enter the On Road Days or On Road Sundays");
    const days = (n.onRoadDays + n.onRoadSundays) / 100;
    if (ctx.totalDays && days > ctx.totalDays)
        errors.push(`On road days and Sundays (${days}) cannot exceed the campaign's ${ctx.totalDays} days`);
    const reportingDate = blank(b.reportingDate) ? null : isDate(b.reportingDate) ? b.reportingDate : (errors.push("Reporting Date must be a valid date"), null);
    if (reportingDate && ctx.fromDate && ctx.toDate && isDate(ctx.fromDate) && isDate(ctx.toDate) && (reportingDate < ctx.fromDate || reportingDate > ctx.toDate))
        errors.push("Reporting Date must be within the campaign start and end dates");
    const expenses = [];
    if (b.expenses !== undefined && b.expenses !== null) {
        if (!Array.isArray(b.expenses))
            errors.push("Expenses must be a list");
        else {
            if (b.expenses.length > 50)
                errors.push("Too many expense rows (max 50)");
            b.expenses.slice(0, 50).forEach((raw, i) => {
                const e = (raw && typeof raw === "object" ? raw : {});
                const cat = FINAL_EXPENSE_CATEGORIES.find((c) => c.key === e.category);
                if (!cat)
                    errors.push(`Expense ${i + 1}: choose one of the listed categories`);
                const description = text(e.description, `Expense ${i + 1} description`, 200, cat?.key === "OTHERS");
                const quantity = num(e.quantity, `Expense ${i + 1} quantity`);
                const cost = num(e.cost, `Expense ${i + 1} cost`);
                if (!quantity)
                    errors.push(`Expense ${i + 1} quantity must be greater than zero`);
                if (!cost)
                    errors.push(`Expense ${i + 1} cost must be greater than zero`);
                const claimed = Math.round((quantity * cost) / 100);
                const approved = blank(e.approved) ? claimed : num(e.approved, `Expense ${i + 1} approved amount`);
                if (approved > claimed)
                    errors.push(`Expense ${i + 1} approved amount cannot be more than the claimed amount`);
                const sig = `${cat?.key}|${(description ?? "").toLowerCase()}`;
                if (cat && expenses.some((x) => `${x.category}|${(x.description ?? "").toLowerCase()}` === sig))
                    errors.push(`Expense ${i + 1} duplicates an earlier ${cat.label} entry with the same description`);
                else if (cat)
                    expenses.push({ category: cat.key, label: cat.label, description, quantity, cost, approved });
            });
        }
    }
    const dIn = (b.deductions && typeof b.deductions === "object" ? b.deductions : {});
    const deductions = {};
    for (const k of DEDUCTION_KEYS)
        deductions[k] = num(dIn[k], DEDUCTION_LABELS[k]);
    const otherDeductionRemark = text(dIn.otherRemark, "Other deduction remark", 200, deductions.other > 0);
    if (typeof b.idempotencyKey !== "string" || !KEY.test(b.idempotencyKey))
        errors.push("A valid submission key is required");
    const data = {
        jsNumber: text(b.jsNumber, "JS No", 60), location: text(b.location, "Location", 120), reportingDate, travelDetails: text(b.travelDetails, "Travel details", 300), n, expenses, deductions, otherDeductionRemark,
        idempotencyKey: b.idempotencyKey,
    };
    if (!errors.length && calculateFinal(data).netP < 0)
        errors.push("Total deduction and suspense amount are more than the gross amount");
    return errors.length ? { errors, data: null } : { errors, data };
}
/**
 * Final settlement calculation (one place, so the business rule can be changed centrally):
 *   Result KM            = Closing KM - Opening KM
 *   Expected litres      = Result KM / Fixed Mileage
 *   Variation in litres  = IOCL litres used - expected litres   (positive = more fuel used than the mileage allows)
 *   Mileage short (hint) = max(variation, 0) x Fuel Cost per litre   (shown as a suggestion; the deduction is entered by RBP)
 *   Earnings             = On road days x per day salary + On road Sundays x per day salary + (on road days + Sundays) x per day food
 *                          + travel pay
 *   Claimed (per row)    = quantity x cost;   rejected = claimed - approved
 *   Gross                = earnings + approved expenses
 *   Net Amount           = Gross - Total Deduction - Suspense Amount
 */
export function calculateFinal(d) {
    const n = d.n;
    const resultKm = (n.closingKm - n.openingKm) / 100;
    const expectedLitres = n.fixedMileage ? r2(resultKm / (n.fixedMileage / 100)) : 0;
    const variationLitres = r2(n.ioclLitres / 100 - expectedLitres);
    const mileageShortSuggestedP = Math.max(0, Math.round(variationLitres * n.dieselCost));
    const mul = (qtyH, paise) => Math.round((qtyH * paise) / 100);
    const earnings = [
        { key: "salary", label: "On Road Days Salary", quantity: n.onRoadDays / 100, rate: n.perDaySalary / 100, amountP: mul(n.onRoadDays, n.perDaySalary) },
        { key: "sundaySalary", label: "On Road Sunday Salary", quantity: n.onRoadSundays / 100, rate: n.perDaySalary / 100, amountP: mul(n.onRoadSundays, n.perDaySalary) },
        { key: "food", label: "Food (Per Day)", quantity: (n.onRoadDays + n.onRoadSundays) / 100, rate: n.perDayFood / 100, amountP: mul(n.onRoadDays + n.onRoadSundays, n.perDayFood) },
        { key: "travel", label: "Travel Pay", quantity: 1, rate: n.travelPay / 100, amountP: n.travelPay },
    ];
    const earningsP = earnings.reduce((s, e) => s + e.amountP, 0);
    const expenses = d.expenses.map((e) => {
        const claimedP = mul(e.quantity, e.cost);
        return { ...e, claimedP, rejectedP: claimedP - e.approved };
    });
    const claimedP = expenses.reduce((s, e) => s + e.claimedP, 0);
    const approvedP = expenses.reduce((s, e) => s + e.approved, 0);
    const grossP = earningsP + approvedP;
    const totalDeductionP = DEDUCTION_KEYS.reduce((s, k) => s + d.deductions[k], 0);
    const netP = grossP - totalDeductionP - n.suspenseAmount;
    return { resultKm, expectedLitres, variationLitres, mileageShortSuggestedP, earnings, earningsP, expenses, claimedP, approvedP, rejectedP: claimedP - approvedP, grossP, totalDeductionP, netP };
}
/**
 * The stored shape of a final settlement (rupees, quantities as plain numbers).
 * `km` compares the actual KM (Result KM) with the campaign's Total Allowed KM, including the one-time Extra KM pool. It is a
 * KM report only: no amount is derived from it, so Gross / Net stay exactly as calculated above (no second diesel payment).
 */
export function finalData(d, campaign) {
    const c = calculateFinal(d);
    const h = (k) => d.n[k] / 100;
    return {
        jsNumber: d.jsNumber, location: d.location, reportingDate: d.reportingDate, travelDetails: d.travelDetails ?? null, campaignFrom: campaign.fromDate, campaignTo: campaign.toDate, totalDays: campaign.totalDays,
        estimatedKmPerDay: h("estimatedKmPerDay"),
        km: campaign.km ? kmUsage(campaign.km, c.resultKm) : null,
        fuel: { fixedMileage: h("fixedMileage"), openingKm: h("openingKm"), closingKm: h("closingKm"), resultKm: c.resultKm, dieselCost: h("dieselCost"), ioclLitres: h("ioclLitres"), ioclKms: h("ioclKms"), expectedLitres: c.expectedLitres, variationLitres: c.variationLitres, mileageShortSuggested: rupees(c.mileageShortSuggestedP) },
        estimate: { estimatedBudget: h("estimatedBudget"), estimatedKm: h("estimatedKm"), estimatedFuel: h("estimatedFuel") },
        rates: { perDaySalary: h("perDaySalary"), perDayFood: h("perDayFood"), travelPay: h("travelPay"), travelKm: h("travelKm"), travelRate: h("travelRate") },
        days: { onRoadDays: h("onRoadDays"), onRoadSundays: h("onRoadSundays") },
        earnings: c.earnings.map((e) => ({ key: e.key, label: e.label, quantity: e.quantity, rate: e.rate, amount: rupees(e.amountP) })),
        expenses: c.expenses.map((e) => ({ category: e.category, label: e.label, description: e.description, quantity: e.quantity / 100, cost: rupees(e.cost), claimed: rupees(e.claimedP), approved: rupees(e.approved), rejected: rupees(e.rejectedP) })),
        deductions: Object.fromEntries(DEDUCTION_KEYS.map((k) => [k, rupees(d.deductions[k])])),
        otherDeductionRemark: d.otherDeductionRemark,
        earningsTotal: rupees(c.earningsP), claimedTotal: rupees(c.claimedP), approvedTotal: rupees(c.approvedP), rejectedTotal: rupees(c.rejectedP),
        gross: rupees(c.grossP), totalDeduction: rupees(c.totalDeductionP), suspenseAmount: h("suspenseAmount"), netAmount: rupees(c.netP),
    };
}
