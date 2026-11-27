"use client";

import { verticalLabel } from "@/utils/vertical";
import { useRef, useState } from "react";
import TableWrap from "@/components/ui/TableWrap";
import { Modal } from "@/components/ui/Ui";
import { useToast } from "@/context/ToastContext";
import { request } from "@/services/api";
import { approveBulk, type BulkApproval } from "@/utils/bulkApproval";
import { formatInr } from "@/utils/format";
import type { SettlementRow } from "@/utils/settlement";

/** `onClose(attempted)`: when approvals were sent the caller reloads the list and summary counts. */
export default function BulkApproveModal({ rows, onClose }: { rows: SettlementRow[]; onClose: (attempted: boolean) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<BulkApproval[] | null>(null);
  const sending = useRef(false); // blocks a double click before the disabled state renders
  const close = () => { if (!sending.current) onClose(!!results); };
  const total = rows.reduce((s, p) => s + Math.round(p.amount * 100), 0) / 100;
  const failed = results?.filter((r) => !r.ok).length ?? 0;

  async function confirm() {
    if (sending.current || results) return;
    sending.current = true;
    setBusy(true);
    const out = await approveBulk(rows, (path, body) => request(path, "POST", body));
    sending.current = false;
    setBusy(false);
    setResults(out);
    const bad = out.filter((r) => !r.ok).length;
    if (bad) toast(`${out.length - bad} of ${out.length} payments approved, ${bad} failed`, "error");
    else toast(`${out.length} payment${out.length > 1 ? "s" : ""} approved`);
  }

  return (
    <Modal title="Bulk Approve" onClose={close} wide>
      {results ? (
        <>
          <p role="status">{results.length - failed} approved · {failed} failed</p>
          <ul>
            {results.map((r) => (
              <li key={r.id}><strong className="num">{r.paymentNumber}</strong>: {r.ok ? "Approved" : `Failed · ${r.message}`}</li>
            ))}
          </ul>
          <div className="actions-row"><button type="button" className="btn btn-primary" onClick={close}>Close</button></div>
        </>
      ) : (
        <>
          <p className="muted">Approve these {rows.length} daily vehicle payments?</p>
          <TableWrap>
            <table className="table" data-section="bulk-approve">
              <thead>
                <tr><th>Payment No</th><th>Vertical</th><th>Project</th><th>Vehicle</th><th>Driver</th><th className="ds-amt">Amount</th></tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p._id}>
                    <td className="num">{p.paymentNumber}</td>
                    <td>{verticalLabel(p.projectType)}</td>
                    <td><div>{p.clientName ?? "-"}</div><small className="muted">{[p.trackupNumber, p.pifNumber].filter(Boolean).join(" · ")}</small></td>
                    <td>{p.vehicleNo ?? "-"}</td>
                    <td>{p.driverName ?? "-"}</td>
                    <td className="ds-amt">{formatInr(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <p><strong>Total: {formatInr(total)}</strong></p>
          <div className="actions-row">
            <button type="button" className="btn btn-outline" disabled={busy} onClick={close}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={confirm}>{busy ? "Approving…" : "Confirm Approve"}</button>
          </div>
        </>
      )}
    </Modal>
  );
}
