"use client";

import { useState } from "react";
import { useApi } from "@/hooks/useApi";
import { useDebounce } from "@/hooks/useDebounce";
import { request } from "@/services/api";
import type { AvailableDriver } from "@/types/domain";
import { DRIVER_TYPE_TEXT, selectDriver, typeDriverName, typeDriverNumber, type DriverPick } from "@/utils/allotment";

/** What a suggestion (and the selected-driver card) shows: number, name, type, mobile. */
export function DriverCard({ d }: { d: AvailableDriver }) {
  return (
    <dl className="kv drv-pick-card" data-section="selected-driver">
      <div><dt>Driver Number</dt><dd><strong className="num">{d.driverNumber}</strong></dd></div>
      <div><dt>Driver Name</dt><dd>{d.driverName}</dd></div>
      <div><dt>Driver Type</dt><dd>{DRIVER_TYPE_TEXT[d.driverType] ?? d.driverType}</dd></div>
      <div><dt>Mobile Number</dt><dd>{d.mobileNumber}</dd></div>
    </dl>
  );
}

export function DriverSuggestion({ d, onPick }: { d: AvailableDriver; onPick: (d: AvailableDriver) => void }) {
  return (
    <button type="button" className="proj-item" role="option" aria-selected="false" onClick={() => onPick(d)}>
      <strong className="num">{d.driverNumber}</strong>
      <span>{d.driverName}</span>
      <small className="muted">{DRIVER_TYPE_TEXT[d.driverType] ?? d.driverType} · {d.mobileNumber}</small>
    </button>
  );
}

type Field = "number" | "name";

/**
 * Driver Number + Driver Name autocomplete over drivers that are Available Now only (server-side search).
 * Both boxes always refer to the same driver record: picking a suggestion, or typing a full number / name and leaving the box,
 * fills the other box plus type and mobile; typing again drops the previous selection and everything that came from it.
 * Free text is never a driver: only a resolved record has an id, and only that id is submitted.
 */
export default function DriverPicker({
  pick, onChange, excludeId,
}: { pick: DriverPick; onChange: (next: DriverPick) => void; excludeId?: string }) {
  const [open, setOpen] = useState<Field | null>(null);
  const [err, setErr] = useState("");
  const text = open === "name" ? pick.name : pick.number;
  const dq = useDebounce(text);
  const res = useApi<AvailableDriver[]>(open && !pick.driver ? `/vehicle-allotments/drivers?q=${encodeURIComponent(dq.trim())}&limit=8` : null);
  const items = (res.data ?? []).filter((d) => d._id !== excludeId);

  async function resolve(field: Field) {
    const v = (field === "number" ? pick.number : pick.name).trim();
    if (pick.driver || !v) return;
    try {
      const d = await request<AvailableDriver>(`/vehicle-allotments/drivers/lookup?${field}=${encodeURIComponent(v)}`);
      if (excludeId && d._id === excludeId) throw new Error("Choose a different driver as the replacement");
      onChange(selectDriver(d));
      setErr("");
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  const choose = (d: AvailableDriver) => { onChange(selectDriver(d)); setErr(""); setOpen(null); };

  const box = (field: Field, label: string, placeholder: string) => (
    <div className="proj-pick" key={field}>
      <label className="drv-pick-label">{label}</label>
      <input
        value={field === "number" ? pick.number : pick.name} readOnly={!!pick.driver} placeholder={placeholder} aria-label={label} aria-invalid={!!err} autoComplete="off"
        onFocus={() => !pick.driver && setOpen(field)}
        onBlur={() => { setOpen(null); void resolve(field); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void resolve(field); } }}
        onChange={(e) => { setErr(""); setOpen(field); onChange(field === "number" ? typeDriverNumber(e.target.value) : typeDriverName(e.target.value)); }}
      />
      {open === field && !pick.driver && (
        <div className="proj-results" role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {res.loading ? (
            <p className="muted">Searching available drivers…</p>
          ) : res.error ? (
            <p className="muted">{res.error}</p>
          ) : items.length === 0 ? (
            <p className="muted">No available driver matches. Only drivers who are Available Now can be assigned.</p>
          ) : (
            items.map((d) => <DriverSuggestion key={d._id} d={d} onPick={choose} />)
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="drv-pick" aria-label="Driver Assignment">
      <div className="drv-pick-grid">
        {box("number", "Driver Number", "DR-1234")}
        {box("name", "Driver Name", "Type the driver name")}
      </div>
      {err && <small className="proj-taken" role="alert">{err}</small>}
      {pick.driver && (
        <>
          <DriverCard d={pick.driver} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onChange({ number: "", name: "", driver: null }); setErr(""); }}>Change driver</button>
        </>
      )}
    </div>
  );
}
