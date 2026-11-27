"use client";

import Select from "@/components/ui/Select";
import DateInput from "@/components/ui/DateInput";
import { useState, type ReactNode } from "react";
import { useApi } from "@/hooks/useApi";
import { useDebounce } from "@/hooks/useDebounce";
import { request } from "@/services/api";
import type { DriverAvStatus } from "@/types/domain";
import {
  DRIVER_AV_LABEL, DRIVER_AV_STATUSES, DRIVER_AV_TONE, UNAVAILABLE_CATEGORIES, type DriverAvForm, type NotAvailableForm,
} from "@/utils/driverAvailability";
import { formatDate } from "@/utils/format";
import { PROJECT_TYPE_LABEL, applyProject, typeProjectRef, unlinkProject, type ProjectChoice, type ProjectForm } from "@/utils/vehicleAvailability";

const Row = ({ label, req, children }: { label: string; req?: boolean; children: ReactNode }) => (
  <div className="b-row">
    <label>{label}{req && <span className="req"> *</span>}</label>
    <div className="b-ctl">{children}</div>
  </div>
);

export const DriverAvBadge = ({ status }: { status?: string | null }) =>
  status && DRIVER_AV_STATUSES.includes(status as DriverAvStatus) ? (
    <span className={`badge badge-av-${DRIVER_AV_TONE[status as DriverAvStatus]}`}>{DRIVER_AV_LABEL[status as DriverAvStatus]}</span>
  ) : (
    <span className="badge badge-av-none">Not set</span>
  );

interface ProjectPage { items: ProjectChoice[]; total: number; page: number; limit: number }
const PAGE_SIZE = 6;

/**
 * Trackup / PIF autocomplete over APPROVED projects (the same read-only endpoints Vehicle Management uses; server-side search + paging).
 * Choosing a suggestion, or typing a full number and leaving the field, fills the matching partner number and the project details;
 * typing again clears everything that came from the previous project.
 */
function RefField({ field, label, project, onProject }: { field: "trackupNumber" | "pifNumber"; label: string; project: ProjectForm; onProject: (p: ProjectForm) => void }) {
  const linked = !!project.trackingProject;
  const text = project[field];
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
      onProject(applyProject(project, c));
      setErr("");
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  const pick = (c: ProjectChoice) => {
    onProject(applyProject(project, c));
    setErr("");
    setOpen(false);
  };

  return (
    <div className="proj-pick">
      <input
        value={text} readOnly={linked} placeholder={`Search approved projects by ${label}`} aria-label={label} aria-invalid={!!err} autoComplete="off"
        onFocus={() => !linked && setOpen(true)}
        onBlur={() => { setOpen(false); void resolve(); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void resolve(); } }}
        onChange={(e) => { setPage(1); setErr(""); setOpen(true); onProject(typeProjectRef(project, field, e.target.value)); }}
      />
      {err && <small className="proj-taken" role="alert">{err}</small>}
      {open && !linked && (
        <div className="proj-results" role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {res.loading ? (
            <p className="muted">Searching approved projects…</p>
          ) : res.error ? (
            <p className="muted">{res.error}</p>
          ) : !res.data || res.data.items.length === 0 ? (
            <p className="muted">No approved project matches.</p>
          ) : (
            <>
              {res.data.items.map((c) => (
                <button type="button" key={c.pifNumber} className="proj-item" role="option" aria-selected="false" onClick={() => pick(c)}>
                  <strong>{c.trackupNumber} <span className="muted">↔</span> {c.pifNumber}</strong>
                  <span>{c.projectName} · {PROJECT_TYPE_LABEL[c.projectType] ?? c.projectType}</span>
                  <small className="muted">{c.clientName}{c.startDate ? ` · ${formatDate(c.startDate)} – ${formatDate(c.endDate)}` : ""}</small>
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

/**
 * "Driver Availability & Status": exactly one of three statuses (radio buttons, green / blue / red) and only the matching fields.
 * The other sections stay in memory (switching never loses typing) but are neither shown nor saved.
 */
export default function DriverAvailability({ value: a, onChange }: { value: DriverAvForm; onChange: (next: DriverAvForm) => void }) {
  const set = <K extends keyof DriverAvForm>(k: K, v: DriverAvForm[K]) => onChange({ ...a, [k]: v });
  const na = (k: keyof NotAvailableForm, v: string) => onChange({ ...a, notAvailable: { ...a.notAvailable, [k]: v } });
  const linked = !!a.project.trackingProject;
  const setProject = (project: ProjectForm) => onChange({ ...a, project });

  return (
    <section className="av-section drv-av" aria-label="Driver Availability & Status">
      <h3 className="sub docs-title">Driver Availability &amp; Status</h3>
      <div className="drv-av-radios" role="radiogroup" aria-label="Driver Status">
        {DRIVER_AV_STATUSES.map((st) => (
          <label key={st} className={`drv-av-opt drv-av-${DRIVER_AV_TONE[st]}${a.status === st ? " on" : ""}`}>
            <input type="radio" name="driverAvailabilityStatus" value={st} checked={a.status === st} onChange={() => set("status", st)} />
            <span className="drv-av-dot" aria-hidden />
            {DRIVER_AV_LABEL[st]}
          </label>
        ))}
      </div>

      {a.status === "AVAILABLE" && (
        <div className="av-panel av-green" data-panel="available">
          <Row label="Available From Date">
            <DateInput value={a.availableFromDate} onChange={(e) => set("availableFromDate", e.target.value)} aria-label="Available From Date" />
          </Row>
          <Row label="Available From Time">
            <input type="time" value={a.availableFromTime} onChange={(e) => set("availableFromTime", e.target.value)} aria-label="Available From Time" />
          </Row>
        </div>
      )}

      {a.status === "IN_USE" && (
        <div className="av-panel av-blue" data-panel="in-use">
          <h4>Project Allocation Details</h4>
          <p className="av-note-strong">Select an approved project; its details are filled in automatically.</p>
          {linked && (
            <p className="av-linked">
              Linked to approved project <strong>{a.project.trackupNumber}</strong> ↔ <strong>{a.project.pifNumber}</strong>.{" "}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setProject({ ...unlinkProject(a.project) })}>Change project</button>
            </p>
          )}
          <div className="b-cols">
            <div className="b-col">
              <Row label="Trackup Number" req><RefField field="trackupNumber" label="Trackup Number" project={a.project} onProject={setProject} /></Row>
              <Row label="PIF Number"><RefField field="pifNumber" label="PIF Number" project={a.project} onProject={setProject} /></Row>
              <Row label="Project Type">
                <input value={PROJECT_TYPE_LABEL[a.project.projectType] ?? a.project.projectType} readOnly placeholder="Filled from the project" aria-label="Project Type" />
              </Row>
              <Row label="Project Name">
                <input value={a.project.projectName} readOnly placeholder="Filled from the project" aria-label="Project Name" />
              </Row>
              <Row label="Client / Billing Name">
                <input value={a.project.clientName} readOnly placeholder="Filled from the project" aria-label="Client / Billing Name" />
              </Row>
            </div>
            <div className="b-col">
              <Row label="Project From Date" req>
                <DateInput value={a.project.startDate} onChange={(e) => setProject({ ...a.project, startDate: e.target.value })} aria-label="Project From Date" />
              </Row>
              <Row label="Project To Date" req>
                <DateInput value={a.project.endDate} min={a.project.startDate || undefined} onChange={(e) => setProject({ ...a.project, endDate: e.target.value })} aria-label="Project To Date" />
              </Row>
              <Row label="Additional Remarks">
                <textarea rows={3} value={a.project.remarks} maxLength={300} aria-label="Additional Remarks" onChange={(e) => setProject({ ...a.project, remarks: e.target.value })} />
              </Row>
            </div>
          </div>
          <p className="muted av-note">Once the Project To Date has passed (IST) the driver is marked Available Now automatically.</p>
        </div>
      )}

      {a.status === "NOT_AVAILABLE" && (
        <div className="av-panel av-red" data-panel="not-available">
          <h4>Unavailability Details</h4>
          <div className="b-cols">
            <div className="b-col">
              <Row label="Reason Category" req>
                <Select value={a.notAvailable.category} onChange={(e) => na("category", e.target.value)} aria-label="Reason Category">
                  <option value="">Select category</option>
                  {UNAVAILABLE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Row>
              <Row label={a.notAvailable.category === "Other" ? "Custom Reason" : "Unavailable Reason"} req>
                <textarea rows={3} value={a.notAvailable.reason} maxLength={300} aria-label="Unavailable Reason" onChange={(e) => na("reason", e.target.value)}
                  placeholder={a.notAvailable.category === "Other" ? "Describe the reason" : "Why is the driver not available?"} />
              </Row>
            </div>
            <div className="b-col">
              <Row label="Unavailable From Date">
                <DateInput value={a.notAvailable.fromDate} onChange={(e) => na("fromDate", e.target.value)} aria-label="Unavailable From Date" />
              </Row>
              <Row label="Expected Available Date">
                <DateInput value={a.notAvailable.expectedAvailableDate} min={a.notAvailable.fromDate || undefined} onChange={(e) => na("expectedAvailableDate", e.target.value)} aria-label="Expected Available Date" />
              </Row>
              <Row label="Additional Remarks">
                <textarea rows={2} value={a.notAvailable.remarks} maxLength={300} aria-label="Additional Remarks" onChange={(e) => na("remarks", e.target.value)} />
              </Row>
            </div>
          </div>
          <p className="muted av-note">The driver stays Not Available until you mark them Available Now; the expected date is only a reminder.</p>
        </div>
      )}
    </section>
  );
}
