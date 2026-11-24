"use client";

import Link from "next/link";
import { useState } from "react";
import AppShell from "@/components/AppShell";
import CopyButton from "@/components/ui/CopyButton";
import { EmptyState, ErrorState, Skeleton, StatusBadge } from "@/components/ui/Ui";
import { ApprovalBadge } from "@/components/ApprovalTimeline";
import { statusOf } from "@/utils/budgetDescribe";
import { useApi } from "@/hooks/useApi";
import { useDebounce } from "@/hooks/useDebounce";
import type { Project } from "@/types/domain";
import { formatDate, formatDateTime, labelize } from "@/utils/format";

export default function RbpPage() {
  return (
    <AppShell role="RBP">
      <Projects />
    </AppShell>
  );
}

export function overallStatus(p: Project): "PENDING" | "CREATED" | "PARTIAL" {
  const done = p.vehicles.filter((v) => v.budgetStatus === "CREATED").length;
  return done === 0 ? "PENDING" : done === p.vehicles.length ? "CREATED" : "PARTIAL";
}

function Projects() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const dq = useDebounce(q); // one request after typing pauses, not one per keystroke
  const list = useApi<Project[]>(`/tracking${dq.trim() ? `?q=${encodeURIComponent(dq.trim())}` : ""}`);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Projects &amp; Budgets</h1>
          <p className="muted">Review RSOP requests and prepare vehicle-wise budgets.</p>
        </div>
      </div>
      <div className="card">
        <div className="filters">
          <input placeholder="Search client, Trackup, PIF or Display number" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {list.loading ? (
          <Skeleton rows={5} />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : !list.data || list.data.length === 0 ? (
          <EmptyState title="No tracking requests yet" hint="Requests created by RSOP will appear here." />
        ) : (
          <div className="project-list">
            {list.data.map((p) => (
              <ProjectBlock key={p._id} p={p} open={open === p._id} onToggle={() => setOpen(open === p._id ? null : p._id)} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function ProjectBlock({ p, open, onToggle }: { p: Project; open: boolean; onToggle: () => void }) {
  const d = p.details;
  const roadshow = p.projectType === "ROADSHOW";
  const master: [string, string][] = roadshow
    ? [
        ["Billing Name", p.clientName],
        ["Total Vans", String(p.vehicleCount)],
        ["Trackup Numbers", String(p.vehicles.length)],
        ["Start", formatDate(d.startDate as string)],
        ["End", formatDate(d.endDate as string)],
        ["Reporting Date", formatDate(d.reportingDate as string)],
      ]
    : [
        ["Client", p.clientName],
        ["Job Sheet", String(d.jobSheetNumber ?? "—")],
        ["Vehicles", String(p.vehicleCount)],
        ["Total Days", String(d.totalDaysOfWork ?? "—")],
        ["From", formatDate(d.fromDate as string)],
        ["To", formatDate(d.toDate as string)],
      ];
  return (
    <div className={`project${open ? " open" : ""}`}>
      <button className="project-head" onClick={onToggle} aria-expanded={open}>
        <span className={`type type-${p.projectType.toLowerCase()}`}>{roadshow ? "Roadshow" : "Signage"}</span>
        <div className="master">
          {master.map(([k, v]) => (
            <div key={k}>
              <small>{k}</small>
              <strong>{v}</strong>
            </div>
          ))}
        </div>
        <StatusBadge status={overallStatus(p)} />
        <span className="chev">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="project-body fade-in">
          {p.vehicles.map((v) => (
            <div key={v._id} className="vehicle">
              <div className="vehicle-top">
                <strong>
                  Vehicle {v.vehicleIndex} of {p.vehicleCount}
                </strong>
                <span className="inline">
                  <StatusBadge status={v.budgetStatus} />
                  {v.approvalStatus && <ApprovalBadge status={statusOf(v.approvalStatus)} />}
                </span>
              </div>
              <div className="nums">
                {[
                  ["Trackup", v.trackupNumber],
                  ["PIF", v.pifNumber],
                  ["Display", v.displayNumber],
                ].map(([l, val]) => (
                  <span key={l} className="num">
                    <small>{l}</small> {val}
                    <CopyButton value={val} label={`${l} Number`} />
                  </span>
                ))}
                <span className="muted">Created {formatDateTime(v.createdAt)}</span>
              </div>
              <dl className="kv compact">
                {Object.entries(d)
                  .filter(([, val]) => val !== undefined && val !== "")
                  .map(([k, val]) => (
                    <div key={k}>
                      <dt>{labelize(k)}</dt>
                      <dd>
                        {Array.isArray(val)
                          ? val.join(", ")
                          : /date$/i.test(k) && typeof val === "string"
                            ? formatDate(val)
                            : String(val)}
                      </dd>
                    </div>
                  ))}
              </dl>
              <div className="actions-row">
                <Link href={`/rbp/budget?vehicle=${v._id}`} className="btn btn-primary">
                  {v.budgetStatus === "CREATED" ? "View Budget" : "Create Budget"}
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
