"use client";

import { useState } from "react";
import { useApi } from "@/hooks/useApi";
import { useDebounce } from "@/hooks/useDebounce";
import type { AvailableVehicle } from "@/types/domain";

export const vehicleLabel = (v: { vehicleNo: string; make?: string | null; model?: string | null }) =>
  [v.vehicleNo, [v.make, v.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ");

/**
 * Vehicle number autocomplete: server-side partial search over vehicles that are Available Now only
 * (in use, issue, draft, inactive and future-available vehicles are never returned).
 */
export default function VehiclePicker({
  value, excludeId, onPick, onClear, label = "Vehicle Number",
}: {
  value: AvailableVehicle | null; excludeId?: string; onPick: (v: AvailableVehicle) => void; onClear: () => void; label?: string;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const dq = useDebounce(text);
  const res = useApi<AvailableVehicle[]>(open && !value ? `/vehicle-allotments/vehicles?q=${encodeURIComponent(dq.trim())}&limit=8` : null);
  const items = (res.data ?? []).filter((v) => v._id !== excludeId);

  if (value)
    return (
      <div className="veh-picked">
        <div>
          <strong className="num">{value.vehicleNo}</strong>
          <small className="muted"> {[value.make, value.model, value.type].filter(Boolean).join(" · ")}</small>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onClear(); setText(""); }}>Change</button>
      </div>
    );
  return (
    <div className="proj-pick">
      <input
        value={text}
        placeholder="Type the vehicle number (Available Now vehicles only)"
        aria-label={label}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => { setText(e.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, "").slice(0, 14)); setOpen(true); }}
      />
      {open && (
        <div className="proj-results" role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {res.loading ? (
            <p className="muted">Searching available vehicles…</p>
          ) : res.error ? (
            <p className="muted">{res.error}</p>
          ) : items.length === 0 ? (
            <p className="muted">No available vehicle matches. Only vehicles that are Available Now can be allotted.</p>
          ) : (
            items.map((v) => (
              <button type="button" key={v._id} className="proj-item" role="option" aria-selected="false" onClick={() => { onPick(v); setOpen(false); }}>
                <strong className="num">{v.vehicleNo}</strong>
                <span>{[v.make, v.model].filter(Boolean).join(" ") || "—"}</span>
                <small className="muted">{v.type ?? ""}</small>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
