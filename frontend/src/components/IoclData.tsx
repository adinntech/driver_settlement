"use client";

import { useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import DateInput from "@/components/ui/DateInput";
import Select from "@/components/ui/Select";
import TableWrap from "@/components/ui/TableWrap";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Ui";
import { useToast } from "@/context/ToastContext";
import { useApi } from "@/hooks/useApi";
import { useDebounce } from "@/hooks/useDebounce";
import { downloadFile, postFile } from "@/services/api";
import { formatDate, formatInr } from "@/utils/format";
import { MATCH_LABEL, ioclQuery, type IoclPage, type IoclSummary } from "@/utils/iocl";

const dash = (v: unknown) => (v === null || v === undefined || v === "" ? "-" : String(v));

export default function IoclData() {
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ from: "", to: "", vehicleNo: "", product: "" });
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<null | "upload" | "export">(null);
  const [result, setResult] = useState<IoclSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const vehicleNo = useDebounce(f.vehicleNo, 300);
  const list = useApi<IoclPage>(`/iocl?${ioclQuery({ ...f, vehicleNo }, page)}&_=${tick}`);
  const change = (patch: Partial<typeof f>) => { setF((x) => ({ ...x, ...patch })); setPage(1); };
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  async function upload(picked: File | undefined) {
    if (!picked || busy) return;
    setError(null);
    setResult(null);
    if (!/\.csv$/i.test(picked.name)) return setError("Upload the IOCL statement as a .csv file");
    setBusy("upload");
    try {
      const r = await postFile<IoclSummary>("/iocl/import", picked);
      setResult(r.data);
      setTick((t) => t + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function exportExcel() {
    if (!f.from || !f.to) return toast("Choose the From and To dates to export (same day for one date)", "error");
    setBusy("export");
    try {
      await downloadFile(`/iocl/export?${ioclQuery(f)}`, "IOCL STATEMENT.xlsx");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell role="RSA">
      <div className="page-head">
        <div>
          <h1>IOCL Data</h1>
          <p className="muted">Fuel card statements, matched to vehicles, projects and drivers. Kept separate from payments and settlements.</p>
        </div>
        <div className="inline ds-gap">
          <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
          <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => file.current?.click()}>{busy === "upload" ? "Uploading…" : "Upload"}</button>
          <button type="button" className="btn btn-outline" disabled={!!busy} onClick={exportExcel}>{busy === "export" ? "Exporting…" : "Export Excel"}</button>
        </div>
      </div>

      {error && <div className="alert" role="alert">{error}</div>}
      {result && (
        <div className="card" role="status">
          <strong>Import finished:</strong> {result.imported} imported · {result.duplicate} duplicate · {result.failed} failed
          {result.corrected > 0 && <p className="field-error">{result.corrected} sales had an Amount that did not match RSP × Quantity. They were corrected and are marked below; please check them against the original statement.</p>}
          {result.errors.length > 0 && <ul>{result.errors.map((e, i) => <li key={i}>Row {e.row}: {e.reason}</li>)}</ul>}
        </div>
      )}

      <div className="card filters">
        <label className="ds-range">From<DateInput value={f.from} max={f.to || undefined} onChange={(e) => change({ from: e.target.value })} aria-label="From date" /></label>
        <label className="ds-range">To<DateInput value={f.to} min={f.from || undefined} onChange={(e) => change({ to: e.target.value })} aria-label="To date" /></label>
        <input placeholder="Vehicle number" value={f.vehicleNo} onChange={(e) => change({ vehicleNo: e.target.value })} aria-label="Vehicle number" />
        <Select value={f.product} onChange={(e) => change({ product: e.target.value })} aria-label="Fuel type">
          <option value="">All fuel types</option>
          {data?.products.map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
      </div>

      {list.loading && !data ? (
        <Skeleton rows={6} />
      ) : list.error || !data ? (
        <ErrorState message={list.error ?? "Could not load IOCL data"} onRetry={list.reload} />
      ) : !data.total ? (
        <EmptyState title="No transactions" hint="Upload an IOCL Financial Transaction Statement CSV, or change the filters." />
      ) : (
        <>
          {data.vehicleTotals.length > 0 && (
            <div className="card">
              <h3>Vehicle-wise totals</h3>
              <p className="muted">
                {data.summary.sales} fuel sales · {formatInr(data.summary.amount)}
                {data.summary.unmatched > 0 && <> · <strong>{data.summary.unmatched} vehicle{data.summary.unmatched > 1 ? "s" : ""} to correct</strong> (their missing details export as blank)</>}
              </p>
              <TableWrap>
                <table className="table">
                  <thead><tr><th>Vehicle No</th><th>Sales</th><th className="ds-amt">Quantity (L)</th><th className="ds-amt">Amount</th><th>Match</th></tr></thead>
                  <tbody>
                    {data.vehicleTotals.map((t) => (
                      <tr key={t.vehicleNo}>
                        <td className="num">{dash(t.vehicleNo)}</td><td>{t.count}</td><td className="ds-amt">{t.quantity.toFixed(2)}</td><td className="ds-amt">{formatInr(t.amount)}</td>
                        <td><span className={`ds-badge ds-${t.status === "MATCHED" ? "approved" : "rejected"}`}>{MATCH_LABEL[t.status]}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </div>
          )}
          <div className="card">
            <h3>Transactions</h3>
            <TableWrap>
              <table className="table">
                <thead>
                  <tr><th>Txn Date</th><th>Txn ID</th><th>Type</th><th>Vehicle No</th><th>Fuel</th><th className="ds-amt">Quantity</th><th className="ds-amt">Amount</th><th>Odometer</th><th>Fuel Station</th><th>Project / Client</th><th>Driver</th><th>Match</th></tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r._id}>
                      <td className="ds-nowrap">{formatDate(r.txnDate)}<br /><small className="muted">{r.txnTime}</small></td>
                      <td className="num">{r.txnId}</td><td>{r.txnType}</td><td className="num">{dash(r.vehicleNo)}</td><td>{dash(r.product)}</td>
                      <td className="ds-amt">{dash(r.quantity)}</td>
                      <td className="ds-amt">
                        {r.amount === null ? "-" : formatInr(r.amount)}
                        {r.amountCorrected && <><br /><small className="field-error">Corrected · file: {dash(r.fileAmount)}</small></>}
                      </td>
                      <td>{dash(r.odometer)}</td><td>{dash(r.location)}</td>
                      <td>{dash(r.match.clientName)}{r.match.projectNo && <small className="muted"> · {r.match.projectNo}</small>}</td>
                      <td>{dash(r.match.driverName)}{r.match.driverCode && <small className="muted"> · {r.match.driverCode}</small>}</td>
                      <td>{r.txnType.toLowerCase() === "sale" ? <span className={`ds-badge ds-${r.match.status === "MATCHED" ? "approved" : "rejected"}`}>{MATCH_LABEL[r.match.status]}</span> : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            {pages > 1 && (
              <div className="pager">
                <button type="button" className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
                <span className="muted">Page {page} of {pages} · {data.total} transactions</span>
                <button type="button" className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
              </div>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
