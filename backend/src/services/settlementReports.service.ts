/* eslint-disable @typescript-eslint/no-explicit-any */
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { fileURLToPath } from "node:url";
import { config } from "../config/index.js";
import { Driver } from "../models/Driver.js";
import { PAYMENT_MODE_LABEL, SettlementPayment } from "../models/SettlementPayment.js";
import { Vehicle } from "../models/Vehicle.js";
import { AppError } from "../utils/AppError.js";
import { maskTail, unseal } from "../utils/secureField.js";
import { savedDeductionLines } from "../utils/settlement.js";
import { CATEGORY_LABEL, ensureDseNumber } from "./settlement.service.js";

/** Reports (RSO), the RSA accounts export and the individual driver salary PDF. All read the saved records only. */

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const validId = (id: unknown): id is string => typeof id === "string" && /^[a-f0-9]{24}$/i.test(id);
const ist = (d: Date | string | null | undefined) => (d ? new Date(new Date(d).getTime() + 5.5 * 3600_000).toISOString().slice(0, 16).replace("T", " ") : "");
const dmy = (ymd: string | null | undefined) => (ymd && YMD.test(ymd) ? `${ymd.slice(8, 10)}-${ymd.slice(5, 7)}-${ymd.slice(0, 4)}` : ymd ?? "");

// ------------------------------------------------------------------------------------------------ report data

export interface ReportQuery { from?: string; to?: string; category?: string; q?: string }

/** Payment details recorded by RSA's payment Entry (blank while the payment is not yet paid). */
const payRef = (p: any) => {
  const c = p.completion ?? {};
  return { referenceNumber: c.referenceNumber ?? "", referenceDate: c.referenceDate ?? "", paymentDate: c.paymentDate ?? "", paymentMode: PAYMENT_MODE_LABEL[c.paymentMode] ?? c.paymentMode ?? "", paymentBank: c.bankName ?? "" };
};
const REF_COLS: Col[] = [
  { header: "Ref. No.", key: "referenceNumber", width: 20 }, { header: "Ref. Date", key: "referenceDate" }, { header: "Pay. Date", key: "paymentDate" },
  { header: "Payment Mode", key: "paymentMode", width: 14 }, { header: "Paid From Bank", key: "paymentBank", width: 20 },
];

export async function approvedPaymentRows(q: ReportQuery, statuses: string[] = ["APPROVED", "COMPLETED"]) {
  const filter: any = { status: { $in: statuses } };
  if (q.category === "DAILY" || q.category === "FINAL") filter.category = q.category;
  if (q.from && YMD.test(q.from)) filter.toDate = { $gte: q.from };
  if (q.to && YMD.test(q.to)) filter.fromDate = { $lte: q.to };
  const rows: any[] = await SettlementPayment.find(filter).sort({ reviewedAt: -1 }).limit(5000).lean();
  return rows.map((p) => ({
    _id: String(p._id), paymentNumber: p.paymentNumber, category: CATEGORY_LABEL[p.category as "DAILY" | "FINAL"], status: p.status, trackupNumber: p.trackupNumber, pifNumber: p.pifNumber ?? "", jsNumber: p.jsNumber ?? "",
    clientName: p.clientName ?? "", projectType: p.projectType, vehicleNo: p.vehicleNo ?? "", driverNumber: p.driverNumber ?? "", driverName: p.driverName ?? "", fromDate: p.fromDate, toDate: p.toDate,
    amount: p.amount, accountName: p.bank?.accountName ?? "", bankName: p.bank?.bankName ?? "", ifscCode: p.bank?.ifscCode ?? "", accountNumber: p.bank?.accountMasked ?? "",
    submittedBy: p.submittedBy, approvedBy: p.reviewedBy ?? "", approvedAt: p.reviewedAt ?? null,
    ...payRef(p),
  }));
}

export async function driverListRows(q: ReportQuery) {
  const filter: any = {};
  if (q.q?.trim()) {
    const rx = new RegExp(q.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ driverNumber: rx }, { driverName: rx }, { mobileNumber: rx }];
  }
  const [drivers, finals]: any[] = await Promise.all([
    Driver.find(filter).sort({ driverNumber: 1 }).limit(5000).lean(),
    SettlementPayment.aggregate([{ $match: { category: "FINAL", status: { $in: ["APPROVED", "COMPLETED"] } } }, { $group: { _id: "$driver", n: { $sum: 1 }, net: { $sum: "$amount" } } }]),
  ]);
  const byDriver = new Map(finals.map((f: any) => [String(f._id), f]));
  return drivers.map((d: any) => ({
    _id: String(d._id), driverNumber: d.driverNumber, driverName: d.driverName, driverType: d.driverType ?? "", mobileNumber: d.mobileNumber ?? "", status: d.status ?? "",
    availability: d.availability?.status ?? "", perDaySalary: d.salary ?? 0, bankName: d.bankName ?? "", ifscCode: d.ifscCode ?? "", accountNumber: maskTail(d.accountNumber) ?? "",
    settlements: (byDriver.get(String(d._id)) as any)?.n ?? 0, settledAmount: Math.round(((byDriver.get(String(d._id)) as any)?.net ?? 0) * 100) / 100,
  }));
}

// ------------------------------------------------------------------------------------------------ Vehicle MIS (vehicle master)

/**
 * Vehicle MIS = the vehicle master register, in the column order of the reference "VehicleMISReport" sheet.
 * Every field comes from the saved vehicle record; nothing is derived or defaulted. Document columns (FC, Insurance,
 * State Permit, RTO / Police Permission) show the latest next-renewal date of that document, the same rule the vehicle
 * list uses for FC / Insurance expiry. A missing or invalid value stays blank (never 01-Jan-1900).
 */
type MisKind = "text" | "int" | "date";
export const VEHICLE_MIS_COLUMNS: { key: string; header: string; kind: MisKind; width: number }[] = [
  { key: "vehicleNo", header: "Vehicle No", kind: "text", width: 16 },
  { key: "make", header: "Make", kind: "text", width: 14 },
  { key: "model", header: "Model", kind: "text", width: 16 },
  { key: "yom", header: "Y.O.M", kind: "int", width: 7 },
  { key: "purchaseDate", header: "Purchase Date", kind: "date", width: 12.5 },
  { key: "type", header: "Vehicle Type", kind: "text", width: 12 },
  { key: "stepneyStatus", header: "Stepney Status", kind: "text", width: 11 },
  { key: "batteryStatus", header: "Battery Status", kind: "text", width: 11 },
  { key: "oilTopUpOn", header: "Oil Top Up On", kind: "date", width: 12.5 },
  { key: "greasePackingOn", header: "Grease Packing On", kind: "date", width: 12.5 },
  { key: "generalCheckUpOn", header: "General Check Up On", kind: "date", width: 12.5 },
  { key: "currentRunning", header: "Current Running", kind: "int", width: 10 },
  { key: "totalRunning", header: "Total Running", kind: "int", width: 10 },
  { key: "fc", header: "Fc", kind: "date", width: 12.5 },
  { key: "insurance", header: "Insurance", kind: "date", width: 12.5 },
  { key: "statePermit", header: "State Permit", kind: "date", width: 12.5 },
  { key: "rtoPermission", header: "Rto Permission", kind: "date", width: 12.5 },
  { key: "policePermission", header: "Police Permission", kind: "date", width: 12.5 },
  { key: "condition", header: "Condition", kind: "text", width: 14 },
  { key: "specification", header: "Specification", kind: "text", width: 22 },
];
const validYmd = (v: unknown): string => (typeof v === "string" && YMD.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && Number(v.slice(0, 4)) >= 1950 ? v : "");
const latestRenewal = (list: unknown): string => validYmd((Array.isArray(list) ? list : []).reduce<string>((m, e: any) => (validYmd(e?.nextRenewalDate) > m ? validYmd(e?.nextRenewalDate) : m), ""));
const txt = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown): number | "" => (typeof v === "number" && Number.isFinite(v) ? v : "");

export async function vehicleMisRows(q: ReportQuery) {
  const filter: any = { status: { $ne: "DRAFT" } }; // drafts are incomplete records (they may not even have a vehicle number)
  if (q.q?.trim()) {
    const rx = new RegExp(q.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ vehicleNo: rx }, { make: rx }, { model: rx }, { type: rx }];
  }
  const list: any[] = await Vehicle.find(filter).sort({ vehicleNo: 1 }).limit(10000).lean();
  return list.map((v) => ({
    _id: String(v._id), vehicleNo: txt(v.vehicleNo), make: txt(v.make), model: txt(v.model), yom: num(v.yearOfManufacture), purchaseDate: validYmd(v.purchaseDate),
    type: txt(v.type), stepneyStatus: txt(v.stepneyStatus), batteryStatus: txt(v.batteryStatus), oilTopUpOn: validYmd(v.oilTopUpOn), greasePackingOn: validYmd(v.greasePackingOn),
    generalCheckUpOn: validYmd(v.generalCheckUpOn), currentRunning: num(v.currentRunning), totalRunning: num(v.totalRunning), fc: latestRenewal(v.fc), insurance: latestRenewal(v.insurance),
    statePermit: latestRenewal(v.permit), rtoPermission: latestRenewal(v.rtoPermission), policePermission: latestRenewal(v.policePermission), condition: txt(v.condition),
    specification: txt(v.specification), status: v.status,
  }));
}

/** Workbook laid out like the reference VehicleMISReport.xls: narrow spacer column A, merged bold title, spacer row,
 *  bold centred wrapped header with thin borders, Arial 10 data with thin borders, dd-MMM-yyyy dates. */
export async function vehicleMisWorkbook(rows: Awaited<ReturnType<typeof vehicleMisRows>>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = `${config.companyName} Driver Settlement`;
  wb.created = new Date();
  const ws = wb.addWorksheet("Sheet1", { views: [{ state: "frozen", xSplit: 2, ySplit: 3, showGridLines: false }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  const font = { name: "Arial", size: 10 };
  const thin = { style: "thin" as const, color: { argb: "FFD3D3D3" } }; // light-grey grid, as in the reference
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const last = VEHICLE_MIS_COLUMNS.length + 1; // data runs B..U
  ws.getColumn(1).width = 0.6; // spacer column, as in the reference
  VEHICLE_MIS_COLUMNS.forEach((c, i) => { ws.getColumn(i + 2).width = c.width; });

  ws.mergeCells(1, 1, 1, last);
  const title = ws.getCell(1, 1);
  title.value = "Vehicle MIS";
  title.font = { ...font, bold: true };
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 18;
  ws.getRow(2).height = 3;

  const head = ws.getRow(3);
  VEHICLE_MIS_COLUMNS.forEach((c, i) => {
    const cell = head.getCell(i + 2);
    cell.value = c.header;
    cell.font = { ...font, bold: true };
    cell.alignment = { horizontal: "center", vertical: "top", wrapText: true };
    cell.border = border;
  });
  head.height = 30;

  rows.forEach((r: any, ri) => {
    const row = ws.getRow(4 + ri);
    VEHICLE_MIS_COLUMNS.forEach((c, i) => {
      const cell = row.getCell(i + 2);
      const v = r[c.key];
      if (c.kind === "date") {
        cell.value = v ? new Date(`${v}T00:00:00Z`) : null; // real Excel date; blank when not recorded
        cell.numFmt = "dd-mmm-yyyy";
      } else if (c.kind === "int") {
        cell.value = v === "" ? null : v;
        cell.numFmt = "0";
      } else cell.value = v || null;
      cell.font = font;
      // "General" horizontal (text left, numbers right) as in the reference; dates are real dates but left-aligned like the reference's date text
      cell.alignment = { vertical: "top", wrapText: c.kind === "text", ...(c.kind === "date" ? { horizontal: "left" as const } : {}) };
      cell.border = border;
    });
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const kmCell = (v: unknown): number | "" => (typeof v === "number" && Number.isFinite(v) ? v : "");

export async function driverSalaryRows(q: ReportQuery) {
  const filter: any = { category: "FINAL", status: { $in: ["APPROVED", "COMPLETED"] } };
  if (q.from && YMD.test(q.from)) filter.toDate = { $gte: q.from };
  if (q.to && YMD.test(q.to)) filter.fromDate = { $lte: q.to };
  const rows: any[] = await SettlementPayment.find(filter).sort({ reviewedAt: -1 }).limit(5000).lean();
  return rows.map((p) => ({
    _id: String(p._id), paymentNumber: p.paymentNumber, status: p.status, driverNumber: p.driverNumber, driverName: p.driverName, vehicleNo: p.vehicleNo, trackupNumber: p.trackupNumber, pifNumber: p.pifNumber ?? "", jsNumber: p.jsNumber ?? "",
    clientName: p.clientName ?? "", fromDate: p.fromDate, toDate: p.toDate, onRoadDays: p.data?.days?.onRoadDays ?? 0, onRoadSundays: p.data?.days?.onRoadSundays ?? 0, haltDays: p.data?.days?.haltDays ?? 0,
    // KM allowance (blank for signage and for settlements saved before it was recorded); actual KM is always the Result KM
    regularKmPerDay: kmCell(p.data?.km?.kmPerDay), extraKmPerDay: kmCell(p.data?.km ? p.data.km.extraKmAllotted : null), allowedKmPerDay: kmCell(p.data?.km?.allowedKmPerDay),
    totalAllowedKm: kmCell(p.data?.km?.totalAllowedKm), actualKm: kmCell(p.data?.km?.actualKm ?? p.data?.fuel?.resultKm), excessKm: kmCell(p.data?.km?.excessKm),
    earnings: p.data?.earningsTotal ?? 0, approvedExpenses: p.data?.approvedTotal ?? 0, gross: p.data?.gross ?? 0, totalDeduction: p.data?.totalDeduction ?? 0, suspenseAmount: p.data?.suspenseAmount ?? 0,
    netAmount: p.amount, approvedBy: p.reviewedBy ?? "", approvedAt: p.reviewedAt ?? null, ...payRef(p),
  }));
}

// ------------------------------------------------------------------------------------------------ Excel

interface Col { header: string; key: string; width?: number; money?: boolean; date?: boolean }

async function workbook(title: string, cols: Col[], rows: Record<string, unknown>[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = `${config.companyName} Driver Settlement`;
  wb.created = new Date();
  const ws = wb.addWorksheet(title.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width ?? Math.max(12, c.header.length + 2) }));
  for (const r of rows) ws.addRow(Object.fromEntries(cols.map((c) => [c.key, c.date ? ist(r[c.key] as any) : r[c.key] ?? ""])));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } };
  cols.forEach((c, i) => {
    if (c.money) ws.getColumn(i + 1).numFmt = "#,##0.00";
  });
  const moneyCols = cols.filter((c) => c.money);
  if (rows.length && moneyCols.length) {
    const total = ws.addRow(Object.fromEntries([[cols[0].key, "TOTAL"], ...moneyCols.map((c) => [c.key, Math.round(rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0) * 100) / 100])]));
    total.font = { bold: true };
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const PAYMENT_COLS: Col[] = [
  { header: "Payment No", key: "paymentNumber", width: 20 }, { header: "Category", key: "category", width: 24 }, { header: "Status", key: "status" }, { header: "Trackup No", key: "trackupNumber", width: 16 }, { header: "PIF No", key: "pifNumber", width: 14 },
  { header: "JS No", key: "jsNumber" }, { header: "Client", key: "clientName", width: 24 }, { header: "Project Type", key: "projectType" }, { header: "Vehicle No", key: "vehicleNo", width: 14 },
  { header: "Driver Code", key: "driverNumber" }, { header: "Driver Name", key: "driverName", width: 22 }, { header: "From", key: "fromDate" }, { header: "To", key: "toDate" },
  { header: "Amount (INR)", key: "amount", money: true, width: 16 }, { header: "Account Name", key: "accountName", width: 22 }, { header: "Bank", key: "bankName", width: 22 }, { header: "IFSC", key: "ifscCode" },
  { header: "Account Number", key: "accountNumber", width: 20 }, { header: "Submitted By", key: "submittedBy" }, { header: "Approved By", key: "approvedBy" }, { header: "Approved On", key: "approvedAt", date: true, width: 18 },
];

/** RSA accounts export: approved entries only, with the full account number (the file goes to the accounts team). */
export async function accountsExport(rows: any[], sheet = "Approved Payments") {
  const shaped = rows.map((p) => ({
    paymentNumber: p.paymentNumber, category: CATEGORY_LABEL[p.category as "DAILY" | "FINAL"], status: p.status, trackupNumber: p.trackupNumber, pifNumber: p.pifNumber ?? "", jsNumber: p.jsNumber ?? "", clientName: p.clientName ?? "",
    projectType: p.projectType, vehicleNo: p.vehicleNo ?? "", driverNumber: p.driverNumber ?? "", driverName: p.driverName ?? "", fromDate: p.fromDate, toDate: p.toDate, amount: p.amount,
    accountName: p.bank?.accountName ?? "", bankName: p.bank?.bankName ?? "", ifscCode: p.bank?.ifscCode ?? "", accountNumber: (p.status === "APPROVED" ? unseal(p.bank?.account) : null) ?? p.bank?.accountMasked ?? "", // full number only on payable rows
    submittedBy: p.submittedBy, approvedBy: p.reviewedBy ?? "", approvedAt: p.reviewedAt,
  }));
  return workbook(sheet, PAYMENT_COLS, shaped);
}

export async function reportWorkbook(kind: string, q: ReportQuery): Promise<{ name: string; buffer: Buffer }> {
  if (kind === "approved-payments") {
    const rows = await approvedPaymentRows(q);
    return { name: "approved-payment-report", buffer: await workbook("Approved Payments", [...PAYMENT_COLS, ...REF_COLS], rows) };
  }
  if (kind === "vehicle-mis") return { name: "vehicle-mis", buffer: await vehicleMisWorkbook(await vehicleMisRows(q)) };
  if (kind === "driver-list")
    return { name: "driver-list-report", buffer: await workbook("Drivers", [
      { header: "Driver Code", key: "driverNumber" }, { header: "Driver Name", key: "driverName", width: 22 }, { header: "Type", key: "driverType", width: 18 }, { header: "Mobile", key: "mobileNumber", width: 16 },
      { header: "Status", key: "status" }, { header: "Availability", key: "availability", width: 16 }, { header: "Per Day Salary", key: "perDaySalary", money: true }, { header: "Bank", key: "bankName", width: 22 },
      { header: "IFSC", key: "ifscCode" }, { header: "Account (masked)", key: "accountNumber", width: 20 }, { header: "Settlements", key: "settlements" }, { header: "Settled Amount", key: "settledAmount", money: true },
    ], await driverListRows(q)) };
  if (kind === "driver-salary")
    return { name: "driver-salary-report", buffer: await workbook("Driver Salary", [
      { header: "DSE No", key: "paymentNumber", width: 20 }, { header: "Status", key: "status" }, { header: "Driver Code", key: "driverNumber" }, { header: "Driver", key: "driverName", width: 22 },
      { header: "Vehicle No", key: "vehicleNo", width: 14 }, { header: "Trackup No", key: "trackupNumber", width: 16 }, { header: "PIF No", key: "pifNumber", width: 14 }, { header: "JS No", key: "jsNumber" }, { header: "Client", key: "clientName", width: 24 },
      { header: "From", key: "fromDate" }, { header: "To", key: "toDate" }, { header: "On Road Days", key: "onRoadDays" }, { header: "On Road Sundays", key: "onRoadSundays" }, { header: "Halt Days", key: "haltDays" },
      { header: "Regular KM/Day", key: "regularKmPerDay" }, { header: "Extra KM/Day", key: "extraKmPerDay" }, { header: "Allowed KM/Day", key: "allowedKmPerDay" },
      { header: "Total Allowed KM", key: "totalAllowedKm" }, { header: "Actual KM", key: "actualKm" }, { header: "Excess KM", key: "excessKm" },
      { header: "Earnings", key: "earnings", money: true }, { header: "Approved Expenses", key: "approvedExpenses", money: true }, { header: "Gross", key: "gross", money: true },
      { header: "Total Deduction", key: "totalDeduction", money: true }, { header: "Suspense", key: "suspenseAmount", money: true }, { header: "Net Amount", key: "netAmount", money: true },
      { header: "Approved By", key: "approvedBy" }, { header: "Approved On", key: "approvedAt", date: true, width: 18 }, ...REF_COLS,
    ], await driverSalaryRows(q)) };
  throw new AppError("Unknown report", 404);
}

// ------------------------------------------------------------------------------------------------ individual driver salary PDF

const LOGO = fileURLToPath(new URL("../../assets/adinn-logo.png", import.meta.url)); // transparent, cropped only (aspect ratio kept)
const num2 = (n: unknown) => (Number(n) || 0).toFixed(2);
const plain = (n: unknown) => String(Math.round((Number(n) || 0) * 100) / 100);
const dmySlash = (d: Date | string | null | undefined) => {
  if (!d) return "";
  const x = new Date(new Date(d).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
  return `${x.slice(8, 10)}/${x.slice(5, 7)}/${x.slice(0, 4)}`;
};

/**
 * One A4 statement per approved final settlement (never for a pending / rejected one). The layout follows the
 * "ROADSHOW - DRIVER SALARY AND EXPENSES" reference: same sections, labels, order and positions.
 */
export async function driverSalaryPdf(id: string): Promise<{ name: string; buffer: Buffer }> {
  if (!validId(id)) throw new AppError("Invalid payment id", 400);
  const found: any = await SettlementPayment.findById(id).select("category status").lean();
  if (!found || found.category !== "FINAL") throw new AppError("Final settlement not found", 404);
  if (found.status !== "APPROVED" && found.status !== "COMPLETED") throw new AppError("The salary statement is available only after RSO approves the final settlement", 409);
  const dseNo = await ensureDseNumber(id);
  const p: any = await SettlementPayment.findById(id).lean();
  const d = p.data;

  const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `Driver Salary and Expenses - DSE ${dseNo}`, Author: config.companyName } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));

  const L = 39;
  const R = 559;
  const FS = 7.5;
  const GREY = "#BDBDBD";
  const txt = (s: string, x: number, y: number, o: { w?: number; align?: "left" | "right" | "center"; bold?: boolean; size?: number } = {}) => {
    doc.font(o.bold ? "Helvetica-Bold" : "Helvetica").fontSize(o.size ?? FS).fillColor("#000");
    doc.text(s, x, y, { width: o.w, align: o.align ?? "left", lineBreak: !!o.w && o.align === undefined, height: o.w ? 30 : undefined });
  };
  const fit = (s: string, w: number, bold = false, size = FS) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
    if (doc.widthOfString(s) <= w) return s;
    let t = s;
    while (t.length > 1 && doc.widthOfString(`${t}…`) > w) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  };
  const hline = (x1: number, x2: number, y: number, w = 0.7, color = "#000") => doc.moveTo(x1, y).lineTo(x2, y).lineWidth(w).strokeColor(color).stroke();

  // ---- header: title block left, logo right
  const title = p.projectType === "SIGNAGE" ? "SIGNAGE" : "ROADSHOW";
  txt(title, L, 56, { bold: true, size: 12 });
  txt("DRIVER SALARY AND EXPENSES", L, 70, { size: 10 });
  txt(`DSE No. : ${dseNo}`, L, 82, { size: 6.5 });
  const logoW = 140; // height follows the image's own aspect ratio
  doc.image(LOGO, R - logoW - 8, 48, { width: logoW });
  txt(`Accounted on : ${dmySlash(p.reviewedAt)}`, 360, 116, { size: 6.5, w: R - 360, align: "right" });
  txt(`Accounted by : ${p.reviewedBy ?? "__________________"}`, 360, 126, { size: 6.5, w: R - 360, align: "right" });
  if (p.completion?.referenceNumber) txt(`Payment Ref : ${p.completion.referenceNumber}  (${dmy(p.completion.paymentDate)})`, 360, 136, { size: 6.5, bold: true, w: R - 360, align: "right" });
  hline(L, 337, 137);

  // ---- campaign details (two columns)
  txt("Campaign Details", L, 150, { bold: true });
  const lv = (label: string, value: string, x: number, y: number, vx: number, vw: number) => {
    txt(label, x, y);
    doc.font("Helvetica").fontSize(FS).text(value || "", vx, y, { width: vw, lineBreak: true, height: 18 });
  };
  lv("JS No.", d.jsNumber ?? p.jsNumber ?? p.trackupNumber, L, 165, 113, 170);
  lv("Client", p.clientName ?? "", L, 177, 113, 120);
  lv("PIF No.", p.pifNumber ?? "", L, 190, 113, 170);
  lv("Campaign Period", `From: ${dmy(d.campaignFrom)}   To: ${dmy(d.campaignTo)}`, L, 203, 113, 180);
  lv("Total Days", String(d.totalDays ?? ""), L, 218, 113, 170);
  lv("Location", fit(d.location ?? "", 170), L, 231, 113, 170);
  lv("Vehicle No.", p.vehicleNo ?? "", 299, 165, 387, 170);
  lv("Driver Name", p.driverName ?? "", 299, 177, 387, 170);
  lv("Driver Code", p.driverNumber ?? "", 299, 218, 387, 170);
  lv("Reporting Date", dmy(d.reportingDate), 299, 231, 387, 170);
  lv("Estimated KM Per Day", plain(d.estimatedKmPerDay), 299, 244, 387, 170);
  // KM allowance (RoadShow, settlements saved with it): free slots of the right-hand column, existing positions unchanged
  const km = d.km;
  if (km && km.totalAllowedKm !== null && km.totalAllowedKm !== undefined) {
    lv("Regular / Extra KM/day", `${plain(km.kmPerDay)} + ${plain(km.extraKmAllotted)} = ${plain(km.allowedKmPerDay ?? Number(km.kmPerDay) + Number(km.extraKmAllotted))} KM/day`, 299, 190, 387, 170);
    lv("Actual / Excess KM", `${plain(km.actualKm)} / ${plain(km.excessKm)}`, 299, 203, 387, 170);
  }

  // ---- ON-ROAD EXPENSES bar
  doc.rect(L, 259, R - L, 15).fillAndStroke(GREY, "#888");
  txt("ON-ROAD EXPENSES", L, 263.5, { bold: true, w: R - L, align: "center" });

  // ---- fuel consumption + on-road budget estimation
  txt("Fuel Consumption", L, 284, { bold: true });
  txt("On-Road budget Estimation", 330, 284, { bold: true });
  const fy = [299, 311.5, 324, 336.5];
  [["Fixed Mileage", plain(d.fuel.fixedMileage), `Fuel Cost : ${plain(d.fuel.dieselCost)}`], ["Opening KM", plain(d.fuel.openingKm), `IOCL card usage in Ltrs : ${plain(d.fuel.ioclLitres)}`],
    ["Closing KM", plain(d.fuel.closingKm), `IOCL card usage in KMs : ${plain(d.fuel.ioclKms)}`], ["Result", plain(d.fuel.resultKm), `Variation in ltrs : ${plain(d.fuel.variationLitres)}`]]
    .forEach(([a, b, c], i) => { txt(a, L, fy[i]); txt(b, 124, fy[i]); txt(c, 175, fy[i]); });
  [["Estimated Budget", num2(d.estimate.estimatedBudget)], ["Estimated KM", plain(d.estimate.estimatedKm)], ["Estimated Fuel", num2(d.estimate.estimatedFuel)],
    ...(km && km.totalAllowedKm !== null && km.totalAllowedKm !== undefined ? [["Total Allowed KM", plain(km.totalAllowedKm)]] : [])]
    .forEach(([a, b], i) => { txt(a, 330, fy[i]); txt(b, 452, fy[i]); });

  // ---- ON-ROAD EXPENSES DETAILS table
  txt("ON-ROAD EXPENSES DETAILS", L, 351, { bold: true, w: R - L, align: "center" });
  const cols = [L, 163, 305, 376, 473, R];
  const heads = ["Description", "Others", "Cost", "Days/Hrs/Kms/QTY", "Approved Amount"];
  const RH = 12.6;
  let y = 362;
  doc.rect(L, y, R - L, RH + 1).fillAndStroke("#D9D9D9", "#000");
  heads.forEach((h, i) => txt(h, cols[i], y + 3.3, { bold: true, w: cols[i + 1] - cols[i], align: "center" }));
  y += RH + 1;
  const rows: string[][] = [
    ...d.earnings.filter((e: any) => e.amount > 0).map((e: any) => [e.key === "salary" ? "On Road Days" : e.label, "", plain(e.rate), plain(e.quantity), num2(e.amount)]),
    ...d.expenses.map((e: any) => [e.label, e.description ?? "", plain(e.cost), plain(e.quantity), num2(e.approved)]),
  ];
  for (const r of rows) {
    if (y > 742) { doc.addPage(); y = 50; }
    doc.rect(L, y, R - L, RH).lineWidth(0.5).strokeColor("#000").stroke();
    for (let i = 1; i < cols.length - 1; i++) doc.moveTo(cols[i], y).lineTo(cols[i], y + RH).stroke();
    r.forEach((v, i) => {
      const w = cols[i + 1] - cols[i] - 6;
      const right = i >= 2;
      txt(fit(v, w), cols[i] + 3, y + 3, { w, align: right ? "right" : "left" });
    });
    y += RH;
  }
  // vertical borders of the header row
  for (let i = 1; i < cols.length - 1; i++) doc.moveTo(cols[i], 362).lineTo(cols[i], 362 + RH + 1).lineWidth(0.5).stroke();

  // ---- totals and deductions (right side, as in the reference)
  if (y > 640) { doc.addPage(); y = 50; }
  const LBL_R = 473;
  const VAL_R = R - 1;
  const step = 16.2;
  y += 5;
  txt("Gross :", 300, y, { bold: true, w: LBL_R - 300 - 8, align: "right" }); txt(num2(d.gross), LBL_R, y, { bold: true, w: VAL_R - LBL_R, align: "right" });
  y += step;
  for (const [label, value] of savedDeductionLines(d.deductions)) {
    txt(`${label} :`, 233, y);
    txt(num2(value), LBL_R, y, { w: VAL_R - LBL_R, align: "right" });
    y += step;
  }
  txt("Total Deduction :", 233, y, { bold: true }); txt(num2(d.totalDeduction), LBL_R, y, { bold: true, w: VAL_R - LBL_R, align: "right" });
  y += step;
  txt("SUSPENSE AMOUNT :", 300, y, { bold: true, w: LBL_R - 300 - 8, align: "right" }); txt(num2(d.suspenseAmount), LBL_R, y, { bold: true, w: VAL_R - LBL_R, align: "right" });
  y += step;
  txt("NET AMOUNT :", 300, y, { bold: true, w: LBL_R - 300 - 8, align: "right" }); txt(num2(d.netAmount), LBL_R, y, { bold: true, w: VAL_R - LBL_R, align: "right" });

  // ---- signatures + driver bank strip
  y += 38;
  hline(78, 259, y, 0.5, "#777");
  hline(358, 500, y, 0.5, "#777");
  txt("Authorised Signatory", 78, y + 8, { bold: true, w: 181, align: "center" });
  txt("Prepared & Verified", 358, y + 8, { bold: true, w: 142, align: "center" });
  hline(52, 549, y + 20, 0.8);
  const by = y + 22;
  doc.rect(52, by, 497, 13).fill(GREY);
  const bc = [52, 130, 245, 352, 478, 549];
  const bank = [p.driverNumber ?? "", p.bank?.accountName || p.driverName || "", unseal(p.bank?.account) ?? p.bank?.accountMasked ?? "", p.bank?.bankName ?? "", p.bank?.ifscCode ?? ""];
  ["Driver Code", "Driver Name", "Account No", "Bank", "IFC Code"].forEach((h, i) => {
    txt(h, bc[i], by + 3.5, { bold: true, w: bc[i + 1] - bc[i], align: "center" });
    txt(fit(String(bank[i]).toUpperCase(), bc[i + 1] - bc[i] - 4, true), bc[i], by + 18, { bold: true, w: bc[i + 1] - bc[i], align: "center" });
  });

  doc.end();
  const safe = `${p.driverNumber ?? "driver"}-DSE-${dseNo}`.replace(/[^A-Za-z0-9-]+/g, "_");
  return { name: `driver-salary-${safe}.pdf`, buffer: await done };
}