// Payment Details PDF: every daily payment line is in it, with matching totals. No database needed.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { paymentGroups, renderPaymentDetails } from "../src/services/paymentDetailsPdf.service.js";

const advances = [{ submittedAt: new Date("2026-11-01T05:00:00Z"), finalAdvanceAmount: 1000, workingDays: 4 }, { submittedAt: new Date("2026-11-03T05:00:00Z"), finalAdvanceAmount: 500.5, workingDays: 2 }];
const daily = (n: number, extra: object = {}) => ({
  paymentNumber: `DVP-${String(n).padStart(6, "0")}`, status: "APPROVED", fromDate: "2026-11-05", ...extra,
  data: {
    salaryAdvance: 1050, foodAmount: 200, dieselEntries: [{ amount: 1944.89, mode: "ePayment", reference: "IOCL card used for on-road vehicle fuel filling" }],
    expenses: [{ optionLabel: "Toll", description: "gate", amount: 150, deduct: false }, { optionLabel: "Others", description: "recovery", amount: 50, deduct: true }],
  },
});
const completion = { paymentMode: "EPAYMENT", paymentDate: "2026-11-06", referenceDate: "2026-11-06", referenceNumber: "AXIS-IMPS-1", bankName: "AXIS IMPS" };
const payments = [daily(1, { status: "COMPLETED", completion }), daily(2)];

test("every line of every payment is a record, and each payment adds up to its total payable", () => {
  const groups = paymentGroups(advances, payments);
  const lines = groups.flatMap((g) => g.lines);
  assert.equal(lines.length, 2 + 5 * 2);
  assert.deepEqual([...new Set(lines.filter((l) => l.source === "DVP-000001").map((l) => l.description.split(" - ")[0]))], ["Salary Advance", "Diesel", "Food", "Toll", "Others"]);
  assert.equal(groups.reduce((s, g) => s + g.paise, 0), 150050 + 2 * 329489);
  const paid = lines.find((l) => l.refNo)!;
  assert.deepEqual([paid.mode, paid.paymentDate, paid.refDate, paid.refNo, paid.bank], ["ePayment", "2026-11-06", "2026-11-06", "AXIS-IMPS-1", "AXIS IMPS"]);
  assert.ok(lines.filter((l) => l.source === "DVP-000002").every((l) => !l.refNo && !l.bank), "nothing invented for an unpaid line");
});

test("many payments flow onto further pages", async () => {
  const head = { client: "Client", vehicle: "TN00AA0000", driver: "DR-0001/Test Driver", accountName: "Test", accountNo: "XXXX1234", bank: "Bank" };
  const pages = (b: Buffer) => b.toString("latin1").match(/\/Type \/Page\b/g)!.length;
  const small = await renderPaymentDetails(head, paymentGroups(advances, payments));
  const big = await renderPaymentDetails(head, paymentGroups(advances, Array.from({ length: 15 }, (_, i) => daily(i + 1, i % 2 ? { completion } : {}))));
  assert.equal(pages(small), 1);
  assert.ok(pages(big) > 1);
  if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, big);
});
