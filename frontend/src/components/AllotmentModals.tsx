"use client";

import { useRef, useState, type ReactNode } from "react";
import VehiclePicker from "@/components/VehiclePicker";
import { fileError } from "@/components/RenewalModal";
import { Modal } from "@/components/ui/Ui";
import { useToast } from "@/context/ToastContext";
import { request, uploadAttachment } from "@/services/api";
import type { AllotmentProject, AvailableVehicle } from "@/types/domain";
import { formatDate, formatInr } from "@/utils/format";
import {
  MAX_ATTACHMENTS, emptyAllotForm, emptyChangeForm, fmtInstant, projectPeriod, scheduleFromAllotment, toAllotPayload, toChangePayload,
  toInstant, validateAllotForm, validateChangeForm, validateSchedule, type AllotForm, type ChangeForm, type Schedule,
} from "@/utils/allotment";

export const Field = ({ label, req, children }: { label: string; req?: boolean; children: ReactNode }) => (
  <div className="b-row">
    <label>{label}{req && <span className="req"> *</span>}</label>
    <div className="b-ctl">{children}</div>
  </div>
);
const DT = ({ d, t, onD, onT, label }: { d: string; t: string; onD: (v: string) => void; onT: (v: string) => void; label: string }) => (
  <div className="dt-pair">
    <input type="date" value={d} onChange={(e) => onD(e.target.value)} aria-label={`${label} date`} />
    <input type="time" value={t} onChange={(e) => onT(e.target.value)} aria-label={`${label} time`} />
  </div>
);
const Errors = ({ list }: { list: string[] }) =>
  list.length ? (
    <div className="alert" role="alert">
      {list.map((e) => <div key={e}>{e}</div>)}
    </div>
  ) : null;
const KV = ({ k, v }: { k: string; v: ReactNode }) => (
  <div>
    <dt>{k}</dt>
    <dd>{v === null || v === undefined || v === "" ? "—" : v}</dd>
  </div>
);

/** Read-only project identifiers (they come from the approved records and cannot be edited here). */
export function ProjectSummary({ p }: { p: AllotmentProject }) {
  return (
    <dl className="kv allot-proj">
      <KV k="Client / Billing Name" v={p.clientName} />
      <KV k="Project Type" v={p.projectType === "ROADSHOW" ? "Roadshow" : "Signage"} />
      <KV k="Project Name" v={p.projectName} />
      <KV k="Trackup Number" v={<strong className="num">{p.trackupNumber}</strong>} />
      <KV k="PIF Number" v={<strong className="num">{p.pifNumber}</strong>} />
      <KV k="Bill Number" v={p.billNumber} />
      <KV k="Project Start Date" v={p.startDate ? formatDate(p.startDate) : null} />
      <KV k="Project End Date" v={p.endDate ? formatDate(p.endDate) : null} />
      <KV k="Project Period" v={projectPeriod(p.startDate, p.endDate, formatDate)} />
    </dl>
  );
}

const when = (d: string, t: string) => (d && t ? fmtInstant(toInstant(d, t).toISOString()) : "—");

// ---------------------------------------------------------------- Allot Vehicle
export function AllotModal({ project, onClose, onDone }: { project: AllotmentProject; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<AllotForm>(() => emptyAllotForm());
  const [veh, setVeh] = useState<AvailableVehicle | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const set = <K extends keyof AllotForm>(k: K, v: AllotForm[K]) => setF((s) => ({ ...s, [k]: v }));

  function review() {
    const e = validateAllotForm(f);
    setErrors(e);
    if (!e.length) setConfirm(true);
  }
  async function submit() {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    try {
      await request("/vehicle-allotments", "POST", toAllotPayload(f, project.trackupNumber));
      toast(`Vehicle ${f.vehicleNo} allotted to ${project.projectName}`);
      onDone();
    } catch (e) {
      setErrors([(e as Error).message]);
      setConfirm(false);
      inflight.current = false;
      setBusy(false);
    }
  }

  if (confirm)
    return (
      <Modal title="Confirm Vehicle Allotment" onClose={onClose}>
        <dl className="kv allot-proj" data-step="summary">
          <KV k="Vehicle Number" v={<strong className="num">{f.vehicleNo}</strong>} />
          <KV k="Client" v={project.clientName} />
          <KV k="Project Name" v={project.projectName} />
          <KV k="Trackup Number" v={project.trackupNumber} />
          <KV k="PIF Number" v={project.pifNumber} />
          <KV k="Bill Number" v={project.billNumber} />
          <KV k="Allotment Date & Time" v={when(f.allottedDate, f.allottedTime)} />
          <KV k="Expected Release" v={when(f.expectedReleaseDate, f.expectedReleaseTime)} />
          <KV k="Next Available" v={when(f.nextAvailableDate, f.nextAvailableTime)} />
          <KV k="Remarks" v={f.remarks} />
        </dl>
        <div className="actions-row">
          <button className="btn btn-outline" onClick={() => setConfirm(false)} disabled={busy}>Back</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Allotting…" : "Confirm"}</button>
        </div>
      </Modal>
    );

  return (
    <Modal title={`Allot Vehicle · ${project.trackupNumber}`} onClose={onClose} wide>
      <Errors list={errors} />
      <h4 className="sub">Project</h4>
      <ProjectSummary p={project} />
      <h4 className="sub">Vehicle</h4>
      <Field label="Vehicle Number" req>
        <VehiclePicker
          value={veh}
          onPick={(v) => { setVeh(v); setF((s) => ({ ...s, vehicleId: v._id, vehicleNo: v.vehicleNo, vehicleLabel: [v.make, v.model].filter(Boolean).join(" ") })); }}
          onClear={() => { setVeh(null); setF((s) => ({ ...s, vehicleId: "", vehicleNo: "", vehicleLabel: "" })); }}
        />
      </Field>
      <h4 className="sub">Schedule (IST)</h4>
      <Field label="Allotment Date & Time" req>
        <DT d={f.allottedDate} t={f.allottedTime} onD={(v) => set("allottedDate", v)} onT={(v) => set("allottedTime", v)} label="Allotment" />
      </Field>
      <Field label="Expected Release">
        <DT d={f.expectedReleaseDate} t={f.expectedReleaseTime} onD={(v) => set("expectedReleaseDate", v)} onT={(v) => set("expectedReleaseTime", v)} label="Expected release" />
      </Field>
      <Field label="Next Available" req>
        <DT d={f.nextAvailableDate} t={f.nextAvailableTime} onD={(v) => set("nextAvailableDate", v)} onT={(v) => set("nextAvailableTime", v)} label="Next available" />
      </Field>
      <Field label="Remarks">
        <textarea rows={3} value={f.remarks} maxLength={300} onChange={(e) => set("remarks", e.target.value)} placeholder="Optional allotment instructions" />
      </Field>
      <div className="actions-row">
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={review}>Confirm Vehicle Allotment</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Change Vehicle
export function ChangeModal({ project, onClose, onDone }: { project: AllotmentProject; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const a = project.allotment!;
  const [f, setF] = useState<ChangeForm>(() => emptyChangeForm());
  const [veh, setVeh] = useState<AvailableVehicle | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inflight = useRef(false);

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const problems: string[] = [];
    const picked = Array.from(files).slice(0, Math.max(0, MAX_ATTACHMENTS - f.attachments.length));
    if (files.length > picked.length) problems.push(`Only ${MAX_ATTACHMENTS} attachments are allowed`);
    setUploading(true);
    for (const file of picked) {
      const bad = fileError(file);
      if (bad) { problems.push(`${file.name}: ${bad}`); continue; }
      try {
        const up = await uploadAttachment(file);
        setF((s) => ({ ...s, attachments: [...s.attachments, up] }));
      } catch (e) {
        problems.push(`${file.name}: ${(e as Error).message}`);
      }
    }
    setUploading(false);
    setErrors(problems);
  }
  function review() {
    const e = validateChangeForm(f, a.vehicleId);
    setErrors(e);
    if (!e.length) setConfirm(true);
  }
  async function submit() {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    try {
      await request(`/vehicle-allotments/${a._id}/change-vehicle`, "POST", toChangePayload(f));
      toast(`Vehicle changed: ${a.vehicleNo} → ${f.vehicleNo}`);
      onDone();
    } catch (e) {
      setErrors([(e as Error).message]);
      setConfirm(false);
      inflight.current = false;
      setBusy(false);
    }
  }

  if (confirm)
    return (
      <Modal title="Confirm Vehicle Change" onClose={onClose}>
        <dl className="kv allot-proj" data-step="summary">
          <KV k="Project" v={project.projectName} />
          <KV k="Trackup / PIF" v={`${project.trackupNumber} / ${project.pifNumber}`} />
          <KV k="Current Vehicle" v={a.vehicleNo} />
          <KV k="Replacement Vehicle" v={<strong className="num">{f.vehicleNo}</strong>} />
          <KV k="Change Reason" v={f.reason} />
          <KV k="Attachments" v={f.attachments.map((x) => x.name).join(", ")} />
          <KV k="Remarks" v={f.remarks} />
        </dl>
        <p className="muted">{a.vehicleNo} becomes Available Now and {f.vehicleNo} takes over this project. The earlier allotment stays in the history.</p>
        <div className="actions-row">
          <button className="btn btn-outline" onClick={() => setConfirm(false)} disabled={busy}>Back</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Changing…" : "Confirm Change"}</button>
        </div>
      </Modal>
    );

  return (
    <Modal title={`Change Vehicle · ${project.trackupNumber}`} onClose={onClose}>
      <Errors list={errors} />
      <Field label="Current Vehicle Number">
        <input value={a.vehicleNo} readOnly aria-label="Current Vehicle Number" />
      </Field>
      <Field label="Replacement Vehicle Number" req>
        <VehiclePicker
          label="Replacement Vehicle Number"
          value={veh}
          excludeId={a.vehicleId}
          onPick={(v) => { setVeh(v); setF((s) => ({ ...s, vehicleId: v._id, vehicleNo: v.vehicleNo })); }}
          onClear={() => { setVeh(null); setF((s) => ({ ...s, vehicleId: "", vehicleNo: "" })); }}
        />
      </Field>
      <Field label="Change Reason" req>
        <textarea rows={3} value={f.reason} maxLength={300} onChange={(e) => setF((s) => ({ ...s, reason: e.target.value }))} placeholder="Why is the vehicle being changed?" />
      </Field>
      <Field label="Supporting Attachment">
        <div className="chg-files">
          <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" disabled={uploading || f.attachments.length >= MAX_ATTACHMENTS} aria-label="Supporting attachments"
            onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
          {uploading && <small className="muted">Uploading…</small>}
          {f.attachments.map((x) => (
            <span key={x.key} className="chg-file">
              {x.name}
              <button type="button" className="icon-btn" aria-label={`Remove ${x.name}`} onClick={() => setF((s) => ({ ...s, attachments: s.attachments.filter((y) => y.key !== x.key) }))}>✕</button>
            </span>
          ))}
          <small className="muted">Optional · PDF / JPG / PNG / WEBP · max 10 MB each · up to {MAX_ATTACHMENTS} files</small>
        </div>
      </Field>
      <Field label="Additional Remarks">
        <textarea rows={2} value={f.remarks} maxLength={300} onChange={(e) => setF((s) => ({ ...s, remarks: e.target.value }))} />
      </Field>
      <div className="actions-row">
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={review} disabled={uploading}>Change Vehicle</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Extend / Release
export function ExtendModal({ project, onClose, onDone }: { project: AllotmentProject; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const a = project.allotment!;
  const [s, setS] = useState<Schedule>(() => scheduleFromAllotment(a));
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  async function submit() {
    const e = validateSchedule(s, new Date(a.allottedAt));
    setErrors(e);
    if (e.length || busy) return;
    setBusy(true);
    try {
      await request(`/vehicle-allotments/${a._id}/schedule`, "PUT", { ...s, reason });
      toast("Release / next available time updated");
      onDone();
    } catch (err) {
      setErrors([(err as Error).message]);
      setBusy(false);
    }
  }
  return (
    <Modal title={`Extend Allotment · ${a.vehicleNo}`} onClose={onClose}>
      <Errors list={errors} />
      <Field label="Expected Release">
        <DT d={s.expectedReleaseDate} t={s.expectedReleaseTime} onD={(v) => setS({ ...s, expectedReleaseDate: v })} onT={(v) => setS({ ...s, expectedReleaseTime: v })} label="Expected release" />
      </Field>
      <Field label="Next Available" req>
        <DT d={s.nextAvailableDate} t={s.nextAvailableTime} onD={(v) => setS({ ...s, nextAvailableDate: v })} onT={(v) => setS({ ...s, nextAvailableTime: v })} label="Next available" />
      </Field>
      <Field label="Reason">
        <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Optional, e.g. project extended by client" />
      </Field>
      <div className="actions-row">
        <button className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  );
}

export function ReleaseModal({ project, onClose, onDone }: { project: AllotmentProject; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const a = project.allotment!;
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await request(`/vehicle-allotments/${a._id}/release`, "POST", { remarks });
      toast(`${a.vehicleNo} released and available again`);
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal title={`Release Vehicle · ${a.vehicleNo}`} onClose={onClose}>
      <Errors list={error ? [error] : []} />
      <p className="muted">{a.vehicleNo} becomes Available Now and this allotment ends. The record stays in the Allotment History.</p>
      <Field label="Remarks">
        <input value={remarks} maxLength={300} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
      </Field>
      <div className="actions-row">
        <button className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Releasing…" : "Release Vehicle"}</button>
      </div>
    </Modal>
  );
}

export { formatInr };
