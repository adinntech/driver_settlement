"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import { ApprovalBadge } from "@/components/ApprovalTimeline";
import CopyButton from "@/components/ui/CopyButton";
import { ConfirmDialog, ErrorState, Modal, Skeleton } from "@/components/ui/Ui";
import { useToast } from "@/context/ToastContext";
import { useApi } from "@/hooks/useApi";
import { request } from "@/services/api";
import { ActivitySummary, ApprovalHistory, VersionHistory } from "@/components/HistorySections";
import type { Activity, Budget, BudgetContext, BudgetEvent, BudgetVersion, Details } from "@/types/domain";
import { describeBudget, fieldLabel, rejectableFields, show, statusOf } from "@/utils/budgetDescribe";
import { formatDate, formatDateTime, formatInr, labelize } from "@/utils/format";
import { allowanceText, kmText } from "@/utils/kmAllowance";

interface Review {
  context: BudgetContext;
  projectDetails: Details;
  vehicleId: string;
  budget: Budget;
  versions: BudgetVersion[];
  events: BudgetEvent[];
  activity: Activity | null;
  comparison: null | {
    fromVersion: number;
    toVersion: number;
    changes: { field: string; from: unknown; to: unknown }[];
    rejection: NonNullable<Budget["rejection"]>;
    resubmissionComment: string | null;
  };
}

export default function ReviewPage() {
  return (
    <AppShell role="RSOM">
      <Suspense fallback={<Skeleton rows={6} />}>
        <ReviewView />
      </Suspense>
    </AppShell>
  );
}

const KV = ({ k, v, cls }: { k: string; v: string; cls?: string }) => (
  <div className={cls}>
    <dt>{k}</dt>
    <dd>{v || "—"}</dd>
  </div>
);

function ReviewView() {
  const id = useSearchParams().get("budget");
  const res = useApi<Review>(id ? `/approvals/${id}?order=desc` : null);
  if (!id) return <ErrorState message="No budget selected." />;
  if (res.loading) return <Skeleton rows={8} />;
  if (res.error || !res.data) return <ErrorState message={res.error ?? "Not found"} onRetry={res.reload} />;
  return <Body data={res.data} reload={res.reload} />;
}

function Body({ data, reload }: { data: Review; reload: () => void }) {
  const { context: c, budget, versions, events, comparison, projectDetails, activity } = data;
  const toast = useToast();
  const status = statusOf(budget.approvalStatus);
  const [confirm, setConfirm] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inflight = useRef(false);
  const rejected = new Map(status === "REJECTED" && budget.rejection ? budget.rejection.fields.map((f) => [f.field, f.comment]) : []);

  async function approve() {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError("");
    try {
      await request(`/approvals/${budget._id}/approve`, "POST", { version: budget.currentVersion });
      toast("Budget approved. RBP has been notified.");
      setConfirm(false);
      inflight.current = false;
      setBusy(false);
      reload();
    } catch (e) {
      setError((e as Error).message);
      setConfirm(false);
      inflight.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/rsom" className="back">← Back to approvals</Link>
          <h1>Review Budget</h1>
          <p className="muted">{c.client} · Vehicle {c.vehicleIndex} · {budget.budgetNumber}</p>
        </div>
        <ApprovalBadge status={status} />
      </div>
      {error && <div className="alert" role="alert">{error}</div>}

      <div className="card">
        <h3 className="sub">Project information</h3>
        <dl className="kv">
          <KV k="Client / Billing Name" v={c.client} />
          <KV k="Project Type" v={c.projectType === "ROADSHOW" ? "Roadshow" : "Signage"} />
          <KV k="Location" v={c.location} />
          <KV k="Campaign Period" v={`${formatDate(c.campaignFrom)} → ${formatDate(c.campaignTo)}`} />
          {c.projectType === "ROADSHOW" && <KV k="Reporting Date" v={formatDate(c.reportingDate)} />}
          <KV k="Number of Days" v={String(c.numberOfDays ?? "—")} />
          {c.km && (
            <>
              <KV k="Extra KM / Day" v={c.km.extraKmAllowed ? kmText(c.km.extraKmAllotted) : "Not allowed"} />
              <KV k="Campaign Total Allowed KM" v={c.km.totalAllowedKm === null ? "" : allowanceText(c.km)} />
              {c.km.totalAllowedKm !== null && (() => {
                const est = Math.round((Number(budget.data.estimatedKmPerDay) || 0) * (Number(budget.data.numberOfDays) || 0) * 100) / 100;
                const over = est > c.km.totalAllowedKm;
                return <KV k="Budget Estimated KM" cls={over ? "kv-rej" : undefined} v={`${kmText(est)}${over ? ` · exceeds the allowance by ${kmText(Math.round((est - c.km.totalAllowedKm) * 100) / 100)}` : " · within the allowance"}`} />;
              })()}
            </>
          )}
          {[["Trackup Number", c.trackupNumber], ["PIF Number", c.pifNumber], ["Display Number", c.displayNumber]].map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className="num">{v}<CopyButton value={v} label={k} /></dd>
            </div>
          ))}
        </dl>
        <details className="more">
          <summary>All project details entered by RSOP</summary>
          <dl className="kv compact">
            {Object.entries(projectDetails).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => (
              <KV key={k} k={labelize(k)} v={Array.isArray(v) ? v.join(", ") : /date$/i.test(k) && typeof v === "string" ? formatDate(v) : String(v)} />
            ))}
          </dl>
        </details>
      </div>

      {comparison && (
        <div className="card compare fade-in">
          <h3 className="sub">Revised budget — V{comparison.fromVersion} (rejected) vs V{comparison.toVersion} (resubmitted)</h3>
          <p className="muted">
            Previously rejected{comparison.rejection.reason ? `: ${comparison.rejection.reason}` : ""}
            {comparison.resubmissionComment && <> · <strong>RBP comment:</strong> {comparison.resubmissionComment}</>}
          </p>
          <table className="table">
            <thead><tr><th>Field</th><th>Rejected version</th><th>Resubmitted version</th><th>RSOM comment</th></tr></thead>
            <tbody>
              {comparison.changes.map((ch) => (
                <tr key={ch.field}>
                  <td><strong>{fieldLabel(ch.field)}</strong></td>
                  <td><s>{show(ch.from)}</s></td>
                  <td><strong>{show(ch.to)}</strong></td>
                  <td>{comparison.rejection.fields.find((f) => f.field === ch.field)?.comment ?? <span className="muted">—</span>}</td>
                </tr>
              ))}
              {comparison.changes.length === 0 && <tr><td colSpan={4} className="muted">No field values changed.</td></tr>}
            </tbody>
          </table>
          {comparison.rejection.fields.filter((f) => !comparison.changes.some((ch) => ch.field === f.field)).length > 0 && (
            <p className="alert">
              Not changed since rejection: {comparison.rejection.fields.filter((f) => !comparison.changes.some((ch) => ch.field === f.field)).map((f) => fieldLabel(f.field)).join(", ")}
            </p>
          )}
        </div>
      )}

      <div className="card">
        <div className="page-head tight">
          <div>
            <h3 className="sub">Budget · V{budget.currentVersion}</h3>
            <p className="muted">Submitted {formatDateTime(budget.submittedAt)} by {budget.submittedBy} · read-only</p>
          </div>
          <div className="total"><small>Total Budget</small><strong>{formatInr(budget.total)}</strong></div>
        </div>
        <ActivitySummary activity={activity} role="RSOM" />
        <dl className="kv">
          {describeBudget(budget.data).map((d) => (
            <div key={d.label} className={d.key && rejected.has(d.key) ? "kv-rej" : ""}>
              <dt>{d.label}</dt>
              <dd>{d.value || "—"}</dd>
              {d.key && rejected.has(d.key) && <small className="rej-note">Rejected: {rejected.get(d.key)}</small>}
            </div>
          ))}
        </dl>
      </div>

      <div className="card">
        <h3 className="sub">Budget version history</h3>
        <VersionHistory versions={versions} events={events} currentVersion={budget.currentVersion} />
      </div>

      <div className="card">
        <h3 className="sub">Approval history</h3>
        <ApprovalHistory events={events} />
      </div>

      <div className="sticky-actions decision">
        {status === "PENDING" ? (
          <>
            <div className="total"><small>Overall budget · V{budget.currentVersion}</small><strong>{formatInr(budget.total)}</strong></div>
            <div className="inline">
              <button className="btn btn-outline btn-danger" onClick={() => setRejecting(true)}>Reject Budget</button>
              <button className="btn btn-primary" onClick={() => setConfirm(true)}>Approve Budget</button>
            </div>
          </>
        ) : (
          <span className="muted">
            {status === "APPROVED" && `Approved V${budget.approvedVersion} by ${budget.reviewedBy} on ${formatDateTime(budget.reviewedAt)}.`}
            {status === "REJECTED" && `Rejected V${budget.rejectedVersion} by ${budget.reviewedBy} on ${formatDateTime(budget.reviewedAt)}. Waiting for RBP to correct and resubmit.`}
          </span>
        )}
      </div>

      {confirm && (
        <ConfirmDialog
          title="Approve this budget?"
          message={`Overall budget ${formatInr(budget.total)} · Version V${budget.currentVersion}. The entire budget will be approved and RBP will be notified.`}
          confirmLabel="Approve"
          busy={busy}
          onConfirm={approve}
          onCancel={() => setConfirm(false)}
        />
      )}
      {rejecting && (
        <RejectModal
          budget={budget}
          onClose={() => setRejecting(false)}
          onDone={() => {
            setRejecting(false);
            toast("Budget rejected. RBP has been notified.");
            reload();
          }}
        />
      )}
    </>
  );
}

function RejectModal({ budget, onClose, onDone }: { budget: Budget; onClose: () => void; onDone: () => void }) {
  const options = rejectableFields(budget.data);
  const [reason, setReason] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({}); // field -> comment
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);

  const toggle = (k: string) =>
    setPicked((p) => {
      const n = { ...p };
      if (k in n) delete n[k];
      else n[k] = "";
      return n;
    });

  async function submit() {
    const e: string[] = [];
    const keys = Object.keys(picked);
    if (keys.length === 0) e.push("Select at least one field that needs correction");
    for (const k of keys) if (!picked[k].trim()) e.push(`Enter a comment for ${fieldLabel(k)}`);
    setErrors(e);
    if (e.length || inflight.current) return;
    inflight.current = true;
    setBusy(true);
    try {
      await request(`/approvals/${budget._id}/reject`, "POST", {
        version: budget.currentVersion,
        reason: reason.trim() || undefined,
        fields: keys.map((k) => ({ field: k, comment: picked[k].trim() })),
      });
      onDone();
    } catch (err) {
      setErrors([(err as Error).message]);
      inflight.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal title={`Reject budget · V${budget.currentVersion}`} wide onClose={busy ? () => {} : onClose}>
      {errors.length > 0 && <div className="alert" role="alert">{errors.map((e) => <div key={e}>{e}</div>)}</div>}
      <label className="field">
        <span>Rejection reason (optional)</span>
        <textarea rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain why this budget is rejected" />
      </label>
      <h4 className="sub reject-sub">Fields that need correction *</h4>
      <div className="reject-fields">
        {options.map((o) => (
          <div key={o.key} className={`reject-field${o.key in picked ? " on" : ""}`}>
            <label className="check">
              <input type="checkbox" checked={o.key in picked} onChange={() => toggle(o.key)} /> {o.label}
            </label>
            {o.key in picked && (
              <textarea rows={2} maxLength={500} className="fade-in" placeholder={`What is wrong with ${o.label}?`} value={picked[o.key]} onChange={(e) => setPicked((p) => ({ ...p, [o.key]: e.target.value }))} />
            )}
          </div>
        ))}
      </div>
      <div className="actions-row">
        <button className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Please wait…" : "Confirm Rejection"}</button>
      </div>
    </Modal>
  );
}
