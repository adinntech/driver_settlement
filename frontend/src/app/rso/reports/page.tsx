"use client";

import TableWrap from "@/components/ui/TableWrap";
import DateInput from "@/components/ui/DateInput";
import { useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Ui";
import { useToast } from "@/context/ToastContext";
import { useApi } from "@/hooks/useApi";
import { useDebounce } from "@/hooks/useDebounce";
import { downloadFile } from "@/services/api";
import { formatDate, formatDateTime, formatInr } from "@/utils/format";

type Kind = "approved-payments" | "vehicle-mis" | "driver-list" | "driver-salary";
type Row = Record<string, string | number | null>;
interface Col { key: string; label: string; type?: "money" | "date" | "datetime" | "num" }

const REPORTS: { kind: Kind; label: string; hint: string; dates: boolean; cols: Col[] }[] = [
  {
    kind: "approved-payments", label: "Approved Payment Report", hint: "Approved and paid daily and final payments.", dates: true,
    cols: [
      { key: "paymentNumber", label: "Payment No" }, { key: "category", label: "Category" }, { key: "status", label: "Status" }, { key: "clientName", label: "Client" }, { key: "vehicleNo", label: "Vehicle" },
      { key: "driverName", label: "Driver" }, { key: "fromDate", label: "From", type: "date" }, { key: "toDate", label: "To", type: "date" }, { key: "amount", label: "Amount", type: "money" },
      { key: "approvedBy", label: "Approved By" }, { key: "approvedAt", label: "Approved On", type: "datetime" }, { key: "referenceNumber", label: "Ref. No." },
      { key: "referenceDate", label: "Ref. Date", type: "date" }, { key: "paymentMode", label: "Mode" }, { key: "paymentDate", label: "Pay. Date", type: "date" },
    ],
  },
  {
    kind: "vehicle-mis", label: "Vehicle MIS Report", hint: "Vehicle master register (all non-draft vehicles), in the Vehicle MIS format. Document columns show the latest renewal date.", dates: false,
    cols: [
      { key: "vehicleNo", label: "Vehicle No" }, { key: "make", label: "Make" }, { key: "model", label: "Model" }, { key: "yom", label: "Y.O.M", type: "num" },
      { key: "purchaseDate", label: "Purchase Date", type: "date" }, { key: "type", label: "Vehicle Type" }, { key: "stepneyStatus", label: "Stepney Status" },
      { key: "batteryStatus", label: "Battery Status" }, { key: "oilTopUpOn", label: "Oil Top Up On", type: "date" }, { key: "greasePackingOn", label: "Grease Packing On", type: "date" },
      { key: "generalCheckUpOn", label: "General Check Up On", type: "date" }, { key: "currentRunning", label: "Current Running", type: "num" }, { key: "totalRunning", label: "Total Running", type: "num" },
      { key: "fc", label: "Fc", type: "date" }, { key: "insurance", label: "Insurance", type: "date" }, { key: "statePermit", label: "State Permit", type: "date" },
      { key: "rtoPermission", label: "Rto Permission", type: "date" }, { key: "policePermission", label: "Police Permission", type: "date" }, { key: "condition", label: "Condition" },
      { key: "specification", label: "Specification" },
    ],  },
  {
    kind: "driver-list", label: "Driver List Report", hint: "All drivers with salary, bank (masked) and settlement totals.", dates: false,
    cols: [
      { key: "driverNumber", label: "Driver Code" }, { key: "driverName", label: "Name" }, { key: "driverType", label: "Type" }, { key: "mobileNumber", label: "Mobile" }, { key: "status", label: "Status" },
      { key: "availability", label: "Availability" }, { key: "perDaySalary", label: "Per Day Salary", type: "money" }, { key: "bankName", label: "Bank" }, { key: "accountNumber", label: "Account" },
      { key: "settlements", label: "Settlements", type: "num" }, { key: "settledAmount", label: "Settled", type: "money" },
    ],
  },
  {
    kind: "driver-salary", label: "Driver Salary Report", hint: "Approved final settlements. Download each driver's salary statement as a PDF.", dates: true,
    cols: [
      { key: "paymentNumber", label: "DSE No" }, { key: "driverNumber", label: "Driver Code" }, { key: "driverName", label: "Driver" }, { key: "vehicleNo", label: "Vehicle" }, { key: "clientName", label: "Client" },
      { key: "onRoadDays", label: "Days", type: "num" }, { key: "gross", label: "Gross", type: "money" }, { key: "totalDeduction", label: "Deduction", type: "money" },
      { key: "suspenseAmount", label: "Suspense", type: "money" }, { key: "netAmount", label: "Net", type: "money" }, { key: "status", label: "Status" },
    ],
  },
];

export default function RsoReports() {
  const [kind, setKind] = useState<Kind>("approved-payments");
  const def = REPORTS.find((r) => r.kind === kind)!;
  return (
    <AppShell role="RSO">
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p className="muted">View reports in the application or download each as Excel.</p>
        </div>
      </div>
      <div className="ds-tabs" role="tablist">
        {REPORTS.map((r) => <button key={r.kind} role="tab" aria-selected={kind === r.kind} className={kind === r.kind ? "on" : ""} onClick={() => setKind(r.kind)}>{r.label}</button>)}
      </div>
      <Report key={kind} def={def} />
    </AppShell>
  );
}

function cell(v: Row[string], type?: Col["type"]) {
  if (v === null || v === undefined || v === "") return "-";
  if (type === "money") return formatInr(Number(v));
  if (type === "date") return formatDate(String(v));
  if (type === "datetime") return formatDateTime(String(v));
  return String(v);
}

function Report({ def }: { def: (typeof REPORTS)[number] }) {
  const toast = useToast();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: def.cols[0].key, dir: 1 });
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState("");
  const dq = useDebounce(q);
  const qs = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), ...(dq ? { q: dq } : {}) }).toString();
  const r = useApi<Row[]>(`/settlements/reports/${def.kind}?${qs}`);
  const limit = 15;

  const rows = useMemo(() => {
    const all = r.data ?? [];
    const t = q.trim().toLowerCase();
    const filtered = t && def.kind !== "driver-list" ? all.filter((x) => def.cols.some((c) => String(x[c.key] ?? "").toLowerCase().includes(t))) : all;
    return [...filtered].sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      if (typeof x === "number" && typeof y === "number") return (x - y) * sort.dir;
      return String(x ?? "").localeCompare(String(y ?? "")) * sort.dir;
    });
  }, [r.data, q, sort, def]);
  const pages = Math.max(1, Math.ceil(rows.length / limit));
  const shown = rows.slice((page - 1) * limit, page * limit);
  const totals = def.cols.filter((c) => c.type === "money").map((c) => [c.key, rows.reduce((s, x) => s + (Number(x[c.key]) || 0), 0)] as const);

  const dl = async (path: string, name: string, tag: string) => {
    setBusy(tag);
    try {
      await downloadFile(path, name);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="card ds-card">
      <div className="ds-toolbar">
        <input className="ds-search" placeholder="Search this report" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search report" />
        {def.dates && <label className="ds-range">From<DateInput value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></label>}
        {def.dates && <label className="ds-range">To<DateInput value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></label>}
        <span className="ds-toolbar-end">
          <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => dl(`/settlements/reports/${def.kind}/export?${qs}`, `${def.kind}.xlsx`, "xlsx")}>{busy === "xlsx" ? "Preparing…" : "Export Excel"}</button>
        </span>
      </div>
      <p className="muted ds-note">{def.hint}</p>
      {r.loading ? <Skeleton rows={6} /> : r.error ? <ErrorState message={r.error} onRetry={r.reload} /> : !rows.length ? <EmptyState title="No records" hint="Change the filters or check back after approvals." /> : (
        <>
          <TableWrap>
            <table className="table ds-table">
              <thead>
                <tr>
                  {def.cols.map((c) => (
                    <th key={c.key} className={c.type === "money" || c.type === "num" ? "ds-amt" : undefined} aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                      <button type="button" className="ds-sort" onClick={() => setSort({ key: c.key, dir: sort.key === c.key ? (sort.dir === 1 ? -1 : 1) : 1 })}>
                        {c.label}<span aria-hidden>{sort.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</span>
                      </button>
                    </th>
                  ))}
                  {def.kind === "driver-salary" && <th><span className="sr-only">PDF</span></th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((x, i) => (
                  <tr key={String(x._id ?? i)}>
                    {def.cols.map((c) => <td key={c.key} className={c.type === "money" || c.type === "num" ? "ds-amt" : undefined}>{cell(x[c.key], c.type)}</td>)}
                    {def.kind === "driver-salary" && (
                      <td><button type="button" className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => dl(`/settlements/${x._id}/salary-pdf`, `driver-salary-${x.driverNumber}.pdf`, String(x._id))}>{busy === x._id ? "…" : "Salary PDF"}</button></td>
                    )}
                  </tr>
                ))}
              </tbody>
              {totals.length > 0 && (
                <tfoot>
                  <tr>{def.cols.map((c, i) => <td key={c.key} className="ds-amt"><b>{i === 0 ? `Total (${rows.length})` : totals.find(([k]) => k === c.key) ? formatInr(Math.round(totals.find(([k]) => k === c.key)![1] * 100) / 100) : ""}</b></td>)}{def.kind === "driver-salary" && <td />}</tr>
                </tfoot>
              )}
            </table>
          </TableWrap>
          <div className="pager">
            <span className="muted">{rows.length} record(s) · page {page} of {pages}</span>
            <div className="inline">
              <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
              <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
