"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import AppShell from "@/components/AppShell";
import RsaPaymentScreen from "@/components/RsaPayment";
import { ErrorState, Skeleton } from "@/components/ui/Ui";

export default function RsaPaymentPage() {
  return (
    <AppShell role="RSA">
      <Suspense fallback={<Skeleton rows={8} />}>
        <Screen />
      </Suspense>
    </AppShell>
  );
}

function Screen() {
  const id = useSearchParams().get("id");
  const router = useRouter();
  if (!id) return <ErrorState message="No project selected." />;
  return (
    <>
      <div className="page-head"><div><h1>Payment Entry</h1></div></div>
      <RsaPaymentScreen tvId={id} onClose={() => router.push("/rsa")} onSaved={() => router.push("/rsa")} />
    </>
  );
}
