"use client";

import DateTimePicker from "@/components/ui/DateTimePicker";
import { laterOf, todayIst } from "@/utils/dates";
import { useRef, useState, type ReactNode } from "react";
import DriverBankSection from "@/components/DriverBank";
import DriverPicker, { DriverCard } from "@/components/DriverPicker";
import VehiclePicker from "@/components/VehiclePicker";
import { fileError } from "@/components/RenewalModal";
import { Modal } from "@/components/ui/Ui";
import { useToast } from "@/context/ToastContext";
import { request, uploadAttachment } from "@/services/api";
import type { AllotmentDriverRef, AllotmentProject, AvailableVehicle } from "@/types/domain";
import { formatDate, formatInr } from "@/utils/format";
import { kmText } from "@/utils/kmAllowance";
import { deductionValue, formatDeduction, sanitizeDeduction, validateDeduction } from "@/utils/driverBank";
import {
  ALLOT_MODE_LABEL, MAX_ATTACHMENTS, emptyAllotForm, emptyChangeDriverForm, emptyChangeForm, emptyDriverPick, fmtInstant, projectPeriod, scheduleFromAllotment,
  toAllotPayload, toChangeDriverPayload, toChangePayload, toInstant, validateAllotForm, validateAssignDriverForm, validateChangeDriverForm, validateChangeForm,
  validateSchedule, DRIVER_TYPE_TEXT, driverLabel, type AllotForm, type AllotMode, type ChangeDriverForm, type ChangeForm, type DriverPick, type Schedule,
} from "@/utils/allotment";

export const Field = ({ label, req, children }: { label: string; req?: boolean; children: ReactNode }) => (
  <div className="b-row">
    <label>{label}{req && <span className="req"> *</span>}</label>
    <div className="b-ctl">{children}</div>
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
      {p.vehicleType && <KV k="Requested Vehicle Type" v={p.vehicleType} />}
      <KV k="Trackup Number" v={<strong className="num">{p.trackupNumber}</strong>} />
      <KV k="PIF Number" v={<strong className="num">{p.pifNumber}</strong>} />
      <KV k="Bill Number" v={p.billNumber} />
      <KV k="Project Start Date" v={p.startDate ? formatDate(p.startDate) : null} />
      <KV k="Project End Date" v={p.endDate ? formatDate(p.endDate) : null} />
      <KV k="Project Period" v={projectPeriod(p.startDate, p.endDate, formatDate)} />
      {p.projectType === "ROADSHOW" && p.totalAllowedKm !== undefined && (
        <KV k="Total Allowed KM" v={p.totalAllowedKm === null ? null : `${kmText(p.totalAllowedKm)}${p.extraKmAllotted ? ` (incl. ${kmText(p.extraKmAllotted)}/day extra)` : ""}`} />
      )}
    </dl>
  );
}

const when = (d: string, t: string) => (d && t ? fmtInstant(toInstant(d, t).toISOString()) : "—");

// ---------------------------------------------------------------- Allot Vehicle
export function AllotModal({ project, onClose, onDone }: { project: AllotmentProject; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<AllotForm>(() => emptyAllotForm());
  const [veh, setVeh] = useState<AvailableVehicle | null>(null);
  const [pick, setPick] = useState<DriverPick>(() => emptyDriverPick());
  const [errors, setErrors] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const set = <K extends keyof AllotForm>(k: K, v: AllotForm[K]) => setF((s) => ({ ...s, [k]: v }));
  const withDriver = f.mode === "VEHICLE_DRIVER";
  const onPickDriver = (p: DriverPick) => { setPick(p); setF((s) => ({ ...s, driverId: p.driver?._id ?? "" })); };

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
      await request("/vehicle-allotments", "POST", toAllotPayload(f, project.pifNumber));
      toast(withDriver && pick.driver ? `Vehicle ${f.vehicleNo} and driver ${pick.driver.driverNumber} allotted to ${project.projectName}` : `Vehicle ${f.vehicleNo} allotted to ${project.projectName}`);
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
          <KV k="Allocation" v={ALLOT_MODE_LABEL[f.mode]} />
          {project.vehicleType && <KV k="Requested Vehicle Type" v={project.vehicleType} />}
          <KV k="Vehicle Number" v={<strong className="num">{f.vehicleNo}</strong>} />
          {withDriver && pick.driver && (
            <>
              <KV k="Driver Number" v={<strong className="num">{pick.driver.driverNumber}</strong>} />
              <KV k="Driver Name" v={pick.driver.driverName} />
              <KV k="Driver Type" v={DRIVER_TYPE_TEXT[pick.driver.driverType] ?? pick.driver.driverType} />
              <KV k="Mobile Number" v={pick.driver.mobileNumber} />
            </>
          )}
          {!withDriver && <KV k="Driver" v="Not assigned (assign later with Assign Driver)" />}
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
    <Modal title={`Allot Vehicle · ${project.trackupNumber} · ${project.pifNumber}`} onClose={onClose} wide className="modal-allot">
      <Errors list={errors} />
      <h4 className="sub">Project</h4>
      <ProjectSummary p={project} />
      <div className="allot-cols">
      <section>
      <h4 className="sub">Vehicle</h4>
      <Field label="Vehicle Number" req>
        <VehiclePicker
          value={veh}
          onPick={(v) => { setVeh(v); setF((s) => ({ ...s, vehicleId: v._id, vehicleNo: v.vehicleNo, vehicleLabel: [v.make, v.model].filter(Boolean).join(" ") })); }}
          onClear={() => { setVeh(null); setF((s) => ({ ...s, vehicleId: "", vehicleNo: "", vehicleLabel: "" })); }}
        />
      </Field>
      </section>
      <section>
      <h4 className="sub">Driver Assignment (Optional)</h4>
      <div className="drv-av-radios allot-mode" role="radiogroup" aria-label="Allocation option">
        {(["VEHICLE_ONLY", "VEHICLE_DRIVER"] as AllotMode[]).map((m) => (
          <label key={m} className={`drv-av-opt drv-av-${m === "VEHICLE_ONLY" ? "blue" : "green"}${f.mode === m ? " on" : ""}`}>
            <input type="radio" name="allotMode" value={m} checked={f.mode === m} onChange={() => set("mode", m)} />
            <span className="drv-av-dot" aria-hidden />
            {ALLOT_MODE_LABEL[m]}
          </label>
        ))}
      </div>
      {withDriver ? (
        <DriverPicker pick={pick} onChange={onPickDriver} />
      ) : (
        <p className="muted" data-note="driver-later">No driver is saved with this allotment. You can use Assign Driver on the allotment later.</p>
      )}
      </section>
      </div>
      <h4 className="sub">Schedule (IST)</h4>
      <Field label="Allotment Date & Time" req>
        <DateTimePicker date={f.allottedDate} time={f.allottedTime} onChange={(d, t) => setF((x) => ({ ...x, allottedDate: d, allottedTime: t }))} label="Allotment" max={todayIst()} />
      </Field>
      <Field label="Expected Release">
        <DateTimePicker date={f.expectedReleaseDate} time={f.expectedReleaseTime} onChange={(d, t) => setF((x) => ({ ...x, expectedReleaseDate: d, expectedReleaseTime: t }))} label="Expected release" min={f.allottedDate || undefined} />
      </Field>
      <Field label="Next Available (optional)">
        <DateTimePicker date={f.nextAvailableDate} time={f.nextAvailableTime} onChange={(d, t) => setF((x) => ({ ...x, nextAvailableDate: d, nextAvailableTime: t }))} label="Next available" min={laterOf(todayIst(), f.expectedReleaseDate)} />
      </Field>
      <Field label="Remarks">
        <textarea rows={3} value={f.remarks} maxLength={300} onChange={(e) => set("remarks", e.target.value)} placeholder="Optional allotment instructions" />
      </Field>
      <div className="actions-row allot-actions">
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
    <Modal title={`Change Vehicle · ${project.trackupNumber} · ${project.pifNumber}`} onClose={onClose}>
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

// ---------------------------------------------------------------- Assign Driver / Change Driver
/** The allotment a driver is being assigned to (shown read-only in the dialogs). */
export interface DriverTarget { _id: string; vehicleNo: string; trackupNumber: string; pifNumber?: string; projectName?: string }

export function AssignDriverModal({ target, onClose, onDone }: { target: DriverTarget; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [pick, setPick] = useState<DriverPick>(() => emptyDriverPick());
  const [errors, setErrors] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const [editingBank, setEditingBank] = useState(false);
  const d = pick.driver;

  function review() {
    const e = validateAssignDriverForm(d?._id ?? "");
    if (editingBank) e.push("Save or cancel the bank details before assigning");
    setErrors(e);
    if (!e.length) setConfirm(true);
  }
  async function submit() {
    if (inflight.current || !d) return;
    inflight.current = true;
    setBusy(true);
    try {
      await request(`/vehicle-allotments/${target._id}/assign-driver`, "POST", { driverId: d._id });
      toast(`Driver ${d.driverNumber} assigned to ${target.vehicleNo}`);
      onDone();
    } catch (e) {
      setErrors([(e as Error).message]);
      setConfirm(false);
      inflight.current = false;
      setBusy(false);
    }
  }

  if (confirm && d)
    return (
      <Modal title="Confirm Driver Assignment" onClose={onClose}>
        <dl className="kv allot-proj" data-step="summary">
          <KV k="Vehicle" v={<strong className="num">{target.vehicleNo}</strong>} />
          <KV k="Project" v={target.projectName} />
          <KV k="Trackup Number" v={target.trackupNumber} />
          <KV k="PIF Number" v={target.pifNumber} />
          <KV k="Driver Number" v={<strong className="num">{d.driverNumber}</strong>} />
          <KV k="Driver Name" v={d.driverName} />
          <KV k="Driver Type" v={DRIVER_TYPE_TEXT[d.driverType] ?? d.driverType} />
          <KV k="Mobile Number" v={d.mobileNumber} />
        </dl>
        <p className="muted">{d.driverNumber} becomes In Use – Another Project on this project. The vehicle allotment itself is not changed.</p>
        <div className="actions-row">
          <button className="btn btn-outline" onClick={() => setConfirm(false)} disabled={busy}>Back</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Assigning…" : "Confirm Assignment"}</button>
        </div>
      </Modal>
    );
  return (
    <Modal title={`Assign Driver · ${target.vehicleNo}`} onClose={onClose}>
      <Errors list={errors} />
      <Field label="Vehicle"><input value={target.vehicleNo} readOnly aria-label="Vehicle" /></Field>
      <Field label="Project"><input value={[target.trackupNumber, target.pifNumber, target.projectName].filter(Boolean).join(" · ")} readOnly aria-label="Project" /></Field>
      <h4 className="sub">Driver (Available Now only)</h4>
      <DriverPicker pick={pick} onChange={(p) => { setPick(p); setEditingBank(false); }} />
      {d && <DriverBankSection key={d._id} driverId={d._id} allotmentId={target._id} onEditingChange={setEditingBank} />}
      <div className="actions-row">
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={review}>Assign Driver</button>
      </div>
    </Modal>
  );
}

export function ChangeDriverModal({ target, current, onClose, onDone }: { target: DriverTarget; current: AllotmentDriverRef; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [pick, setPick] = useState<DriverPick>(() => emptyDriverPick());
  const [f, setF] = useState<ChangeDriverForm>(() => emptyChangeDriverForm());
  const [errors, setErrors] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editingBank, setEditingBank] = useState(false);
  const inflight = useRef(false);
  const d = pick.driver;

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
        setF((x) => ({ ...x, attachments: [...x.attachments, up] }));
      } catch (e) {
        problems.push(`${file.name}: ${(e as Error).message}`);
      }
    }
    setUploading(false);
    setErrors(problems);
  }
  function review() {
    const e = validateChangeDriverForm({ ...f, driverId: d?._id ?? "" }, current.driverId);
    if (editingBank) e.push("Save or cancel the bank details before changing the driver");
    setErrors(e);
    if (!e.length) setConfirm(true);
  }
  async function submit() {
    if (inflight.current || !d) return;
    inflight.current = true;
    setBusy(true);
    try {
      await request(`/vehicle-allotments/${target._id}/change-driver`, "POST", toChangeDriverPayload({ ...f, driverId: d._id }));
      toast(`Driver changed: ${current.driverNumber} → ${d.driverNumber}`);
      onDone();
    } catch (e) {
      setErrors([(e as Error).message]);
      setConfirm(false);
      inflight.current = false;
      setBusy(false);
    }
  }

  if (confirm && d)
    return (
      <Modal title="Confirm Driver Change" onClose={onClose}>
        <dl className="kv allot-proj" data-step="summary">
          <KV k="Vehicle" v={target.vehicleNo} />
          <KV k="Trackup Number" v={target.trackupNumber} />
          <KV k="PIF Number" v={target.pifNumber} />
          <KV k="Current Driver" v={driverLabel(current)} />
          <KV k="Replacement Driver" v={<strong>{driverLabel({ driverNumber: d.driverNumber, driverName: d.driverName })}</strong>} />
          <KV k="Change Reason" v={f.reason} />
          <KV k="Travel Amount Deduction" v={formatDeduction(deductionValue(f.travelAmountDeduction))} />
          <KV k="Attachments" v={f.attachments.map((x) => x.name).join(", ")} />
          <KV k="Remarks" v={f.remarks} />
        </dl>
        <p className="muted">{current.driverNumber} becomes Available Now and {d.driverNumber} takes over. The vehicle allotment stays as it is and the earlier driver stays in the history.</p>
        <div className="actions-row">
          <button className="btn btn-outline" onClick={() => setConfirm(false)} disabled={busy}>Back</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Changing…" : "Confirm Change"}</button>
        </div>
      </Modal>
    );
  return (
    <Modal title={`Change Driver · ${target.vehicleNo}`} onClose={onClose}>
      <Errors list={errors} />
      <h4 className="sub">Current driver</h4>
      <dl className="kv drv-pick-card" data-section="current-driver">
        <KV k="Driver Number" v={<strong className="num">{current.driverNumber}</strong>} />
        <KV k="Driver Name" v={current.driverName} />
        <KV k="Driver Type" v={current.driverType ? DRIVER_TYPE_TEXT[current.driverType] ?? current.driverType : null} />
        <KV k="Mobile Number" v={current.mobileNumber} />
      </dl>
      <h4 className="sub">Replacement driver (Available Now only)</h4>
      <DriverPicker pick={pick} onChange={(p) => { setPick(p); setEditingBank(false); }} excludeId={current.driverId} />
      {d && <DriverBankSection key={d._id} driverId={d._id} allotmentId={target._id} onEditingChange={setEditingBank} />}
      <Field label="Change Reason" req>
        <textarea rows={3} value={f.reason} maxLength={300} aria-label="Change Reason" onChange={(e) => setF((x) => ({ ...x, reason: e.target.value }))} placeholder="Why is the driver being changed?" />
      </Field>
      <Field label="Travel Amount Deduction">
        <input className="num-input" inputMode="decimal" value={f.travelAmountDeduction} placeholder="0" aria-label="Travel Amount Deduction" aria-invalid={!!validateDeduction(f.travelAmountDeduction)}
          onChange={(e) => setF((x) => ({ ...x, travelAmountDeduction: sanitizeDeduction(e.target.value) }))} />
        <small className="muted" data-note="deduction">{validateDeduction(f.travelAmountDeduction) ?? `Numbers only · ${formatDeduction(deductionValue(f.travelAmountDeduction))} · deducted from the replaced driver in Previous Salary Deduction on their next Final Settlement`}</small>
      </Field>
      <Field label="Supporting Attachment">
        <div className="chg-files">
          <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" disabled={uploading || f.attachments.length >= MAX_ATTACHMENTS} aria-label="Supporting attachments"
            onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
          {uploading && <small className="muted">Uploading…</small>}
          {f.attachments.map((x) => (
            <span key={x.key} className="chg-file">
              {x.name}
              <button type="button" className="icon-btn" aria-label={`Remove ${x.name}`} onClick={() => setF((y) => ({ ...y, attachments: y.attachments.filter((z) => z.key !== x.key) }))}>✕</button>
            </span>
          ))}
          <small className="muted">Optional · PDF / JPG / PNG / WEBP · max 10 MB each · up to {MAX_ATTACHMENTS} files</small>
        </div>
      </Field>
      <Field label="Additional Remarks">
        <textarea rows={2} value={f.remarks} maxLength={300} aria-label="Additional Remarks" onChange={(e) => setF((x) => ({ ...x, remarks: e.target.value }))} />
      </Field>
      <div className="actions-row">
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={review} disabled={uploading}>Change Driver</button>
      </div>
    </Modal>
  );
}

export { DriverCard };

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
        <DateTimePicker date={s.expectedReleaseDate} time={s.expectedReleaseTime} onChange={(d, t) => setS({ ...s, expectedReleaseDate: d, expectedReleaseTime: t })} label="Expected release" />
      </Field>
      <Field label="Next Available (optional)">
        <DateTimePicker date={s.nextAvailableDate} time={s.nextAvailableTime} onChange={(d, t) => setS({ ...s, nextAvailableDate: d, nextAvailableTime: t })} label="Next available" />
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
