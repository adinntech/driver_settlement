import test from "node:test";
import assert from "node:assert/strict";
import {
  addToll, autoDays, computeValues, draftFromData, emptyDraft, filledTolls, removeToll, sanitizeDecimal,
  sanitizeInt, toPayload, updateToll, validateDraft,
} from "../src/utils/budgetForm";
import { addCharge, filledCharges, removeCharge, updateCharge } from "../src/utils/budgetForm";
import { fromStoredPhone, isValidPhone, sanitizePhoneInput, toFullPhone } from "../src/utils/phone";

const ctx = { campaignFrom: "2026-10-22", campaignTo: "2026-10-23", sundayHalt: false };

test("empty draft prefills dates, sunday halt and days from the RSOP data", () => {
  const d = emptyDraft(ctx);
  assert.equal(d.onRoadDate, "2026-10-22");
  assert.equal(d.completionDate, "2026-10-23");
  assert.equal(d.numberOfDays, "2");
  assert.equal(d.tolls.length, 1);
  assert.equal(autoDays("2026-10-24", "2026-10-26", true), "2"); // Sunday excluded
});

test("toll rows: add several, update independently, remove one, never lose the others", () => {
  let d = emptyDraft(ctx);
  d = addToll(addToll(d));
  assert.equal(d.tolls.length, 3);
  d = updateToll(d, d.tolls[0].id, { location: "Salem", rate: "120" });
  d = updateToll(d, d.tolls[1].id, { location: "Madurai", rate: "80.5" });
  d = updateToll(d, d.tolls[0].id, { rate: "125" }); // editing one field keeps the other
  assert.deepEqual(d.tolls.map((t) => [t.location, t.rate]), [["Salem", "125"], ["Madurai", "80.5"], ["", ""]]);
  d = removeToll(d, d.tolls[1].id);
  assert.deepEqual(d.tolls.map((t) => t.location), ["Salem", ""]);
  assert.equal(filledTolls(d).length, 1); // empty row is ignored
  d = removeToll(removeToll(d, d.tolls[0].id), d.tolls[0].id);
  assert.equal(d.tolls.length, 1); // always keeps one blank row
});

test("payload keeps every entry in order and drops empty rows", () => {
  let d = emptyDraft(ctx);
  d = addToll(addToll(d));
  d = updateToll(d, d.tolls[0].id, { location: " A ", rate: "10" });
  d = updateToll(d, d.tolls[2].id, { location: "C", rate: "30.25" });
  assert.deepEqual(toPayload(d).tolls, [{ location: "A", rate: 10 }, { location: "C", rate: 30.25 }]);
});

test("edit restores all saved entries (round trip); legacy records fall back to a fresh form", () => {
  let d = emptyDraft(ctx);
  d = addToll(d);
  d = updateToll(d, d.tolls[0].id, { location: "Salem", rate: "120" });
  d = updateToll(d, d.tolls[1].id, { location: "Madurai", rate: "80.5" });
  d = { ...d, sundayHalt: true, haltFood: "200", fuelRate: "95.5", fromLocation: "Chennai", salaryUnit: "PER_CAMPAIGN" };
  const back = draftFromData({ ...toPayload(d), schemaVersion: 2 }, ctx);
  assert.deepEqual(back.tolls.map((t) => [t.location, t.rate]), [["Salem", "120"], ["Madurai", "80.5"]]);
  assert.equal(back.haltFood, "200");
  assert.equal(back.fuelRate, "95.5");
  assert.equal(back.salaryUnit, "PER_CAMPAIGN");
  assert.equal(back.fromLocation, "Chennai");
  assert.deepEqual(toPayload(back), toPayload(d));
  const legacy = draftFromData({ permitCharges: 500 }, ctx);
  assert.equal(legacy.onRoadDate, "2026-10-22");
  assert.equal(legacy.tolls.length, 1);
});

test("calculation mirrors the backend", () => {
  let d = emptyDraft(ctx);
  d = { ...d, sundayHalt: true, dieselAmount: "5000", salaryAmount: "800", foodAmount: "300", haltFood: "200", mileage: "10", totalKm: "100", fuelRate: "95" };
  d = updateCharge(d, d.others[0].id, { description: "Parking", amount: "100" });
  d = updateToll(d, d.tolls[0].id, { location: "Salem", rate: "120" });
  d = addToll(d);
  d = updateToll(d, d.tolls[1].id, { location: "Madurai", rate: "80.5" });
  // Up/Down = 100 km / 10 km per litre x Rs 95 + tolls 200.5 = 1150.5
  assert.deepEqual(computeValues(d), { dieselValue: 5000, salaryValue: 1600, foodValue: 600, tollAmount: 200.5, upDownValue: 1150.5, totalValue: 8851 });
  assert.equal(computeValues({ ...d, salaryUnit: "PER_CAMPAIGN" }).salaryValue, 800);
});

test("Up/Down recalculates from Total KM, Mileage, Fuel Rate and tolls; never typed", () => {
  let d = { ...emptyDraft(ctx), mileage: "8", totalKm: "1000", fuelRate: "100" };
  assert.equal(computeValues(d).upDownValue, 12500); // 1000 / 8 x 100, no tolls
  d = updateToll(d, d.tolls[0].id, { location: "Salem", rate: "150.25" });
  assert.equal(computeValues(d).upDownValue, 12650.25);
  assert.equal(computeValues({ ...d, fuelRate: "90" }).upDownValue, 11400.25);
  assert.equal(computeValues({ ...d, upDownValue: "99999" }).upDownValue, 12650.25); // a stale saved value is ignored
  assert.equal(computeValues({ ...d, mileage: "" }).upDownValue, 150.25); // no mileage: fuel part is 0
  assert.ok(validateDraft({ ...d, mileage: "" }).includes("Mileage is required to calculate the Up/Down value"));
  assert.equal(toPayload(d).upDownValue, 12650.25);
});

test("Halt Food counts only with Sunday Halt; without it it is not validated, saved or added", () => {
  const base = { ...emptyDraft(ctx), haltFood: "500" };
  assert.equal(computeValues({ ...base, sundayHalt: true }).totalValue, 500);
  assert.equal(computeValues({ ...base, sundayHalt: false }).totalValue, 0);
  assert.equal(toPayload({ ...base, sundayHalt: false }).haltFood, 0);
  assert.equal(toPayload({ ...base, sundayHalt: true }).haltFood, 500);
  assert.ok(!validateDraft({ ...base, sundayHalt: false, haltFood: "abc" }).some((e) => /Halt food/.test(e)));
});

test("numeric sanitizers block letters, minus, exponent and extra decimals", () => {
  assert.equal(sanitizeDecimal("12a.3b4c5"), "12.34");
  assert.equal(sanitizeDecimal("-5"), "5");
  assert.equal(sanitizeDecimal("1e5"), "15");
  assert.equal(sanitizeDecimal("1.2.3"), "1.23");
  assert.equal(sanitizeInt("1.5x"), "15");
});

test("draft validation: required dates/days, invalid rates, half-filled toll rows", () => {
  const ok = emptyDraft(ctx);
  assert.deepEqual(validateDraft(ok), []);
  assert.ok(validateDraft({ ...ok, onRoadDate: "" }).length > 0);
  assert.ok(validateDraft({ ...ok, completionDate: "2026-10-01" }).some((e) => /before/.test(e)));
  assert.ok(validateDraft({ ...ok, numberOfDays: "0" }).length > 0);
  assert.ok(validateDraft(updateToll(ok, ok.tolls[0].id, { location: "A" })).some((e) => /rate/.test(e)));
  assert.ok(validateDraft(updateToll(ok, ok.tolls[0].id, { rate: "5" })).some((e) => /location/.test(e)));
});

test("phone: +91 handling, digits only, no duplicate country code", () => {
  assert.equal(sanitizePhoneInput("98765abc43210"), "9876543210");
  assert.equal(sanitizePhoneInput("+91 98765 43210"), "9876543210");
  assert.equal(sanitizePhoneInput("919876543210"), "9876543210");
  assert.equal(sanitizePhoneInput("09876543210"), "9876543210");
  assert.equal(sanitizePhoneInput("98765432101234"), "9876543210");
  assert.equal(sanitizePhoneInput("!@#$%"), "");
  assert.equal(sanitizePhoneInput("9198765432"), "9198765432"); // a real 10-digit number starting 91 is kept
  assert.equal(toFullPhone("9876543210"), "+91 9876543210");
  assert.equal(toFullPhone(""), "");
  assert.equal(isValidPhone("9876543210"), true);
  assert.equal(isValidPhone("1234567890"), false);
  assert.equal(isValidPhone("98765"), false);
  assert.equal(fromStoredPhone("+91 7548810034"), "7548810034");
  assert.equal(fromStoredPhone("75488 10034"), "7548810034");
  assert.equal(fromStoredPhone(undefined), "");
});


test("others: add several rows, edit, remove; each keeps its own description and amount", () => {
  let d = emptyDraft(ctx);
  assert.equal(d.others.length, 1);
  d = addCharge(addCharge(d));
  assert.equal(d.others.length, 3);
  d = updateCharge(d, d.others[0].id, { description: "toll", amount: "100" });
  d = updateCharge(d, d.others[1].id, { description: "Parking", amount: "50.5" });
  d = updateCharge(d, d.others[0].id, { amount: "120" });
  assert.deepEqual(d.others.map((c) => [c.description, c.amount]), [["toll", "120"], ["Parking", "50.5"], ["", ""]]);
  assert.equal(filledCharges(d).length, 2); // empty row ignored
  assert.deepEqual(toPayload(d).others, [{ description: "toll", amount: 120 }, { description: "Parking", amount: 50.5 }]);
  d = removeCharge(d, d.others[0].id);
  assert.deepEqual(d.others.map((c) => c.description), ["Parking", ""]);
  d = removeCharge(removeCharge(d, d.others[0].id), d.others[0].id);
  assert.equal(d.others.length, 1); // always one blank row
});

test("others: all rows are summed into the total, validated, and restored on edit", () => {
  let d = emptyDraft(ctx);
  const base = computeValues(d).totalValue;
  d = addCharge(d);
  d = updateCharge(d, d.others[0].id, { description: "toll", amount: "100" });
  d = updateCharge(d, d.others[1].id, { description: "Loading", amount: "250.25" });
  assert.equal(computeValues(d).totalValue - base, 350.25);
  assert.deepEqual(validateDraft(d), []);
  assert.ok(validateDraft(updateCharge(d, d.others[0].id, { description: "", amount: "5" })).some((e) => /description/.test(e)));
  const back = draftFromData({ ...toPayload(d), schemaVersion: 2 }, ctx);
  assert.deepEqual(back.others.map((c) => [c.description, c.amount]), [["toll", "100"], ["Loading", "250.25"]]);
  assert.deepEqual(toPayload(back), toPayload(d));
  // budget saved with the earlier single Others pair opens as the first row
  const old = draftFromData({ schemaVersion: 2, othersDescription: "toll", othersAmount: 100 }, ctx);
  assert.deepEqual(old.others.map((c) => [c.description, c.amount]), [["toll", "100"]]);
});

import { formatEntry, formatList } from "../src/utils/historyFormat";

test("history formatting: every list shape reads correctly, never undefined", () => {
  assert.equal(formatList([{ description: "toll", amount: 100 }, { description: "Loading", amount: 250.5 }]), "toll ₹100.00; Loading ₹250.50");
  assert.equal(formatList([{ location: "Salem", rate: 120 }]), "Salem ₹120.00");
  assert.equal(formatList([{ name: "Accommodation", value: "5000" }, { name: "Parking", value: "" }]), "Accommodation: 5000; Parking: —");
  assert.equal(formatList([]), "—");
  assert.equal(formatList(null), "—");
  assert.equal(formatList(undefined), "—");
  assert.equal(formatEntry({}), "—");
  assert.equal(formatEntry({ foo: "bar" }), "foo: bar");
  assert.equal(formatEntry({ description: "x" }), "x —"); // missing amount shown as a dash, not undefined
  for (const out of [formatList([{ description: "a" }, { location: "b" }, { name: "c" }, {}, null]), formatEntry(undefined)])
    assert.ok(!/undefined|\[object/.test(out), out);
});
