"use client";

import Select from "@/components/ui/Select";
import DateInput from "@/components/ui/DateInput";
import { useRef, useState, type ReactNode } from "react";
import { fileError } from "@/components/RenewalModal";
import DriverAvailability from "@/components/DriverAvailability";
import { PhoneInput } from "@/components/ui/Inputs";
import { uploadAttachment } from "@/services/api";
import {
  DRIVER_TYPE_OPTIONS, sanitizeDigits, sanitizeIfsc, sanitizeLicence, sanitizeName, sanitizeSalary, type DriverFormState,
} from "@/utils/driverForm";

const Row = ({ label, req, children }: { label: string; req?: boolean; children: ReactNode }) => (
  <>
    <label>{label}{req && <span className="req"> *</span>}</label>
    <div>{children}</div>
  </>
);

/**
 * Driver Details form, laid out like the reference screen (Driver No, Name, Address, Mobile, bank details, licence details,
 * Attachment with "..." / "V", Driver Type, Salary). The Branch field is intentionally not part of it.
 * The Driver Number is shown read-only: the server generates it on save and never changes it.
 */
export default function DriverFormView({
  value: f, onChange, driverNumber, isEdit, busy, onSave, onClose, onError,
}: {
  value: DriverFormState; onChange: (next: DriverFormState) => void; driverNumber: string | null; isEdit: boolean; busy?: boolean;
  onSave: () => void; onClose: () => void; onError?: (message: string) => void;
}) {
  const set = <K extends keyof DriverFormState>(k: K, v: DriverFormState[K]) => onChange({ ...f, [k]: v });
  const file = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function pick(picked: File | null) {
    if (!picked) return;
    const bad = fileError(picked);
    if (bad) return onError?.(bad);
    setUploading(true);
    try {
      set("attachment", await uploadAttachment(picked));
    } catch (e) {
      onError?.((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="card form-card drv-form">
      <div className="rm-form">
        <Row label="Driver No">
          <strong className="drv-no" aria-label="Driver No">{driverNumber ?? "Generated on save"}</strong>
        </Row>
        <Row label="Name" req>
          <input value={f.driverName} maxLength={80} autoComplete="off" onChange={(e) => set("driverName", sanitizeName(e.target.value))} aria-label="Name" />
        </Row>
        <Row label="Address">
          <input value={f.address} maxLength={200} onChange={(e) => set("address", e.target.value.replace(/[<>]/g, ""))} aria-label="Address" />
        </Row>
        <Row label="Mobile No" req>
          <PhoneInput value={f.mobile} onChange={(v) => set("mobile", v)} />
        </Row>
        <Row label="Account Name">
          <input value={f.accountName} maxLength={80} onChange={(e) => set("accountName", e.target.value.replace(/[<>]/g, ""))} aria-label="Account Name" />
        </Row>
        <Row label="Account No">
          <input className="num-input" inputMode="numeric" value={f.accountNumber} onChange={(e) => set("accountNumber", sanitizeDigits(e.target.value))} aria-label="Account No" />
        </Row>
        <Row label="IFSC Code">
          <input value={f.ifscCode} placeholder="SBIN0001234" onChange={(e) => set("ifscCode", sanitizeIfsc(e.target.value))} aria-label="IFSC Code" />
        </Row>
        <Row label="Bank Name">
          <input value={f.bankName} maxLength={80} onChange={(e) => set("bankName", e.target.value.replace(/[<>]/g, ""))} aria-label="Bank Name" />
        </Row>
        <Row label="Licence No">
          <input value={f.licenceNumber} placeholder="TN07 20110012345" onChange={(e) => set("licenceNumber", sanitizeLicence(e.target.value))} aria-label="Licence No" />
        </Row>
        <Row label="Licence Type">
          <input value={f.licenceType} maxLength={40} onChange={(e) => set("licenceType", e.target.value.replace(/[<>]/g, ""))} aria-label="Licence Type" />
        </Row>
        <Row label="Licence Expiry Date">
          <DateInput value={f.licenceExpiryDate} onChange={(e) => set("licenceExpiryDate", e.target.value)} aria-label="Licence Expiry Date" />
        </Row>
        <Row label="Attachment">
          <div className="drv-attach">
            <input value={f.attachment?.name ?? ""} readOnly placeholder="No file chosen" aria-label="Attachment" />
            <button type="button" className="btn btn-outline" onClick={() => file.current?.click()} disabled={uploading} aria-label="Browse attachment">{uploading ? "…" : "..."}</button>
            {f.attachment?.url ? (
              <a className="btn btn-outline" href={f.attachment.url} target="_blank" rel="noopener noreferrer" aria-label="View attachment">V</a>
            ) : (
              <button type="button" className="btn btn-outline" disabled aria-label="View attachment">V</button>
            )}
            <input ref={file} type="file" hidden accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => { void pick(e.target.files?.[0] ?? null); e.target.value = ""; }} />
          </div>
        </Row>
        <Row label="Driver Type" req>
          <div className="drv-types" role="radiogroup" aria-label="Driver Type">
            {DRIVER_TYPE_OPTIONS.map((o) => (
              <label key={o.value} className="drv-radio">
                <input type="radio" name="driverType" value={o.value} checked={f.driverType === o.value} onChange={() => set("driverType", o.value)} />
                {o.label}
              </label>
            ))}
          </div>
        </Row>
        <Row label="Salary">
          <input className="num-input" inputMode="decimal" value={f.salary} placeholder="0.00" onChange={(e) => set("salary", sanitizeSalary(e.target.value))} aria-label="Salary" />
        </Row>
        {isEdit && (
          <Row label="Status">
            <Select value={f.status} onChange={(e) => set("status", e.target.value as "ACTIVE" | "INACTIVE")} aria-label="Status">
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </Select>
          </Row>
        )}
      </div>
      <DriverAvailability value={f.availability} onChange={(availability) => set("availability", availability)} />
      <div className="drv-actions">
        <button className="btn btn-primary" onClick={onSave} disabled={busy || uploading}>{busy ? "Saving…" : "Save"}</button>
        <button className="btn btn-outline" onClick={onClose} disabled={busy}>Close</button>
      </div>
    </div>
  );
}
