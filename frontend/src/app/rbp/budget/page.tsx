"use client";

import { markRejectionViewed, unviewedRejection } from "@/utils/rejectionViews";
import ReadMore from "@/components/ui/ReadMore";
import Select from "@/components/ui/Select";
import DateInput from "@/components/ui/DateInput";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createContext, Suspense, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import CopyButton from "@/components/ui/CopyButton";
import { DecimalInput, IntInput } from "@/components/ui/Inputs";
import { ConfirmDialog, ErrorState, Modal, Skeleton } from "@/components/ui/Ui";
import { useToast } from "@/context/ToastContext";
import { useApi } from "@/hooks/useApi";
import { ApiError, request } from "@/services/api";
import type { Activity, Budget, BudgetContext, BudgetEvent, BudgetVersion } from "@/types/domain";
import { ActivitySummary, ApprovalHistory, VersionHistory } from "@/components/HistorySections";
import {
  addCharge, removeCharge, updateCharge, addToll, autoDays, computeValues, haltFoodApplies, draftFromData, removeToll, toPayload, updateToll, validateDraft,
  type Draft, type Unit,
} from "@/utils/budgetForm";
import RbpApprovalPanel from "@/components/RbpApprovalPanel";
import TollPlazaInput from "@/components/TollPlazaInput";
import { keepInRange, laterOf } from "@/utils/dates";
import {
  STATUS_TEXT, TOLL_VEHICLE_CLASSES, applyPlaza, rateOrigin, sourceLine, tollClassLabel, type TollJourney, type TollSourceInfo, type TollVehicleClass,
} from "@/utils/tolls";
import { canEdit, canSelfCorrect, canSubmit, describeBudget, statusOf } from "@/utils/budgetDescribe";
import { formatDate, formatDateTime, formatInr } from "@/utils/format";
import { allowanceText, kmText } from "@/utils/kmAllowance";

export default function BudgetPage() {
  return (
    <AppShell role="RBP">
      <Suspense fallback={<Skeleton rows={6} />}>
        <BudgetView />
      </Suspense>
    </AppShell>
  );
}

function BudgetView() {
  const vehicle = useSearchParams().get("vehicle");
  const res = useApi<{ context: BudgetContext; budget: Budget | null; activity: Activity | null }>(vehicle ? `/budgets/vehicle/${vehicle}` : null);
  const [editing, setEditing] = useState(false);
  const [askReason, setAskReason] = useState(false);
  const [revisionReason, setRevisionReason] = useState("");
  // Opening the details of a rejected budget marks that rejection as viewed (a failure just leaves it counted).
  const opened = res.data?.budget;
  const openedId = opened?._id;
  const unviewed = unviewedRejection(opened);
  useEffect(() => {
    if (openedId && unviewed) markRejectionViewed(openedId, unviewed).catch(() => {});
  }, [openedId, unviewed]);

  if (!vehicle) return <ErrorState message="No vehicle selected." />;
  if (res.loading) return <Skeleton rows={8} />;
  if (res.error || !res.data) return <ErrorState message={res.error ?? "Not found"} onRetry={res.reload} />;
  const { context: c, budget, activity } = res.data;

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/rbp" className="back">← Back to projects</Link>
          <h1>{budget ? "Budget" : "Create Budget"}</h1>
          <p className="muted">
            {c.client} · Vehicle {c.vehicleIndex}
          </p>
        </div>
        {budget && !editing && (canEdit(budget.approvalStatus) || canSelfCorrect(budget)) && (
          <button className="btn btn-primary" onClick={() => (canSelfCorrect(budget) ? setAskReason(true) : setEditing(true))}>
            {statusOf(budget.approvalStatus) === "REJECTED" ? "Edit & Resubmit" : "Edit Budget"}
          </button>
        )}
      </div>

      <div className="card">
        <h3 className="sub">Project details (read-only)</h3>
        <dl className="kv">
          <KV k="Client / Billing Name" v={c.client} />
          <KV k="Project Type" v={c.projectType === "ROADSHOW" ? "Roadshow" : "Signage"} />
          {c.vehicleType && <KV k="Vehicle Type" v={c.vehicleType} />}
          <KV k="Location" v={c.location} />
          <KV k="Campaign Period" v={`${formatDate(c.campaignFrom)} → ${formatDate(c.campaignTo)}`} />
          {c.projectType === "ROADSHOW" && <KV k="Reporting Date" v={formatDate(c.reportingDate)} />}
          <KV k="Number of Days" v={String(c.numberOfDays ?? "—")} />
          {c.km && (
            <>
              <KV k="Regular KM / Day" v={c.km.kmPerDay === null ? "" : kmText(c.km.kmPerDay)} />
              <KV k="Extra KM / Day" v={c.km.extraKmAllowed ? kmText(c.km.extraKmAllotted) : "Not allowed"} />
              <KV k="Total Allowed KM / Day" v={c.km.allowedKmPerDay === null ? "" : kmText(c.km.allowedKmPerDay)} />
              <KV k="Campaign Total Allowed KM" v={c.km.totalAllowedKm === null ? "" : allowanceText(c.km)} />
            </>
          )}
          {[
            ["Trackup Number", c.trackupNumber],
            ["PIF Number", c.pifNumber],
          ].map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className="num">
                {v}
                <CopyButton value={v} label={k} />
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* RSOM's reason and requested changes stay in view while RBP corrects a rejected budget. */}
      {budget && editing && statusOf(budget.approvalStatus) === "REJECTED" && <RbpApprovalPanel budget={budget} />}

      {!budget || (editing && (canEdit(budget.approvalStatus) || canSelfCorrect(budget))) ? (
        <BudgetForm
          vehicleId={vehicle}
          context={c}
          budget={budget}
          revisionReason={revisionReason}
          rejected={rejectedMap(budget)}
          onCancel={budget ? () => setEditing(false) : undefined}
          onSaved={() => {
            setEditing(false);
            res.reload();
          }}
        />
      ) : (
        <>
          <BudgetSummary budget={budget} activity={activity} rejected={rejectedMap(budget)} />
          <RbpApprovalPanel budget={budget} />
          <HistorySection key={`${budget.currentVersion}-${budget.approvalStatus ?? ""}`} budget={budget} />
        </>
      )}
      {askReason && (
        <RevisionReasonModal
          version={budget!.currentVersion}
          onClose={() => setAskReason(false)}
          onConfirm={(reason) => {
            setRevisionReason(reason);
            setAskReason(false);
            setEditing(true);
          }}
        />
      )}
    </>
  );
}

/** Mandatory before a submitted budget can be corrected ahead of RSOM review; the reason is saved with the new version and shown to RSOM. */
function RevisionReasonModal({ version, onClose, onConfirm }: { version: number; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  return (
    <Modal title={`Edit submitted budget · V${version}`} onClose={onClose}>
      {error && <div className="alert" role="alert">{error}</div>}
      <label className="field">
        <span>Reason for revision *</span>
        <textarea rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What are you correcting?" />
      </label>
      <div className="actions-row">
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => (reason.trim() ? onConfirm(reason.trim()) : setError("Enter the reason for revision"))}>Continue to Edit</button>
      </div>
    </Modal>
  );
}

/** Fields RSOM flagged on the current rejection (only while the budget is rejected). */
function rejectedMap(b: Budget | null): Map<string, string> {
  if (!b || statusOf(b.approvalStatus) !== "REJECTED" || !b.rejection) return new Map();
  return new Map(b.rejection.fields.map((f) => [f.field, f.comment]));
}
const RejectedCtx = createContext<Map<string, string>>(new Map());

const KV = ({ k, v }: { k: string; v: string }) => (
  <div>
    <dt>{k}</dt>
    <dd>{v || "—"}</dd>
  </div>
);

function BudgetSummary({ budget, activity, rejected }: { budget: Budget; activity: Activity | null; rejected: Map<string, string> }) {
  return (
    <div className="card">
      <div className="page-head tight">
        <div>
          <h3 className="sub">{budget.budgetNumber}</h3>
          <p className="muted">
            Version V{budget.currentVersion} · Created {formatDateTime(budget.createdAt)} by {budget.createdBy} · Last updated{" "}
            {formatDateTime(budget.updatedAt)} by {budget.updatedBy}
          </p>
        </div>
        <div className="total">
          <small>Total Value</small>
          <strong>{formatInr(budget.total)}</strong>
        </div>
      </div>
      <ActivitySummary activity={activity} role="RBP" />
      {budget.data.schemaVersion !== 2 && <p className="muted">This budget was created with the earlier form layout. Editing it will save a new version in the current layout.</p>}
      <dl className="kv">
        {describeBudget(budget.data).map((d) => (
          <div key={d.label} className={d.key && rejected.has(d.key) ? "kv-rej" : ""}>
            <dt>{d.label}</dt>
            <dd>{d.value || "—"}</dd>
            {d.key && rejected.has(d.key) && <small className="rej-note">Rejected: {rejected.get(d.key)}</small>}
          </div>
        ))}
      </dl>
    </div>
  );
}

// ---------- form (follows the reference screenshot) ----------
const Row = ({ label, k, children }: { label: string; k?: string; children: ReactNode }) => {
  const rej = useContext(RejectedCtx);
  const bad = k ? rej.get(k) : undefined;
  return (
    <div className={`b-row${bad !== undefined ? " b-rej" : ""}`}>
      <label>{label}</label>
      <div className="b-ctl">{children}</div>
      {bad !== undefined && <small className="rej-note b-rej-note"><ReadMore>Rejected: {bad}</ReadMore></small>}
    </div>
  );
};

function UnitSelect({ value, onChange, fixed }: { value: Unit; onChange?: (u: Unit) => void; fixed?: boolean }) {
  return (
    <Select value={value} disabled={fixed} onChange={(e) => onChange?.(e.target.value as Unit)} aria-label="Unit">
      <option value="PER_DAY">Per Day</option>
      <option value="PER_CAMPAIGN">Per Campaign</option>
    </Select>
  );
}

const Out = ({ value }: { value: number }) => <input className="num-input out" readOnly value={value.toFixed(2)} aria-label="Calculated value" />;

function BudgetForm({
  vehicleId, context, budget, revisionReason, rejected, onSaved, onCancel,
}: {
  revisionReason: string;
  rejected: Map<string, string>;
  vehicleId: string;
  context: BudgetContext;
  budget: Budget | null;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const toast = useToast();
  const [f, setF] = useState<Draft>(() => draftFromData(budget?.data, { campaignFrom: context.campaignFrom, campaignTo: context.campaignTo, sundayHalt: context.sundayHalt }));
  const [daysManual, setDaysManual] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  /** Which action the confirm dialog is for: SAVE keeps a draft, SUBMIT saves and sends the version to RSOM. */
  const [confirm, setConfirm] = useState<"SAVE" | "SUBMIT" | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false); // blocks double submits
  const status = budget ? statusOf(budget.approvalStatus) : "DRAFT";
  const resubmit = status === "REJECTED";
  const correcting = status === "PENDING"; // self-correction: saving resubmits at once
  const v = useMemo(() => computeValues(f), [f]);
  // Budget KM estimate against the campaign allowance (KM / day x days + the one-time Extra KM pool). Shown only; no money effect.
  const estimatedKm = Math.round((Number(f.estimatedKmPerDay) || 0) * (Number(f.numberOfDays) || 0) * 100) / 100;

  const set = <K extends keyof Draft>(k: K, val: Draft[K]) => setF((s) => ({ ...s, [k]: val }));
  const [dateNote, setDateNote] = useState("");
  // Both dates stay inside the campaign period. Changing the On Road Date clears a Completion Date that no longer fits (never moves it).
  // Dates / Sunday halt re-calculate days unless the user typed a manual value.
  const setSchedule = (patch: Partial<Pick<Draft, "onRoadDate" | "completionDate" | "sundayHalt">>) => {
    if (patch.onRoadDate !== undefined && f.completionDate) {
      const kept = keepInRange(f.completionDate, patch.onRoadDate || context.campaignFrom, context.campaignTo);
      setDateNote(kept ? "" : "Completion date was cleared because it is before the new on road date. Pick it again.");
      if (!kept) patch = { ...patch, completionDate: "" };
    } else if (patch.completionDate !== undefined) setDateNote("");
    setF((s) => {
      const n = { ...s, ...patch };
      return daysManual ? n : { ...n, numberOfDays: autoDays(n.onRoadDate, n.completionDate, n.sundayHalt) };
    });
  };
  const bounds = { campaignFrom: context.campaignFrom, campaignTo: context.campaignTo, previous: budget?.data as Record<string, unknown> | undefined };

  // ---- toll lookup
  const [journey, setJourney] = useState<TollJourney>(() => (f.tolls.find((t) => t.plaza)?.plaza?.journey === "RETURN" ? "RETURN" : "SINGLE"));
  const [tollSource, setTollSource] = useState<TollSourceInfo | null>(null);
  const [tollNote, setTollNote] = useState("");
  const onSource = useCallback((src: TollSourceInfo | null) => setTollSource(src), []);
  const savedSource = f.tolls.find((t) => t.plaza)?.plaza;
  /** Class / journey decide the rate: rows picked for the old choice lose their plaza link, and untouched fetched rates are cleared. */
  const changeTollBasis = (cls: TollVehicleClass | "", j: TollJourney) => {
    const linked = f.tolls.filter((t) => t.plaza).length;
    setJourney(j);
    setTollNote(linked ? `${linked} toll plaza row(s) were unlinked because the vehicle class or journey changed. Search the plaza again to fetch the new rate.` : "");
    setF((s) => ({
      ...s,
      tollVehicleClass: cls,
      tolls: s.tolls.map((t) => (t.plaza ? { ...t, plaza: null, rate: rateOrigin(t.rate, t.plaza) === "AUTO" ? "" : t.rate } : t)),
    }));
  };

  const places = useMemo(() => {
    const base = ["Chennai", "Madurai", "Coimbatore", "Salem", "Trichy", "Vellore", "Hosur", "Thanjavur", "Tirunelveli"];
    const fromCtx = context.location.split(",").map((x) => x.trim()).filter(Boolean);
    return Array.from(new Set([...fromCtx, ...base]));
  }, [context.location]);

  /**
   * Save keeps the budget as a draft (first save creates V1, later saves a new version). Save & Submit saves the same way and
   * then submits that version to RSOM: a first submission for a draft, a resubmission after a rejection. When nothing changed
   * since the last saved version, Save & Submit sends that saved version as it is (the server still refuses an unrevised
   * rejected version).
   */
  async function save(mode: "SAVE" | "SUBMIT") {
    const e = validateDraft(f, bounds);
    setErrors(e);
    if (e.length) return setConfirm(null);
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    const body = { ...toPayload(f), ...(correcting ? { selfCorrection: true, revisionReason } : {}) };
    let id = budget?._id ?? "";
    let saved = false;
    const fail = (msg: string) => {
      setErrors([msg]);
      setConfirm(null);
      setBusy(false);
      saving.current = false;
    };
    try {
      if (budget) {
        try {
          await request(`/budgets/${budget._id}`, "PUT", body);
          saved = true;
        } catch (err) {
          const unchanged = err instanceof ApiError && err.status === 400 && /no changes to save/i.test(err.message);
          if (!(mode === "SUBMIT" && unchanged && canSubmit(status, budget.currentVersion, budget.rejectedVersion))) throw err;
        }
      } else {
        const r = await request<{ budget: { _id: string } }>("/budgets", "POST", { vehicleId, ...body });
        id = r.budget._id;
        saved = true;
      }
    } catch (err) {
      return fail((err as Error).message);
    }
    if (correcting) toast("Revised budget resubmitted to RSOM");
    else if (mode === "SUBMIT") {
      try {
        await request(`/budgets/${id}/submit`, "POST", { comment });
      } catch (err) {
        if (!saved) return fail((err as Error).message);
        // the new version is kept as a draft; show why it was not sent
        toast(`Budget saved as a draft, but it was not submitted: ${(err as Error).message}`);
        return onSaved();
      }
      toast(resubmit ? "Revised budget saved and resubmitted to RSOM" : "Budget saved and submitted to RSOM for approval");
    } else toast(budget ? "Budget updated — new version saved as draft" : "Budget saved as draft");
    onSaved();
  }

  return (
    <div className="card form-card fade-in">
      <div className="b-head">
        {context.jobSheetNumber && <div>JobSheet No: <strong>{context.jobSheetNumber}</strong></div>}
        {context.paSystem && <div>PA System: <strong>{context.paSystem === "YES" ? "Yes" : "No"}</strong></div>}
        <div>Report Location: <strong>{context.location || "—"}</strong></div>
      </div>
      <h3 className="sub">{budget ? `Edit budget (will save as V${budget.currentVersion + 1})` : "Budget"}</h3>
      {errors.length > 0 && (
        <div className="alert" role="alert">
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}

      <RejectedCtx.Provider value={rejected}>
      <div className="b-cols">
        <div className="b-col">
          <Row label="Mileage" k="mileage"><DecimalInput value={f.mileage} onChange={(x) => set("mileage", x)} placeholder="0" /></Row>
          <Row label="Estimated KM per day" k="estimatedKmPerDay"><DecimalInput value={f.estimatedKmPerDay} onChange={(x) => set("estimatedKmPerDay", x)} placeholder="0" /></Row>
          <Row label="On Road Date" k="onRoadDate">
            <DateInput value={f.onRoadDate} min={context.campaignFrom || undefined} max={context.campaignTo || undefined} onChange={(e) => setSchedule({ onRoadDate: e.target.value })} aria-label="On Road Date" />
          </Row>
          <Row label="Completion Date" k="completionDate">
            <DateInput value={f.completionDate} min={laterOf(f.onRoadDate, context.campaignFrom)} max={context.campaignTo || undefined} onChange={(e) => setSchedule({ completionDate: e.target.value })} aria-label="Completion Date" />
            <label className="check">
              <input type="checkbox" checked={f.sundayHalt} onChange={(e) => setSchedule({ sundayHalt: e.target.checked })} /> Sunday Halt
            </label>
          </Row>
          <p className="muted b-date-hint">
            Campaign period {formatDate(context.campaignFrom)} → {formatDate(context.campaignTo)}.{" "}
            {dateNote && <strong className="toll-warn" role="status">{dateNote}</strong>}
          </p>
          <Row label="Number of days" k="numberOfDays">
            <IntInput value={f.numberOfDays} onChange={(x) => { setDaysManual(true); set("numberOfDays", x); }} />
          </Row>
          {context.km && context.km.totalAllowedKm !== null && (
            <p className={`muted b-date-hint${estimatedKm > context.km.totalAllowedKm ? " toll-warn" : ""}`} role="status">
              Estimated KM {kmText(estimatedKm)} (KM per day x days) · Total Allowed KM {allowanceText(context.km)}
              {estimatedKm > context.km.totalAllowedKm && ` · exceeds the allowance by ${kmText(Math.round((estimatedKm - context.km.totalAllowedKm) * 100) / 100)}`}
            </p>
          )}
          <Row label="Fuel Rate (₹/litre)" k="fuelRate"><DecimalInput value={f.fuelRate} onChange={(x) => set("fuelRate", x)} placeholder="0.00" aria-label="Fuel Rate per litre" /></Row>
          <Row label="Daily Fuel Cost"><Out value={v.dailyFuelCost} /></Row>
          <Row label="Fuel Cost (campaign)" k="dieselAmount"><Out value={v.dieselValue} /></Row>
          <p className="muted b-date-hint">Daily = Estimated KM per day ÷ Mileage × Fuel Rate (₹/litre). Campaign = Daily × Number of days.</p>
          <Row label="Salary" k="salaryAmount">
            <DecimalInput value={f.salaryAmount} onChange={(x) => set("salaryAmount", x)} placeholder="0.00" />
            <UnitSelect value={f.salaryUnit} onChange={(u) => set("salaryUnit", u)} />
            <Out value={v.salaryValue} />
          </Row>
          <Row label="Food" k="foodAmount">
            <DecimalInput value={f.foodAmount} onChange={(x) => set("foodAmount", x)} placeholder="0.00" />
            <UnitSelect value={f.foodUnit} onChange={(u) => set("foodUnit", u)} />
            <Out value={v.foodValue} />
          </Row>
          {haltFoodApplies(f) && <Row label="Halt Food" k="haltFood"><DecimalInput value={f.haltFood} onChange={(x) => set("haltFood", x)} placeholder="0.00" /></Row>}
        </div>

        <div className="b-col">
          <h4 className={`sub${rejected.has("tolls") ? " kv-rej-h" : ""}`}>Toll Detail{rejected.has("tolls") && <small className="rej-note"><ReadMore>Rejected: {rejected.get("tolls")}</ReadMore></small>}</h4>
          <div className="toll-basis">
            <label>
              <span>Toll vehicle class</span>
              <Select value={f.tollVehicleClass} onChange={(e) => changeTollBasis(e.target.value as TollVehicleClass | "", journey)} aria-label="Toll vehicle class">
                <option value="">Choose class (needed for rate lookup)</option>
                {TOLL_VEHICLE_CLASSES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </Select>
            </label>
            <label>
              <span>Journey</span>
              <Select value={journey} onChange={(e) => changeTollBasis(f.tollVehicleClass, e.target.value as TollJourney)} aria-label="Toll journey">
                <option value="SINGLE">Single journey</option>
                <option value="RETURN">Return within 24 hours</option>
              </Select>
            </label>
            <small className="muted">
              {f.tollVehicleClass
                ? TOLL_VEHICLE_CLASSES.find((c) => c.key === f.tollVehicleClass)?.hint
                : "Pick the NHAI fee class of the vehicle that will run this campaign. Most branded vans are LCV; 2-axle trucks above the LCV range are Bus / Truck."}
            </small>
          </div>
          {tollNote && <p className="toll-warn" role="status">{tollNote}</p>}
          <div className="toll">
            <div className="toll-head"><span>Location</span><span>Rate</span><span /></div>
            {f.tolls.map((t, i) => {
              const origin = rateOrigin(t.rate, t.plaza);
              const suggested = t.plaza && t.plaza.fetchedRate !== null && t.rate === "" ? t.plaza.fetchedRate : null;
              return (
                <div key={t.id} className="toll-row fade-in">
                  <TollPlazaInput
                    value={t.location}
                    index={i}
                    vehicleClass={f.tollVehicleClass}
                    journey={journey}
                    onSource={onSource}
                    onType={(location) => setF((s) => updateToll(s, t.id, { location, plaza: null }))}
                    onPick={(r, src) => setF((s) => updateToll(s, t.id, applyPlaza(r, journey, src)))}
                  />
                  <DecimalInput value={t.rate} placeholder="0.00" aria-label={`Toll rate ${i + 1}`} onChange={(x) => setF((s) => updateToll(s, t.id, { rate: x }))} />
                  <button type="button" className="icon-btn rm" onClick={() => setF((s) => removeToll(s, t.id))} aria-label={`Remove toll entry ${i + 1}`}>
                    ×
                  </button>
                  {t.plaza && (
                    <small className={`toll-origin${origin === "AUTO" && t.plaza.rateStatus === "OK" ? "" : " toll-warn"}`}>
                      {origin === "AUTO" && `Auto-filled: ${tollClassLabel(t.plaza.vehicleClass)}, ${t.plaza.journey === "RETURN" ? "return" : "single"} journey`}
                      {origin === "AUTO_EDITED" && suggested === null && `Edited manually (published rate ${formatInr(t.plaza.fetchedRate)})`}
                      {origin === "AUTO_EDITED" && suggested !== null && "Rate not filled automatically"}
                      {origin === "MANUAL" && "No published rate for this class: enter the rate manually"}
                      {t.plaza.rateStatus !== "OK" && t.plaza.rateStatus !== "UNAVAILABLE" && ` · ${STATUS_TEXT[t.plaza.rateStatus] ?? t.plaza.rateStatus}`}
                      {suggested !== null && (
                        <>
                          {" · "}
                          <button type="button" className="ui-cal-link" onClick={() => setF((s) => updateToll(s, t.id, { rate: String(suggested) }))}>
                            Use {formatInr(suggested)} after verifying
                          </button>
                        </>
                      )}
                    </small>
                  )}
                </div>
              );
            })}
          </div>
          <div className="toll-actions">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setF(addToll)}>+ Add Location</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setF(addToll)}>+ Add Rate</button>
            <span className="muted">Each row keeps its Location and Rate together. Fetched rates can be edited; edits are shown to the approver.</span>
          </div>
          {(tollSource || savedSource) && (
            <p className="muted toll-source">
              {tollSource
                ? sourceLine(tollSource)
                : `Source: ${savedSource!.source}${savedSource!.datasetUpdated ? ` · data updated ${formatDate(savedSource!.datasetUpdated)}` : ""}`}
            </p>
          )}

          <Row label="Toll Amount" k="tolls"><Out value={v.tollAmount} /></Row>
          <div className={`b-row b-row-top${rejected.has("others") ? " b-rej" : ""}`}>
            <label>Others</label>
            <div className="others-list">
              {f.others.map((c, i) => (
                <div key={c.id} className="others-row fade-in">
                  <input value={c.description} maxLength={120} placeholder="Description" aria-label={`Others description ${i + 1}`} onChange={(e) => setF((st) => updateCharge(st, c.id, { description: e.target.value }))} />
                  <DecimalInput value={c.amount} placeholder="0.00" aria-label={`Others amount ${i + 1}`} onChange={(x) => setF((st) => updateCharge(st, c.id, { amount: x }))} />
                  <button type="button" className="icon-btn rm" onClick={() => setF((st) => removeCharge(st, c.id))} aria-label={`Remove others entry ${i + 1}`}>
                    ×
                  </button>
                </div>
              ))}
              {rejected.has("others") && <small className="rej-note"><ReadMore>Rejected: {rejected.get("others")}</ReadMore></small>}
              <div>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setF(addCharge)}>+ Add Others</button>
              </div>
            </div>
          </div>
          <Row label="From" k="fromLocation">
            <input list="places" value={f.fromLocation} maxLength={120} onChange={(e) => set("fromLocation", e.target.value)} placeholder="Select or type" />
          </Row>
          <Row label="To" k="toLocation">
            <input list="places" value={f.toLocation} maxLength={120} onChange={(e) => set("toLocation", e.target.value)} placeholder="Select or type" />
          </Row>
          <datalist id="places">
            {places.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <Row label="Total Km" k="totalKm"><DecimalInput value={f.totalKm} onChange={(x) => set("totalKm", x)} placeholder="0.00" /></Row>
          <Row label="Up/Down Value" k="upDownValue"><Out value={v.upDownValue} /></Row>
          <p className="muted b-date-hint">Up/Down = Total KM ÷ Mileage × Fuel Rate + Toll Amount (calculated automatically).</p>
          <Row label="Total Value"><Out value={v.totalValue} /></Row>
        </div>
      </div>
      </RejectedCtx.Provider>

      {!correcting && (
        <label className="field comment-field">
          <span>{resubmit ? "Resubmission comment for RSOM (optional, sent with Save & Submit)" : "Comment for RSOM (optional, sent with Save & Submit)"}</span>
          <textarea rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What did you change or what should RSOM know?" />
        </label>
      )}

      <div className="sticky-actions">
        <div className="total">
          <small>Total Value</small>
          <strong>{formatInr(v.totalValue)}</strong>
        </div>
        <div className="inline">
          {onCancel && (
            <button className="btn btn-outline" onClick={onCancel}>
              Close
            </button>
          )}
          {!correcting && (
            <button className="btn btn-outline" onClick={() => setConfirm("SAVE")} disabled={busy}>
              Save
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setConfirm("SUBMIT")} disabled={busy}>
            {correcting ? "Resubmit to RSOM" : <>Save &amp; Submit for Approval</>}
          </button>
        </div>
      </div>
      {confirm === "SAVE" && (
        <ConfirmDialog
          title={budget ? "Save changes?" : "Save budget?"}
          message={budget ? "A new version will be saved as a draft. Previous versions are kept in history." : "The budget is saved as a draft. One budget can be created per vehicle."}
          busy={busy}
          confirmLabel="Save"
          onConfirm={() => save("SAVE")}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "SUBMIT" && (
        <ConfirmDialog
          title={resubmit || correcting ? "Save and resubmit to RSOM?" : "Save and submit for approval?"}
          message={`${budget ? "Any changes are saved as a new version" : "The budget is saved"}, and that version is sent to RSOM. ${correcting ? "It cannot be edited again while RSOM reviews it." : "While it waits, you can correct it once, before RSOM reviews it."}`}
          busy={busy}
          confirmLabel={resubmit || correcting ? "Save & Resubmit" : "Save & Submit"}
          onConfirm={() => save("SUBMIT")}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

function HistorySection({ budget }: { budget: Budget }) {
  // Latest first, straight from the server (order=desc); the components re-sort by timestamp as a safety net.
  const versions = useApi<BudgetVersion[]>(`/budgets/${budget._id}/versions?order=desc`);
  const events = useApi<BudgetEvent[]>(`/budgets/${budget._id}/events?order=desc`);
  const failed = versions.error ?? events.error;
  return (
    <>
      <div className="card">
        <h3 className="sub">Budget version history</h3>
        {versions.loading || events.loading ? (
          <Skeleton rows={3} />
        ) : failed || !versions.data || !events.data ? (
          <ErrorState message={failed ?? "Failed"} onRetry={() => { versions.reload(); events.reload(); }} />
        ) : (
          <VersionHistory versions={versions.data} events={events.data} currentVersion={budget.currentVersion} />
        )}
      </div>
      <div className="card">
        <h3 className="sub">Approval history</h3>
        {events.loading ? <Skeleton rows={3} /> : events.error || !events.data ? <ErrorState message={events.error ?? "Failed"} onRetry={events.reload} /> : <ApprovalHistory events={events.data} />}
      </div>
    </>
  );
}
