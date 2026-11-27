import test from "node:test";
import assert from "node:assert/strict";
import { earlierOf, keepInRange, laterOf, todayIst } from "../src/utils/dates";
import { addToll, computeValues, draftFromData, editedTolls, emptyDraft, toPayload, updateToll, validateDraft, type Draft } from "../src/utils/budgetForm";
import { applyPlaza, canAutoFill, plazaLabel, rateOrigin, sourceLine, type TollSearchResult } from "../src/utils/tolls";
import { formatEntry } from "../src/utils/historyFormat";
import { validatePaymentEntry, finalPayload, validateFinalForm, finalFormFrom } from "../src/utils/settlement";

test("dates: dependent date kept inside the new range, cleared (never moved) outside it", () => {
  assert.equal(keepInRange("2026-12-05", "2026-12-01", "2026-12-10"), "2026-12-05");
  assert.equal(keepInRange("2026-12-01", "2026-12-01", "2026-12-10"), "2026-12-01"); // boundary
  assert.equal(keepInRange("2026-11-30", "2026-12-01", "2026-12-10"), "");
  assert.equal(keepInRange("2026-12-11", "2026-12-01", "2026-12-10"), "");
  assert.equal(keepInRange("", "2026-12-01", "2026-12-10"), "");
  assert.equal(keepInRange("2026-12-05", "", undefined), "2026-12-05");
  assert.equal(laterOf("2026-12-03", "2026-12-01", "", null), "2026-12-03");
  assert.equal(earlierOf("2026-12-03", undefined, "2026-12-01"), "2026-12-01");
  assert.equal(todayIst(new Date("2026-11-25T19:00:00Z")), "2026-11-26"); // IST, not the browser timezone
});

const ctx = { campaignFrom: "2026-12-01", campaignTo: "2026-12-10", sundayHalt: false };
const bounds = { campaignFrom: ctx.campaignFrom, campaignTo: ctx.campaignTo };

test("budget draft dates: inside the campaign, completion on/after on road, unchanged legacy values allowed", () => {
  const d = emptyDraft(ctx);
  assert.deepEqual(validateDraft(d, bounds).filter((e) => /date/i.test(e)), []);
  const e = (on: string, done: string, b = {}) => validateDraft({ ...d, onRoadDate: on, completionDate: done }, { ...bounds, ...b }).filter((x) => /date/i.test(x));
  assert.ok(e("2026-11-30", "2026-12-05").includes("On road date cannot be before the campaign start date"));
  assert.ok(e("2026-12-11", "2026-12-12").includes("On road date cannot be after the campaign end date"));
  assert.ok(e("2026-12-02", "2026-12-11").includes("Completion date cannot be after the campaign end date"));
  assert.ok(e("2026-12-05", "2026-12-04").includes("Completion date cannot be before on road date"));
  assert.deepEqual(e("2026-12-10", "2026-12-10"), []);
  assert.deepEqual(e("2026-11-29", "2026-12-10", { previous: { onRoadDate: "2026-11-29" } }), []);
  assert.ok(e("", "2026-12-04").includes("On road date is required"));
});

const result = (over: Partial<TollSearchResult> = {}, rate: Partial<TollSearchResult["rate"]> = {}): TollSearchResult => ({
  id: 1, name: "Krishnagiri", code: "1", state: "Tamil Nadu", nh: "44", location: "Krishnagiri", chainage: null, sourceType: "nhai", confidence: "complete",
  active: true, rateEffectiveDate: "2026-04-01", rateRevisionDate: "2027-03-31", lastUpdated: "2026-07-07", vehicleClass: "LCV",
  ...over, rate: { single: 135, return: 205, status: "OK", note: "", ...rate },
});
const source = { name: "India Toll Plaza dataset", url: "u", datasetUpdated: "2026-07-07", fetchedAt: "2026-11-25T00:00:00Z", stale: false };

test("toll pick: trusted rate auto-filled for the chosen journey; missing / uncertain rates are never filled", () => {
  const ok = applyPlaza(result(), "SINGLE", source);
  assert.equal(ok.rate, "135");
  assert.equal(ok.location, "Krishnagiri · NH 44 · Tamil Nadu");
  assert.equal(ok.plaza.fetchedRate, 135);
  assert.equal(ok.plaza.vehicleClass, "LCV");
  assert.equal(ok.plaza.datasetUpdated, "2026-07-07");
  assert.equal(applyPlaza(result(), "RETURN", source).rate, "205");
  const missing = applyPlaza(result({}, { single: null, return: null, status: "UNAVAILABLE" }), "SINGLE", source);
  assert.equal(missing.rate, "");
  assert.equal(missing.plaza.fetchedRate, null);
  assert.equal(missing.plaza.rateStatus, "UNAVAILABLE");
  for (const status of ["UNVERIFIED", "OUTDATED", "INACTIVE"] as const) {
    const r = applyPlaza(result({}, { status }), "SINGLE", source);
    assert.equal(r.rate, "", status); // shown as a suggestion only
    assert.equal(r.plaza.fetchedRate, 135);
    assert.equal(canAutoFill(result({}, { status }), "SINGLE"), false);
  }
  assert.equal(applyPlaza(result({}, { return: null }), "RETURN", source).rate, ""); // no return fare published
  assert.equal(plazaLabel({ name: "X", nh: null, state: null }), "X");
});

test("toll rows: origin tracked, editable, multiple rows total correctly, saved with the plaza and class", () => {
  let d: Draft = { ...emptyDraft(ctx), tollVehicleClass: "LCV" };
  d = addToll(addToll(d));
  d = updateToll(d, d.tolls[0].id, applyPlaza(result(), "SINGLE", source));
  d = updateToll(d, d.tolls[1].id, { ...applyPlaza(result({ id: 2, name: "Vaniyambadi" }, { single: 185 }), "SINGLE", source) });
  d = updateToll(d, d.tolls[1].id, { rate: "190" }); // user overrides the fetched rate
  d = updateToll(d, d.tolls[2].id, { location: "Local bridge", rate: "40" }); // manual row
  assert.deepEqual(d.tolls.map((t) => rateOrigin(t.rate, t.plaza)), ["AUTO", "AUTO_EDITED", "MANUAL"]);
  assert.equal(editedTolls(d).length, 1);
  assert.equal(computeValues(d).tollAmount, 365);
  const p = toPayload(d);
  assert.equal(p.tollVehicleClass, "LCV");
  assert.equal(p.tolls[0].plaza?.id, 1);
  assert.deepEqual(p.tolls[2], { location: "Local bridge", rate: 40 });
  assert.deepEqual(validateDraft(d, bounds), []);
  // restored for editing with the plaza link and class
  const back = draftFromData({ schemaVersion: 2, ...p, tolls: p.tolls }, ctx);
  assert.equal(back.tollVehicleClass, "LCV");
  assert.equal(back.tolls[0].plaza?.name, "Krishnagiri");
  assert.equal(back.tolls[2].plaza, null);
});

test("toll rows: missing rate asks for manual entry; class change invalidates linked rows", () => {
  let d: Draft = { ...emptyDraft(ctx), tollVehicleClass: "LCV" };
  d = updateToll(d, d.tolls[0].id, applyPlaza(result({}, { single: null, status: "UNAVAILABLE" }), "SINGLE", source));
  assert.ok(validateDraft(d, bounds).some((e) => /no published rate for this plaza, enter the rate manually/.test(e)));
  d = updateToll(d, d.tolls[0].id, { rate: "75" });
  assert.deepEqual(validateDraft(d, bounds), []);
  assert.ok(validateDraft({ ...d, tollVehicleClass: "CAR" }, bounds).some((e) => /vehicle class changed/.test(e)));
});

test("toll display: source and origin visible to reviewers; manual and legacy rows unchanged", () => {
  assert.equal(formatEntry({ location: "Salem", rate: 80 }), "Salem ₹80.00");
  assert.match(formatEntry({ location: "K", rate: 135, rateSource: "AUTO", plaza: { sourceType: "nhai", fetchedRate: 135, verified: true } }), /\(auto: NHAI rate\)/);
  assert.match(formatEntry({ location: "K", rate: 150, rateSource: "AUTO_EDITED", plaza: { sourceType: "nhai", fetchedRate: 135 } }), /edited; published ₹135/);
  assert.match(formatEntry({ location: "K", rate: 70, rateSource: "MANUAL", plaza: { sourceType: "state", fetchedRate: null } }), /manual; no published rate/);
  assert.match(sourceLine(source), /data updated 07-Jul-2026/);
  assert.match(sourceLine({ ...source, stale: true }), /could not refresh/);
  assert.equal(sourceLine(null), "");
});

test("payments: payment date not in the future nor before approval; reference date not in the future", () => {
  const f = { paymentMode: "EPAYMENT", paymentDate: "2026-11-25", bankName: "HDFC", referenceNumber: "UTR1", referenceDate: "" };
  assert.deepEqual(validatePaymentEntry(f, "2026-11-25", "2026-11-21"), {});
  assert.match(validatePaymentEntry({ ...f, paymentDate: "2026-11-26" }, "2026-11-25").paymentDate ?? "", /future/);
  assert.match(validatePaymentEntry({ ...f, paymentDate: "2026-11-20" }, "2026-11-25", "2026-11-21").paymentDate ?? "", /before the approval/);
  assert.match(validatePaymentEntry({ ...f, referenceDate: "2026-11-26" }, "2026-11-25").referenceDate ?? "", /future/);
  assert.deepEqual(validatePaymentEntry({ ...f, referenceDate: "2026-01-10" }, "2026-11-25"), {}); // older cheque date is legitimate
});

test("final settlement reporting date is read-only: never validated or sent", () => {
  const form = { ...finalFormFrom(null), reportingDate: "2026-11-30", campaignFrom: "2026-12-01", campaignTo: "2026-12-10" };
  assert.ok(!validateFinalForm(form, 10).join().includes("Reporting Date"));
  assert.equal("reportingDate" in finalPayload(form, "key"), false);
});
