"use client";

import Select from "@/components/ui/Select";
import Link from "next/link";
import { useState } from "react";
import AppShell from "@/components/AppShell";
import { RsaFilters, RsaProjectTable, emptyRsaFilters, rsaFiltersActive, rsaQuery, type RsaFilterState } from "@/components/RsaDashboard";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Ui";
import { useApi } from "@/hooks/useApi";
import { useDebounce } from "@/hooks/useDebounce";
import type { RsaProjectRow } from "@/utils/rsa";

interface Page { items: RsaProjectRow[]; total: number; page: number; limit: number }

/** Step 1 of "+ Enter Payment": pick an eligible project (approved budget, vehicle and driver allotted). The form opens after the selection. */
export default function RsaNewPayment() {
  return (
    <AppShell role="RSA">
      <Picker />
    </AppShell>
  );
}

function Picker() {
  const [f, setF] = useState<RsaFilterState>(emptyRsaFilters());
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const dq = useDebounce(f.q);
  const list = useApi<Page>(`/rsa/projects?${rsaQuery({ ...f, q: dq }, page, limit)}`);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / limit)) : 1;
  const change = (next: RsaFilterState) => { setF(next); setPage(1); };

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/rsa" className="back">← Back to payment entries</Link>
          <h1>Enter Payment</h1>
          <p className="muted">Select the project: RSOM-approved budget with an allotted vehicle and driver.</p>
        </div>
      </div>
      <div className="card">
        <RsaFilters f={f} onChange={change} onClear={() => change(emptyRsaFilters())} />
        {list.loading ? (
          <Skeleton rows={6} />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : !list.data || list.data.items.length === 0 ? (
          <EmptyState title={rsaFiltersActive(f) ? "No project matches your filters" : "No eligible projects yet"} hint="A project appears here once its budget is approved by RSOM and a vehicle and driver are allotted." />
        ) : (
          <>
            <RsaProjectTable items={list.data.items} actionLabel="Select" />
            <div className="pager">
              <span className="muted">{list.data.total} project(s) · page {page} of {pages}</span>
              <div className="inline">
                <label className="muted size-pick">
                  Rows
                  <Select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }} aria-label="Page size">
                    {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                  </Select>
                </label>
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
