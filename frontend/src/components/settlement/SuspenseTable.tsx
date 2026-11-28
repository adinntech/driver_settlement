"use client";

import { formatDate, formatInr } from "@/utils/format";
import type { SuspenseRecords } from "@/utils/settlement";

/** The Suspense Amount records: the same table on the Final Settlement form and on a saved settlement (RSA / RSO). */
export default function SuspenseTable({ records }: { records: SuspenseRecords }) {
  return (
    <table className="table ds-mini">
      <thead><tr><th>Source</th><th>Date</th><th>Description</th><th className="ds-amt">Amount</th></tr></thead>
      <tbody>
        {records.rows.length === 0 && <tr><td colSpan={4}>No daily payment with a Reference No. / UTR is recorded for this driver on this vehicle.</td></tr>}
        {records.rows.map((r, i) => <tr key={i}><td>{r.source.startsWith("Previous Data") ? <><span className="badge badge-created">Previous Data</span> {r.source.split(" · ")[1]}</> : r.source}</td><td>{formatDate(r.date)}</td><td>{r.description}</td><td className="ds-amt">{formatInr(r.amount)}</td></tr>)}
      </tbody>
      <tfoot><tr><td colSpan={3}><b>Total of these records</b></td><td className="ds-amt"><b>{formatInr(records.total)}</b></td></tr></tfoot>
    </table>
  );
}
