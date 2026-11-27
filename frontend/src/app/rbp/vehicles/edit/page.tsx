"use client";

import Select from "@/components/ui/Select";
import DateInput from "@/components/ui/DateInput";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState, type ReactNode } from "react";
import AppShell from "@/components/AppShell";
import RenewalModal from "@/components/RenewalModal";
import VehicleAvailability from "@/components/VehicleAvailability";
import VehicleDocSection from "@/components/VehicleDocSection";
import { ConfirmDialog, ErrorState, Skeleton } from "@/components/ui/Ui";
import { useToast } from "@/context/ToastContext";
import { useApi } from "@/hooks/useApi";
import { request } from "@/services/api";
import type { Vehicle } from "@/types/domain";
import {
  DOC_KEYS, VEHICLE_TYPES, addDoc, emptyForm, fromVehicle, removeDoc, sanitizeRunning, sanitizeVehicleNo, sanitizeYear,
  todayIST, toPayload, updateDoc, validateForm, type DocKey, type VForm,
} from "@/utils/vehicleForm";
import { emptyAvailability, fromAvailability, toAvailabilityPayload, validateAvailability, type AvForm } from "@/utils/vehicleAvailability";

export default function VehicleEditPage() {
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
  const res = useApi<Vehicle>(id ? `/vehicles/${id}` : null);
  if (id && res.loading) return <Skeleton rows={8} />;
  if (id && (res.error || !res.data)) return <ErrorState message={res.error ?? "Vehicle not found"} onRetry={res.reload} />;
  return <VehicleForm key={id ?? "new"} vehicle={res.data} />;
}

const Row = ({ label, req, children }: { label: string; req?: boolean; children: ReactNode }) => (
  <div className="b-row">
    <label>{label}{req && <span className="req"> *</span>}</label>
    <div className="b-ctl">{children}</div>
  </div>
);

function VehicleForm({ vehicle }: { vehicle: Vehicle | null }) {
  const router = useRouter();
  const toast = useToast();
  const isDraft = !vehicle || vehicle.status === "DRAFT";
  const [f, setF] = useState<VForm>(() => (vehicle ? fromVehicle(vehicle as unknown as Record<string, unknown>) : emptyForm()));
  // new vehicle: Available Now from the current time; an older record without availability starts unchosen (never silently "Available")
  const [av, setAv] = useState<AvForm>(() => (vehicle ? fromAvailability(vehicle.availability) : emptyAvailability()));
  const [status, setStatus] = useState<string>(vehicle?.status ?? "DRAFT");
  const [errors, setErrors] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [popup, setPopup] = useState<{ k: DocKey; id?: string } | null>(null);
  const inflight = useRef(false); // blocks double submits
  const set = <K extends keyof VForm>(k: K, v: VForm[K]) => setF((s) => ({ ...s, [k]: v }));
  const today = todayIST();

  async function save(saveAs: "DRAFT" | "FINAL") {
    const e = [...validateForm(f, saveAs === "DRAFT"), ...validateAvailability(av, saveAs === "DRAFT")];
    setErrors(e);
    if (e.length) {
      setConfirm(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    try {
      const body = { ...toPayload(f, saveAs, !isDraft ? status : undefined), availability: toAvailabilityPayload(av) };
      if (vehicle) await request(`/vehicles/${vehicle._id}`, "PUT", body);
      else await request("/vehicles", "POST", body);
      toast(saveAs === "DRAFT" ? "Draft saved" : "Vehicle saved successfully");
      router.push("/rbp/vehicles");
    } catch (err) {
      setErrors([(err as Error).message]);
      setConfirm(false);
      inflight.current = false;
      setBusy(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/rbp/vehicles" className="back">← Back to vehicles</Link>
          <h1>{vehicle ? (isDraft ? "Continue Draft" : "Edit Vehicle") : "Add Vehicle"}</h1>
          <p className="muted">
            {vehicle ? `${vehicle.vehicleNo || "Unnamed draft"} · ` : ""}
            {isDraft ? "Draft — mandatory fields are checked only on Save." : "Active record"}
          </p>
        </div>
        <span className={`badge badge-v-${(vehicle?.status ?? "DRAFT").toLowerCase()}`}>{vehicle ? vehicle.status : "NEW"}</span>
      </div>

      {errors.length > 0 && (
        <div className="alert" role="alert">
          {errors.map((e) => <div key={e}>{e}</div>)}
        </div>
      )}

      <div className="card form-card fade-in">
        <h3 className="sub">Vehicle details</h3>
        <div className="b-cols">
          <div className="b-col">
            <Row label="Vehicle No" req>
              <input value={f.vehicleNo} onChange={(e) => set("vehicleNo", sanitizeVehicleNo(e.target.value))} placeholder="TN58BM6554" autoComplete="off" />
            </Row>
            <Row label="Make" req>
              <input value={f.make} maxLength={80} onChange={(e) => set("make", e.target.value)} />
            </Row>
            <Row label="Model" req>
              <input value={f.model} maxLength={80} onChange={(e) => set("model", e.target.value)} />
            </Row>
            <Row label="Type" req>
              <Select value={f.type} onChange={(e) => set("type", e.target.value)}>
                {VEHICLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Row>
            <Row label="Year Of Manufacture" req>
              <input className="num-input" inputMode="numeric" value={f.yearOfManufacture} onChange={(e) => set("yearOfManufacture", sanitizeYear(e.target.value))} placeholder="YYYY" />
            </Row>
            <Row label="Purchase Date" req>
              <DateInput value={f.purchaseDate} max={today} onChange={(e) => set("purchaseDate", e.target.value)} />
            </Row>
            <Row label="Current Running" req>
              <input className="num-input" inputMode="decimal" value={f.currentRunning} onChange={(e) => set("currentRunning", sanitizeRunning(e.target.value))} placeholder="0" />
            </Row>
          </div>
          <div className="b-col">
            <Row label="Stepney Status">
              <input value={f.stepneyStatus} maxLength={80} onChange={(e) => set("stepneyStatus", e.target.value)} />
            </Row>
            <Row label="Battery Status">
              <input value={f.batteryStatus} maxLength={80} onChange={(e) => set("batteryStatus", e.target.value)} />
            </Row>
            <Row label="Oil Top Up On">
              <DateInput value={f.oilTopUpOn} min={f.purchaseDate || undefined} onChange={(e) => set("oilTopUpOn", e.target.value)} />
            </Row>
            <Row label="Grease Packing On">
              <DateInput value={f.greasePackingOn} min={f.purchaseDate || undefined} onChange={(e) => set("greasePackingOn", e.target.value)} />
            </Row>
            <Row label="General Check Up On">
              <DateInput value={f.generalCheckUpOn} min={f.purchaseDate || undefined} onChange={(e) => set("generalCheckUpOn", e.target.value)} />
            </Row>
            <Row label="Total Running" req>
              <input className="num-input" inputMode="decimal" value={f.totalRunning} onChange={(e) => set("totalRunning", sanitizeRunning(e.target.value))} placeholder="0" />
            </Row>
            {!isDraft && (
              <Row label="Record Status">
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </Select>
              </Row>
            )}
          </div>
        </div>

        <VehicleAvailability value={av} onChange={setAv} />

        <h3 className="sub docs-title">Documents &amp; permissions</h3>
        {DOC_KEYS.map((k: DocKey) => (
          <VehicleDocSection
            key={k}
            k={k}
            rows={f[k]}
            onAdd={() => setPopup({ k })}
            onEdit={(id) => setPopup({ k, id })}
            onRemove={(id) => setF((s) => removeDoc(s, k, id))}
          />
        ))}

        <div className="b-col narrow">
          <Row label="Condition">
            <input value={f.condition} maxLength={120} onChange={(e) => set("condition", e.target.value)} />
          </Row>
          <Row label="Specification">
            <input value={f.specification} maxLength={200} onChange={(e) => set("specification", e.target.value)} />
          </Row>
        </div>

        <div className="sticky-actions">
          {vehicle ? (
            <Link href={`/rbp/vehicles/view?id=${vehicle._id}#history`} className="btn btn-outline">History</Link>
          ) : (
            <span />
          )}
          <div className="inline">
            <Link href="/rbp/vehicles" className="btn btn-outline">Close</Link>
            {isDraft && (
              <button className="btn btn-outline btn-danger" disabled={busy} onClick={() => save("DRAFT")}>
                {busy ? "Saving…" : "Save as Draft"}
              </button>
            )}
            <button className="btn btn-primary" disabled={busy} onClick={() => { const e = [...validateForm(f, false), ...validateAvailability(av, false)]; setErrors(e); if (e.length) window.scrollTo({ top: 0, behavior: "smooth" }); else setConfirm(true); }}>
              Save
            </button>
          </div>
        </div>
      </div>

      {popup && (
        <RenewalModal
          initialType={popup.k}
          initial={popup.id ? f[popup.k].find((d) => d.id === popup.id) : undefined}
          onClose={() => setPopup(null)}
          onSave={(type, row) => {
            setF((s) => {
              if (!popup.id) return addDoc(s, type, row);
              if (type === popup.k) return updateDoc(s, type, popup.id, row);
              return addDoc(removeDoc(s, popup.k, popup.id), type, row); // renewal type changed: moves to that section
            });
            setPopup(null);
          }}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={isDraft ? "Save as final vehicle record?" : "Save changes?"}
          message={isDraft ? "All mandatory details are complete. This vehicle will become Active." : "Changes are recorded in the vehicle history."}
          confirmLabel="Save"
          busy={busy}
          onConfirm={() => save("FINAL")}
          onCancel={() => setConfirm(false)}
        />
      )}
    </>
  );
}
