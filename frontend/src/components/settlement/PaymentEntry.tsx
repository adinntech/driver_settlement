"use client";

import Select from "@/components/ui/Select";
import DateInput from "@/components/ui/DateInput";
import { useRef, useState } from "react";
import { Modal } from "@/components/ui/Ui";
import { useToast } from "@/context/ToastContext";
import { request } from "@/services/api";
import { formatDate, formatInr } from "@/utils/format";
import { ENTRY_MODES, cleanReference, validatePaymentEntry, type PaymentEntryForm, type SettlementDetail, type SettlementRow } from "@/utils/settlement";

/**
 * RSA payment Entry, laid out like the legacy "VEHICLE PAYMENT" window's job header and Payment Detail box.
 * RSA only records the actual payment: mode, payment date, bank, reference number (mandatory) and reference date. The approved
 * amount and category are shown read-only and are never sent. Saving completes the same approved record (APPROVED -> COMPLETED):
 * the server refuses a second save, so a double click or a second user cannot record it twice.
 */
const istDate = (d: string | Date | null | undefined) => (d ? new Date(new Date(d).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) : "");

export function PaymentEntryForm({ p, onCancel, onDone, inline = false }: { p: SettlementRow; onCancel: () => void; onDone: (saved: SettlementDetail) => void; inline?: boolean }) {
  const toast = useToast();
  const [today] = useState(() => istDate(new Date())); // IST date, fixed when the popup opens
  const approvedOn = istDate(p.reviewedAt);
  const [f, setF] = useState<PaymentEntryForm>({ paymentMode: "", paymentDate: today, bankName: "", referenceNumber: "", referenceDate: "" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const sending = useRef(false); // guards a double click before React re-renders the disabled button

  const set = (k: keyof PaymentEntryForm, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    if (errs[k]) setErrs((x) => ({ ...x, [k]: "" }));
  };

  const save = async () => {
    if (sending.current) return;
    const e = validatePaymentEntry(f, today, approvedOn);
    setErrs(e);
    if (Object.keys(e).length) return setErr("Fill in the highlighted fields");
    sending.current = true;
    setBusy(true);
    setErr("");
    try {
      const saved = await request<SettlementDetail>(`/settlements/${p._id}/complete`, "POST", {
        paymentMode: f.paymentMode, paymentDate: f.paymentDate, bankName: f.bankName.trim() || undefined,
        referenceNumber: f.referenceNumber.trim(), referenceDate: f.referenceDate || undefined,
      });
      toast(`${p.paymentNumber} paid · Ref ${saved.completion?.referenceNumber ?? f.referenceNumber.trim()}`);
      onDone(saved);
    } catch (x) {
      const m = (x as Error).message;
      if (/reference number/i.test(m)) setErrs((o) => ({ ...o, referenceNumber: m })); // e.g. already recorded on another payment
      setErr(m);
      sending.current = false;
      setBusy(false);
    }
  };

  const cash = f.paymentMode === "CASH";
  const fe = (k: keyof PaymentEntryForm) => (errs[k] ? <small className="field-error" id={`pe-${k}-err`} role="alert">{errs[k]}</small> : null);
  const approvedBy = p.reviewedBy ? `${p.reviewedBy}${p.reviewedRole && p.reviewedRole !== p.reviewedBy ? ` (${p.reviewedRole})` : ""}` : null;

  // Frontend guard: only an approved payment can be entered (the server refuses anything else, so a stale list cannot submit twice).
  if (p.status !== "APPROVED")
    return (
      <div className={`pe${inline ? " pe-inline" : ""}`}>
        <div className="pe-done" role="status">
          <Icon d={ICONS.check} />
          <div>
            <b>Entry completed</b>
            <span>{p.completion ? `Recorded with reference ${p.completion.referenceNumber} on ${formatDate(p.completion.paymentDate)}.` : "This payment is no longer awaiting entry."} It cannot be entered again.</span>
          </div>
        </div>
        <div className="pe-actions"><button type="button" className="btn btn-outline" onClick={onCancel}>Close</button></div>
      </div>
    );

  return (
    <div className={`pe${inline ? " pe-inline" : ""}`}>
      {/* ---- payment summary: who / what, and the approved figure */}
      <section className="pe-summary" aria-label="Approved payment">
        <div className="pe-summary-top">
          <div className="pe-id">
            <span className="pe-eyebrow">Payment No.</span>
            <b className="pe-payno num">{p.paymentNumber}</b>
            <span className={`pe-cat pe-cat-${p.category.toLowerCase()}`}>{p.categoryLabel}</span>
          </div>
          <div className="pe-amount">
            <span className="pe-eyebrow">Approved Amount</span>
            <b className="num">{formatInr(p.amount)}</b>
            {approvedBy && <span className="pe-sub">Approved by {approvedBy} · {formatDate(approvedOn)}</span>}
          </div>
        </div>
        <dl className="pe-facts">
          <div><dt><Icon d={ICONS.doc} />JobSheet No.</dt><dd>{p.jsNumber ?? p.trackupNumber}</dd></div>
          <div><dt><Icon d={ICONS.truck} />Vehicle No.</dt><dd>{p.vehicleNo ?? "-"}</dd></div>
          <div><dt><Icon d={ICONS.building} />Client Name</dt><dd title={p.clientName ?? undefined}>{p.clientName ?? "-"}</dd></div>
          <div><dt><Icon d={ICONS.user} />Driver Name</dt><dd title={[p.driverName, p.driverNumber].filter(Boolean).join(" · ") || undefined}>{p.driverName ?? "-"}{p.driverNumber && <small> {p.driverNumber}</small>}</dd></div>
        </dl>
        <p className="pe-meta">
          <span><Icon d={ICONS.calendar} />{formatDate(p.fromDate)} – {formatDate(p.toDate)}</span>
          {p.bank?.accountMasked && <span><Icon d={ICONS.bank} />Pay to {p.bank.accountName ?? p.driverName ?? ""} · {p.bank.bankName ?? ""} {p.bank.accountMasked}</span>}
        </p>
      </section>

      {/* ---- what RSA enters: the actual payment */}
      <fieldset className="pe-box" disabled={busy}>
        <legend><Icon d={ICONS.card} />Payment Details</legend>
        <div className="pe-grid">
          <div className="pe-field">
            <label htmlFor="pe-mode">Payment Mode <i aria-hidden>*</i></label>
            <Select id="pe-mode" className="dsf-in" value={f.paymentMode} onChange={(e) => set("paymentMode", e.target.value)} aria-label="Payment Mode" aria-describedby={errs.paymentMode ? "pe-paymentMode-err" : undefined}>
              <option value="">Select mode</option>
              {ENTRY_MODES.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
            </Select>
            {fe("paymentMode")}
          </div>
          <div className="pe-field">
            <label htmlFor="pe-date">Payment Date <i aria-hidden>*</i></label>
            <DateInput id="pe-date" className="dsf-in" value={f.paymentDate} min={approvedOn || undefined} max={today} onChange={(e) => set("paymentDate", e.target.value)} aria-label="Payment Date" />
            {fe("paymentDate")}
          </div>
          <div className="pe-field pe-span">
            <label htmlFor="pe-bank">Bank Name {!cash && <i aria-hidden>*</i>}</label>
            <span className="pe-ic">
              <Icon d={ICONS.bank} />
              <input id="pe-bank" className="dsf-in" maxLength={120} value={f.bankName} placeholder={cash ? "Not needed for cash" : "Paying bank, e.g. Axis Bank"} aria-invalid={!!errs.bankName} onChange={(e) => set("bankName", e.target.value)} />
            </span>
            {fe("bankName")}
          </div>
          <div className="pe-field">
            <label htmlFor="pe-ref">Reference No. <i aria-hidden>*</i></label>
            <span className="pe-ic">
              <Icon d={ICONS.hash} />
              <input
                id="pe-ref" className="dsf-in pe-ref" maxLength={60} required aria-required="true" autoFocus value={f.referenceNumber} placeholder="UTR / cheque / DD no."
                aria-invalid={!!errs.referenceNumber} aria-describedby="pe-ref-help" onChange={(e) => set("referenceNumber", cleanReference(e.target.value))}
              />
            </span>
            {errs.referenceNumber ? <small className="field-error" id="pe-ref-help" role="alert">{errs.referenceNumber}</small> : <small className="pe-hint" id="pe-ref-help">As received from Accounts · letters, digits, / - _</small>}
          </div>
          <div className="pe-field">
            <label htmlFor="pe-refdate">Reference Date</label>
            <DateInput id="pe-refdate" className="dsf-in" value={f.referenceDate} max={today} onChange={(e) => set("referenceDate", e.target.value)} aria-label="Reference Date" />
            {fe("referenceDate")}
          </div>
        </div>
      </fieldset>

      {err && <div className="alert pe-alert" role="alert">{err}</div>}
      <div className="pe-actions">
        <span className="pe-foot-note"><Icon d={ICONS.lock} />Amount and category are fixed by the approval</span>
        <button type="button" className="btn btn-outline" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-primary pe-save" onClick={save} disabled={busy}>
          {busy ? <><span className="pe-spin" aria-hidden />Saving…</> : <><Icon d={ICONS.check} />Save Payment</>}
        </button>
      </div>
    </div>
  );
}

/** Small line icons (24px grid, currentColor). */
const ICONS = {
  doc: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  truck: "M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-.01M17 19a2 2 0 1 0 0-.01",
  building: "M4 21V5l8-2v18M12 9h8v12M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2M3 21h18",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1.5-4 4.5-6 8-6s6.5 2 8 6",
  calendar: "M4 6h16v14H4zM4 10h16M9 3v5M15 3v5",
  bank: "M3 10l9-6 9 6M5 10v8M10 10v8M14 10v8M19 10v8M3 21h18",
  card: "M3 6h18v12H3zM3 10h18M7 15h4",
  hash: "M9 4 7 20M17 4l-2 16M4 9h16M3 15h16",
  check: "m5 12.5 4.5 4.5L19 7.5",
  lock: "M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3",
};
function Icon({ d }: { d: string }) {
  return <svg className="pe-i" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
export function PaymentEntryModal({ p, onClose, onSaved }: { p: SettlementRow; onClose: () => void; onSaved: (saved: SettlementDetail) => void }) {
  const [locked, setLocked] = useState(false);
  return (
    <Modal title="Payment Entry" onClose={() => !locked && onClose()} wide>
      <PaymentEntryForm p={p} onCancel={onClose} onDone={(s) => { setLocked(true); onSaved(s); }} />
    </Modal>
  );
}
