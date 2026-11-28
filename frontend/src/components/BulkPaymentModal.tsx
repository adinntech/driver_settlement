"use client";

import { useErrorState } from "@/context/ToastContext";
import { verticalLabel } from "@/utils/vertical";
import { useRef, useState } from "react";
import DateInput, { todayIst } from "@/components/ui/DateInput";
import Select from "@/components/ui/Select";
import TableWrap from "@/components/ui/TableWrap";
import { Modal } from "@/components/ui/Ui";
import { useToast } from "@/context/ToastContext";
import { request } from "@/services/api";
import { BULK_REASONS, bulkError, bulkTotal, submitBulk, type BulkLine, type BulkResult, type BulkVehicle } from "@/utils/bulkPayment";
import { formatInr } from "@/utils/format";

const EMPTY: BulkLine = { reason: "", amount: "", description: "" };

/** `onClose` receives the vehicles whose payment was submitted, so they can be unselected (failed ones stay selected). */
export default function BulkPaymentModal({ vehicles, onClose }: { vehicles: BulkVehicle[]; onClose: (submitted: string[]) => void }) {
  const toast = useToast();
  const [date, setDate] = useState(todayIst());
  const [lines, setLines] = useState<Record<string, BulkLine>>({});
  const [, setError] = useErrorState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<BulkResult[] | null>(null);
  const sending = useRef(false); // blocks a double click before the disabled state renders
  const [batch] = useState(() => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
  const entries = vehicles.map((v) => ({ ...v, ...(lines[v.trackingVehicle] ?? EMPTY) }));
  const set = (tv: string, patch: Partial<BulkLine>) => {
    setLines((all) => ({ ...all, [tv]: { ...(all[tv] ?? EMPTY), ...patch } }));
    setError(null);
  };
  const close = () => { if (!sending.current) onClose((results ?? []).filter((r) => r.ok).map((r) => r.trackingVehicle)); };

  async function submit() {
    if (sending.current || results) return;
    const problem = bulkError(entries, date);
    if (problem) return setError(problem);
    sending.current = true;
    setBusy(true);
    const out = await submitBulk(entries, date, batch, (path, body) => request(path, "POST", body));
    sending.current = false;
    setBusy(false);
    setResults(out);
    const done = out.filter((r) => r.ok).length;
    if (done === out.length) toast(`${done} payment${done > 1 ? "s" : ""} submitted to RSOM`);
    else toast(`${done} of ${out.length} payments submitted, ${out.length - done} failed`, "error");
  }

  return (
    <Modal title="Bulk Payment" onClose={close} wide>
      {results ? (
        <>
          <p role="status">{results.filter((r) => r.ok).length} submitted to RSOM · {results.filter((r) => !r.ok).length} failed</p>
          <ul>
            {results.map((r) => (
              <li key={r.trackingVehicle}><strong className="num">PIF {r.pifNumber}</strong>: {r.ok ? "Submitted" : "Failed"} · {r.message}</li>
            ))}
          </ul>
          <div className="actions-row"><button type="button" className="btn btn-primary" onClick={close}>Close</button></div>
        </>
      ) : (
        <>
          <p className="muted">One Daily Vehicle Payment for each of the {vehicles.length} selected vehicles, sent to RSOM for approval.</p>
          <div className="field"><span>Payment Date (all vehicles)</span>
            <DateInput value={date} disabled={busy} onChange={(e) => { setDate(e.target.value); setError(null); }} aria-label="Payment date" />
          </div>
          <TableWrap>
            <table className="table" data-section="bulk-payment">
              <thead>
                <tr><th>Trackup No</th><th>Vertical</th><th>PIF No</th><th>Vehicle No</th><th>Driver</th><th>Payment Reason</th><th>Amount (₹)</th></tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.trackingVehicle}>
                    <td className="num">{e.trackupNumber}</td>
                    <td>{verticalLabel(e.projectType)}</td>
                    <td className="num">{e.pifNumber}</td>
                    <td className="num">{e.vehicleNo ?? "—"}</td>
                    <td>{e.driverName ?? "—"}</td>
                    <td>
                      <Select value={e.reason} onChange={(x) => set(e.trackingVehicle, { reason: x.target.value })} disabled={busy} aria-label={`Payment reason, PIF ${e.pifNumber}`}>
                        <option value="">Select reason</option>
                        {BULK_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                      </Select>
                      {e.reason === "Others" && (
                        <input placeholder="Description" maxLength={200} value={e.description} disabled={busy} aria-label={`Description, PIF ${e.pifNumber}`}
                          onChange={(x) => set(e.trackingVehicle, { description: x.target.value })} />
                      )}
                    </td>
                    <td>
                      <input className="num-input" inputMode="decimal" placeholder="0.00" value={e.amount} disabled={busy} aria-label={`Amount, PIF ${e.pifNumber}`}
                        onChange={(x) => set(e.trackingVehicle, { amount: x.target.value })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <p><strong>Total: {formatInr(bulkTotal(entries))}</strong></p>
          <div className="actions-row">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? "Submitting…" : "Submit Bulk Payment"}</button>
          </div>
        </>
      )}
    </Modal>
  );
}
