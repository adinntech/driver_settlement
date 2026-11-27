"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import AppShell from "@/components/AppShell";
import DeliveryForm from "@/components/DeliveryForm";
import { ErrorState, Skeleton } from "@/components/ui/Ui";

/** RBP: Deliver Vehicle form (reached from Vehicle Deliver -> Deliver). */
export default function DeliverPage() {
  return (
    <AppShell role="RBP">
      <Suspense fallback={<Skeleton rows={8} />}>
        <Screen />
      </Suspense>
    </AppShell>
  );
}

function Screen() {
  const id = useSearchParams().get("id");
  if (!id) return <ErrorState message="No allocation selected." />;
  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/rbp/on-road" className="muted">← Back</Link>
          <h1>Deliver Vehicle</h1>
        </div>
      </div>
      <DeliveryForm id={id} />
    </>
  );
}
