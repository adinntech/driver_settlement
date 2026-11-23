"use client";

import { formatDate } from "@/utils/format";
import { DOC_LABEL, DOC_STATUS_LABEL, docStatus, type DocKey, type DocRow } from "@/utils/vehicleForm";

interface Props {
  k: DocKey;
  rows: DocRow[];
  onAdd: () => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}

/**
 * One document section from the reference screen (FC, Insurance, RTO, Police, Permit).
 * "+" opens the Vehicle Detail popup. "V" is reserved for a later feature.
 */
export default function VehicleDocSection({ k, rows, onAdd, onEdit, onRemove }: Props) {
  const label = DOC_LABEL[k];
  return (
    <div className="doc-sec">
      <label className="doc-label">{label}</label>
      <div className="doc-box">
        {rows.length === 0 ? (
          <p className="muted doc-empty">No {label} entries. Click + to add one.</p>
        ) : (
          rows.map((r, i) => {
            const st = docStatus(r.nextRenewalDate || null);
            return (
              <div key={r.id} className="doc-item fade-in">
                <span className="doc-n">{i + 1}</span>
                <div className="doc-main">
                  <strong>Next renewal: {r.nextRenewalDate ? formatDate(r.nextRenewalDate) : "—"}</strong>
                  <span className={`badge badge-doc-${st.toLowerCase()}`}>{DOC_STATUS_LABEL[st]}</span>
                  {r.attachment ? (
                    r.attachment.url ? (
                      <a href={r.attachment.url} target="_blank" rel="noopener noreferrer" className="doc-file">📎 {r.attachment.name}</a>
                    ) : (
                      <span className="doc-file">📎 {r.attachment.name}</span>
                    )
                  ) : (
                    <span className="muted">No attachment</span>
                  )}
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(r.id)} aria-label={`Edit ${label} entry ${i + 1}`}>Edit</button>
                <button type="button" className="icon-btn rm" onClick={() => onRemove(r.id)} aria-label={`Remove ${label} entry ${i + 1}`}>×</button>
              </div>
            );
          })
        )}
      </div>
      <div className="doc-btns">
        <button type="button" className="sq-btn" onClick={onAdd} aria-label={`Add ${label} entry`} title="Add entry">+</button>
        <button type="button" className="sq-btn" disabled aria-label={`View ${label} (coming soon)`} title="Coming soon">V</button>
      </div>
    </div>
  );
}
