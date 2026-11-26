/* eslint-disable @typescript-eslint/no-explicit-any */
import ExcelJS from "exceljs";
import { Driver } from "../models/Driver.js";
import { DOC_SECTIONS, VEHICLE_TYPES, Vehicle } from "../models/Vehicle.js";
import { AppError } from "../utils/AppError.js";
import { normalizeIndianPhone } from "../utils/phone.js";
import { normalizeVehicleNo } from "../utils/vehicleNo.js";
import { validateAvailability } from "../validators/availability.validator.js";
import { licenceKeyOf, validateDriver } from "../validators/driver.validator.js";
import { validateVehicle } from "../validators/vehicle.validator.js";
import { createDriver } from "./driver.service.js";
import { createVehicle } from "./vehicle.service.js";

/**
 * RBP Excel bulk import for Vehicle Management and Driver Management.
 * The template columns map 1:1 onto the existing create forms, every row is checked with the existing validators (the same rules
 * as a manual save), duplicates are refused inside the file and against the database, and the import itself goes through the
 * existing createVehicle / createDriver services, so history, availability and numbering behave exactly as for a manual add.
 * An import is all-or-nothing at validation time: while any row has an error nothing is imported.
 */

export type ImportKind = "vehicles" | "drivers";
export const MAX_IMPORT_ROWS = 500;

interface Column {
  header: string;
  key: string;
  required?: boolean;
  /** How the cell is read: plain text, number, or a YYYY-MM-DD date (Excel dates are accepted too). */
  kind?: "text" | "number" | "date";
  format: string;
  samples: [string | number, string | number];
  /** Dropdown values offered in the template. */
  list?: string[];
}

const DOC_LABEL: Record<(typeof DOC_SECTIONS)[number], string> = {
  fc: "FC", insurance: "Insurance", rtoPermission: "RTO Permission", policePermission: "Police Permission", permit: "Permit",
};
const DRIVER_TYPE_LABEL: Record<string, string> = { COMPANY_DRIVER: "Company Driver", ACTING_DRIVER: "Acting Driver" };

export const VEHICLE_COLUMNS: Column[] = [
  { header: "Vehicle No", key: "vehicleNo", required: true, format: "Registration number, e.g. TN58BM6554 (spaces / hyphens allowed)", samples: ["TN58BM6554", "KA01AB1234"] },
  { header: "Make", key: "make", required: true, format: "Text, up to 80 characters", samples: ["Tata", "Mahindra"] },
  { header: "Model", key: "model", required: true, format: "Text, up to 80 characters", samples: ["Ace Gold", "Bolero Pik-Up"] },
  { header: "Type", key: "type", required: true, format: `One of: ${VEHICLE_TYPES.join(", ")}`, samples: [VEHICLE_TYPES[0], VEHICLE_TYPES[1]], list: VEHICLE_TYPES },
  { header: "Year of Manufacture", key: "yearOfManufacture", required: true, kind: "number", format: "Year, e.g. 2021", samples: [2021, 2019] },
  { header: "Purchase Date", key: "purchaseDate", required: true, kind: "date", format: "Date YYYY-MM-DD, not in the future", samples: ["2021-06-15", "2019-11-02"] },
  { header: "Current Running (KM)", key: "currentRunning", required: true, kind: "number", format: "Number", samples: [48210, 91500] },
  { header: "Total Running (KM)", key: "totalRunning", required: true, kind: "number", format: "Number", samples: [48210, 91500] },
  { header: "Stepney Status", key: "stepneyStatus", format: "Text (optional)", samples: ["Good", ""] },
  { header: "Battery Status", key: "batteryStatus", format: "Text (optional)", samples: ["Good", "Replace soon"] },
  { header: "Oil Top Up On", key: "oilTopUpOn", kind: "date", format: "Date YYYY-MM-DD (optional)", samples: ["2026-10-01", ""] },
  { header: "Grease Packing On", key: "greasePackingOn", kind: "date", format: "Date YYYY-MM-DD (optional)", samples: ["", ""] },
  { header: "General Check Up On", key: "generalCheckUpOn", kind: "date", format: "Date YYYY-MM-DD (optional)", samples: ["2026-09-20", ""] },
  ...DOC_SECTIONS.map((s): Column => ({
    header: `${DOC_LABEL[s]} Next Renewal Date`, key: `doc:${s}`, kind: "date",
    format: `Date YYYY-MM-DD (optional). The ${DOC_LABEL[s]} document file can be attached later in Vehicle Management.`,
    samples: [s === "fc" || s === "insurance" ? "2027-03-31" : "", s === "insurance" ? "2027-01-15" : ""],
  })),
  { header: "Condition", key: "condition", format: "Text, up to 120 characters (optional)", samples: ["Good", ""] },
  { header: "Specification", key: "specification", format: "Text, up to 200 characters (optional)", samples: ["Branded box body", ""] },
];

export const DRIVER_COLUMNS: Column[] = [
  { header: "Driver Name", key: "driverName", required: true, format: "Letters, spaces, dots, apostrophes and hyphens", samples: ["Murugan K", "Sampath M"] },
  { header: "Driver Type", key: "driverType", required: true, format: "Company Driver or Acting Driver", samples: ["Company Driver", "Acting Driver"], list: Object.values(DRIVER_TYPE_LABEL) },
  { header: "Mobile No", key: "mobileNumber", required: true, format: "10-digit Indian mobile number (+91 optional)", samples: ["9876543210", "9123456780"] },
  { header: "Address", key: "address", format: "Text, up to 200 characters (optional)", samples: ["12, Anna Nagar, Chennai", ""] },
  { header: "Account Name", key: "accountName", format: "Text (optional)", samples: ["Murugan K", ""] },
  { header: "Account No", key: "accountNumber", format: "6 to 20 digits (optional)", samples: ["123456789012", ""] },
  { header: "IFSC Code", key: "ifscCode", format: "e.g. SBIN0001234 (optional)", samples: ["SBIN0001234", ""] },
  { header: "Bank Name", key: "bankName", format: "Text (optional)", samples: ["State Bank of India", ""] },
  { header: "Licence No", key: "licenceNumber", format: "e.g. TN0720110012345 (optional, must be unique)", samples: ["TN0720110012345", "TN0920150067890"] },
  { header: "Licence Type", key: "licenceType", format: "Text, e.g. LMV / HMV (optional)", samples: ["LMV", "HMV"] },
  { header: "Licence Expiry Date", key: "licenceExpiryDate", kind: "date", format: "Date YYYY-MM-DD (optional)", samples: ["2030-05-20", "2029-01-10"] },
  { header: "Salary", key: "salary", kind: "number", format: "Number, 0 to 9999999.99 (optional)", samples: [18500, 650] },
];

const SPEC: Record<ImportKind, { columns: Column[]; sheet: string; label: string }> = {
  vehicles: { columns: VEHICLE_COLUMNS, sheet: "Vehicles", label: "vehicle" },
  drivers: { columns: DRIVER_COLUMNS, sheet: "Drivers", label: "driver" },
};

// ---------------------------------------------------------------- template

export async function importTemplate(kind: ImportKind): Promise<{ name: string; buffer: Buffer }> {
  const { columns, sheet, label } = SPEC[kind];
  const wb = new ExcelJS.Workbook();
  wb.creator = "Driver Settlement";
  const ws = wb.addWorksheet(sheet, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: `${c.header}${c.required ? " *" : ""}`, key: c.key, width: Math.max(14, c.header.length + 4) }));
  const head = ws.getRow(1);
  head.font = { bold: true };
  columns.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.required ? "FFFDE68A" : "FFE5E7EB" } };
    cell.note = `${c.required ? "Required. " : "Optional. "}${c.format}`;
  });
  for (const n of [0, 1] as const) ws.addRow(Object.fromEntries(columns.map((c) => [c.key, c.samples[n]])));
  // text format keeps dates as typed (YYYY-MM-DD) and phone / account numbers without scientific notation
  columns.forEach((c, i) => {
    if (c.kind !== "number") ws.getColumn(i + 1).numFmt = "@";
    if (c.list) for (let r = 2; r <= MAX_IMPORT_ROWS + 1; r++)
      ws.getCell(r, i + 1).dataValidation = { type: "list", allowBlank: !c.required, formulae: [`"${c.list.join(",")}"`], showErrorMessage: true, error: `Choose one of: ${c.list.join(", ")}` };
  });

  const info = wb.addWorksheet("Instructions");
  info.columns = [{ width: 30 }, { width: 12 }, { width: 90 }];
  const lines: (string | string[])[] = [
    `How to import ${label}s`,
    `1. Fill one ${label} per row in the "${sheet}" sheet, starting at row 2. Keep the header row exactly as it is.`,
    "2. Replace or delete the two sample rows before importing (they would be imported too).",
    "3. Columns marked * are required. Dates use the format YYYY-MM-DD (e.g. 2026-11-26).",
    `4. Upload the file in ${kind === "vehicles" ? "Vehicle Management" : "Driver Management"} → Import from Excel. Every row is checked first; nothing is imported while any row has an error.`,
    kind === "vehicles"
      ? "5. Duplicates are refused: a vehicle number may appear only once in the file and must not already exist. Imported vehicles start as Active and Available Now."
      : "5. Duplicates are refused: a mobile number or licence number may appear only once in the file and must not belong to an existing driver. A Driver Number is generated for each imported driver, who starts as Active and Available Now.",
    `6. At most ${MAX_IMPORT_ROWS} rows per file.`,
    "",
    ["Column", "Required", "Format / allowed values"],
    ...columns.map((c) => [c.header, c.required ? "Yes" : "No", c.format]),
  ];
  lines.forEach((l, i) => {
    const row = info.addRow(Array.isArray(l) ? l : [l]);
    if (i === 0) row.font = { bold: true, size: 14 };
    if (Array.isArray(l) && l[0] === "Column") row.font = { bold: true };
  });
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { name: `${kind}-import-template.xlsx`, buffer };
}

// ---------------------------------------------------------------- parsing

const normHeader = (s: unknown) => String(s ?? "").replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** A cell as the plain value a form would send: rich text / formulas / hyperlinks unwrapped, Excel dates as YYYY-MM-DD. */
function cellValue(v: ExcelJS.CellValue, kind: Column["kind"]): string | number | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10); // Excel dates carry no zone: read as the calendar date
  if (typeof v === "object") {
    const o = v as any;
    if ("result" in o) return cellValue(o.result, kind);
    if ("richText" in o) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    if ("text" in o) return String(o.text);
    return null;
  }
  if (typeof v === "number") {
    // a date typed into a number-formatted cell arrives as an Excel serial day number
    if (kind === "date" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000).toISOString().slice(0, 10);
    return v;
  }
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  const t = String(v).trim();
  return t === "" ? null : t;
}

interface RawRow { row: number; values: Record<string, string | number | null> }

async function readRows(kind: ImportKind, file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined): Promise<RawRow[]> {
  if (!file) throw new AppError("Choose an Excel file (.xlsx) to import", 400);
  if (!/\.xlsx$/i.test(file.originalname) || file.buffer.subarray(0, 2).toString("latin1") !== "PK")
    throw new AppError("Only Excel .xlsx files can be imported. Download the template and save it as .xlsx", 400);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(file.buffer as any);
  } catch {
    throw new AppError("The file could not be read as an Excel workbook", 400);
  }
  const { columns, sheet } = SPEC[kind];
  const ws = wb.getWorksheet(sheet) ?? wb.worksheets.find((w) => w.name.toLowerCase() !== "instructions");
  if (!ws) throw new AppError(`The workbook has no "${sheet}" sheet`, 400);
  const header = ws.getRow(1);
  const at = new Map<string, number>();
  header.eachCell((c, i) => at.set(normHeader(c.value), i));
  const missing = columns.filter((c) => c.required && !at.has(normHeader(c.header))).map((c) => c.header);
  if (missing.length) throw new AppError(`Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Use the import template`, 400);
  const rows: RawRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const values: RawRow["values"] = {};
    for (const c of columns) {
      const i = at.get(normHeader(c.header));
      values[c.key] = i ? cellValue(row.getCell(i).value, c.kind) : null;
    }
    if (Object.values(values).every((v) => v === null)) continue; // empty rows are skipped
    rows.push({ row: r, values });
    if (rows.length > MAX_IMPORT_ROWS) throw new AppError(`Too many rows: at most ${MAX_IMPORT_ROWS} per file`, 400);
  }
  if (!rows.length) throw new AppError("The file has no data rows to import", 400);
  return rows;
}

// ---------------------------------------------------------------- row → create input

function vehicleInput(v: RawRow["values"]) {
  const input: Record<string, unknown> = { saveAs: "FINAL", availability: { status: "AVAILABLE" } };
  for (const c of VEHICLE_COLUMNS) {
    if (c.key.startsWith("doc:")) {
      const s = c.key.slice(4);
      input[s] = v[c.key] === null ? [] : [{ nextRenewalDate: String(v[c.key]), attachment: null }];
    } else input[c.key] = v[c.key] === null ? undefined : String(v[c.key]);
  }
  return input;
}

function driverInput(v: RawRow["values"]) {
  const input: Record<string, unknown> = { availability: { status: "AVAILABLE" } };
  for (const c of DRIVER_COLUMNS) input[c.key] = v[c.key] === null ? undefined : String(v[c.key]);
  // the template shows the readable driver type; the API keeps its codes (codes are accepted as typed too)
  const t = String(v.driverType ?? "").trim().toLowerCase();
  const code = Object.entries(DRIVER_TYPE_LABEL).find(([k, label]) => label.toLowerCase() === t || k.toLowerCase() === t)?.[0];
  if (code) input.driverType = code;
  return input;
}

// ---------------------------------------------------------------- validate (preview) + import

export interface RowResult { row: number; status: "VALID" | "ERROR"; errors: string[]; label: string }
export interface ImportCheck { kind: ImportKind; total: number; valid: number; invalid: number; rows: RowResult[] }

async function check(kind: ImportKind, raw: RawRow[], now = new Date()): Promise<{ result: ImportCheck; inputs: Record<string, unknown>[] }> {
  const inputs: Record<string, unknown>[] = [];
  const rows: RowResult[] = [];
  if (kind === "vehicles") {
    const nos = raw.map((r) => (r.values.vehicleNo === null ? null : normalizeVehicleNo(r.values.vehicleNo)));
    const existing = new Set((await Vehicle.find({ vehicleNo: { $in: nos.filter(Boolean) } }).select("vehicleNo").lean()).map((x: any) => x.vehicleNo));
    raw.forEach((r, i) => {
      const input = vehicleInput(r.values);
      const v = validateVehicle(input, false, now);
      const av = validateAvailability(input.availability, false, now);
      const errors = [...v.errors, ...av.errors];
      const no = nos[i];
      if (no && existing.has(no)) errors.push(`Vehicle number ${no} already exists`);
      const first = no ? nos.indexOf(no) : -1;
      if (no && first !== i) errors.push(`Vehicle number ${no} is repeated in the file (row ${raw[first].row})`);
      inputs.push(input);
      rows.push({ row: r.row, status: errors.length ? "ERROR" : "VALID", errors, label: no ?? String(r.values.vehicleNo ?? "") });
    });
  } else {
    const parsed = raw.map((r) => {
      const input = driverInput(r.values);
      const v = validateDriver(input);
      const mobile = r.values.mobileNumber === null ? null : normalizeIndianPhone(r.values.mobileNumber);
      return { input, v, mobileDigits: mobile ? mobile.replace(/\D/g, "").slice(2) : null, licenceKey: r.values.licenceNumber === null ? null : licenceKeyOf(String(r.values.licenceNumber)) };
    });
    const mobiles = parsed.map((p) => p.mobileDigits).filter(Boolean) as string[];
    const licences = parsed.map((p) => p.licenceKey).filter(Boolean) as string[];
    const clashes: any[] = await Driver.find({ $or: [{ mobileDigits: { $in: mobiles } }, { licenceKey: { $in: licences } }] }).select("driverNumber mobileDigits licenceKey").lean();
    parsed.forEach((p, i) => {
      const r = raw[i];
      const errors = [...p.v.errors];
      const byMobile = p.mobileDigits && clashes.find((c) => c.mobileDigits === p.mobileDigits);
      if (byMobile) errors.push(`A driver with mobile number ${r.values.mobileNumber} already exists (${byMobile.driverNumber})`);
      const byLic = p.licenceKey && clashes.find((c) => c.licenceKey === p.licenceKey);
      if (byLic) errors.push(`A driver with licence number ${r.values.licenceNumber} already exists (${byLic.driverNumber})`);
      const mFirst = p.mobileDigits ? parsed.findIndex((x) => x.mobileDigits === p.mobileDigits) : i;
      if (mFirst !== i) errors.push(`Mobile number ${r.values.mobileNumber} is repeated in the file (row ${raw[mFirst].row})`);
      const lFirst = p.licenceKey ? parsed.findIndex((x) => x.licenceKey === p.licenceKey) : i;
      if (lFirst !== i) errors.push(`Licence number ${r.values.licenceNumber} is repeated in the file (row ${raw[lFirst].row})`);
      inputs.push(p.input);
      rows.push({ row: r.row, status: errors.length ? "ERROR" : "VALID", errors, label: [r.values.driverName, r.values.mobileNumber].filter(Boolean).join(" · ") });
    });
  }
  const invalid = rows.filter((r) => r.status === "ERROR").length;
  return { result: { kind, total: rows.length, valid: rows.length - invalid, invalid, rows }, inputs };
}

/** Validates every row without saving anything (the preview the user sees before importing). */
export async function previewImport(kind: ImportKind, file: Parameters<typeof readRows>[1]): Promise<ImportCheck> {
  return (await check(kind, await readRows(kind, file))).result;
}

/**
 * Validates again on the server (the preview may be stale) and, only when every row is valid, creates the records one by one with
 * the existing create services. A record that fails at that moment (e.g. a duplicate saved meanwhile) is reported on its row.
 */
export async function runImport(kind: ImportKind, file: Parameters<typeof readRows>[1], username: string) {
  const { result, inputs } = await check(kind, await readRows(kind, file));
  if (result.invalid)
    return { blocked: true as const, message: `Nothing was imported: ${result.invalid} of ${result.total} row${result.total > 1 ? "s have" : " has"} errors. Fix them and upload the file again`, check: result };
  const created: { row: number; id: string; label: string }[] = [];
  const failed: RowResult[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const row = result.rows[i];
    try {
      const doc: any = kind === "vehicles" ? await createVehicle(inputs[i], username) : await createDriver(inputs[i], username);
      created.push({ row: row.row, id: String(doc._id), label: kind === "vehicles" ? doc.vehicleNo : `${doc.driverNumber} · ${doc.driverName}` });
    } catch (err) {
      failed.push({ ...row, status: "ERROR", errors: [(err as Error).message] });
    }
  }
  return { blocked: false as const, kind, total: result.total, imported: created.length, failed: failed.length, created, failedRows: failed };
}
