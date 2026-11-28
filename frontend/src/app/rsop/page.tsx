"use client";

import { useErrorState } from "@/context/ToastContext";
import { roadshowOn } from "@/utils/features";
import VerticalSelect from "@/components/ui/VerticalSelect";
import TableWrap from "@/components/ui/TableWrap";
import DateInput from "@/components/ui/DateInput";
import Link from "next/link";
import { useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import CopyButton from "@/components/ui/CopyButton";
import { EmptyState, ErrorState, Modal, Skeleton, StatusBadge } from "@/components/ui/Ui";
import { useApi } from "@/hooks/useApi";
import StatCard from "@/components/ui/StatCard";
import { useDebounce } from "@/hooks/useDebounce";
import { request } from "@/services/api";
import type { Project, Stats, Vehicle } from "@/types/domain";
import { formatDate, formatDateTime, labelize } from "@/utils/format";
import { vehicleTypesText } from "@/utils/vehicleTypes";
import { groupByProjectCode, type ProjectGroup } from "@/utils/projectCode";

export default function RsopDashboard() {
  return (
    <AppShell role="RSOP">
      <Dashboard />
    </AppShell>
  );
}

function Dashboard() {
  const [q, setQ] = useState("");
  const dq = useDebounce(q); // one request after typing pauses, not one per keystroke
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [detail, setDetail] = useState<Project | null>(null);
  const [doomed, setDoomed] = useState<ProjectGroup | null>(null); // project awaiting delete confirmation
  const [deleting, setDeleting] = useState(false);
  const [, setDeleteError] = useErrorState<string>("");

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (dq.trim()) p.set("q", dq.trim());
    if (type) p.set("projectType", type);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    return p.toString();
  }, [dq, type, from, to]);

  const stats = useApi<Stats>("/tracking/stats");
  const list = useApi<Project[]>(`/tracking${qs ? `?${qs}` : ""}`);

  // One row per Project Code (Roadshow and Signage separately); each expands to its vehicles. While searching, groups open by default.
  const groups = useMemo(() => groupByProjectCode(list.data ?? []), [list.data]);
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const searching = !!dq.trim();
  const isOpen = (key: string) => toggled.has(key) !== searching;
  const toggle = (key: string) => setToggled((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const askDelete = (g: ProjectGroup) => {
    setDeleteError("");
    setDoomed(g);
  };
  async function confirmDelete() {
    if (!doomed || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await request(`/tracking/${doomed.requests[0]._id}`, "DELETE");
      setDoomed(null);
      list.reload();
      stats.reload();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Could not delete the project");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Create and track {roadshowOn() ? "Roadshow / Signage" : "Signage"} requests.</p>
        </div>
        <Link href="/rsop/new" className="btn btn-primary">
          + New Tracking Request
        </Link>
      </div>

      <div className="stat-row">
        {stats.loading || !stats.data ? (
          Array.from({ length: roadshowOn() ? 5 : 4 }, (_, i) => <div key={i} className="stat skeleton" style={{ height: 84 }} />)
        ) : (
          <>
            <StatCard label="Total Requests" value={stats.data.total} active={!type} onClick={() => setType("")} title="Show all requests" />
            {roadshowOn() && <StatCard label="Roadshow" value={stats.data.roadshow} active={type === "ROADSHOW"} onClick={() => setType(type === "ROADSHOW" ? "" : "ROADSHOW")} />}
            <StatCard label="Signage" value={stats.data.signage} active={type === "SIGNAGE"} onClick={() => setType(type === "SIGNAGE" ? "" : "SIGNAGE")} />
            <Stat label="Pending Budget" value={stats.data.pendingBudget} accent />
            <Stat label="Budget Created" value={stats.data.budgetCreated} />
          </>
        )}
      </div>

      {stats.data && stats.data.recent.length > 0 && (
        <div className="card recent">
          <strong>Recently created</strong>
          <div className="chips">
            {stats.data.recent.map((r) => (
              <span key={r._id} className="chip">
                {r.trackupNumber}
                <CopyButton value={r.trackupNumber} label="Trackup Number" />
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="filters">
          <input
            placeholder="Search Project Code / Trackup / PIF / Client"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search"
          />
          {roadshowOn() && <VerticalSelect value={type} onChange={(v) => setType(v)} />}
          <DateInput value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Created from" />
          <DateInput value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="Created to" />
          {(q || type || from || to) && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                setQ("");
                setType("");
                setFrom("");
                setTo("");
              }}
            >
              Clear
            </button>
          )}
        </div>

        {list.loading ? (
          <Skeleton rows={6} />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : groups.length === 0 ? (
          <EmptyState title="No tracking requests found" hint="Create your first request or adjust the filters." />
        ) : (
          <TableWrap>
            <table className="table pc-table">
              <thead>
                <tr>
                  <th><span className="sr-only">Expand</span></th>
                  <th>Project Code</th>
                  {roadshowOn() && <th>Vertical</th>}
                  <th>Client / Billing</th>
                  <th>Campaign</th>
                  <th>Vehicles</th>
                  <th>Last Created (IST)</th>
                  <th>Budget</th>
                  <th><span className="sr-only">Delete</span></th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <GroupRows key={g.key} g={g} open={isOpen(g.key)} onToggle={() => toggle(g.key)} onView={setDetail} onDelete={askDelete} />
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </div>

      {detail && (
        <Modal title={`${detail.clientName} — full details`} wide onClose={() => setDetail(null)}>
          <DetailsView project={detail} />
        </Modal>
      )}

      {doomed && (
        <Modal title="Delete project?" onClose={() => !deleting && setDoomed(null)}>
          <dl className="kv">
            <div>
              <dt>Project Code</dt>
              <dd>{doomed.projectCode ?? "No project code"}</dd>
            </div>
            <div>
              <dt>Client</dt>
              <dd>{doomed.clientName}</dd>
            </div>
          </dl>
          <div className="alert">
            This deletes the whole project ({doomed.projectType === "ROADSHOW" ? "Roadshow" : "Signage"}, every request under this code) for all users and notifies everyone. It cannot be undone from the application.
          </div>
          <div className="actions-row">
            <button type="button" className="btn btn-outline" onClick={() => setDoomed(null)} disabled={deleting}>
              Cancel
            </button>
            <button type="button" className="btn btn-danger" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete project"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

const Stat = ({ label, value, accent }: { label: string; value: number; accent?: boolean }) => (
  <div className={`stat${accent ? " accent" : ""}`}>
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

/** Collapsed project row (one per Project Code and type) + its vehicles when expanded. */
function GroupRows({ g, open, onToggle, onView, onDelete }: { g: ProjectGroup; open: boolean; onToggle: () => void; onView: (p: Project) => void; onDelete: (g: ProjectGroup) => void }) {
  const bodyId = `pc-${g.key.replace(/[^A-Za-z0-9]/g, "-")}`;
  const label = g.projectCode ?? "No project code";
  return (
    <>
      <tr className={`pc-row${open ? " is-open" : ""}`} onClick={onToggle}>
        <td>
          <button type="button" className="icon-btn pc-toggle" aria-expanded={open} aria-controls={bodyId} aria-label={`${open ? "Collapse" : "Expand"} project ${label}`} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
            {open ? "▾" : "▸"}
          </button>
        </td>
        <td>{g.projectCode ? <span className="num"><strong>{g.projectCode}</strong><CopyButton value={g.projectCode} label="Project Code" /></span> : <span className="muted" title="Created before Project Codes were introduced">—</span>}</td>
        {roadshowOn() && <td><span className={`type type-${g.projectType.toLowerCase()}`}>{g.projectType === "ROADSHOW" ? "Roadshow" : "Signage"}</span></td>}
        <td>{g.clientName}</td>
        <td className="ds-nowrap">{formatDate(g.startDate)}<br /><small className="muted">to {formatDate(g.endDate)}</small></td>
        <td><strong>{g.vehicleCount}</strong>{g.requests.length > 1 && <><br /><small className="muted">{g.requests.length} requests</small></>}</td>
        <td>{formatDateTime(g.lastCreatedAt)}</td>
        <td><small className="muted">{g.budgetsCreated} / {g.vehicleCount} created</small></td>
        <td>
          <button type="button" className="icon-btn rm" title="Delete project" aria-label={`Delete project ${label}`} onClick={(e) => { e.stopPropagation(); onDelete(g); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5" />
            </svg>
          </button>
        </td>
      </tr>
      {open && (
        <tr className="pc-sub" id={bodyId}>
          <td colSpan={roadshowOn() ? 9 : 8}>
            <table className="table">
              <thead>
                <tr>
                  <th>Trackup Number</th>
                  <th>Vehicle</th>
                  <th>Vehicle Type</th>
                  <th>PIF</th>
                  <th>Created (IST)</th>
                  <th>Created By</th>
                  <th>Budget</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {g.rows.map(({ p, v, position }) => (
                  <Row key={v._id} p={p} v={v} position={position} total={g.vehicleCount} onView={() => onView(p)} />
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

function Row({ p, v, position, total, onView }: { p: Project; v: Vehicle; position: number; total: number; onView: () => void }) {
  return (
    <tr>
      <td>
        <span className="num">
          {v.trackupNumber}
          <CopyButton value={v.trackupNumber} label="Trackup Number" />
        </span>
      </td>
      <td title={`Vehicle ${v.vehicleIndex} of ${p.vehicleCount} in its request`}>
        {position} / {total}
      </td>
      <td>{v.vehicleType ?? "—"}</td>
      <td>
        <span className="num">
          {v.pifNumber}
          <CopyButton value={v.pifNumber} label="PIF Number" />
        </span>
      </td>
      <td>{formatDateTime(v.createdAt)}</td>
      <td>{p.createdByName}</td>
      <td>
        <StatusBadge status={v.budgetStatus} />
      </td>
      <td>
        <button className="btn btn-outline btn-sm" onClick={onView}>
          View
        </button>
      </td>
    </tr>
  );
}

export function DetailsView({ project }: { project: Project }) {
  const dateKey = /date$/i;
  const fmt = (k: string, v: unknown) =>
    k === "vehicleTypes" ? vehicleTypesText(v) : Array.isArray(v) ? v.join(", ") : dateKey.test(k) && typeof v === "string" ? formatDate(v) : String(v);
  const entries = Object.entries(project.details).filter(([, v]) => v !== undefined && v !== "");
  return (
    <>
      <dl className="kv">
        <div>
          <dt>Project type</dt>
          <dd>{project.projectType}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>
            {formatDateTime(project.createdAt)} by {project.createdByName}
          </dd>
        </div>
        {entries.map(([k, v]) => (
          <div key={k}>
            <dt>{labelize(k)}</dt>
            <dd>{fmt(k, v)}</dd>
          </div>
        ))}
      </dl>
      <h4 className="sub">Generated numbers</h4>
      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Vehicle Type</th>
            <th>Trackup</th>
            <th>PIF</th>
          </tr>
        </thead>
        <tbody>
          {project.vehicles.map((v) => (
            <tr key={v._id}>
              <td>{v.vehicleIndex}</td>
              <td>{v.vehicleType ?? "—"}</td>
              <td>
                <span className="num">
                  {v.trackupNumber}
                  <CopyButton value={v.trackupNumber} label="Trackup Number" />
                </span>
              </td>
              <td>
                <span className="num">
                  {v.pifNumber}
                  <CopyButton value={v.pifNumber} label="PIF Number" />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
