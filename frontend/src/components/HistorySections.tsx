"use client";

import ReadMore from "@/components/ui/ReadMore";
import { useState, type ReactNode } from "react";
import { ApprovalBadge, ACTION_LABEL } from "@/components/ApprovalTimeline";
import type { Activity, BudgetEvent, BudgetVersion, Stamp } from "@/types/domain";
import { describeBudget, fieldLabel, show, STATUS_LABEL } from "@/utils/budgetDescribe";
import { formatDateTime, formatInr } from "@/utils/format";
import { approvalEvents, sortVersionsDesc, statusAfter, versionStatus, versionSubmittedAt } from "@/utils/history";

const NA = "Not available";
const when = (iso: string | null | undefined) => (iso ? formatDateTime(iso) : NA);

/** Expand / collapse card in the style of the Project Information "all details" section. */
export function Collapsible({ defaultOpen, head, children, tone }: { defaultOpen: boolean; head: ReactNode; children: ReactNode; tone?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`hist-item${open ? " open" : ""}${tone ? ` ${tone}` : ""}`}>
      <button type="button" className="hist-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="hist-chev" aria-hidden>{open ? "▾" : "▸"}</span>
        <div className="hist-summary">{head}</div>
      </button>
      <div className={`hist-body${open ? " show" : ""}`}>
        <div className="hist-inner">{open && <div className="hist-content">{children}</div>}</div>
      </div>
    </div>
  );
}

const Meta = ({ label, children }: { label: string; children: ReactNode }) => (
  <span className="hist-meta"><small>{label}</small><strong>{children}</strong></span>
);

// ------------------------------------------------------------------ date & time summary
export function ActivitySummary({ activity, role }: { activity: Activity | null; role: "RBP" | "RSOM" }) {
  if (!activity) return null;
  const item = (label: string, s: Stamp | null | undefined, opts?: { always?: boolean; at?: string | null }) => {
    const at = opts?.at ?? s?.at;
    if (!s && !opts?.always) return null;
    return (
      <div className={`act${s?.superseded ? " act-old" : ""}`} key={label}>
        <small>{label}</small>
        <strong>{when(at)}</strong>
        <span className="muted">
          {s ? `V${s.version} · ${s.by}` : ""}
          {s?.superseded && " · earlier decision"}
        </span>
      </div>
    );
  };
  const rbp = role === "RBP";
  return (
    <div className="activity" aria-label="Date and time tracking">
      <div className="act"><small>Budget Created</small><strong>{when(activity.createdAt)}</strong><span className="muted">{activity.createdBy}</span></div>
      {item("Last Edited", activity.lastEdited, { always: true })}
      {item(rbp ? "Last Submitted" : "Submitted for Approval", activity.lastSubmitted)}
      {item(rbp ? "Last Resubmitted" : "Resubmitted", activity.lastResubmitted)}
      {item(rbp ? "Last Approved" : "Approved", activity.lastApproved)}
      {item(rbp ? "Last Rejected" : "Rejected", activity.lastRejected)}
    </div>
  );
}

// ------------------------------------------------------------------ budget version history
export function VersionHistory({ versions, events, currentVersion }: { versions: BudgetVersion[]; events: BudgetEvent[]; currentVersion: number }) {
  const list = sortVersionsDesc(versions);
  if (list.length === 0) return <p className="muted">No versions yet.</p>;
  // Keyed by the latest version: when a new one arrives the cards remount, so it opens and the older ones close.
  return (
    <div className="hist-list" key={list[0]._id}>
      {list.map((v, i) => {
        const st = versionStatus(v.version, events);
        const sub = versionSubmittedAt(v.version, events);
        return (
          <Collapsible
            key={v._id}
            defaultOpen={i === 0}
            tone={i === 0 ? "latest" : ""}
            head={
              <>
                <strong className="hist-title">V{v.version}</strong>
                {(i === 0 || v.version === currentVersion) && <span className="badge badge-created">Latest</span>}
                {st ? <ApprovalBadge status={st} /> : <span className="badge badge-ap-draft">Status: {NA}</span>}
                <Meta label="Total Budget">{formatInr(v.total)}</Meta>
                <Meta label="Updated By">{v.updatedBy}</Meta>
                <Meta label="Last Edited">{when(v.createdAt)}</Meta>
                {sub && <Meta label="Submitted">{formatDateTime(sub)}</Meta>}
              </>
            }
          >
            <VersionBody v={v} />
          </Collapsible>
        );
      })}
    </div>
  );
}

function VersionBody({ v }: { v: BudgetVersion }) {
  return (
    <>
      {v.version === 1 ? (
        <p className="muted">Initial budget · created by {v.updatedBy} on {when(v.createdAt)}</p>
      ) : (
        <>
          <h4 className="sub">Changes in this version (previous → updated)</h4>
          {v.changes.length === 0 ? (
            <p className="muted">{NA}</p>
          ) : (
            <ul className="changes">
              {v.changes.map((c) => (
                <li key={c.field}>
                  {fieldLabel(c.field)}: <s>{show(c.from)}</s> → <strong>{show(c.to)}</strong>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <h4 className="sub">Complete budget in this version</h4>
      <dl className="kv compact">
        {describeBudget(v.data).map((d) => (
          <div key={d.label}>
            <dt>{d.label}</dt>
            <dd>{d.value || "—"}</dd>
          </div>
        ))}
      </dl>
      <p className="muted hist-foot">Saved by {v.updatedBy} · {when(v.createdAt)} · Total {formatInr(v.total)}</p>
    </>
  );
}

// ------------------------------------------------------------------ approval history
export function ApprovalHistory({ events }: { events: BudgetEvent[] }) {
  const list = approvalEvents(events);
  if (list.length === 0) return <p className="muted">No approval activity yet.</p>;
  return (
    <div className="hist-list">
      {list.map((e, i) => {
        const status = statusAfter(e.action);
        return (
          <Collapsible
            key={e._id}
            defaultOpen={i === 0}
            tone={`${i === 0 ? "latest " : ""}ev-${e.action.toLowerCase()}`}
            head={
              <>
                <strong className="hist-title">{ACTION_LABEL[e.action]}</strong>
                <span className="badge badge-created hist-v">V{e.version}</span>
                <ApprovalBadge status={status} />
                <Meta label="Performed By">{e.username} ({e.role})</Meta>
                <Meta label="Date & Time">{when(e.createdAt)}</Meta>
              </>
            }
          >
            <EventBody e={e} />
          </Collapsible>
        );
      })}
    </div>
  );
}

function EventBody({ e }: { e: BudgetEvent }) {
  const d = (e.details ?? {}) as Record<string, unknown>;
  const fields = Array.isArray(d.fields) ? (d.fields as { field: string; comment: string }[]) : [];
  const changes = (Array.isArray(d.changesSinceRejected) ? d.changesSinceRejected : []) as { field: string; from: unknown; to: unknown }[];
  const total = typeof d.total === "number" ? d.total : null;
  return (
    <dl className="kv compact">
      <div><dt>Action</dt><dd>{ACTION_LABEL[e.action]}</dd></div>
      <div><dt>Resulting status</dt><dd>{STATUS_LABEL[statusAfter(e.action)]}</dd></div>
      <div><dt>Budget version</dt><dd>V{e.version}</dd></div>
      <div><dt>{e.action === "APPROVED" || e.action === "REJECTED" ? "Reviewed by" : "Submitted by"}</dt><dd>{e.username} ({e.role})</dd></div>
      <div><dt>Exact timestamp (IST)</dt><dd>{when(e.createdAt)}</dd></div>
      {total !== null && <div><dt>{e.action === "APPROVED" ? "Approved amount" : e.action === "REJECTED" ? "Rejected amount" : "Total budget"}</dt><dd>{formatInr(total)}</dd></div>}
      {typeof d.reason === "string" && <div className="wide"><dt>Rejection reason</dt><dd><ReadMore>{d.reason}</ReadMore></dd></div>}
      {fields.length > 0 && (
        <div className="wide kv-rej">
          <dt>Rejected fields and comments</dt>
          <dd>
            <ul className="tl-list">
              {fields.map((f) => (
                <li key={f.field}><ReadMore><strong>{fieldLabel(f.field)}</strong>: {f.comment}</ReadMore></li>
              ))}
            </ul>
          </dd>
        </div>
      )}
      {typeof d.revisionReason === "string" && (
        <div className="wide">
          <dt>Reason for revision</dt>
          <dd>
            <ReadMore>{d.revisionReason}</ReadMore>
            {typeof d.revisedBy === "string" && <> (edited by {d.revisedBy} on {when(String(d.revisedAt))})</>}
          </dd>
        </div>
      )}
      {typeof d.comment === "string" && d.comment && <div className="wide"><dt>RBP comment</dt><dd><ReadMore>{d.comment}</ReadMore></dd></div>}
      {changes.length > 0 && (
        <div className="wide">
          <dt>Changes since rejected V{String(d.rejectedVersion ?? "")} (previous → updated)</dt>
          <dd>
            <ul className="tl-list">
              {changes.map((c) => (
                <li key={c.field}>{fieldLabel(c.field)}: <s>{show(c.from)}</s> → <strong>{show(c.to)}</strong></li>
              ))}
            </ul>
          </dd>
        </div>
      )}
    </dl>
  );
}
