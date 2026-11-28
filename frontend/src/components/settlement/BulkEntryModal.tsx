"use client";

import { useErrorState } from "@/context/ToastContext";
import { verticalLabel } from "@/utils/vertical";
import { useRef, useState } from "react";
import DateInput, { todayIst } from "@/components/ui/DateInput";
import Select from "@/components/ui/Select";
import { EmptyState, ErrorState, Modal, Skeleton } from "@/components/ui/Ui";
import { useToast } from "@/context/ToastContext";
import { useApi } from "@/hooks/useApi";
import { request } from "@/services/api";
import { bulkEntryBody, bulkEntryError, bulkEntryTotal, emptyEntry, type BulkEntries, type RowEntry } from "@/utils/bulkEntry";
import { formatInr } from "@/utils/format";
import { CATEGORY_SHORT, ENTRY_MODES, cleanReference, type SettlementPage, type SettlementRow } from "@/utils/settlement";

interface Result { id: string; ok: boolean; message: string }

/** `onClose(attempted)`: after a submission the caller reloads the list (completed payments move to Payment Completed). */
export default function BulkEntryModal({ onClose }: { onClose: (attempted: boolean) => void }) {
  const [date, setDate] = useState("");
  const sending = useRef(false);
  const attempted = useRef(false);
  const close = () => { if (!sending.current) onClose(attempted.current); };
  const onBusy = (v: boolean) => { sending.current = v; if (v) attempted.current = true; };
  return (
    <Modal title="Bulk Entry" onClose={close} wide>
      <div className="field be-date"><span>Approval date</span>
        <DateInput value={date} max={todayIst()} onChange={(e) => { if (!sending.current) setDate(e.target.value); }} aria-label="Approval date" />
      </div>
      {date ? <Entry key={date} date={date} onBusy={onBusy} onClose={close} /> : <p className="muted">Pick a date to list the payments approved on it.</p>}
    </Modal>
  );
}

function Entry({ date, onBusy, onClose }: { date: string; onBusy: (v: boolean) => void; onClose: () => void }) {
  const toast = useToast();
  const sending = useRef(false); // blocks a double click before the disabled state renders
  const list = useApi<SettlementPage>(`/settlements?scope=all&status=APPROVED&approvedOn=${date}&limit=100&sort=paymentNumber&dir=asc`);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [entries, setEntries] = useState<BulkEntries>({});
  const [, setError] = useErrorState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<(Result & { paymentNumber: string })[] | null>(null);
  const setEntry = (id: string, entry: RowEntry) => { setEntries((all) => ({ ...all, [id]: entry })); setError(null); };

  if (results) {
    const failed = results.filter((r) => !r.ok).length;
    return (
      <>
        <p role="status">{results.length - failed} completed · {failed} failed</p>
        <ul>{results.map((r) => <li key={r.id}><strong className="num">{r.paymentNumber}</strong>: {r.ok ? "Completed" : `Failed · ${r.message}`}</li>)}</ul>
        <div className="actions-row"><button type="button" className="btn btn-primary" onClick={onClose}>Close</button></div>
      </>
    );
  }
  if (list.loading) return <Skeleton rows={4} />;
  if (list.error) return <ErrorState message={list.error} onRetry={list.reload} />;
  const rows = list.data?.items ?? [];
  if (!rows.length) return <EmptyState title="No approved payments for this date" />;

  const selected: SettlementRow[] = rows.filter((p) => picked.has(p._id));
  const all = selected.length === rows.length;
  // each selected row's own fields; typed values survive unticking and ticking again
  const chosen = Object.fromEntries(selected.map((p) => [p._id, entries[p._id] ?? emptyEntry(todayIst())]));
  const toggle = (id: string) => { setPicked((s) => { const next = new Set(s); if (!next.delete(id)) next.add(id); return next; }); setError(null); };

  async function submit() {
    if (sending.current) return;
    const problem = bulkEntryError(selected, chosen, todayIst(), date);
    if (problem) return setError(problem);
    sending.current = true;
    onBusy(true);
    setBusy(true);
    setError(null);
    try {
      const out = await request<{ results: Result[] }>("/settlements/complete-bulk", "POST", bulkEntryBody(selected, chosen));
      const done = out.results.filter((r) => r.ok).length;
      setResults(out.results.map((r) => ({ ...r, paymentNumber: selected.find((p) => p._id === r.id)?.paymentNumber ?? r.id })));
      if (done === out.results.length) toast(`${done} payment${done > 1 ? "s" : ""} completed`);
      else toast(`${done} of ${out.results.length} payments completed, ${out.results.length - done} failed`, "error");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      sending.current = false;
      onBusy(false);
      setBusy(false);
    }
  }

  return (
    <div className="be">
      <div className="be-scroll">
      <fieldset disabled={busy} className="be-set">
      {(list.data?.total ?? 0) > rows.length && <p className="muted">Showing the first {rows.length} of {list.data?.total}. Reopen after submitting for the rest.</p>}
      <BulkEntryFields
        rows={rows} picked={picked} entries={entries} date={date} today={todayIst()} onEntry={setEntry} onToggle={toggle}
        onToggleAll={() => { setPicked(new Set(all ? [] : rows.map((p) => p._id))); setError(null); }}
      />
      </fieldset>
      </div>
      {/* outside the scroll area, so it never moves; the error sits here to stay in view */}
      <div className="be-foot">
        <span>{selected.length} selected · Total <b>{formatInr(bulkEntryTotal(selected))}</b></span>
        <button type="button" className="btn btn-outline" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={busy || !selected.length} onClick={submit}>{busy ? "Saving…" : "Submit Bulk Entry"}</button>
      </div>
    </div>
  );
}

interface FieldsProps {
  rows: SettlementRow[]; picked: Set<string>; entries: BulkEntries; date: string; today: string;
  onEntry: (id: string, entry: RowEntry) => void; onToggle: (id: string) => void; onToggleAll: () => void;
}

/** The payment table; each selected payment has its own entry fields underneath it. */
export function BulkEntryFields({ rows, picked, entries, date, today, onEntry, onToggle, onToggleAll }: FieldsProps) {
  const count = rows.filter((p) => picked.has(p._id)).length;
  const all = count === rows.length;
  return (
    <>
      <div className="table-wrap">
        <table className="table" data-section="bulk-entry">
          <colgroup><col className="be-c-check" /><col className="be-c-no" /><col className="be-c-vert" /><col className="be-c-veh" /><col /><col className="be-c-amt" /></colgroup>
          <thead>
            <tr>
              <th>
                <input type="checkbox" aria-label="Select all payments" checked={all} ref={(el) => { if (el) el.indeterminate = count > 0 && !all; }} onChange={onToggleAll} />
              </th>
              <th>Payment No</th><th>Vertical</th><th>Vehicle</th><th>Driver</th><th className="ds-amt">Amount</th>
            </tr>
          </thead>
          {rows.map((p) => {
            const on = picked.has(p._id);
            const entry = entries[p._id] ?? emptyEntry(today);
            return (
              <tbody key={p._id} className={on ? "is-on" : undefined}>
                <tr>
                  <td><input type="checkbox" aria-label={`Select ${p.paymentNumber}`} checked={on} onChange={() => onToggle(p._id)} /></td>
                  <td><strong>{p.paymentNumber}</strong><small>{CATEGORY_SHORT[p.category]}</small></td>
                  <td>{verticalLabel(p.projectType)}</td>
                  <td>{p.vehicleNo ?? "-"}</td>
                  <td>{p.driverName ?? "-"}</td>
                  <td className="ds-amt">{formatInr(p.amount)}</td>
                </tr>
                {on && (
                  <tr className="be-detail">
                    <td />
                    <td colSpan={5}>
                      <EntryFields value={entry} date={date} today={today} label={p.paymentNumber} onChange={(patch) => onEntry(p._id, { ...entry, ...patch })} />
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
        </table>
      </div>
    </>
  );
}

/** The five fields of one payment's entry; `label` (the payment number) tells the rows apart for screen readers. */
function EntryFields({ value, date, today, label, onChange }: { value: RowEntry; date: string; today: string; label: string; onChange: (patch: Partial<RowEntry>) => void }) {
  const name = (text: string) => `${text}, ${label}`;
  return (
    <div className="be-grid">
      <div className="pe-field"><span>Payment Mode <i>*</i></span>
        <Select value={value.paymentMode} onChange={(e) => onChange({ paymentMode: e.target.value })} aria-label={name("Payment Mode")}>
          <option value="">Select mode</option>
          {ENTRY_MODES.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
        </Select>
      </div>
      <div className="pe-field"><span>Payment Date <i>*</i></span>
        <DateInput value={value.paymentDate} min={date} max={today} onChange={(e) => onChange({ paymentDate: e.target.value })} aria-label={name("Payment Date")} />
      </div>
      <div className="pe-field"><span>Mode of Payment {value.paymentMode !== "CASH" && <i>*</i>}</span>
        <input maxLength={120} placeholder="Paying bank" value={value.bankName} aria-label={name("Mode of Payment")} onChange={(e) => onChange({ bankName: e.target.value })} />
      </div>
      <div className="pe-field"><span>Reference No. <i>*</i></span>
        <input maxLength={60} placeholder="UTR / cheque / DD" value={value.referenceNumber} aria-label={name("Reference Number")} onChange={(e) => onChange({ referenceNumber: cleanReference(e.target.value) })} />
      </div>
      <div className="pe-field"><span>Reference Date</span>
        <DateInput value={value.referenceDate} max={today} onChange={(e) => onChange({ referenceDate: e.target.value })} aria-label={name("Reference Date")} />
      </div>
    </div>
  );
}
