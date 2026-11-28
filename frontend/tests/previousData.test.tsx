import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { hasSubmitted, PreviousDataTable, type PreviousEntry } from "../src/components/settlement/PreviousData";
import SuspenseTable from "../src/components/settlement/SuspenseTable";

const rec = (revision: number, status: "DRAFT" | "SUBMITTED") => ({
  _id: `r${revision}${status}`, entryId: "e", revision, status, fromDate: "2026-01-01", toDate: "2026-01-02", paymentDate: "2026-01-03", paymentMode: "CASH", bankName: null,
  referenceNumber: `UTR-${revision}`, amount: 100 * revision, sourceDetails: "Cash book", remarks: null, correctionReason: revision > 1 ? "misread" : null,
  createdBy: "RSA", createdByRole: "RSA", createdAt: "2026-01-04T00:00:00Z", data: {},
});
const entry = (...revs: ReturnType<typeof rec>[]): PreviousEntry => ({ entryId: "e", current: revs[0], revisions: revs });
const html = (e: PreviousEntry, rsa: boolean) => renderToStaticMarkup(<PreviousDataTable entries={[e]} onAction={rsa ? () => {} : undefined} />);

test("drafts offer edit / submit / delete; submitted entries only a correction; non-RSA no actions", () => {
  const draft = html(entry(rec(1, "DRAFT")), true);
  assert.ok(draft.includes("Draft (not counted)") && draft.includes(">Edit<") && draft.includes(">Submit<") && draft.includes(">Delete<") && !draft.includes(">Correct<"));
  const revised = html(entry(rec(2, "SUBMITTED"), rec(1, "SUBMITTED")), true);
  assert.ok(revised.includes("Historical · revision 2") && revised.includes("Earlier revision 1 (not counted)") && revised.includes("Correction: misread"));
  assert.ok(revised.includes(">Correct<") && !revised.includes(">Delete<"));
  assert.ok(!html(entry(rec(1, "DRAFT")), false).includes("<button"));
});

test("a submitted entry locks new entries for that vehicle; a draft does not", () => {
  const on = (status: "DRAFT" | "SUBMITTED") => [entry({ ...rec(1, status), vehicleNo: "TN1" } as ReturnType<typeof rec>)];
  assert.deepEqual([hasSubmitted(on("DRAFT"), "TN1"), hasSubmitted(on("SUBMITTED"), "TN1"), hasSubmitted(on("SUBMITTED"), "TN2")], [false, true, false]);
});

test("the form has Fuel Amount, an optional Source Details and no Deduct checkbox", () => {
  const src = readFileSync(new URL("../src/components/settlement/PreviousData.tsx", import.meta.url), "utf8");
  assert.ok(src.includes('amount("diesel", "Fuel Amount")') && src.includes('input("sourceDetails", "Source Details", 200)'));
  assert.ok(!src.includes("Diesel Amount") && !src.includes("Deduct") && !src.includes("deduct:"));
});

test("suspense records label previous data, and the form is offered inside the Suspense popup", () => {
  const out = renderToStaticMarkup(<SuspenseTable records={{ rows: [{ source: "Previous Data", date: "2026-01-03", description: "Food", amount: 50 }], total: 50 }} />);
  assert.ok(out.includes('<span class="badge badge-created">Previous Data</span>'));
  assert.ok(readFileSync(new URL("../src/components/settlement/PaymentForms.tsx", import.meta.url), "utf8").includes("<PreviousDataPanel who="));
});
