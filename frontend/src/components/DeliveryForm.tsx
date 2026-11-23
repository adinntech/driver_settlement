"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { DetailSections } from "@/components/Clearance";
import { ErrorState, Modal, Skeleton } from "@/components/ui/Ui";
import { useToast } from "@/context/ToastContext";
import { useApi } from "@/hooks/useApi";
import { ApiError, request, uploadDeliveryPhoto, type UploadedPhoto } from "@/services/api";
import type { ClearanceDetail, DeliveryPhoto } from "@/utils/clearance";
import { DESCRIPTION_MAX, EVIDENCE_HELPER, PHOTO_EXTENSIONS, fileSizeText, validateDeliveryForm } from "@/utils/delivery";
import { formatDateTime } from "@/utils/format";

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong");

/** One photo slot: camera capture (mobile), choose-from-device, preview, replace and remove. Nothing is uploaded until delivery is confirmed. */
export function PhotoPicker({ label, helper, file, onChange, camera }: { label: string; helper?: string; file: File | null; onChange: (f: File | null) => void; camera: boolean }) {
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const take = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    e.target.value = ""; // the same file can be chosen again after a removal
    if (f) onChange(f);
  };
  return (
    <section className="card cl-section" data-section={`photo-${label}`}>
      <h3>{label} *</h3>
      {helper && <p className="muted">{helper}</p>}
      {file && url ? (
        <div className="photo-box">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={`${label} preview`} className="photo-preview" />
          <small className="muted">{file.name} · {fileSizeText(file.size)}</small>
        </div>
      ) : <p className="muted">No photo selected.</p>}
      <div className="actions-row" style={{ justifyContent: "flex-start" }}>
        {camera && <button type="button" className="btn btn-outline" onClick={() => cam.current?.click()}>{file ? "Retake Photo" : "Take Photo"}</button>}
        <button type="button" className="btn btn-outline" onClick={() => pick.current?.click()}>{file ? "Replace from Device" : "Choose from Device"}</button>
        {file && <button type="button" className="btn btn-outline btn-danger" onClick={() => onChange(null)}>Remove</button>}
      </div>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={take} aria-label={`${label} camera`} />
      <input ref={pick} type="file" accept={PHOTO_EXTENSIONS.join(",")} hidden onChange={take} aria-label={`${label} file`} />
    </section>
  );
}

export function PhotoThumb({ photo, label }: { photo: DeliveryPhoto | null; label: string }) {
  const [open, setOpen] = useState(false);
  if (!photo) return <p className="muted">{label}: not available</p>;
  return (
    <div className="photo-box">
      <strong>{label}</strong>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.url} alt={label} className="photo-preview" onClick={() => setOpen(true)} style={{ cursor: "zoom-in" }} />
      <small className="muted">{photo.name} · {fileSizeText(photo.size)}</small>
      {open && (
        <Modal title={label} onClose={() => setOpen(false)} wide>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.url} alt={label} style={{ maxWidth: "100%" }} />
        </Modal>
      )}
    </div>
  );
}

/** Deliver Vehicle page: read-only project / vehicle / driver details, description, the two mandatory photos, confirmation. */
export default function DeliveryForm({ id }: { id: string }) {
  const toast = useToast();
  const q = useApi<ClearanceDetail>(`/on-road-vehicles/${id}`);
  const [description, setDescription] = useState("");
  const [speedo, setSpeedo] = useState<File | null>(null);
  const [evidence, setEvidence] = useState<File | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // photos already stored by an earlier (failed) attempt are reused on retry; replacing a file drops its stored copy
  const stored = useRef<{ speedo?: { file: File; up: UploadedPhoto }; evidence?: { file: File; up: UploadedPhoto } }>({});

  if (q.loading) return <Skeleton rows={8} />;
  if (q.error || !q.data) return <ErrorState message={q.error ?? "Allocation not found"} onRetry={q.reload} />;
  const d = q.data;
  const problems = validateDeliveryForm(description, speedo, evidence);

  if (done) {
    return (
      <div className="card" role="status">
        <h3>Vehicle delivered successfully</h3>
        <p className="muted">{d.trackupNumber} · {d.vehicleNo} · {d.driverName}</p>
        <Link href="/rbp/on-road" className="btn btn-primary">Back to Vehicle Deliver</Link>
      </div>
    );
  }
  if (!d.canDeliver) {
    return (
      <div className="card">
        <div className="cl-flag bad" role="alert">
          {d.deliveryStatus === "DELIVERED" ? "This vehicle has already been delivered."
            : d.status === "REJECTED" ? "A rejected allocation cannot be delivered. Correct and resubmit it for RSA approval."
              : d.status === "YET_TO_APPROVE" ? "RSA approval is required before delivery."
                : "This is no longer the current active vehicle and driver allocation."}
        </div>
        <Link href={`/rbp/on-road/view?id=${id}`} className="btn btn-outline">View Details</Link>
      </div>
    );
  }

  async function ensure(kind: "speedometer" | "evidence", file: File): Promise<UploadedPhoto> {
    const slot = kind === "speedometer" ? "speedo" : "evidence";
    const have = stored.current[slot];
    if (have && have.file === file) return have.up;
    const up = await uploadDeliveryPhoto(id, kind, file);
    stored.current[slot] = { file, up };
    return up;
  }

  async function go() {
    if (problems.length || !speedo || !evidence) return setError(problems.join("; "));
    setBusy(true);
    setError(null);
    try {
      const s = await ensure("speedometer", speedo);
      const e = await ensure("evidence", evidence);
      await request(`/on-road-vehicles/${id}/deliver`, "POST", { description: description.trim(), speedometerPhoto: { key: s.key }, evidencePhoto: { key: e.key }, version: d.version });
      toast("Vehicle delivered successfully");
      setConfirm(false);
      setDone(true);
    } catch (err) {
      setError(errText(err)); // photos that were stored stay stored, so a retry does not upload them again
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="cl-flag ok" role="status">RSA approved by {d.approvedBy} on {formatDateTime(d.approvedAt)}</div>
      <DetailSections d={d} />
      <section className="card cl-section" data-section="delivery-description">
        <h3>Delivery Description *</h3>
        <label className="field">
          <textarea rows={4} maxLength={DESCRIPTION_MAX} value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Delivery Description"
            placeholder="Vehicle handed over to the assigned driver for the approved campaign." />
          <small>{description.trim().length}/{DESCRIPTION_MAX}</small>
        </label>
      </section>
      <PhotoPicker label="Speedometer Photo" helper="Capture the vehicle's current speedometer reading." file={speedo} onChange={setSpeedo} camera />
      <PhotoPicker label="Driver & Vehicle Handover Photo" helper={EVIDENCE_HELPER} file={evidence} onChange={setEvidence} camera />
      <section className="card cl-section">
        <p className="muted">Delivered Date &amp; Time and Delivered By are recorded automatically by the server (IST) for the signed-in user when you confirm.</p>
      </section>
      {error && !confirm && <div className="alert" role="alert">{error}</div>}
      <div className="cl-actions">
        <Link href="/rbp/on-road" className="btn btn-outline">Cancel</Link>
        <button type="button" className="btn btn-primary" disabled={problems.length > 0} onClick={() => { setError(null); setConfirm(true); }} title={problems[0] ?? ""}>Confirm Vehicle Delivery</button>
      </div>
      {confirm && (
        <Modal title="Confirm Vehicle Delivery" onClose={() => !busy && setConfirm(false)}>
          <dl className="kv compact">
            <div><dt>Trackup Number</dt><dd>{d.trackupNumber}</dd></div>
            <div><dt>Vehicle Number</dt><dd>{d.vehicleNo}</dd></div>
            <div><dt>Driver</dt><dd>{d.driverName}</dd></div>
            <div><dt>RSA Approval Status</dt><dd>Approved</dd></div>
            <div><dt>Speedometer Photo</dt><dd>{speedo?.name}</dd></div>
            <div><dt>Driver &amp; Vehicle Photo</dt><dd>{evidence?.name}</dd></div>
            <div className="wide"><dt>Delivery Description</dt><dd>{description.trim()}</dd></div>
          </dl>
          {error && <div className="alert" role="alert">{error}</div>}
          <div className="actions-row">
            <button className="btn btn-outline" onClick={() => setConfirm(false)} disabled={busy}>Back</button>
            <button className="btn btn-primary" onClick={go} disabled={busy}>{busy ? "Uploading & saving…" : error ? "Retry Delivery" : "Confirm Delivery"}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
