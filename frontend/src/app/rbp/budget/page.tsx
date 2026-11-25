"use client";

import Select from "@/components/ui/Select";
import DateInput from "@/components/ui/DateInput";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import AppShell from "@/components/AppShell";
import CopyButton from "@/components/ui/CopyButton";
import { DecimalInput, IntInput } from "@/components/ui/Inputs";
import { ConfirmDialog, ErrorState, Skeleton } from "@/components/ui/Ui";
import { useToast } from "@/context/ToastContext";
import { useApi } from "@/hooks/useApi";
import { request } from "@/services/api";
import type { Activity, Budget, BudgetContext, BudgetEvent, BudgetVersion } from "@/types/domain";
import { ActivitySummary, ApprovalHistory, VersionHistory } from "@/components/HistorySections";
import {
  addCharge, removeCharge, updateCharge, addToll, autoDays, computeValues, draftFromData, removeToll, toPayload, updateToll, validateDraft,
  type Draft, type Unit,
} from "@/utils/budgetForm";
import RbpApprovalPanel from "@/components/RbpApprovalPanel";
import TollPlazaInput from "@/components/TollPlazaInput";
import { keepInRange, laterOf } from "@/utils/dates";
import {
  STATUS_TEXT, TOLL_VEHICLE_CLASSES, applyPlaza, rateOrigin, sourceLine, tollClassLabel, type TollJourney, type TollSourceInfo, type TollVehicleClass,
} from "@/utils/tolls";
import { canEdit, describeBudget, statusOf } from "@/utils/budgetDescribe";
import { formatDate, formatDateTime, formatInr } from "@/utils/format";

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
        {budget && !editing && canEdit(budget.approvalStatus) && (
          <button className="btn btn-primary" onClick={() => setEditing(true)}>
            Edit Budget
          </button>
        )}
      </div>

      <div className="card">
        <h3 className="sub">Project details (read-only)</h3>
        <dl className="kv">
          <KV k="Client / Billing Name" v={c.client} />
          <KV k="Project Type" v={c.projectType === "ROADSHOW" ? "Roadshow" : "Signage"} />
          <KV k="Location" v={c.location} />
          <KV k="Campaign Period" v={`${formatDate(c.campaignFrom)} → ${formatDate(c.campaignTo)}`} />
          {c.projectType === "ROADSHOW" && <KV k="Reporting Date" v={formatDate(c.reportingDate)} />}
          <KV k="Number of Days" v={String(c.numberOfDays ?? "—")} />
          {[
            ["Trackup Number", c.trackupNumber],
            ["PIF Number", c.pifNumber],
            ["Display Number", c.displayNumber],
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

      {!budget || editing ? (
        <BudgetForm
          vehicleId={vehicle}
          context={c}
          budget={budget}
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
          <RbpApprovalPanel budget={budget} onChanged={res.reload} />
          <HistorySection key={`${budget.currentVersion}-${budget.approvalStatus ?? ""}`} budget={budget} />
        </>
      )}
    </>
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
      {bad !== undefined && <small className="rej-note b-rej-note">Rejected: {bad}</small>}
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
  vehicleId, context, budget, rejected, onSaved, onCancel,
}: {
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
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false); // blocks double submits
  const v = useMemo(() => computeValues(f), [f]);

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

  async function save() {
    const e = validateDraft(f, bounds);
    setErrors(e);
    if (e.length) return setConfirm(false);
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    const body = toPayload(f);
    try {
      if (budget) await request(`/budgets/${budget._id}`, "PUT", body);
      else await request("/budgets", "POST", { vehicleId, ...body });
      toast(budget ? "Budget updated — new version saved" : "Budget created successfully");
      onSaved();
    } catch (err) {
      setErrors([(err as Error).message]);
      setConfirm(false);
      setBusy(false);
      saving.current = false;
    }
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
          <Row label="Diesel Cost" k="dieselAmount">
            <DecimalInput value={f.dieselAmount} onChange={(x) => set("dieselAmount", x)} placeholder="0.00" />
            <UnitSelect value="PER_CAMPAIGN" fixed />
            <Out value={v.dieselValue} />
          </Row>
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
          <Row label="Halt Food" k="haltFood"><DecimalInput value={f.haltFood} onChange={(x) => set("haltFood", x)} placeholder="0.00" /></Row>
        </div>

        <div className="b-col">
          <h4 className={`sub${rejected.has("tolls") ? " kv-rej-h" : ""}`}>Toll Detail{rejected.has("tolls") && <small className="rej-note"> — Rejected: {rejected.get("tolls")}</small>}</h4>
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
              {rejected.has("others") && <small className="rej-note">Rejected: {rejected.get("others")}</small>}
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
          <Row label="Up/Down Value" k="upDownValue"><DecimalInput value={f.upDownValue} onChange={(x) => set("upDownValue", x)} placeholder="0.00" /></Row>
          <Row label="Total Value"><Out value={v.totalValue} /></Row>
        </div>
      </div>
      </RejectedCtx.Provider>

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
          <button className="btn btn-primary" onClick={() => setConfirm(true)}>
            {budget ? "Save New Version" : "Save"}
          </button>
        </div>
      </div>
      {confirm && (
        <ConfirmDialog
          title={budget ? "Save changes?" : "Save budget?"}
          message={budget ? "A new version will be saved. Previous versions are kept in history." : "One budget can be created per vehicle."}
          busy={busy}
          confirmLabel="Save"
          onConfirm={save}
          onCancel={() => setConfirm(false)}
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
