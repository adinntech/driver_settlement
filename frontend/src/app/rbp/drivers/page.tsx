"use client";

import Select from "@/components/ui/Select";
import Link from "next/link";
import { useState } from "react";
import AppShell from "@/components/AppShell";
import { DriverFilters, DriverTable } from "@/components/DriverList";
import { BulkImportButton } from "@/components/BulkImport";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Ui";
import { useApi } from "@/hooks/useApi";
import { useDebounce } from "@/hooks/useDebounce";
import type { Driver } from "@/types/domain";

interface Page { items: Driver[]; total: number; page: number; limit: number }

export default function DriversPage() {
  return (
    <AppShell role="RBP">
      <Drivers />
    </AppShell>
  );
}

function Drivers() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const dq = useDebounce(q); // no request per keystroke
  const list = useApi<Page>(`/drivers?q=${encodeURIComponent(dq.trim())}&availabilityStatus=${encodeURIComponent(status)}&page=${page}&limit=${limit}`);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / limit)) : 1;
  const filtered = !!q.trim() || !!status;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Driver Management</h1>
          <p className="muted">Maintain driver details and availability.</p>
        </div>
        <div className="inline ds-gap">
          <BulkImportButton kind="drivers" onImported={list.reload} />
          <Link href="/rbp/drivers/edit" className="btn btn-primary">+ Add Driver</Link>
        </div>
      </div>

      <div className="card">
        <DriverFilters
          q={q} status={status}
          onQ={(v) => { setQ(v); setPage(1); }} onStatus={(v) => { setStatus(v); setPage(1); }}
          onClear={() => { setQ(""); setStatus(""); setPage(1); }}
        />

        {list.loading ? (
          <Skeleton rows={6} />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : !list.data || list.data.items.length === 0 ? (
          <EmptyState title={filtered ? "No drivers match your filters" : "No drivers yet"} hint={filtered ? "Try a different search or clear the filters." : "Click Add Driver to create the first one."} />
        ) : (
          <>
            <DriverTable items={list.data.items} />
            <div className="pager">
              <span className="muted">{list.data.total} driver(s) · page {page} of {pages}</span>
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
