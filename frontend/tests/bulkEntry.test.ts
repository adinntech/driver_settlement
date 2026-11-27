import test from "node:test";
import assert from "node:assert/strict";
import { bulkEntryBody, bulkEntryError, bulkEntryTotal, type RowEntry } from "../src/utils/bulkEntry";

const today = "2026-11-27";
const rows = [{ _id: "a", paymentNumber: "DVP-1", category: "DAILY" as const }, { _id: "b", paymentNumber: "DVP-2", category: "DAILY" as const }];
const row = (referenceNumber: string, patch: Partial<RowEntry> = {}): RowEntry => ({ paymentMode: "CASH", paymentDate: today, bankName: "", referenceDate: "", referenceNumber, ...patch });
const check = (a: RowEntry, b: RowEntry = row("R2")) => bulkEntryError(rows, { a, b }, today, today);

test("every selected payment needs its own complete, distinct entry", () => {
  assert.equal(check(row("R1")), null);
  assert.match(bulkEntryError([], {}, today, today)!, /Select at least one/);
  assert.match(bulkEntryError(rows, { a: row("R1") }, today, today)!, /^DVP-2: .*payment mode/, "nothing is carried over from another payment");
  assert.match(check(row(""))!, /^DVP-1: .*reference number/);
  assert.match(check(row("R1", { paymentDate: "2026-11-26" }))!, /before the approval date/);
  assert.match(check(row("R1"), row("R2", { paymentMode: "DD" }))!, /^DVP-2: .*bank name/);
  assert.match(check(row("r2"))!, /also entered for DVP-1/);
});

test("only the selected payments are sent, each with its own values", () => {
  const body = bulkEntryBody([rows[1]], { a: row("R1"), b: row("R2", { paymentMode: "DD", bankName: " SBI " }) });
  assert.deepEqual(body, { items: [{ id: "b", paymentMode: "DD", paymentDate: today, bankName: "SBI", referenceNumber: "R2", referenceDate: undefined }] });
  assert.equal(bulkEntryTotal([{ amount: 0.1 }, { amount: 0.2 }]), 0.3);
});
