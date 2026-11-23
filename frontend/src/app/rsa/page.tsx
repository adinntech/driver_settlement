"use client";

import Link from "next/link";
import { useState } from "react";
import AppShell from "@/components/AppShell";
import {
  HistoryEmpty, RsaHistoryFilters, RsaHistoryTable, RsaPager, RsaSummaryCards, emptyHistoryFilters, historyFiltersActive, historyQuery, type HistoryFilterState, type RsaSummary,
} from "@/components/RsaHistory";
import { PaymentDetail } from "@/components/RsaPayment";
import { ErrorState, Skeleton } from "@/components/ui/Ui";
import { useApi } from "@/hooks/useApi";
import { useDebounce } from "@/hooks/useDebounce";
import type { RsaPaymentRow } from "@/utils/rsa";

interface Page { items: RsaPaymentRow[]; total: number; page: number; limit: number }

/** RSA landing page: the saved payment history. The entry form is a separate page opened with "+ Enter Payment". */
export default function RsaHome() {
  return (
    <AppShell role="RSA">
      <History />
    </AppShell>
  );
}

function History() {
  const [f, setF] = useState<HistoryFilterState>(emptyHistoryFilters());
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [view, setView] = useState<RsaPaymentRow | null>(null);
  const dq = useDebounce(f.q); // no request per keystroke; a newer request always wins over an older one (useApi drops stale replies)
  const list = useApi<Page>(`/rsa/payments?${historyQuery({ ...f, q: dq }, page, limit)}`);
  const summary = useApi<RsaSummary>("/rsa/payments/summary");
  const change = (next: HistoryFilterState) => { setF(next); setPage(1); }; // any filter change goes back to page 1

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Payment Entries</h1>
          <p className="muted">Saved payment entries of approved Roadshow and Signage projects.</p>
        </div>
        <Link href="/rsa/new" className="btn btn-primary">+ Enter Payment</Link>
      </div>

      {summary.data && <RsaSummaryCards s={summary.data} />}

      <div className="card">
        <RsaHistoryFilters f={f} onChange={change} onClear={() => change(emptyHistoryFilters())} createdByOptions={summary.data?.createdByOptions ?? []} />
        {list.loading ? (
          <Skeleton rows={6} />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : !list.data || list.data.items.length === 0 ? (
          <HistoryEmpty filtered={historyFiltersActive(f)} />
        ) : (
          <>
            <RsaHistoryTable items={list.data.items} onView={setView} />
            <RsaPager total={list.data.total} page={page} limit={limit} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
          </>
        )}
      </div>
      {view && <PaymentDetail p={view} onClose={() => setView(null)} />}
    </>
  );
}
