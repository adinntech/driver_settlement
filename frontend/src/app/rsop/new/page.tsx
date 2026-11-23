"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import AppShell from "@/components/AppShell";
import CopyButton from "@/components/ui/CopyButton";
import { ConfirmDialog, Modal } from "@/components/ui/Ui";
import { useToast } from "@/context/ToastContext";
import { request } from "@/services/api";
import type { Project, ProjectType } from "@/types/domain";
import { countDays } from "@/utils/format";
import { PhoneInput } from "@/components/ui/Inputs";
import { isValidPhone, toFullPhone } from "@/utils/phone";

type Form = Record<string, string>;
const CITIES = ["Chennai", "Madurai", "Thanjavur", "Salem", "Vellore", "Coimbatore", "Trichy", "Virudhunagar", "Tirunelveli", "Erode", "Tiruppur", "Kanyakumari", "Ramnad", "Pondicherry"];
const YN = ["YES", "NO"];

export default function NewTrackingPage() {
  return (
    <AppShell role="RSOP">
      <Wizard />
    </AppShell>
  );
}

function Wizard() {
  const [type, setType] = useState<ProjectType | null>(null);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>New Tracking Request</h1>
          <p className="muted">Select a project type, then enter the details.</p>
        </div>
      </div>
      <div className="type-pick">
        {(["ROADSHOW", "SIGNAGE"] as ProjectType[]).map((t) => (
          <button key={t} className={`role-card${type === t ? " selected" : ""}`} onClick={() => setType(t)}>
            <strong>{t === "ROADSHOW" ? "Roadshow" : "Signage"}</strong>
            <span>{t === "ROADSHOW" ? "LED / backlit van campaigns across locations" : "Signage & in-shop branding jobs"}</span>
          </button>
        ))}
      </div>
      {type && (
        <div key={type} className="fade-in">
          {type === "ROADSHOW" ? <RoadshowForm /> : <SignageForm />}
        </div>
      )}
    </>
  );
}

function Field({ label, children, hint, wide }: { label: string; children: ReactNode; hint?: string; wide?: boolean }) {
  return (
    <label className={`field${wide ? " wide" : ""}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function useFormState(initial: Form) {
  const [f, setF] = useState<Form>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const bind = (k: string) => ({ value: f[k] ?? "", onChange: (e: { target: { value: string } }) => set(k, e.target.value) });
  return { f, set, bind, errors, setErrors };
}

function YesNo({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="seg">
      {YN.map((o) => (
        <button type="button" key={o} className={value === o ? "on" : ""} onClick={() => onChange(o)}>
          {o === "YES" ? "Yes" : "No"}
        </button>
      ))}
    </div>
  );
}

function LocationPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const t = raw.trim();
    if (t && !value.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...value, t]);
    setText("");
  };
  return (
    <div className="multi">
      <div className="chips">
        {value.map((l) => (
          <span key={l} className="chip">
            {l}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== l))} aria-label={`Remove ${l}`}>
              ✕
            </button>
          </span>
        ))}
      </div>
      <input
        list="cities"
        placeholder="Type or pick a location, press Enter"
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          if (CITIES.includes(v)) add(v);
          else setText(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(text);
          }
        }}
        onBlur={() => add(text)}
      />
      <datalist id="cities">
        {CITIES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  );
}

function useSubmit(projectType: ProjectType) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Project | null>(null);
  // Same key for retries of the same form so a double-click can never create twice.
  const [requestId] = useState(() => crypto.randomUUID());

  async function submit(details: Record<string, unknown>): Promise<string | null> {
    setBusy(true);
    try {
      const p = await request<Project>("/tracking", "POST", { projectType, details, requestId });
      setCreated(p);
      toast("Tracking numbers created successfully");
      return null;
    } catch (e) {
      return (e as Error).message;
    } finally {
      setBusy(false);
    }
  }
  const done = created && (
    <Modal title="Tracking numbers created" wide onClose={() => router.push("/rsop")}>
      <p className="muted">
        {created.clientName} — {created.vehicles.length} vehicle(s). Copy any number below; you can view them anytime from the dashboard.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Trackup</th>
            <th>PIF</th>
            <th>Display</th>
          </tr>
        </thead>
        <tbody>
          {created.vehicles.map((v) => (
            <tr key={v._id}>
              <td>{v.vehicleIndex}</td>
              {[
                [v.trackupNumber, "Trackup Number"],
                [v.pifNumber, "PIF Number"],
                [v.displayNumber, "Display Number"],
              ].map(([val, label]) => (
                <td key={label}>
                  <span className="num">
                    {val}
                    <CopyButton value={val} label={label} />
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="actions-row">
        <button className="btn btn-primary" onClick={() => router.push("/rsop")}>
          Go to dashboard
        </button>
      </div>
    </Modal>
  );
  return { submit, busy, done };
}

const clean = (f: Form) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ""));

function RoadshowForm() {
  const { f, set, bind, errors, setErrors } = useFormState({
    sundayHalt: "NO", paSystem: "NO", mike: "NO", tv: "NO", promoter: "NO", leaflet: "NO", extraKmAllowed: "NO",
    photos: "REQUIRED",
  });
  const [locs, setLocs] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const { submit, busy, done } = useSubmit("ROADSHOW");

  const days = useMemo(
    () => (f.startDate && f.endDate ? countDays(f.startDate, f.endDate, f.sundayHalt === "YES") : 0),
    [f.startDate, f.endDate, f.sundayHalt],
  );

  function stepErrors(s: number): string[] {
    const e: string[] = [];
    if (s === 0) {
      if (!f.billingName?.trim()) e.push("Billing name is required");
      if (!f.stateCode?.trim()) e.push("State code is required");
      const n = Number(f.numberOfVans);
      if (!Number.isInteger(n) || n < 1 || n > 100) e.push("Number of vans must be between 1 and 100");
      if (!f.startDate || !f.endDate) e.push("Start and end dates are required");
      else if (f.endDate < f.startDate) e.push("End date cannot be before start date");
      if (!f.reportingDate) e.push("Reporting date is required");
    }
    if (s === 1) {
      if (locs.length === 0) e.push("Add at least one reporting location");
      if (f.contactNumber && !isValidPhone(f.contactNumber)) e.push("Contact number must be a valid 10-digit mobile number");
      if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) e.push("Email is invalid");
    }
    return e;
  }

  function next() {
    const e = stepErrors(step);
    setErrors(e);
    if (e.length === 0) setStep(step + 1);
  }

  async function create() {
    const e = [...stepErrors(0), ...stepErrors(1)];
    if (e.length) {
      setErrors(e);
      setConfirm(false);
      return;
    }
    const err = await submit({ ...clean(f), contactNumber: toFullPhone(f.contactNumber ?? "") || undefined, numberOfVans: Number(f.numberOfVans), reportingLocations: locs });
    setConfirm(false);
    if (err) setErrors([err]);
  }

  const steps = ["Project & Dates", "Reporting & Contact", "Elements & Billing"];

  return (
    <div className="card form-card">
      <ol className="stepper">
        {steps.map((s, i) => (
          <li key={s} className={i === step ? "on" : i < step ? "done" : ""}>
            <span>{i < step ? "✓" : i + 1}</span>
            {s}
          </li>
        ))}
      </ol>

      {errors.length > 0 && (
        <div className="alert" role="alert">
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}

      {step === 0 && (
        <div className="grid">
          <Field label="Billing Name *"><input {...bind("billingName")} placeholder="Sapphire Foods (KFC)" /></Field>
          <Field label="State Code *"><input {...bind("stateCode")} placeholder="33" /></Field>
          <Field label="Number of Vans *"><input type="number" min={1} max={100} {...bind("numberOfVans")} /></Field>
          <Field label="Model / Backlit or Nonlit"><input {...bind("model")} placeholder="LED Van" /></Field>
          <Field label="Innovation Model / LED Model"><input {...bind("innovationModel")} placeholder="2 Sided LED Van" /></Field>
          <Field label="Sunday Halt"><YesNo value={f.sundayHalt} onChange={(v) => set("sundayHalt", v)} /></Field>
          <Field label="Start Date *"><input type="date" {...bind("startDate")} /></Field>
          <Field label="End Date *"><input type="date" {...bind("endDate")} /></Field>
          <Field label="Number of Days" hint={f.sundayHalt === "YES" ? "Sundays excluded" : "Sundays included"}>
            <input value={days ? `${days} day${days > 1 ? "s" : ""}` : ""} readOnly />
          </Field>
          <Field label="Reporting Date *"><input type="date" {...bind("reportingDate")} /></Field>
        </div>
      )}

      {step === 1 && (
        <div className="grid">
          <Field label="Reporting Locations *" wide><LocationPicker value={locs} onChange={setLocs} /></Field>
          <Field label="Reporting Person Name"><input {...bind("reportingPerson")} /></Field>
          <Field label="Contact Number" hint="+91 added automatically"><PhoneInput value={f.contactNumber ?? ""} onChange={(v) => set("contactNumber", v)} placeholder="75488 10034" /></Field>
          <Field label="Email"><input type="email" {...bind("email")} /></Field>
          <Field label="Address"><input {...bind("address")} /></Field>
          <Field label="KM Allotted"><input {...bind("kmAllotted")} placeholder="60 KM per day" /></Field>
          <Field label="Extra KM Allowed"><YesNo value={f.extraKmAllowed} onChange={(v) => set("extraKmAllowed", v)} /></Field>
          <Field label="Timing"><input {...bind("timing")} placeholder="8 Hours" /></Field>
        </div>
      )}

      {step === 2 && (
        <div className="grid">
          <Field label="PA System"><YesNo value={f.paSystem} onChange={(v) => set("paSystem", v)} /></Field>
          <Field label="Mike"><YesNo value={f.mike} onChange={(v) => set("mike", v)} /></Field>
          <Field label="TV"><YesNo value={f.tv} onChange={(v) => set("tv", v)} /></Field>
          <Field label="Promoter"><YesNo value={f.promoter} onChange={(v) => set("promoter", v)} /></Field>
          <Field label="Leaflet / Carry Material"><YesNo value={f.leaflet} onChange={(v) => set("leaflet", v)} /></Field>
          <Field label="Photos">
            <select {...bind("photos")}>
              <option value="REQUIRED">Required</option>
              <option value="NOT_REQUIRED">Not required</option>
            </select>
          </Field>
          <Field label="Other Elements" wide><input {...bind("otherElements")} placeholder="As per design, all required elements" /></Field>
          <Field label="Arts File Date"><input type="date" {...bind("artsFileDate")} /></Field>
          <Field label="Printing Date"><input type="date" {...bind("printingDate")} /></Field>
          <Field label="Fabrication Date"><input type="date" {...bind("fabricationDate")} /></Field>
          <Field label="Vehicle Delivery Date"><input type="date" {...bind("vehicleDeliveryDate")} /></Field>
          <Field label="Supporting Date"><input type="date" {...bind("supportingDate")} /></Field>
          <Field label="Invoice Date"><input type="date" {...bind("invoiceDate")} /></Field>
        </div>
      )}

      <div className="sticky-actions">
        <button className="btn btn-outline" disabled={step === 0} onClick={() => { setErrors([]); setStep(step - 1); }}>
          Back
        </button>
        {step < 2 ? (
          <button className="btn btn-primary" onClick={next}>Next</button>
        ) : (
          <button className="btn btn-primary" onClick={() => setConfirm(true)}>Create Trackup Numbers</button>
        )}
      </div>

      {confirm && (
        <ConfirmDialog
          title="Create tracking numbers?"
          message={`This will generate ${f.numberOfVans} unique Trackup, PIF and Display number set(s) for ${f.billingName}. Numbers cannot be regenerated afterwards.`}
          confirmLabel="Create"
          busy={busy}
          onConfirm={create}
          onCancel={() => setConfirm(false)}
        />
      )}
      {done}
    </div>
  );
}

function SignageForm() {
  const today = new Date().toISOString().slice(0, 10);
  const { f, bind, set, errors, setErrors } = useFormState({ date: today });
  const [confirm, setConfirm] = useState(false);
  const [manualDays, setManualDays] = useState(false);
  const { submit, busy, done } = useSubmit("SIGNAGE");

  const auto = f.fromDate && f.toDate ? countDays(f.fromDate, f.toDate, false) : 0;
  const totalDays = manualDays ? f.totalDaysOfWork ?? "" : auto ? String(auto) : "";

  function validate(): string[] {
    const e: string[] = [];
    if (!f.client?.trim()) e.push("Client is required");
    if (!f.jobSheetNumber?.trim()) e.push("Job sheet number is required");
    if (!f.location?.trim()) e.push("Location is required");
    const n = Number(f.numberOfVehicles);
    if (!Number.isInteger(n) || n < 1 || n > 100) e.push("Number of vehicles must be between 1 and 100");
    if (!f.fromDate || !f.toDate) e.push("From and To dates are required");
    else if (f.toDate < f.fromDate) e.push("To date cannot be before from date");
    if (f.arrivedBudget && !(Number(f.arrivedBudget) >= 0)) e.push("Arrived budget must be a valid amount");
    if (manualDays && !(Number(f.totalDaysOfWork) >= 1)) e.push("Total days must be at least 1");
    return e;
  }

  async function create() {
    const e = validate();
    setErrors(e);
    if (e.length) return setConfirm(false);
    const payload: Record<string, unknown> = { ...clean(f), numberOfVehicles: Number(f.numberOfVehicles) };
    if (f.arrivedBudget) payload.arrivedBudget = Number(f.arrivedBudget);
    if (manualDays) payload.totalDaysOfWork = Number(f.totalDaysOfWork);
    const err = await submit(payload);
    setConfirm(false);
    if (err) setErrors([err]);
  }

  return (
    <div className="card form-card">
      {errors.length > 0 && (
        <div className="alert" role="alert">
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}
      <div className="grid">
        <Field label="Date"><input type="date" {...bind("date")} /></Field>
        <Field label="Client *"><input {...bind("client")} placeholder="DALMIA" /></Field>
        <Field label="Job Sheet Number *"><input {...bind("jobSheetNumber")} placeholder="22070649" /></Field>
        <Field label="Location *"><input {...bind("location")} placeholder="RAMNAD" /></Field>
        <Field label="Number of Vehicles *"><input type="number" min={1} max={100} {...bind("numberOfVehicles")} /></Field>
        <Field label="Arrived Budget (₹)"><input type="number" min={0} {...bind("arrivedBudget")} placeholder="25000" /></Field>
        <Field label="From Date *"><input type="date" {...bind("fromDate")} /></Field>
        <Field label="To Date *"><input type="date" {...bind("toDate")} /></Field>
        <Field label="Total Days of Work" hint={manualDays ? "Manual value" : "Auto-calculated"}>
          <div className="inline">
            <input
              type="number"
              min={1}
              value={totalDays}
              readOnly={!manualDays}
              onChange={(e) => set("totalDaysOfWork", e.target.value)}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                if (!manualDays) set("totalDaysOfWork", totalDays);
                setManualDays(!manualDays);
              }}
            >
              {manualDays ? "Auto" : "Edit"}
            </button>
          </div>
        </Field>
        <Field label="Brief Work Details" wide><input {...bind("briefWorkDetails")} placeholder="Signage & Inshop Branding" /></Field>
        <Field label="Site ID / Installation Details" wide><input {...bind("siteDetails")} placeholder="Signage & Inshop Branding" /></Field>
      </div>
      <div className="sticky-actions">
        <span />
        <button className="btn btn-primary" onClick={() => setConfirm(true)}>Create Trackup Numbers</button>
      </div>
      {confirm && (
        <ConfirmDialog
          title="Create tracking numbers?"
          message={`This will generate ${f.numberOfVehicles || 0} unique Trackup, PIF and Display number set(s) for ${f.client || "this client"}. Numbers cannot be regenerated afterwards.`}
          confirmLabel="Create"
          busy={busy}
          onConfirm={create}
          onCancel={() => setConfirm(false)}
        />
      )}
      {done}
    </div>
  );
}
