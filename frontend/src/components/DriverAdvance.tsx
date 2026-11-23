"use client";

import { useRef, useState } from "react";
import { Modal, EmptyState, ErrorState, Skeleton } from "@/components/ui/Ui";
import { useToast } from "@/context/ToastContext";
import { useApi } from "@/hooks/useApi";
import { request } from "@/services/api";
import type { Driver, DriverAdvanceRow } from "@/types/domain";
import { advancePreview, money, newSubmissionKey, ROUNDING_TEXT, sanitizeWorkingDays, toAdvancePayload, validateAdvance } from "@/utils/driverAdvance";
import { formatDateTime } from "@/utils/format";

const KV = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div>
    <dt>{k}</dt>
    <dd>{v === null || v === undefined || v === "" ? "—" : v}</dd>
  </div>
);

/** Advance calculation form. Working days is the only input; salary, eligible amount and advance are read-only and always derived. */
export function AdvanceForm({
  salary, days, onDays, onSubmit, busy, error,
}: { salary: number | null | undefined; days: string; onDays: (v: string) => void; onSubmit: () => void; busy?: boolean; error?: string | null }) {
  const problem = validateAdvance(days, salary);
  const p = advancePreview(days, salary);
  const salaryMissing = !salary || salary <= 0;
  return (
    <div className="card" data-section="advance-form">
      <h3 className="sub">Advance Amount</h3>
      {error && <div className="alert" role="alert">{error}</div>}
      {salaryMissing && <div className="alert" role="alert" data-note="no-salary">Driver salary is unavailable; set the driver&apos;s salary in Driver Management first.</div>}
      <div className="rm-form adv-form">
        <label>Overall Working Days<span className="req"> *</span></label>
        <div>
          <input className="num-input" inputMode="numeric" value={days} placeholder="e.g. 10" aria-label="Overall Working Days" aria-invalid={!!days && !!problem && !salaryMissing}
            onChange={(e) => onDays(sanitizeWorkingDays(e.target.value))} />
          <small className="muted">Enter the driver&apos;s working days (no attendance source is connected).</small>
        </div>
        <label>Per Day Salary</label>
        <div><input value={salaryMissing ? "—" : money(salary)} readOnly aria-label="Per Day Salary" /></div>
        <label>Eligible Advance Amount</label>
        <div><input value={p ? money(p.eligible) : "—"} readOnly aria-label="Eligible Advance Amount" /><small className="muted">Working days × per day salary</small></div>
        <label>Advance Amount</label>
        <div><input className="adv-final" value={p ? money(p.advance) : "—"} readOnly aria-label="Advance Amount" /><small className="muted">{ROUNDING_TEXT}</small></div>
      </div>
      {days && problem && !salaryMissing && <small className="proj-taken" role="alert">{problem}</small>}
      <div className="drv-actions">
        <button className="btn btn-primary" onClick={onSubmit} disabled={busy || !!problem || !p || p.advance <= 0}>Submit Advance</button>
      </div>
      {p && p.advance <= 0 && <small className="proj-taken" role="alert">The eligible amount is too low for an advance (half of it must be at least ₹500).</small>}
    </div>
  );
}

/** Confirmation summary shown before anything is saved. */
export function AdvanceConfirm({
  driver, days, salary, busy, onBack, onConfirm,
}: { driver: Pick<Driver, "driverNumber" | "driverName">; days: string; salary: number; busy?: boolean; onBack: () => void; onConfirm: () => void }) {
  const p = advancePreview(days, salary);
  if (!p) return null;
  return (
    <Modal title="Confirm Advance" onClose={onBack}>
      <dl className="kv allot-proj" data-step="summary">
        <KV k="Driver Number" v={<strong className="num">{driver.driverNumber}</strong>} />
        <KV k="Driver Name" v={driver.driverName} />
        <KV k="Overall Working Days" v={p.workingDays} />
        <KV k="Per Day Salary" v={money(p.perDaySalary)} />
        <KV k="Eligible Advance Amount" v={money(p.eligible)} />
        <KV k="Final Advance Amount" v={<strong>{money(p.advance)}</strong>} />
      </dl>
      <p className="muted">The amounts are recalculated and saved by the server.</p>
      <div className="actions-row">
        <button className="btn btn-outline" onClick={onBack} disabled={busy}>Back</button>
        <button className="btn btn-primary" onClick={onConfirm} disabled={busy}>{busy ? "Submitting…" : "Confirm & Submit"}</button>
      </div>
    </Modal>
  );
}

export function AdvanceHistoryTable({
  items, total, page, limit, onPage, onView,
}: { items: DriverAdvanceRow[]; total: number; page: number; limit: number; onPage: (p: number) => void; onView: (a: DriverAdvanceRow) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="card" data-section="advance-history">
      <h3 className="sub">Advance History</h3>
      {items.length === 0 ? (
        <EmptyState title="No advances yet" hint="Submitted advances for this driver appear here." />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Date &amp; Time</th><th>Working Days</th><th>Per Day Salary</th><th>Eligible Amount</th><th>Advance Amount</th><th>Submitted By</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a._id}>
                    <td>{formatDateTime(a.submittedAt)}</td>
                    <td>{a.workingDays}</td>
                    <td>{money(a.perDaySalary)}</td>
                    <td>{money(a.eligibleAdvanceAmount)}</td>
                    <td><strong>{money(a.finalAdvanceAmount)}</strong></td>
                    <td>{a.submittedBy}</td>
                    <td><button className="btn btn-outline btn-sm" onClick={() => onView(a)}>View Details</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span className="muted">{total} advance(s) · page {page} of {pages}</span>
            <div className="inline">
              <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
              <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function AdvanceDetail({ a, onClose }: { a: DriverAdvanceRow; onClose: () => void }) {
  return (
    <Modal title="Advance Details" onClose={onClose}>
      <dl className="kv allot-proj" data-section="advance-detail">
        <KV k="Driver Number" v={a.driverNumber} />
        <KV k="Driver Name" v={a.driverName} />
        <KV k="Submitted" v={formatDateTime(a.submittedAt)} />
        <KV k="Submitted By" v={a.submittedBy} />
        <KV k="Overall Working Days" v={a.workingDays} />
        <KV k="Per Day Salary (used)" v={money(a.perDaySalary)} />
        <KV k="Eligible Advance Amount" v={money(a.eligibleAdvanceAmount)} />
        <KV k="Half of Eligible Amount" v={money(a.calculatedHalfAmount)} />
        <KV k="Rounding" v={`Down to ₹${a.roundingUnit}`} />
        <KV k="Final Advance Amount" v={<strong>{money(a.finalAdvanceAmount)}</strong>} />
      </dl>
      <div className="actions-row"><button className="btn btn-outline" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

interface Page { items: DriverAdvanceRow[]; total: number; page: number; limit: number }

/** Advance Amount + Advance History for the driver being viewed. Nothing else on the page is touched. */
export default function DriverAdvancePanel({ driver }: { driver: Driver }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<DriverAdvanceRow | null>(null);
  const key = useRef(newSubmissionKey()); // same key for every click / retry of one form session
  const inflight = useRef(false);
  const hist = useApi<Page>(`/drivers/${driver._id}/advances?page=${page}&limit=10`);

  async function submit() {
    if (inflight.current) return; // double-click guard
    inflight.current = true;
    setBusy(true);
    try {
      await request(`/drivers/${driver._id}/advances`, "POST", toAdvancePayload(days, key.current));
      toast("Advance submitted successfully");
      key.current = newSubmissionKey(); // the next advance is a new submission
      setDays("");
      setConfirm(false);
      setOpen(false);
      setError(null);
      setPage(1);
      hist.reload();
    } catch (e) {
      setError((e as Error).message);
      setConfirm(false);
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <div className="inline" data-section="advance-toggle">
        <button className={`btn ${open ? "btn-outline" : "btn-primary"}`} onClick={() => { setOpen(!open); setError(null); }} aria-expanded={open}>Advance Amount</button>
      </div>
      {open && (
        <AdvanceForm salary={driver.salary} days={days} onDays={setDays} busy={busy} error={error}
          onSubmit={() => { if (!validateAdvance(days, driver.salary)) { setError(null); setConfirm(true); } }} />
      )}
      {confirm && <AdvanceConfirm driver={driver} days={days} salary={driver.salary} busy={busy} onBack={() => setConfirm(false)} onConfirm={submit} />}
      {hist.loading ? (
        <Skeleton rows={3} />
      ) : hist.error || !hist.data ? (
        <ErrorState message={hist.error ?? "Advance history could not be loaded"} onRetry={hist.reload} />
      ) : (
        <AdvanceHistoryTable items={hist.data.items} total={hist.data.total} page={page} limit={hist.data.limit} onPage={setPage} onView={setView} />
      )}
      {view && <AdvanceDetail a={view} onClose={() => setView(null)} />}
    </>
  );
}
