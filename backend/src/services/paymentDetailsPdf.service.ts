/* eslint-disable @typescript-eslint/no-explicit-any */
import PDFDocument from "pdfkit";
import { config } from "../config/index.js";
import { Driver } from "../models/Driver.js";
import { DriverAdvance } from "../models/DriverAdvance.js";
import { PAYMENT_MODE_LABEL, SettlementPayment } from "../models/SettlementPayment.js";
import { TrackingProject } from "../models/TrackingProject.js";
import { AppError } from "../utils/AppError.js";
import { maskTail, unseal } from "../utils/secureField.js";
import { verticalLabel } from "../utils/vertical.js";
import { projectContext } from "./rsa.service.js";

/**
 * Suspense records of one driver on one project vehicle, and their "Payment Details" PDF. The rule: an approved or paid Daily
 * Payment counts only once its Reference No. / UTR is recorded (completion.referenceNumber, entered by RSA), and then for its whole
 * Total Payable: its lines (salary advance, diesel, food, expenses, deductions negative) add up to exactly that, each counted once.
 * Driver advances of the campaign are included as before. The Suspense Amount, the popup and the PDF all come from here.
 * Read-only.
 */
export interface DetailLine { source: string; date: string; description: string; paise: number; mode: string; paymentDate: string; refDate: string; refNo: string; bank: string }
export interface DetailGroup { date: string; lines: DetailLine[]; paise: number }

const ist = (d: Date | string) => new Date(new Date(d).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
const dmy = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split("-").reverse().join("-") : s);
const money = (paise: number) => (paise / 100).toFixed(2);
const paiseOf = (n: unknown) => Math.round((Number(n) || 0) * 100);

/** One group per saved record (a daily payment, or one advance), oldest first, each with its own total. */
export function paymentGroups(advances: any[], payments: any[]): DetailGroup[] {
  const groups: DetailGroup[] = [];
  const add = (date: string, lines: DetailLine[]) => {
    if (lines.length) groups.push({ date, lines, paise: lines.reduce((s, l) => s + l.paise, 0) });
  };
  for (const a of advances) {
    const date = ist(a.submittedAt);
    add(date, [{ source: "Driver Advance", date, description: `Driver Advance (${a.workingDays} working days)`, paise: paiseOf(a.finalAdvanceAmount), mode: "", paymentDate: "", refDate: "", refNo: "", bank: "" }]);
  }
  for (const p of payments) {
    const c = p.completion;
    const d = p.data ?? {};
    const date = c?.paymentDate ?? p.fromDate;
    const paid = {
      source: p.paymentNumber, date, mode: c ? PAYMENT_MODE_LABEL[c.paymentMode] ?? c.paymentMode : d.cashInHand ? "Cash" : "",
      paymentDate: c?.paymentDate ?? "", refDate: c?.referenceDate ?? "", refNo: c?.referenceNumber ?? "", bank: c?.bankName ?? "",
    };
    const lines: DetailLine[] = [];
    const line = (description: string, amount: unknown, mode?: string) => {
      if (paiseOf(amount)) lines.push({ ...paid, mode: paid.mode || mode || "", description, paise: paiseOf(amount) });
    };
    line("Salary Advance", d.salaryAdvance);
    for (const x of d.dieselEntries ?? []) line(x.reference ? `Diesel - ${x.reference}` : "Diesel", x.amount, x.mode);
    line("Food", d.foodAmount);
    for (const e of d.expenses ?? []) line(`${e.optionLabel}${e.description ? ` - ${e.description}` : ""}${e.deduct ? " (deduction)" : ""}`, e.deduct ? -e.amount : e.amount);
    add(date, lines);
  }
  return groups.sort((a, b) => a.date.localeCompare(b.date));
}

const COLUMNS = ["Description", "Amount", "Mode", "Payment Date", "Check/DD Date", "Check/DD No", "Bank Name"];
const LEFT = 20, WIDTH = 555, CELL = WIDTH / COLUMNS.length, BOTTOM = 810;

export function renderPaymentDetails(head: { vertical?: string; client: string; vehicle: string; driver: string; accountName: string; accountNo: string; bank: string }, groups: DetailGroup[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: "Payment Details", Author: config.companyName } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  const font = (bold = false) => doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor("#000");

  font(true).text("Payment Details", LEFT, 24, { width: WIDTH, align: "center" });
  if (head.vertical) font().text(`Vertical : ${head.vertical}`, LEFT + 4, 24);
  let y = 48;
  const left = [["Client Name", head.client], ["Vehicle No", head.vehicle], ["Driver Name", head.driver]];
  const right = [["Account Name", head.accountName], ["Account No", head.accountNo], ["Bank Name", head.bank]];
  for (let i = 0; i < 3; i++) {
    font();
    const h = Math.max(doc.heightOfString(left[i][1], { width: 220 }), doc.heightOfString(right[i][1], { width: 170 }), 11);
    doc.text(left[i][0], LEFT + 4, y).text(left[i][1], LEFT + 78, y, { width: 220 });
    doc.text(right[i][0], 330, y).text(right[i][1], 402, y, { width: 170 });
    y += h + 9;
  }

  /** One bordered row, as tall as its longest cell; a new page repeats the column header. */
  const row = (cells: string[], opts: { bold?: boolean[]; header?: boolean } = {}) => {
    const height = Math.max(...cells.map((t, i) => (font(opts.header || opts.bold?.[i]), doc.heightOfString(t || " ", { width: CELL - 6 })))) + 8;
    if (y + height > BOTTOM) {
      doc.addPage();
      y = 24;
      if (!opts.header) row(COLUMNS, { header: true });
    }
    if (opts.header) doc.rect(LEFT, y, WIDTH, height).fill("#d3d3d3");
    cells.forEach((t, i) => {
      const x = LEFT + i * CELL;
      if (!opts.header) doc.lineWidth(0.8).strokeColor("#d3d3d3").rect(x, y, CELL, height).stroke();
      const isTotal = i === 0 && t === "Total";
      font(opts.header || opts.bold?.[i]).text(t, x + 3, y + 4, { width: CELL - 6, align: !opts.header && (i === 1 || isTotal) ? "right" : "left" });
    });
    y += height;
  };

  row(COLUMNS, { header: true });
  for (const g of groups) {
    row([dmy(g.date), "", "", "", "", "", ""], { bold: [true] });
    for (const l of g.lines) row([l.source === "Driver Advance" ? l.description : `${l.description} (${l.source})`, money(l.paise), l.mode, dmy(l.paymentDate), dmy(l.refDate), l.refNo, l.bank]);
    row(["Total", money(g.paise), "", "", "", "", ""], { bold: [false, true] });
  }
  if (y + 24 > BOTTOM) {
    doc.addPage();
    y = 24;
  }
  font(true).text("Total Payment Amount :", 300, y + 8, { width: 170, align: "right" });
  doc.text(money(groups.reduce((s, g) => s + g.paise, 0)), 475, y + 8, { width: 97, align: "right" });
  doc.end();
  return done;
}

/** The one lookup: records of this driver on this project vehicle only (any allotment of it), each payment once. */
export async function suspenseFor(trackingVehicle: string, driver: string, campaignFrom: string | null) {
  const [advances, payments]: any[] = await Promise.all([
    DriverAdvance.find({ driver, submittedAt: { $gte: new Date(`${campaignFrom ?? "1970-01-01"}T00:00:00+05:30`) } }).sort({ submittedAt: 1 }).lean(),
    SettlementPayment.find({ trackingVehicle, driver, category: "DAILY", status: { $in: ["APPROVED", "COMPLETED"] }, "completion.referenceNumber": /\S/ }).sort({ fromDate: 1 }).lean(),
  ]);
  const groups = paymentGroups(advances, payments);
  const lines = groups.flatMap((g) => g.lines);
  return {
    groups,
    rows: lines.map((l) => ({ source: l.source, date: l.date, description: l.description, amount: l.paise / 100 })),
    total: lines.reduce((s, l) => s + l.paise, 0) / 100,
  };
}

const campaignFrom = (proj: any): string | null => (proj?.projectType === "ROADSHOW" ? proj?.details?.startDate : proj?.details?.fromDate) ?? null;
const fileName = (vehicleNo: unknown) => `payment-details-${String(vehicleNo ?? "vehicle").replace(/[^A-Za-z0-9]/g, "")}.pdf`;

/** From the Final Settlement form. The full account number only for RSA (who pays); RBP gets it masked, as on screen. */
export async function paymentDetailsPdf(tvId: string, role: string): Promise<{ name: string; buffer: Buffer }> {
  const ctx = await projectContext(tvId);
  const [proj, driver]: any[] = await Promise.all([TrackingProject.findById(ctx._raw.project).lean(), Driver.findById(ctx._raw.driver).lean()]);
  const { groups } = await suspenseFor(tvId, ctx._raw.driver, campaignFrom(proj));
  const buffer = await renderPaymentDetails({
    vertical: verticalLabel(ctx.projectType),
    client: ctx.clientName ?? "", vehicle: ctx.vehicle.vehicleNo ?? "", driver: [ctx.driver.driverNumber, ctx.driver.driverName].filter(Boolean).join("/"),
    accountName: driver?.accountName ?? "", accountNo: (role === "RSA" ? driver?.accountNumber : maskTail(driver?.accountNumber)) ?? "", bank: driver?.bankName ?? "",
  }, groups);
  return { name: fileName(ctx.vehicle.vehicleNo), buffer };
}

/** From a saved Final Settlement (RSA / RSO): the same records, for that settlement's own driver and project vehicle. */
async function ofSettlement(id: string) {
  if (!/^[a-f0-9]{24}$/i.test(id)) throw new AppError("Invalid payment id", 400);
  const p: any = await SettlementPayment.findById(id).lean();
  if (!p || p.category !== "FINAL") throw new AppError("Final settlement not found", 404);
  const proj: any = await TrackingProject.findById(p.project).lean();
  return { p, ...(await suspenseFor(String(p.trackingVehicle), String(p.driver), campaignFrom(proj))) };
}

export async function settlementSuspense(id: string) {
  const { p, rows, total } = await ofSettlement(id);
  return { rows, total, saved: p.data?.suspenseAmount ?? 0 };
}

export async function settlementSuspensePdf(id: string): Promise<{ name: string; buffer: Buffer }> {
  const { p, groups } = await ofSettlement(id);
  const buffer = await renderPaymentDetails({
    vertical: verticalLabel(p.projectType),
    client: p.clientName ?? "", vehicle: p.vehicleNo ?? "", driver: [p.driverNumber, p.driverName].filter(Boolean).join("/"),
    accountName: p.bank?.accountName ?? "", accountNo: unseal(p.bank?.account) ?? p.bank?.accountMasked ?? "", bank: p.bank?.bankName ?? "",
  }, groups);
  return { name: fileName(p.vehicleNo), buffer };
}
