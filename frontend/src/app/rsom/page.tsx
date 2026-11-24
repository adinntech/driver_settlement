"use client";

import TableWrap from "@/components/ui/TableWrap";
import Select from "@/components/ui/Select";
import DateInput from "@/components/ui/DateInput";
import Link from "next/link";
import { useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import { ApprovalBadge } from "@/components/ApprovalTimeline";
import CopyButton from "@/components/ui/CopyButton";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Ui";
import { useApi } from "@/hooks/useApi";
import StatCard from "@/components/ui/StatCard";
import { statusOf } from "@/utils/budgetDescribe";
import { formatDate, formatDateTime, formatInr } from "@/utils/format";

interface Row {
  budgetId: string;
  status: string;
  trackupNumber: string;
  pifNumber: string;
  projectType: "ROADSHOW" | "SIGNAGE";
  client: string;
  vehicleIndex: number;
  campaignFrom: string;
  campaignTo: string;
  version: number;
  total: number;
  submittedBy: string;
  submittedAt: string;
}
interface Page {
  items: Row[];
  total: number;
  page: number;
  limit: number;
}
interface Stats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
}

export default function RsomPage() {
  return (
    <AppShell role="RSOM">
      <Dashboard />
    </AppShell>
  );
}

const LIMIT = 10;

function Dashboard() {
  const [f, setF] = useState({ projectType: "", client: "", trackup: "", pif: "", status: "", from: "" });
  const [page, setPage] = useState(1);
  const set = (k: keyof typeof f, v: string) => {
    setF((s) => ({ ...s, [k]: v }));
    setPage(1);
  };

  const qs = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    for (const [k, v] of Object.entries(f)) if (v.trim()) p.set(k, v.trim());
    return p.toString();
  }, [f, page]);

  const stats = useApi<Stats>("/approvals/stats");
  const list = useApi<Page>(`/approvals?${qs}`);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / LIMIT)) : 1;
  const filtered = Object.values(f).some(Boolean);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Budget Approvals</h1>
          <p className="muted">Review and approve or reject budgets created by RBP.</p>
        </div>
      </div>

      <div className="stat-row">
        {stats.loading || !stats.data ? (
          Array.from({ length: 4 }, (_, i) => <div key={i} className="stat skeleton" style={{ height: 84 }} />)
        ) : (
          <>
            <StatCard label="Total Budgets Received" value={stats.data.total} active={!f.status} onClick={() => set("status", "")} title="Show all budgets" />
            {([["PENDING", "Pending Approval", stats.data.pending, stats.data.pending ? "accent" : undefined], ["APPROVED", "Approved Budgets", stats.data.approved, "stat-ok"], ["REJECTED", "Rejected Budgets", stats.data.rejected, "stat-bad"]] as const).map(([k, label, n, tone]) => (
              <StatCard key={k} label={label} value={n} tone={tone} active={f.status === k} onClick={() => set("status", f.status === k ? "" : k)} />
            ))}
          </>
        )}
      </div>

      <div className="card">
        <div className="filters filters-rsom">
          <input placeholder="Client / Billing name" value={f.client} onChange={(e) => set("client", e.target.value)} aria-label="Client name" />
          <input placeholder="Trackup number" value={f.trackup} onChange={(e) => set("trackup", e.target.value)} aria-label="Trackup number" />
          <input placeholder="PIF number" value={f.pif} onChange={(e) => set("pif", e.target.value)} aria-label="PIF number" />
          <Select value={f.projectType} onChange={(e) => set("projectType", e.target.value)} aria-label="Project type">
            <option value="">All types</option>
            <option value="ROADSHOW">Roadshow</option>
            <option value="SIGNAGE">Signage</option>
          </Select>
          <Select value={f.status} onChange={(e) => set("status", e.target.value)} aria-label="Approval status">
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </Select>
          <DateInput value={f.from} onChange={(e) => set("from", e.target.value)} aria-label="Submitted from" title="Submitted on or after" />
          {filtered && (
            <button className="btn btn-ghost" onClick={() => { setF({ projectType: "", client: "", trackup: "", pif: "", status: "", from: "" }); setPage(1); }}>
              Clear
            </button>
          )}
        </div>

        {list.loading ? (
          <Skeleton rows={6} />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : !list.data || list.data.items.length === 0 ? (
          <EmptyState title="No budgets to show" hint="Budgets submitted by RBP will appear here." />
        ) : (
          <>
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th>Trackup Number</th><th>PIF</th><th>Type</th><th>Client / Billing</th><th>Vehicle</th>
                    <th>Campaign Period</th><th>Version</th><th>Total Budget</th><th>Submitted By</th><th>Submitted (IST)</th><th>Status</th><th />
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((r) => (
                    <tr key={r.budgetId} className={r.status === "PENDING" ? "row-pending" : ""}>
                      <td><span className="num">{r.trackupNumber}<CopyButton value={r.trackupNumber} label="Trackup Number" /></span></td>
                      <td><span className="num">{r.pifNumber}<CopyButton value={r.pifNumber} label="PIF Number" /></span></td>
                      <td><span className={`type type-${r.projectType.toLowerCase()}`}>{r.projectType === "ROADSHOW" ? "Roadshow" : "Signage"}</span></td>
                      <td>{r.client}</td>
                      <td>{r.vehicleIndex}</td>
                      <td>{formatDate(r.campaignFrom)} → {formatDate(r.campaignTo)}</td>
                      <td>V{r.version}</td>
                      <td><strong>{formatInr(r.total)}</strong></td>
                      <td>{r.submittedBy}</td>
                      <td>{formatDateTime(r.submittedAt)}</td>
                      <td><ApprovalBadge status={statusOf(r.status)} /></td>
                      <td>
                        <Link href={`/rsom/review?budget=${r.budgetId}`} className="btn btn-outline btn-sm">
                          {r.status === "PENDING" ? "Review Budget" : "View"}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <div className="pager">
              <span className="muted">{list.data.total} budget(s) · page {page} of {pages}</span>
              <div className="inline">
                <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
