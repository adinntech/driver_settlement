"use client";

import { Modal } from "@/components/ui/Ui";
import { REQUEST_VEHICLE_TYPES, selectedTotal, stepSelection, toVehicleTypes, vehicleTypesText, type VehicleTypeSelection } from "@/utils/vehicleTypes";

/** Van outline: longer body for the Ultra, one filled panel per LED side. */
function VanIcon({ size, sides }: { size: "small" | "large"; sides: number }) {
  const x = size === "large" ? 2 : 12;
  const w = 42 - x;
  return (
    <svg viewBox="0 0 64 40" width="64" height="40" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <rect x={x} y="6" width={w} height="22" rx="2" />
      {Array.from({ length: sides }, (_, i) => (
        <rect key={i} x={x + 3 + (i * (w - 4)) / sides} y="10" width={(w - 4) / sides - 2} height="13" fill="var(--red)" stroke="none" />
      ))}
      <path d="M44 14h10l8 8v6H44z" />
      <circle cx={x + 8} cy="31" r="4" fill="var(--surface)" />
      <circle cx="53" cy="31" r="4" fill="var(--surface)" />
    </svg>
  );
}

export function VehicleTypeModal({ count, value, onChange, onClose }: { count: number; value: VehicleTypeSelection; onChange: (v: VehicleTypeSelection) => void; onClose: () => void }) {
  const total = selectedTotal(value);
  const left = count - total;
  return (
    <Modal title="Select vehicle types" wide onClose={onClose}>
      <p className="muted" role="status">
        {total} of {count} selected · <strong>{left >= 0 ? `${left} remaining` : `${-left} too many`}</strong>
      </p>
      <div className="vt-grid">
        {REQUEST_VEHICLE_TYPES.map((t) => {
          const q = value[t.code] ?? 0;
          return (
            <div key={t.code} className={`vt-card${q ? " on" : ""}`} data-code={t.code}>
              <VanIcon size={t.size} sides={t.sides} />
              <span className="vt-name">{t.name}</span>
              <div className="vt-qty">
                <button type="button" className="btn btn-outline btn-sm" disabled={!q} onClick={() => onChange(stepSelection(value, t.code, -1, count))} aria-label={`Remove one ${t.name}`}>−</button>
                <strong>{q}</strong>
                <button type="button" className="btn btn-outline btn-sm" disabled={left <= 0} onClick={() => onChange(stepSelection(value, t.code, 1, count))} aria-label={`Add one ${t.name}`}>+</button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="actions-row">
        <button type="button" className="btn btn-outline" onClick={onClose}>Close</button>
        <button type="button" className="btn btn-primary" disabled={left !== 0} onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

/** The form row: what is selected, with a button to open the popup again. */
export function VehicleTypeSummary({ count, value, onEdit }: { count: number; value: VehicleTypeSelection; onEdit: () => void }) {
  const valid = Number.isInteger(count) && count >= 1 && count <= 100;
  const total = selectedTotal(value);
  return (
    <div className="field wide">
      <span>Vehicle Types *</span>
      <div className="inline vt-summary">
        <button type="button" className="btn btn-outline btn-sm" disabled={!valid} onClick={onEdit}>{total ? "Edit vehicle types" : "Select vehicle types"}</button>
        <span>{vehicleTypesText(toVehicleTypes(value))}</span>
      </div>
      <small>{!valid ? "Enter the number of vehicles first" : total === count ? `All ${count} selected` : total < count ? `${count - total} remaining` : `${total - count} too many`}</small>
    </div>
  );
}
