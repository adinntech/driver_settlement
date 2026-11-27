"use client";

import TableWrap from "@/components/ui/TableWrap";
import Select from "@/components/ui/Select";
import DateInput from "@/components/ui/DateInput";
import Link from "next/link";
import { useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import CopyButton from "@/components/ui/CopyButton";
import { EmptyState, ErrorState, Modal, Skeleton, StatusBadge } from "@/components/ui/Ui";
import { useApi } from "@/hooks/useApi";
import StatCard from "@/components/ui/StatCard";
import { useDebounce } from "@/hooks/useDebounce";
import type { Project, Stats, Vehicle } from "@/types/domain";
import { formatDate, formatDateTime, labelize } from "@/utils/format";
import { sumVehicleTypes, vehicleTypesText } from "@/utils/vehicleTypes";
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

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Create and track Roadshow / Signage requests.</p>
        </div>
        <Link href="/rsop/new" className="btn btn-primary">
          + New Tracking Request
        </Link>
      </div>

      <div className="stat-row">
        {stats.loading || !stats.data ? (
          Array.from({ length: 5 }, (_, i) => <div key={i} className="stat skeleton" style={{ height: 84 }} />)
        ) : (
          <>
            <StatCard label="Total Requests" value={stats.data.total} active={!type} onClick={() => setType("")} title="Show all requests" />
            <StatCard label="Roadshow" value={stats.data.roadshow} active={type === "ROADSHOW"} onClick={() => setType(type === "ROADSHOW" ? "" : "ROADSHOW")} />
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
          <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Project type">
            <option value="">All types</option>
            <option value="ROADSHOW">Roadshow</option>
            <option value="SIGNAGE">Signage</option>
          </Select>
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
                  <th>Type</th>
                  <th>Client / Billing</th>
                  <th>Campaign</th>
                  <th>Vehicles</th>
                  <th>Last Created (IST)</th>
                  <th>Budget</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <GroupRows key={g.key} g={g} open={isOpen(g.key)} onToggle={() => toggle(g.key)} onView={setDetail} />
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
function GroupRows({ g, open, onToggle, onView }: { g: ProjectGroup; open: boolean; onToggle: () => void; onView: (p: Project) => void }) {
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
        <td><span className={`type type-${g.projectType.toLowerCase()}`}>{g.projectType === "ROADSHOW" ? "Roadshow" : "Signage"}</span></td>
        <td>{g.clientName}</td>
        <td className="ds-nowrap">{formatDate(g.startDate)}<br /><small className="muted">to {formatDate(g.endDate)}</small></td>
        <td><strong>{g.vehicleCount}</strong><br /><small className="muted">{vehicleTypesText(sumVehicleTypes(g.requests.map((r) => r.details.vehicleTypes)))}</small>{g.requests.length > 1 && <><br /><small className="muted">{g.requests.length} requests</small></>}</td>
        <td>{formatDateTime(g.lastCreatedAt)}</td>
        <td><small className="muted">{g.budgetsCreated} / {g.vehicleCount} created</small></td>
      </tr>
      {open && (
        <tr className="pc-sub" id={bodyId}>
          <td colSpan={8}>
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
