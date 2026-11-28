"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import DriverFormView from "@/components/DriverFormView";
import { ErrorState, Skeleton } from "@/components/ui/Ui";
import { useErrorState, useToast } from "@/context/ToastContext";
import { useApi } from "@/hooks/useApi";
import { request } from "@/services/api";
import type { Driver } from "@/types/domain";
import { emptyDriverForm, fromDriver, toDriverPayload, validateDriverForm, type DriverFormState } from "@/utils/driverForm";

export default function DriverEditPage() {
  return (
    <AppShell role="RBP">
      <Suspense fallback={<Skeleton rows={8} />}>
        <Loader />
      </Suspense>
    </AppShell>
  );
}

function Loader() {
  const id = useSearchParams().get("id");
  const res = useApi<Driver>(id ? `/drivers/${id}` : null);
  if (id && res.loading) return <Skeleton rows={8} />;
  if (id && (res.error || !res.data)) return <ErrorState message={res.error ?? "Driver not found"} onRetry={res.reload} />;
  return <DriverEditor key={id ?? "new"} driver={res.data} />;
}

function DriverEditor({ driver }: { driver: Driver | null }) {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState<DriverFormState>(() => (driver ? fromDriver(driver) : emptyDriverForm()));
  const [, setErrors] = useErrorState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false); // blocks double submits

  async function save() {
    const e = validateDriverForm(f);
    setErrors(e);
    if (e.length) return void window.scrollTo({ top: 0, behavior: "smooth" });
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    try {
      const body = toDriverPayload(f, !!driver);
      const saved = driver ? await request<Driver>(`/drivers/${driver._id}`, "PUT", body) : await request<Driver>("/drivers", "POST", body);
      toast(driver ? "Driver updated" : `Driver ${saved.driverNumber} created`);
      router.push("/rbp/drivers"); // the listing reloads its data on arrival
    } catch (err) {
      setErrors([(err as Error).message]);
      inflight.current = false;
      setBusy(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/rbp/drivers" className="back">← Back to drivers</Link>
          <h1>{driver ? "Edit Driver" : "Add Driver"}</h1>
          <p className="muted">{driver ? `${driver.driverNumber} · ${driver.driverName}` : "A unique Driver Number is generated when you save."}</p>
        </div>
      </div>
      <DriverFormView
        value={f} onChange={setF} driverNumber={driver?.driverNumber ?? null} isEdit={!!driver} busy={busy}
        onSave={save} onClose={() => router.push("/rbp/drivers")} onError={(m) => setErrors([m])}
      />
    </>
  );
}
