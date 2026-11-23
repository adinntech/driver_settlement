"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import CopyButton from "@/components/ui/CopyButton";
import { EmptyState, ErrorState, Modal, Skeleton, StatusBadge } from "@/components/ui/Ui";
import { useApi } from "@/hooks/useApi";
import type { Project, Stats, Vehicle } from "@/types/domain";
import { formatDate, formatDateTime, labelize } from "@/utils/format";

export default function RsopDashboard() {
  return (
    <AppShell role="RSOP">
      <Dashboard />
    </AppShell>
  );
}

function Dashboard() {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [detail, setDetail] = useState<Project | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (type) p.set("projectType", type);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    return p.toString();
  }, [q, type, from, to]);

  const stats = useApi<Stats>("/tracking/stats");
  const list = useApi<Project[]>(`/tracking${qs ? `?${qs}` : ""}`);

  const rows = (list.data ?? []).flatMap((p) => p.vehicles.map((v) => ({ p, v })));

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
            <Stat label="Total Requests" value={stats.data.total} />
            <Stat label="Roadshow" value={stats.data.roadshow} />
            <Stat label="Signage" value={stats.data.signage} />
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
            placeholder="Search Trackup / PIF / Display / Client"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search"
          />
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Project type">
            <option value="">All types</option>
            <option value="ROADSHOW">Roadshow</option>
            <option value="SIGNAGE">Signage</option>
          </select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Created from" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Created to" />
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
        ) : rows.length === 0 ? (
          <EmptyState title="No tracking requests found" hint="Create your first request or adjust the filters." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Trackup Number</th>
                  <th>Type</th>
                  <th>Client / Billing</th>
                  <th>Vehicle</th>
                  <th>PIF</th>
                  <th>Display</th>
                  <th>Created (IST)</th>
                  <th>Created By</th>
                  <th>Budget</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, v }) => (
                  <Row key={v._id} p={p} v={v} onView={() => setDetail(p)} />
                ))}
              </tbody>
            </table>
          </div>
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

function Row({ p, v, onView }: { p: Project; v: Vehicle; onView: () => void }) {
  return (
    <tr>
      <td>
        <span className="num">
          {v.trackupNumber}
          <CopyButton value={v.trackupNumber} label="Trackup Number" />
        </span>
      </td>
      <td>
        <span className={`type type-${p.projectType.toLowerCase()}`}>{p.projectType === "ROADSHOW" ? "Roadshow" : "Signage"}</span>
      </td>
      <td>{p.clientName}</td>
      <td>
        {v.vehicleIndex} / {p.vehicleCount}
      </td>
      <td>
        <span className="num">
          {v.pifNumber}
          <CopyButton value={v.pifNumber} label="PIF Number" />
        </span>
      </td>
      <td>
        <span className="num">
          {v.displayNumber}
          <CopyButton value={v.displayNumber} label="Display Number" />
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
    Array.isArray(v) ? v.join(", ") : dateKey.test(k) && typeof v === "string" ? formatDate(v) : String(v);
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
            <th>Trackup</th>
            <th>PIF</th>
            <th>Display</th>
          </tr>
        </thead>
        <tbody>
          {project.vehicles.map((v) => (
            <tr key={v._id}>
              <td>{v.vehicleIndex}</td>
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
              <td>
                <span className="num">
                  {v.displayNumber}
                  <CopyButton value={v.displayNumber} label="Display Number" />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
