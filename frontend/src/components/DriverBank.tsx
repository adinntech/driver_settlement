"use client";

import { useErrorState } from "@/context/ToastContext";
import { useState } from "react";
import { useApi } from "@/hooks/useApi";
import { request } from "@/services/api";
import {
  bankChanged, bankFormFrom, maskAccount, sanitizeBankText, sanitizeDigits, sanitizeIfsc, toBankPayload, validateBankForm, type BankForm, type BankView,
} from "@/utils/driverBank";

const KV = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div>
    <dt>{k}</dt>
    <dd>{v === null || v === undefined || v === "" ? "—" : v}</dd>
  </div>
);

/**
 * Presentational bank panel: read-only (account number masked) with Edit Bank Details, or the four editable fields with Save / Cancel.
 * Everything is driven by props so it renders the same in tests and in the dialogs.
 */
export function DriverBankPanel({
  bank, editing, form, saving, onEdit, onChange, onSave, onCancel,
}: {
  bank: BankView; editing: boolean; form: BankForm; saving?: boolean;
  onEdit: () => void; onChange: (next: BankForm) => void; onSave: () => void; onCancel: () => void;
}) {
  const set = <K extends keyof BankForm>(k: K, v: BankForm[K]) => onChange({ ...form, [k]: v });
  return (
    <div className="drv-bank" data-section="bank-details" data-driver={bank.driverId}>
      <div className="drv-bank-head">
        <h4 className="sub">Bank Details · {bank.driverNumber}</h4>
        {!editing && <button type="button" className="btn btn-outline btn-sm" onClick={onEdit}>{bank.hasBankDetails ? "Edit Bank Details" : "Add Bank Details"}</button>}
      </div>
      {!editing ? (
        bank.hasBankDetails ? (
          <dl className="kv" data-mode="view">
            <KV k="Account Holder Name" v={bank.accountName} />
            <KV k="Bank Name" v={bank.bankName} />
            <KV k="Account Number" v={bank.accountNumber ? maskAccount(bank.accountNumber) : null} />
            <KV k="IFSC Code" v={bank.ifscCode} />
          </dl>
        ) : (
          <p className="muted" data-mode="empty">No bank details are saved for this driver. You can add them now or assign without them.</p>
        )
      ) : (
        <div data-mode="edit">
          <div className="b-row"><label>Account Holder Name</label><div className="b-ctl"><input value={form.accountName} maxLength={80} aria-label="Account Holder Name" onChange={(e) => set("accountName", sanitizeBankText(e.target.value))} /></div></div>
          <div className="b-row"><label>Bank Name</label><div className="b-ctl"><input value={form.bankName} maxLength={80} aria-label="Bank Name" onChange={(e) => set("bankName", sanitizeBankText(e.target.value))} /></div></div>
          <div className="b-row"><label>Account Number</label><div className="b-ctl"><input className="num-input" inputMode="numeric" value={form.accountNumber} aria-label="Account Number" onChange={(e) => set("accountNumber", sanitizeDigits(e.target.value))} /></div></div>
          <div className="b-row"><label>IFSC Code</label><div className="b-ctl"><input value={form.ifscCode} placeholder="SBIN0001234" aria-label="IFSC Code" onChange={(e) => set("ifscCode", sanitizeIfsc(e.target.value))} /></div></div>
          <div className="inline row-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save Bank Details"}</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={onCancel} disabled={saving}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Loads the selected driver's saved bank details (by that driver's id) and lets RBP edit them while assigning.
 * Save writes to that driver's record only; Cancel restores the saved values. Mount it with key={driverId} so switching
 * driver always starts from the new driver's own record and never carries values over from the previous one.
 */
export default function DriverBankSection({
  driverId, allotmentId, onEditingChange,
}: { driverId: string; allotmentId: string; onEditingChange?: (editing: boolean) => void }) {
  const res = useApi<BankView>(`/vehicle-allotments/drivers/${driverId}/bank`);
  const [saved, setSaved] = useState<BankView | null>(null);
  const [editing, setEditingState] = useState(false);
  const [form, setForm] = useState<BankForm>(() => bankFormFrom(null));
  const [, setErrors] = useErrorState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const bank = saved ?? res.data;
  const setEditing = (v: boolean) => { setEditingState(v); onEditingChange?.(v); };

  if (res.loading) return <p className="muted">Loading bank details…</p>;
  if (res.error || !bank) return <p className="muted" role="alert">Bank details could not be loaded{res.error ? `: ${res.error}` : ""}</p>;

  async function save() {
    const e = validateBankForm(form);
    setErrors(e);
    if (e.length || saving) return;
    if (!bankChanged(form, bankFormFrom(bank))) return void setEditing(false); // nothing to save
    setSaving(true);
    try {
      setSaved(await request<BankView>(`/vehicle-allotments/${allotmentId}/drivers/${driverId}/bank`, "PUT", toBankPayload(form)));
      setEditing(false);
    } catch (err) {
      setErrors([(err as Error).message]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <DriverBankPanel
      bank={bank} editing={editing} form={form} saving={saving}
      onEdit={() => { setForm(bankFormFrom(bank)); setErrors([]); setEditing(true); }}
      onChange={setForm}
      onSave={save}
      onCancel={() => { setForm(bankFormFrom(bank)); setErrors([]); setEditing(false); }}
    />
  );
}
