/* eslint-disable @typescript-eslint/no-explicit-any */
import ExcelJS from "exceljs";
import { Driver } from "../models/Driver.js";
import { IoclTransaction } from "../models/IoclTransaction.js";
import { TrackingProject } from "../models/TrackingProject.js";
import { Vehicle } from "../models/Vehicle.js";
import { AllotmentEvent, VehicleAllotment } from "../models/VehicleAllotment.js";
import { AppError } from "../utils/AppError.js";
import { parseIoclCsv } from "../utils/iocl.js";

/** IOCL Data (RSA): import, list and export of fuel card statements. Reads other records; writes only its own collection. */

export async function importIocl(file: { buffer: Buffer; originalname: string } | undefined, username: string) {
  if (!file) throw new AppError("Choose the CSV file to upload", 400);
  if (!/\.csv$/i.test(file.originalname)) throw new AppError("Upload the IOCL statement as a .csv file", 400);
  const { rows, failed } = parseIoclCsv(file.buffer.toString("utf8"));
  await IoclTransaction.init(); // the unique Txn ID index must exist before the first insert
  let imported = 0, duplicate = 0, corrected = 0;
  for (const row of rows) {
    try {
      await IoclTransaction.create({ ...row, fileName: file.originalname.slice(0, 200), uploadedBy: username });
      imported++;
      if (row.amountCorrected) corrected++;
    } catch (e) {
      if ((e as { code?: number }).code === 11000) duplicate++;
      else {
        console.error("IOCL row failed", row.txnId, e);
        failed.push({ row: row.txnId, reason: "Could not be saved" });
      }
    }
  }
  return { imported, duplicate, failed: failed.length, corrected, errors: failed.slice(0, 100) };
}

export interface IoclQuery { from?: string; to?: string; vehicleNo?: string; product?: string; page?: number; limit?: number }
export type MatchStatus = "MATCHED" | "NO_DRIVER" | "NO_PROJECT" | "UNKNOWN_VEHICLE" | "NO_VEHICLE";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MAX_READ = 20_000;
const istDate = (d: Date | string) => new Date(new Date(d).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

function filterOf(q: IoclQuery) {
  for (const d of [q.from, q.to]) if (d && !YMD.test(d)) throw new AppError("Dates must be YYYY-MM-DD", 400);
  if (q.from && q.to && q.to < q.from) throw new AppError("The To date cannot be before the From date", 400);
  const f: any = {};
  if (q.from || q.to) f.txnDate = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  const v = q.vehicleNo?.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (v) f.vehicleNo = { $regex: v };
  if (q.product) f.product = String(q.product);
  return f;
}

async function read(filter: any) {
  const rows: any[] = await IoclTransaction.find(filter).sort({ txnDate: 1, txnTime: 1, txnId: 1 }).limit(MAX_READ + 1).lean();
  if (rows.length > MAX_READ) throw new AppError("Too many transactions; choose a shorter date range", 400);
  return rows;
}

/**
 * Matches each line to the project vehicle that held this registration on the transaction date, and to the driver of that
 * allotment at that moment. Anything the application does not know stays empty.
 */
async function matcher(rows: any[]) {
  const numbers = [...new Set(rows.map((r) => r.vehicleNo).filter(Boolean))];
  const [allotments, vehicles]: any[][] = await Promise.all([
    VehicleAllotment.find({ vehicleNo: { $in: numbers } }).sort({ allottedAt: 1 }).lean(),
    Vehicle.find({ vehicleNo: { $in: numbers } }).select("vehicleNo").lean(),
  ]);
  const ids = allotments.map((a) => a._id);
  const [projects, changes]: any[][] = await Promise.all([
    TrackingProject.find({ _id: { $in: allotments.map((a) => a.project) } }).lean(),
    AllotmentEvent.find({ allotment: { $in: ids }, action: "DRIVER_CHANGED" }).sort({ createdAt: 1 }).lean(),
  ]);
  const driverIds = [...allotments.map((a) => a.driver), ...changes.map((e) => e.details?.from?.driverId)].filter(Boolean);
  const drivers: any[] = await Driver.find({ _id: { $in: driverIds } }).select("driverNumber driverName mobileDigits").lean();
  const byId = <T extends { _id: unknown }>(list: T[]) => new Map(list.map((x) => [String(x._id), x]));
  const projectOf = byId(projects), driverOf = byId(drivers);
  const known = new Set(vehicles.map((v) => v.vehicleNo));

  return (row: any) => {
    const none = (status: MatchStatus) => ({ status, projectNo: null, department: null, clientName: null, projectLocation: null, driverCode: null, driverName: null, driverMobile: null });
    if (!row.vehicleNo) return none("NO_VEHICLE");
    const own = allotments.filter((a) => a.vehicleNo === row.vehicleNo);
    // from the allotment (or the campaign start, for one entered late) until it was released or replaced
    const covering = own.filter((a) => {
      const allotted = istDate(a.allottedAt);
      const start = a.projectStart && a.projectStart < allotted ? a.projectStart : allotted;
      const end = a.releasedAt ?? a.changedAt ?? (a.status !== "ACTIVE" ? a.updatedAt : null);
      return start <= row.txnDate && (!end || row.txnDate <= istDate(end));
    });
    const at = new Date(`${row.txnDate}T${row.txnTime || "23:59:59"}+05:30`);
    const a = [...covering].reverse().find((x) => new Date(x.allottedAt) <= at) ?? covering[0];
    const p = a && projectOf.get(String(a.project));
    if (!a || !p) return none(own.length || known.has(row.vehicleNo) ? "NO_PROJECT" : "UNKNOWN_VEHICLE");
    const later = changes.find((e) => String(e.allotment) === String(a._id) && new Date(e.createdAt) > at);
    const driver: any = driverOf.get(String(later ? later.details?.from?.driverId : a.driver));
    const d = p.details ?? {};
    return {
      status: (driver ? "MATCHED" : "NO_DRIVER") as MatchStatus,
      projectNo: p.projectCode ?? null, department: p.projectType ?? null, clientName: p.clientName ?? null,
      projectLocation: (p.projectType === "ROADSHOW" ? (d.reportingLocations ?? []).join(", ") : d.location) || null,
      driverCode: driver?.driverNumber ?? null, driverName: driver?.driverName ?? null, driverMobile: driver?.mobileDigits ?? null,
    };
  };
}

const isSale = (r: { txnType: string }) => r.txnType.toLowerCase() === "sale";
const paise = (n: number | null | undefined) => Math.round((n ?? 0) * 100);

export async function listIocl(q: IoclQuery) {
  const filter = filterOf(q);
  const rows = await read(filter);
  const match = await matcher(rows);
  const all = rows.map((r) => ({
    _id: String(r._id), txnId: r.txnId, txnDate: r.txnDate, txnTime: r.txnTime, txnType: r.txnType, vehicleNo: r.vehicleNo ?? null, product: r.product ?? null,
    rsp: r.rsp ?? null, quantity: r.quantity ?? null, amount: r.amount ?? null, fileAmount: r.fileAmount ?? null, amountCorrected: !!r.amountCorrected,
    odometer: r.odometer ?? null, location: r.location ?? null, match: match(r),
  }));
  // totals and corrections cover fuel sales; recharges and loyalty points are listed but never added up
  const totals = new Map<string, { vehicleNo: string; count: number; quantityH: number; amountP: number; status: MatchStatus }>();
  for (const r of all.filter(isSale)) {
    const key = r.vehicleNo ?? "";
    const t = totals.get(key) ?? { vehicleNo: key, count: 0, quantityH: 0, amountP: 0, status: r.match.status };
    t.count++;
    t.quantityH += paise(r.quantity);
    t.amountP += paise(r.amount);
    if (r.match.status !== "MATCHED") t.status = r.match.status;
    totals.set(key, t);
  }
  const vehicleTotals = [...totals.values()].sort((a, b) => a.vehicleNo.localeCompare(b.vehicleNo))
    .map(({ quantityH, amountP, ...t }) => ({ ...t, quantity: quantityH / 100, amount: amountP / 100 }));
  const limit = Math.min(Math.max(q.limit ?? 25, 1), 100);
  const page = Math.max(q.page ?? 1, 1);
  const products = (await IoclTransaction.distinct("product")).filter(Boolean).sort();
  return {
    items: [...all].reverse().slice((page - 1) * limit, page * limit), total: all.length, page, limit, products, vehicleTotals,
    summary: { sales: all.filter(isSale).length, amount: vehicleTotals.reduce((s, t) => s + paise(t.amount), 0) / 100, unmatched: vehicleTotals.filter((t) => t.status !== "MATCHED").length },
  };
}

export const EXPORT_HEADERS = ["S.NO", "PAYMENT DATE", "PROJECT NO", "DEPARTMENT", "CLIENT NAME", "VEHICLE NO", "LOCATION", "DRIVER CODE", "DRIVER NAME", "DRIVER NO", "AMOUNT", "DESCRIBTIONS", "REMARK"];
// column widths and styling of the sample "IOCL STATEMENT" workbook, Sheet1
const WIDTHS = [8.7265625, 11.1796875, 8.7265625, 12.54296875, 8.7265625, 8.7265625, 8.7265625, 8.7265625, 10.6328125, 13, 13.54296875, 8.7265625, 8.7265625];
const AMOUNT_COLUMN = 11;

/** Fuel sales of the chosen dates in the sample's layout. Unmatched details are left blank, never filled in. */
export async function exportIocl(q: IoclQuery): Promise<{ name: string; buffer: Buffer }> {
  if (!q.from || !q.to) throw new AppError("Choose the From and To dates to export", 400);
  const rows = (await read(filterOf(q))).filter(isSale);
  if (!rows.length) throw new AppError("There are no fuel transactions for these filters", 404);
  const match = await matcher(rows);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.columns = WIDTHS.map((width) => ({ width }));
  const thin = { style: "thin" as const, color: { indexed: 64 } as any };
  const style = (row: ExcelJS.Row, header: boolean) => {
    for (let c = 1; c <= EXPORT_HEADERS.length; c++) {
      const cell = row.getCell(c);
      cell.font = { name: "Times New Roman", family: 1, size: 11, bold: header, color: { theme: 1 } };
      cell.border = { left: thin, right: thin, top: thin, bottom: thin };
      cell.alignment = { horizontal: "center", vertical: "middle", ...(header || c !== AMOUNT_COLUMN ? { wrapText: true } : {}) };
      if (header) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" }, bgColor: { indexed: 64 } as any };
    }
  };
  const head = ws.addRow(EXPORT_HEADERS);
  head.height = 28.5;
  style(head, true);
  const numeric = (s: string | null) => (s && /^\d{1,15}$/.test(s) ? Number(s) : s);
  rows.forEach((r, i) => {
    const m = match(r);
    const [y, mo, d] = r.txnDate.split("-");
    style(ws.addRow([i + 1, `${d}.${mo}.${y}`, numeric(m.projectNo), m.department, m.clientName, r.vehicleNo ?? null, m.projectLocation, m.driverCode, m.driverName, numeric(m.driverMobile), r.amount, "IOCL", "NO"]), false);
  });
  const dot = (s: string) => s.split("-").reverse().join(".");
  const name = `IOCL STATEMENT ${q.from === q.to ? dot(q.from) : `${dot(q.from)} to ${dot(q.to)}`}.xlsx`;
  return { name, buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
}
