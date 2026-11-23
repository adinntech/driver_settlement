"use client";

import { useState, type ReactNode } from "react";
import { useApi } from "@/hooks/useApi";
import { useDebounce } from "@/hooks/useDebounce";
import { request } from "@/services/api";
import {
  AV_LABEL, AV_STATUSES, AV_TONE, ISSUE_CATEGORIES, ISSUE_STATUS_LABEL, PROJECT_TYPE_LABEL, applyProject, typeProjectRef, unlinkProject,
  type AvForm, type AvStatus, type ProjectChoice,
} from "@/utils/vehicleAvailability";
import { formatDate } from "@/utils/format";

const Row = ({ label, req, children }: { label: string; req?: boolean; children: ReactNode }) => (
  <div className="b-row">
    <label>{label}{req && <span className="req"> *</span>}</label>
    <div className="b-ctl">{children}</div>
  </div>
);
const DateTime = ({ d, t, onD, onT, minD }: { d: string; t: string; onD: (v: string) => void; onT: (v: string) => void; minD?: string }) => (
  <div className="dt-pair">
    <input type="date" value={d} min={minD} onChange={(e) => onD(e.target.value)} aria-label="date" />
    <input type="time" value={t} onChange={(e) => onT(e.target.value)} aria-label="time" />
  </div>
);

export const AvBadge = ({ status }: { status?: string | null }) =>
  status && AV_STATUSES.includes(status as AvStatus) ? (
    <span className={`badge badge-av-${AV_TONE[status as AvStatus]}`}>{AV_LABEL[status as AvStatus]}</span>
  ) : (
    <span className="badge badge-av-none">Not set</span>
  );

interface ProjectPage { items: ProjectChoice[]; total: number; page: number; limit: number }
const PAGE_SIZE = 6;

/**
 * Trackup / PIF autocomplete over APPROVED projects only (server-side search + paging).
 * Choosing a suggestion, or typing a full number and leaving the field, fills the matching partner number and the
 * project details; typing again clears everything that came from the previous project.
 */
function RefField({ field, label, a, onChange }: { field: "trackupNumber" | "pifNumber"; label: string; a: AvForm; onChange: (next: AvForm) => void }) {
  const p = a.project;
  const linked = !!p.trackingProject;
  const text = p[field];
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [err, setErr] = useState("");
  const dq = useDebounce(text);
  const res = useApi<ProjectPage>(open && !linked ? `/vehicles/projects?q=${encodeURIComponent(dq.trim())}&page=${page}&limit=${PAGE_SIZE}` : null);
  const pages = res.data ? Math.max(1, Math.ceil(res.data.total / PAGE_SIZE)) : 1;

  async function resolve() {
    if (linked || !text.trim()) return;
    try {
      const c = await request<ProjectChoice>(`/vehicles/projects/lookup?${field === "trackupNumber" ? "trackup" : "pif"}=${encodeURIComponent(text.trim())}`);
      onChange({ ...a, project: applyProject(p, c) });
      setErr("");
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  const pick = (c: ProjectChoice) => {
    onChange({ ...a, project: applyProject(p, c) });
    setErr("");
    setOpen(false);
  };

  return (
    <div className="proj-pick">
      <input
        value={text}
        readOnly={linked}
        placeholder={`Search approved projects by ${label}`}
        aria-label={label}
        aria-invalid={!!err}
        autoComplete="off"
        onFocus={() => !linked && setOpen(true)}
        onBlur={() => { setOpen(false); void resolve(); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void resolve(); } }}
        onChange={(e) => { setPage(1); setErr(""); setOpen(true); onChange({ ...a, project: typeProjectRef(p, field, e.target.value) }); }}
      />
      {err && <small className="proj-taken" role="alert">{err}</small>}
      {open && !linked && (
        <div className="proj-results" role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {res.loading ? (
            <p className="muted">Searching approved projects…</p>
          ) : res.error ? (
            <p className="muted">{res.error}</p>
          ) : !res.data || res.data.items.length === 0 ? (
            <p className="muted">No approved project matches. Only approved projects can be allocated.</p>
          ) : (
            <>
              {res.data.items.map((c) => (
                <button type="button" key={c.trackupNumber} className="proj-item" role="option" aria-selected="false" disabled={!!c.allocatedTo} onClick={() => pick(c)}>
                  <strong>{c.trackupNumber} <span className="muted">↔</span> {c.pifNumber}</strong>
                  <span>{c.projectName} · {PROJECT_TYPE_LABEL[c.projectType] ?? c.projectType}</span>
                  <small className="muted">{c.clientName}{c.startDate ? ` · ${formatDate(c.startDate)} – ${formatDate(c.endDate)}` : ""}</small>
                  {c.allocatedTo && <small className="proj-taken">Already allocated to {c.allocatedTo}</small>}
                </button>
              ))}
              {pages > 1 && (
                <div className="proj-pager">
                  <button type="button" className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                  <small className="muted">Page {page} of {pages}</small>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function VehicleAvailability({ value: a, onChange }: { value: AvForm; onChange: (next: AvForm) => void }) {
  const set = <K extends keyof AvForm>(k: K, v: AvForm[K]) => onChange({ ...a, [k]: v });
  const proj = (k: keyof AvForm["project"], v: string) => onChange({ ...a, project: { ...a.project, [k]: v } });
  const iss = (k: keyof AvForm["issue"], v: string) => onChange({ ...a, issue: { ...a.issue, [k]: v } });
  const linked = !!a.project.trackingProject;
  const period = a.project.startDate ? `${formatDate(a.project.startDate)} – ${a.project.endDate ? formatDate(a.project.endDate) : "…"}` : "";

  return (
    <section className="av-section" aria-label="Vehicle Availability & Status">
      <h3 className="sub docs-title">Vehicle Availability &amp; Status</h3>
      <div className="b-col narrow">
        <Row label="Vehicle Status" req>
          <div className="av-status-pick">
            <select value={a.status} onChange={(e) => set("status", e.target.value as AvForm["status"])} aria-label="Vehicle Status">
              <option value="">Select status</option>
              {AV_STATUSES.map((s) => <option key={s} value={s}>{AV_LABEL[s]}</option>)}
            </select>
            {a.status && <span className={`badge badge-av-${AV_TONE[a.status]}`}>{AV_LABEL[a.status]}</span>}
          </div>
        </Row>
      </div>

      {a.status === "AVAILABLE" && (
        <div className="av-panel av-green" data-panel="available">
          <p className="av-state">Current availability: <strong>Available now</strong></p>
          <Row label="Available From">
            <DateTime d={a.availableFromDate} t={a.availableFromTime} onD={(v) => set("availableFromDate", v)} onT={(v) => set("availableFromTime", v)} />
          </Row>
        </div>
      )}

      {a.status === "IN_USE" && (
        <div className="av-panel av-blue" data-panel="in-use">
          <h4>Project Allocation Details</h4>
          <p className="av-note-strong">Only approved projects are available for vehicle allocation.</p>
          {linked && (
            <p className="av-linked">
              Linked to approved project <strong>{a.project.trackupNumber}</strong> ↔ <strong>{a.project.pifNumber}</strong>.{" "}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ ...a, project: unlinkProject(a.project) })}>Change project</button>
            </p>
          )}
          <div className="b-cols">
            <div className="b-col">
              <Row label="Trackup Number" req>
                <RefField field="trackupNumber" label="Trackup Number" a={a} onChange={onChange} />
              </Row>
              <Row label="PIF Number" req>
                <RefField field="pifNumber" label="PIF Number" a={a} onChange={onChange} />
              </Row>
              <Row label="Client / Billing Name">
                <input value={a.project.clientName} readOnly placeholder="Filled from the project" />
              </Row>
              <Row label="Project Type">
                <input value={PROJECT_TYPE_LABEL[a.project.projectType] ?? a.project.projectType} readOnly placeholder="Filled from the project" />
              </Row>
              <Row label="Project Name">
                <input value={a.project.projectName} readOnly placeholder="Filled from the project" />
              </Row>
              <Row label="Project Period">
                <input value={period} readOnly placeholder="Filled from the project" />
              </Row>
            </div>
            <div className="b-col">
              <Row label="Expected Release">
                <DateTime d={a.expectedReleaseDate} t={a.expectedReleaseTime} onD={(v) => set("expectedReleaseDate", v)} onT={(v) => set("expectedReleaseTime", v)} />
              </Row>
              <Row label="Next Available" req>
                <DateTime d={a.nextAvailableDate} t={a.nextAvailableTime} minD={a.expectedReleaseDate || undefined} onD={(v) => set("nextAvailableDate", v)} onT={(v) => set("nextAvailableTime", v)} />
              </Row>
              <Row label="Additional Remarks">
                <textarea rows={3} value={a.project.remarks} maxLength={300} onChange={(e) => proj("remarks", e.target.value)} />
              </Row>
            </div>
          </div>
          <p className="muted av-note">When the next available date &amp; time is reached the vehicle is marked Available Now automatically (IST).</p>
        </div>
      )}

      {a.status === "ISSUE" && (
        <div className="av-panel av-red" data-panel="issue">
          <h4>Vehicle Issue Details</h4>
          <div className="b-cols">
            <div className="b-col">
              <Row label="Issue Category" req>
                <select value={a.issue.category} onChange={(e) => iss("category", e.target.value)}>
                  <option value="">Select category</option>
                  {ISSUE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Row>
              <Row label="Issue Description / Reason" req>
                <textarea rows={3} value={a.issue.description} maxLength={500} onChange={(e) => iss("description", e.target.value)} placeholder="What is wrong with the vehicle?" />
              </Row>
              <Row label="Issue Reported">
                <DateTime d={a.issue.reportedDate} t={a.issue.reportedTime} onD={(v) => iss("reportedDate", v)} onT={(v) => iss("reportedTime", v)} />
              </Row>
              <Row label="Issue Status">
                <select value={a.issue.issueStatus} onChange={(e) => iss("issueStatus", e.target.value)}>
                  {Object.entries(ISSUE_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </Row>
            </div>
            <div className="b-col">
              <Row label="Expected Repair Completion">
                <DateTime d={a.issue.expectedRepairDate} t={a.issue.expectedRepairTime} minD={a.issue.reportedDate || undefined} onD={(v) => iss("expectedRepairDate", v)} onT={(v) => iss("expectedRepairTime", v)} />
              </Row>
              <Row label="Garage / Service Centre">
                <input value={a.issue.garage} maxLength={120} onChange={(e) => iss("garage", e.target.value)} placeholder="Optional" />
              </Row>
              <Row label="Repair Remarks">
                <textarea rows={3} value={a.issue.repairRemarks} maxLength={300} onChange={(e) => iss("repairRemarks", e.target.value)} />
              </Row>
            </div>
          </div>
          <p className="muted av-note">The vehicle stays unavailable until you change its status to Available Now after the issue is resolved.</p>
        </div>
      )}
    </section>
  );
}
