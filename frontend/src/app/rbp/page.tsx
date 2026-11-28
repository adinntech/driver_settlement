"use client";

import VerticalSelect from "@/components/ui/VerticalSelect";
import Select from "@/components/ui/Select";
import { matchesStatus, overallStatus, STATUS_FILTERS } from "@/utils/projectStatus";
import Link from "next/link";
import { useState } from "react";
import AppShell from "@/components/AppShell";
import CopyButton from "@/components/ui/CopyButton";
import { EmptyState, ErrorState, Skeleton, StatusBadge } from "@/components/ui/Ui";
import { ApprovalBadge } from "@/components/ApprovalTimeline";
import { statusOf } from "@/utils/budgetDescribe";
import { useApi } from "@/hooks/useApi";
import { useDebounce } from "@/hooks/useDebounce";
import { vehicleCardDetails, vehicleTypesText } from "@/utils/vehicleTypes";
import type { Project } from "@/types/domain";
import { formatDate, formatDateTime, labelize } from "@/utils/format";

export default function RbpPage() {
  return (
    <AppShell role="RBP">
      <Projects />
    </AppShell>
  );
}

function Projects() {
  const [q, setQ] = useState("");
  const [vertical, setVertical] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const dq = useDebounce(q); // one request after typing pauses, not one per keystroke
  const list = useApi<Project[]>(`/tracking?${new URLSearchParams({ ...(dq.trim() ? { q: dq.trim() } : {}), ...(vertical ? { projectType: vertical } : {}) })}`);

  const shown = (list.data ?? []).filter((p) => matchesStatus(p, status));

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
          <VerticalSelect value={vertical} onChange={setVertical} />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            {STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
          <input placeholder="Search client, Trackup or PIF number" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {list.loading ? (
          <Skeleton rows={5} />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : shown.length === 0 ? (
          list.data?.length ? <EmptyState title="No projects with this status" hint="Choose All to see every project." /> : <EmptyState title="No tracking requests yet" hint="Requests created by RSOP will appear here." />
        ) : (
          <div className="project-list">
            {shown.map((p) => (
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
        ["Project Code", p.projectCode ?? "—"],
        ["Billing Name", p.clientName],
        ["Total Vans", String(p.vehicleCount)],
        ["Trackup Numbers", String(new Set(p.vehicles.map((v) => v.trackupNumber)).size)],
        ["Start", formatDate(d.startDate as string)],
        ["End", formatDate(d.endDate as string)],
        ["Reporting Date", formatDate(d.reportingDate as string)],
      ]
    : [
        ["Project Code", p.projectCode ?? "—"],
        ["Client", p.clientName],
        ["Job Sheet", String(d.jobSheetNumber ?? "—")],
        ["Vehicles", String(p.vehicleCount)],
        ["Trackup Numbers", String(new Set(p.vehicles.map((v) => v.trackupNumber)).size)],
        ["Total Days", String(d.totalDaysOfWork ?? "—")],
        ["From", formatDate(d.fromDate as string)],
        ["To", formatDate(d.toDate as string)],
      ];
  const requested = vehicleTypesText(d.vehicleTypes);
  if (requested) master.push(["Vehicle Types", requested]);
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
                  Vehicle {v.vehicleIndex} of {p.vehicleCount}{v.vehicleType ? ` · ${v.vehicleType}` : ""}
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
                ].map(([l, val]) => (
                  <span key={l} className="num">
                    <small>{l}</small> {val}
                    <CopyButton value={val} label={`${l} Number`} />
                  </span>
                ))}
                <span className="muted">Created {formatDateTime(v.createdAt)}</span>
              </div>
              <dl className="kv compact">
                {vehicleCardDetails(d, v.vehicleType)
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
