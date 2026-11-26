"use client";

import Select from "@/components/ui/Select";
import DateInput from "@/components/ui/DateInput";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import AppShell from "@/components/AppShell";
import CopyButton from "@/components/ui/CopyButton";
import { ConfirmDialog, Modal } from "@/components/ui/Ui";
import { useToast } from "@/context/ToastContext";
import { request } from "@/services/api";
import type { Project, ProjectType } from "@/types/domain";
import { countDays, formatDate } from "@/utils/format";
import { earlierOf, earliestStartYmd, inYmdRange, isYmd, keepInRange, laterOf, startDateError, todayIst } from "@/utils/dates";
import { DecimalInput, PhoneInput } from "@/components/ui/Inputs";
import { isValidPhone, toFullPhone } from "@/utils/phone";
import { allowanceText, extraKmError, kmAllowance, parseKmPerDay } from "@/utils/kmAllowance";
import { projectCodeError } from "@/utils/projectCode";

type Form = Record<string, string>;
const CITIES = ["Chennai", "Madurai", "Thanjavur", "Salem", "Vellore", "Coimbatore", "Trichy", "Virudhunagar", "Tirunelveli", "Erode", "Tiruppur", "Kanyakumari", "Ramnad", "Pondicherry"];
const YN = ["YES", "NO"];
/** Elements & Billing dates (same list and labels as the server). Every one lies within the campaign start and end dates. */
const ELEMENT_DATES = [
  ["artsFileDate", "Arts File Date"], ["printingDate", "Printing Date"], ["fabricationDate", "Fabrication Date"],
  ["vehicleDeliveryDate", "Vehicle Delivery Date"], ["supportingDate", "Supporting Date"], ["invoiceDate", "Invoice Date"],
] as const;

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

/** Project Code (both project types): 8 digits. Typed characters are kept as entered so a wrong one is shown, not hidden. */
function ProjectCodeField({ bind }: { bind: { value: string; onChange: (e: { target: { value: string } }) => void } }) {
  const err = bind.value ? projectCodeError(bind.value) : null;
  return (
    <Field label="Project Code *" hint={err ?? "8 digits. Use the same code to add more vehicles to the same project."}>
      <input {...bind} inputMode="numeric" maxLength={8} placeholder="12345678" aria-label="Project Code" aria-invalid={!!err} className={err ? "is-invalid" : undefined} />
    </Field>
  );
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
    photos: "REQUIRED", startDate: todayIst(),
  });
  const [locs, setLocs] = useState<string[]>([]);
  const today = todayIst();
  const minStart = earliestStartYmd(today);
  const [dateNote, setDateNote] = useState("");
  const [elementNote, setElementNote] = useState("");
  // Campaign dates drive the Reporting Date and the Elements & Billing dates: when they change, any of those dates outside the
  // new period is cleared (never moved) and the user is told which ones to pick again.
  const setCampaign = (k: "startDate" | "endDate", v: string) => {
    const start = k === "startDate" ? v : f.startDate;
    const end = k === "endDate" ? v : f.endDate;
    set(k, v);
    const kept = keepInRange(f.reportingDate ?? "", start, end);
    const cleared = ELEMENT_DATES.filter(([key]) => f[key] && !keepInRange(f[key], start, end));
    cleared.forEach(([key]) => set(key, ""));
    const elements = cleared.map(([, label]) => label).join(", ");
    setElementNote(cleared.length ? `${elements} ${cleared.length > 1 ? "were" : "was"} cleared because ${cleared.length > 1 ? "they are" : "it is"} outside the new campaign period. Pick ${cleared.length > 1 ? "them" : "it"} again.` : "");
    if (f.reportingDate && !kept) {
      set("reportingDate", "");
      setDateNote(`Reporting date${cleared.length ? ` and ${elements}` : ""} ${cleared.length ? "were" : "was"} cleared because ${cleared.length ? "they are" : "it is"} outside the new campaign period. Pick ${cleared.length ? "them" : "it"} again.`);
    } else setDateNote(cleared.length ? `${elements} (Elements & Billing) ${cleared.length > 1 ? "were" : "was"} cleared because ${cleared.length > 1 ? "they are" : "it is"} outside the new campaign period.` : "");
  };
  const campStart = isYmd(f.startDate) ? f.startDate : undefined;
  const campEnd = isYmd(f.endDate) ? f.endDate : undefined;
  const extraYes = f.extraKmAllowed === "YES";
  const setExtraAllowed = (v: string) => {
    set("extraKmAllowed", v);
    if (v !== "YES") set("extraKmAllotted", ""); // No -> the field is hidden and the value is 0 (the server stores 0)
  };
  const [step, setStep] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const { submit, busy, done } = useSubmit("ROADSHOW");

  const days = useMemo(
    () => (f.startDate && f.endDate ? countDays(f.startDate, f.endDate, f.sundayHalt === "YES") : 0),
    [f.startDate, f.endDate, f.sundayHalt],
  );
  const allowance = kmAllowance(f.kmAllotted, days, extraYes, f.extraKmAllotted);

  function stepErrors(s: number): string[] {
    const e: string[] = [];
    if (s === 0) {
      const pc = projectCodeError(f.projectCode);
      if (pc) e.push(pc);
      if (!f.billingName?.trim()) e.push("Billing name is required");
      if (!f.stateCode?.trim()) e.push("State code is required");
      const n = Number(f.numberOfVans);
      if (!Number.isInteger(n) || n < 1 || n > 100) e.push("Number of vans must be between 1 and 100");
      if (!f.startDate || !f.endDate) e.push("Start and end dates are required");
      else if (!isYmd(f.startDate) || !isYmd(f.endDate)) e.push("Start and end dates must be valid dates");
      else {
        const se = startDateError(f.startDate, "Start date");
        if (se) e.push(se);
        if (f.endDate < f.startDate) e.push("End date cannot be before start date");
      }
      if (!f.reportingDate) e.push("Reporting date is required");
      else if (!isYmd(f.reportingDate)) e.push("Reporting date must be a valid date");
      else if (isYmd(f.startDate) && isYmd(f.endDate) && !inYmdRange(f.reportingDate, f.startDate, f.endDate))
        e.push("Reporting date must be within the campaign start and end dates");
    }
    if (s === 2) {
      // same rule as the server: every Elements & Billing date lies within the campaign start and end dates
      if (campStart && campEnd)
        for (const [k, label] of ELEMENT_DATES)
          if (f[k] && isYmd(f[k]) && !inYmdRange(f[k], campStart, campEnd)) e.push(`${label} must be within the campaign start and end dates`);
      // same order as the server: arts file -> printing -> fabrication -> vehicle delivery (supporting / invoice are free)
      const chain = ["artsFileDate", "printingDate", "fabricationDate", "vehicleDeliveryDate"] as const;
      for (let i = 1; i < chain.length; i++) {
        const prev = f[chain[i - 1]];
        const curr = f[chain[i]];
        if (prev && curr && isYmd(prev) && isYmd(curr) && curr < prev)
          e.push(`${chain[i].replace(/([A-Z])/g, " $1").toLowerCase()} cannot be before ${chain[i - 1].replace(/([A-Z])/g, " $1").toLowerCase()}`);
      }
    }
    if (s === 1) {
      if (locs.length === 0) e.push("Add at least one reporting location");
      if (f.contactNumber && !isValidPhone(f.contactNumber)) e.push("Contact number must be a valid 10-digit mobile number");
      if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) e.push("Email is invalid");
      if (extraYes) {
        const x = extraKmError(f.extraKmAllotted ?? "");
        if (x) e.push(x);
        if (parseKmPerDay(f.kmAllotted) === null) e.push("KM Allotted (KM per day) is required as a number when Extra KM Allowed is Yes");
      }
    }
    return e;
  }

  function next() {
    const e = stepErrors(step);
    setErrors(e);
    if (e.length === 0) setStep(step + 1);
  }

  async function create() {
    const e = [...stepErrors(0), ...stepErrors(1), ...stepErrors(2)];
    if (e.length) {
      setErrors(e);
      setConfirm(false);
      return;
    }
    const { extraKmAllotted, ...rest } = clean(f);
    const err = await submit({
      ...rest, contactNumber: toFullPhone(f.contactNumber ?? "") || undefined, numberOfVans: Number(f.numberOfVans), reportingLocations: locs,
      ...(extraYes ? { extraKmAllotted: Number(extraKmAllotted) } : {}), // No -> not sent; the server stores 0
    });
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
          <ProjectCodeField bind={bind("projectCode")} />
          <Field label="Billing Name *"><input {...bind("billingName")} placeholder="Sapphire Foods (KFC)" /></Field>
          <Field label="State Code *"><input {...bind("stateCode")} placeholder="33" /></Field>
          <Field label="Number of Vans *"><input type="number" min={1} max={100} {...bind("numberOfVans")} /></Field>
          <Field label="Innovation Model / LED Model"><input {...bind("innovationModel")} placeholder="2 Sided LED Van" /></Field>
          <Field label="Sunday Halt"><YesNo value={f.sundayHalt} onChange={(v) => set("sundayHalt", v)} /></Field>
          <Field label="Start Date *" hint="Today or up to 7 days back"><DateInput value={f.startDate ?? ""} min={minStart} max={earlierOf(today, f.endDate)} onChange={(e) => setCampaign("startDate", e.target.value)} aria-label="Start Date" /></Field>
          <Field label="End Date *" hint="On or after the start date"><DateInput value={f.endDate ?? ""} min={f.startDate || minStart} onChange={(e) => setCampaign("endDate", e.target.value)} aria-label="End Date" /></Field>
          <Field label="Number of Days" hint={f.sundayHalt === "YES" ? "Sundays excluded" : "Sundays included"}>
            <input value={days ? `${days} day${days > 1 ? "s" : ""}` : ""} readOnly />
          </Field>
          <Field label="Reporting Date *" hint={dateNote || "Within the campaign start and end dates"}>
            <DateInput {...bind("reportingDate")} min={f.startDate || minStart} max={f.endDate || undefined} disabled={!f.startDate || !f.endDate} aria-label="Reporting Date" />
          </Field>
        </div>
      )}

      {step === 1 && (
        <div className="grid">
          <Field label="Reporting Locations *" wide><LocationPicker value={locs} onChange={setLocs} /></Field>
          <Field label="Reporting Person Name"><input {...bind("reportingPerson")} /></Field>
          <Field label="Contact Number" hint="+91 added automatically"><PhoneInput value={f.contactNumber ?? ""} onChange={(v) => set("contactNumber", v)} placeholder="75488 10034" /></Field>
          <Field label="Email"><input type="email" {...bind("email")} /></Field>
          <Field label="Address"><input {...bind("address")} /></Field>
          <Field label={`KM Allotted${extraYes ? " *" : ""}`} hint="KM per day"><input {...bind("kmAllotted")} placeholder="60 KM per day" /></Field>
          <Field label="Extra KM Allowed"><YesNo value={f.extraKmAllowed} onChange={setExtraAllowed} /></Field>
          {extraYes && (
            <Field label="Extra KM Allotted *" hint="Extra KM per day, added to the KM Allotted per day">
              <DecimalInput value={f.extraKmAllotted ?? ""} onChange={(v) => set("extraKmAllotted", v)} placeholder="20" aria-label="Extra KM Allotted" />
            </Field>
          )}
          <Field label="Total Allowed KM / Day" hint={extraYes ? "KM Allotted + Extra KM, per day" : "KM Allotted per day"}>
            <input value={allowance.allowedKmPerDay === null ? "" : `${allowance.allowedKmPerDay} km/day`} readOnly aria-label="Total Allowed KM per day" />
          </Field>
          <Field label="Campaign Total Allowed KM" hint="Total Allowed KM / day x campaign days">
            <input value={allowance.totalAllowedKm === null ? "" : allowanceText(allowance)} readOnly aria-label="Campaign Total Allowed KM" />
          </Field>
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
            <Select {...bind("photos")}>
              <option value="REQUIRED">Required</option>
              <option value="NOT_REQUIRED">Not required</option>
            </Select>
          </Field>
          <Field label="Other Elements" wide><input {...bind("otherElements")} placeholder="As per design, all required elements" /></Field>
          <p className="field wide muted" role="status">
            Campaign dates {formatDate(campStart)} → {formatDate(campEnd)}: every date below must fall within this period.
            {elementNote && <> <strong>{elementNote}</strong></>}
          </p>
          <Field label="Arts File Date"><DateInput {...bind("artsFileDate")} min={campStart} max={earlierOf(f.printingDate, campEnd)} aria-label="Arts File Date" /></Field>
          <Field label="Printing Date"><DateInput {...bind("printingDate")} min={laterOf(f.artsFileDate, campStart)} max={earlierOf(f.fabricationDate, campEnd)} aria-label="Printing Date" /></Field>
          <Field label="Fabrication Date"><DateInput {...bind("fabricationDate")} min={laterOf(f.printingDate, campStart)} max={earlierOf(f.vehicleDeliveryDate, campEnd)} aria-label="Fabrication Date" /></Field>
          <Field label="Vehicle Delivery Date"><DateInput {...bind("vehicleDeliveryDate")} min={laterOf(f.fabricationDate, campStart)} max={campEnd} aria-label="Vehicle Delivery Date" /></Field>
          <Field label="Supporting Date"><DateInput {...bind("supportingDate")} min={campStart} max={campEnd} aria-label="Supporting Date" /></Field>
          <Field label="Invoice Date"><DateInput {...bind("invoiceDate")} min={campStart} max={campEnd} aria-label="Invoice Date" /></Field>
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
  const today = todayIst();
  const { f, bind, set, errors, setErrors } = useFormState({ date: today, fromDate: today });
  const minStart = earliestStartYmd(today);
  const [confirm, setConfirm] = useState(false);
  const [manualDays, setManualDays] = useState(false);
  const { submit, busy, done } = useSubmit("SIGNAGE");

  const auto = f.fromDate && f.toDate ? countDays(f.fromDate, f.toDate, false) : 0;
  const totalDays = manualDays ? f.totalDaysOfWork ?? "" : auto ? String(auto) : "";

  function validate(): string[] {
    const e: string[] = [];
    const pc = projectCodeError(f.projectCode);
    if (pc) e.push(pc);
    if (!f.client?.trim()) e.push("Client is required");
    if (!f.jobSheetNumber?.trim()) e.push("Job sheet number is required");
    if (!f.location?.trim()) e.push("Location is required");
    const n = Number(f.numberOfVehicles);
    if (!Number.isInteger(n) || n < 1 || n > 100) e.push("Number of vehicles must be between 1 and 100");
    if (!f.date || !isYmd(f.date)) e.push("Date must be a valid date");
    else if (f.date > todayIst()) e.push("Date cannot be in the future");
    if (!f.fromDate || !f.toDate) e.push("From and To dates are required");
    else if (!isYmd(f.fromDate) || !isYmd(f.toDate)) e.push("From and To dates must be valid dates");
    else if (f.toDate < f.fromDate) e.push("To date cannot be before from date");
    if (f.fromDate && isYmd(f.fromDate)) {
      const se = startDateError(f.fromDate, "From date");
      if (se) e.push(se);
    }
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
        <ProjectCodeField bind={bind("projectCode")} />
        <Field label="Date"><DateInput {...bind("date")} max={today} /></Field>
        <Field label="Client *"><input {...bind("client")} placeholder="DALMIA" /></Field>
        <Field label="Job Sheet Number *"><input {...bind("jobSheetNumber")} placeholder="22070649" /></Field>
        <Field label="Location *"><input {...bind("location")} placeholder="RAMNAD" /></Field>
        <Field label="Number of Vehicles *"><input type="number" min={1} max={100} {...bind("numberOfVehicles")} /></Field>
        <Field label="Arrived Budget (₹)"><input type="number" min={0} {...bind("arrivedBudget")} placeholder="25000" /></Field>
        <Field label="From Date *" hint="Today or up to 7 days back"><DateInput {...bind("fromDate")} min={minStart} max={earlierOf(today, f.toDate)} /></Field>
        <Field label="To Date *"><DateInput {...bind("toDate")} min={f.fromDate || minStart} /></Field>
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
