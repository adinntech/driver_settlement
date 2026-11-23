"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import AppShell from "@/components/AppShell";
import DriverDetails from "@/components/DriverDetails";
import { ErrorState, Skeleton } from "@/components/ui/Ui";
import { useApi } from "@/hooks/useApi";
import type { Driver, DriverHistoryRow } from "@/types/domain";

export default function DriverViewPage() {
  return (
    <AppShell role="RBP">
      <Suspense fallback={<Skeleton rows={8} />}>
        <View />
      </Suspense>
    </AppShell>
  );
}

function View() {
  const id = useSearchParams().get("id");
  const res = useApi<Driver>(id ? `/drivers/${id}` : null);
  const hist = useApi<DriverHistoryRow[]>(id ? `/drivers/${id}/history` : null);
  if (!id) return <ErrorState message="No driver selected." />;
  if (res.loading) return <Skeleton rows={8} />;
  if (res.error || !res.data) return <ErrorState message={res.error ?? "Not found"} onRetry={res.reload} />;
  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/rbp/drivers" className="back">← Back to drivers</Link>
          <h1>{res.data.driverName}</h1>
          <p className="muted">{res.data.driverNumber}</p>
        </div>
        <Link href={`/rbp/drivers/edit?id=${res.data._id}`} className="btn btn-primary">Edit Driver</Link>
      </div>
      <DriverDetails d={res.data} history={hist.data ?? undefined} />
      {hist.error && <p className="muted">History could not be loaded: {hist.error}</p>}
    </>
  );
}
