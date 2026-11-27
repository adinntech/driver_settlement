import test from "node:test";
import assert from "node:assert/strict";
import {
  DOC_KEYS, VEHICLE_TYPES, addDoc, docStatus, emptyForm, filledDocs, fmtValue, fromVehicle, normalizeVehicleNo, removeDoc, sanitizeRunning,
  sanitizeVehicleNo, sanitizeYear, toPayload, todayIST, updateDoc, validateForm, type VForm,
} from "../src/utils/vehicleForm";
import { fileError } from "../src/components/RenewalModal";
import type { Attachment } from "../src/types/domain";

const NOW = new Date("2026-11-23T05:00:00Z"); // 23-Nov-2026 IST
const ok = (over: Partial<VForm> = {}): VForm => ({
  ...emptyForm(NOW), vehicleNo: "TN58BM6554", make: "Tata", model: "Ace", type: "Dynamic", yearOfManufacture: "2022",
  purchaseDate: "2022-06-15", currentRunning: "1200", totalRunning: "45000", ...over,
});
const att = (name: string): Attachment => ({
  storage: "local", key: `driver_settlement/vehicles/2026/123e4567-e89b-12d3-a456-426614174000-${name}`, name, size: 1234,
  mimeType: "application/pdf", url: `http://localhost:5000/files/x/${name}`,
});

test("new form defaults: Dynamic type, today's purchase date (IST), no document rows; all 5 vehicle types", () => {
  const f = emptyForm(NOW);
  assert.equal(f.type, "Dynamic");
  assert.equal(f.purchaseDate, "2026-11-23");
  assert.equal(todayIST(new Date("2026-11-23T20:00:00Z")), "2026-11-24"); // rolls over in IST
  for (const k of DOC_KEYS) assert.deepEqual(f[k], []);
  assert.deepEqual(VEHICLE_TYPES, ["Dynamic", "Static", "Utility", "Ladder Vehicle", "Event"]);
});

test("keyboard sanitisers: vehicle number, year, running", () => {
  assert.equal(sanitizeVehicleNo("tn58-bm 6554!@#"), "TN58-BM 6554");
  assert.equal(sanitizeVehicleNo("a".repeat(30)).length, 14);
  assert.equal(sanitizeYear("20a22x9"), "2022");
  assert.equal(sanitizeRunning("12ab.345-6"), "12.34");
  assert.equal(sanitizeRunning("-5"), "5");
});

test("vehicle number normalisation matches the server", () => {
  assert.equal(normalizeVehicleNo("tn 58 bm 6554"), "TN58BM6554");
  assert.equal(normalizeVehicleNo("22BH1234AA"), "22BH1234AA");
  for (const bad of ["", "ABC", "TN58BM", "1234", "TN58BM65541"]) assert.equal(normalizeVehicleNo(bad), null, bad);
});

test("validation: final needs the mandatory fields, a draft does not", () => {
  const empty = { ...emptyForm(NOW), purchaseDate: "" };
  const finalErr = validateForm(empty, false, NOW);
  for (const l of ["Vehicle number", "Make", "Model", "Year of manufacture", "Purchase date", "Current running", "Total running"])
    assert.ok(finalErr.some((e) => e.startsWith(l)), l);
  assert.deepEqual(validateForm(empty, true, NOW), []);
  assert.deepEqual(validateForm(ok(), false, NOW), []);
  assert.ok(validateForm({ ...empty, vehicleNo: "bad!" }, true, NOW).length > 0); // format still checked in a draft
});

test("validation: year, dates, numeric rules", () => {
  assert.ok(validateForm(ok({ yearOfManufacture: "1900" }), false, NOW).length > 0);
  assert.ok(validateForm(ok({ yearOfManufacture: "2027" }), false, NOW).length > 0);
  assert.ok(validateForm(ok({ purchaseDate: "2026-11-24" }), false, NOW).some((e) => /future/.test(e)));
  assert.ok(validateForm(ok({ purchaseDate: "2026-02-31" }), false, NOW).length > 0);
  assert.ok(validateForm(ok({ purchaseDate: "2021-01-01" }), false, NOW).some((e) => /year of manufacture/.test(e)));
  assert.ok(validateForm(ok({ oilTopUpOn: "2021-01-01" }), false, NOW).some((e) => /before the purchase date/.test(e)));
  assert.ok(validateForm(ok({ currentRunning: "-1" }), false, NOW).length > 0);
  assert.deepEqual(validateForm(ok({ oilTopUpOn: "2026-10-01" }), false, NOW), []);
});

test("renewal entries: add via popup, edit, remove, order kept, other sections untouched", () => {
  let f = ok();
  f = addDoc(f, "insurance", { nextRenewalDate: "2027-01-01", attachment: att("policy.pdf") });
  f = addDoc(f, "insurance", { nextRenewalDate: "2027-06-01" });
  f = addDoc(f, "fc", { nextRenewalDate: "2026-12-31" });
  assert.deepEqual(f.insurance.map((d) => [d.nextRenewalDate, d.attachment?.name ?? null]), [["2027-01-01", "policy.pdf"], ["2027-06-01", null]]);
  f = updateDoc(f, "insurance", f.insurance[1].id, { nextRenewalDate: "2027-07-01", attachment: att("renewed.pdf") });
  assert.deepEqual(f.insurance.map((d) => d.nextRenewalDate), ["2027-01-01", "2027-07-01"]);
  assert.equal(f.insurance[0].attachment?.name, "policy.pdf"); // editing one entry leaves the other alone
  f = removeDoc(f, "insurance", f.insurance[0].id);
  assert.deepEqual(f.insurance.map((d) => d.attachment?.name), ["renewed.pdf"]);
  assert.equal(f.fc.length, 1);
  assert.equal(filledDocs([{ id: "x", nextRenewalDate: "", attachment: null }]).length, 0); // empty rows are never saved
  const p = toPayload(f, "FINAL");
  assert.deepEqual(p.insurance, [{ nextRenewalDate: "2027-07-01", attachment: { storage: "local", key: att("renewed.pdf").key, name: "renewed.pdf", size: 1234, mimeType: "application/pdf" } }]);
  assert.ok(!("url" in (p.insurance[0].attachment as object))); // url is computed by the server, never sent back
  assert.deepEqual(p.fc, [{ nextRenewalDate: "2026-12-31", attachment: null }]);
});

test("renewal validation: date required and real", () => {
  let f = addDoc(ok(), "permit", { attachment: att("p.pdf") });
  assert.ok(validateForm(f, false, NOW).some((e) => /next renewal date is required/.test(e)));
  f = updateDoc(f, "permit", f.permit[0].id, { nextRenewalDate: "2026-02-31" });
  assert.ok(validateForm(f, false, NOW).some((e) => /not a valid date/.test(e)));
  f = updateDoc(f, "permit", f.permit[0].id, { nextRenewalDate: "2027-02-01" });
  assert.deepEqual(validateForm(f, false, NOW), []);
});

test("edit restores every saved value and attachment; payload round-trips; draft vs final flag", () => {
  const saved = {
    vehicleNo: "TN58BM6554", make: "Tata", model: "Ace", type: "Utility", yearOfManufacture: 2022, purchaseDate: "2022-06-15",
    currentRunning: 1200.5, totalRunning: 45000, stepneyStatus: "Good", batteryStatus: null, oilTopUpOn: "2026-10-01", condition: "Fine",
    fc: [{ nextRenewalDate: "2026-12-31", attachment: att("fc.pdf") }, { nextRenewalDate: "2027-12-31", attachment: null }],
    insurance: [], rtoPermission: [], policePermission: [], permit: [{ nextRenewalDate: "2027-03-03", attachment: null }],
  };
  const f = fromVehicle(saved);
  assert.equal(f.type, "Utility");
  assert.equal(f.currentRunning, "1200.5");
  assert.equal(f.batteryStatus, "");
  assert.deepEqual(f.fc.map((d) => [d.nextRenewalDate, d.attachment?.name ?? null]), [["2026-12-31", "fc.pdf"], ["2027-12-31", null]]);
  assert.equal(f.fc[0].attachment?.url, att("fc.pdf").url); // link keeps working while editing
  const p = toPayload(f, "DRAFT");
  assert.equal(p.saveAs, "DRAFT");
  assert.equal(p.fc[0].attachment?.name, "fc.pdf");
  assert.equal(toPayload(f, "FINAL").saveAs, "FINAL");
  assert.equal(toPayload(f, "FINAL", "INACTIVE").status, "INACTIVE");
  assert.equal(fromVehicle({}).type, "Dynamic"); // old / empty records load safely
});

test("attachment file check: allowed types, size, empty", () => {
  assert.equal(fileError({ name: "rc.PDF", size: 1000 }), null);
  assert.equal(fileError({ name: "photo.jpeg", size: 1000 }), null);
  assert.equal(fileError({ name: "scan.webp", size: 1000 }), null);
  assert.match(fileError({ name: "virus.exe", size: 1000 }) ?? "", /allowed/);
  assert.match(fileError({ name: "page.html", size: 1000 }) ?? "", /allowed/);
  assert.match(fileError({ name: "noext", size: 1000 }) ?? "", /allowed/);
  assert.match(fileError({ name: "big.pdf", size: 10 * 1024 * 1024 + 1 }) ?? "", /too large/);
  assert.match(fileError({ name: "empty.pdf", size: 0 }) ?? "", /empty/);
  assert.equal(fileError({ name: "max.pdf", size: 10 * 1024 * 1024 }), null);
});

test("document status badges and history value formatting never show undefined", () => {
  assert.equal(docStatus(null, NOW), "NONE");
  assert.equal(docStatus("2026-11-22", NOW), "EXPIRED");
  assert.equal(docStatus("2026-11-23", NOW), "EXPIRING_SOON");
  assert.equal(docStatus("2026-12-23", NOW), "EXPIRING_SOON");
  assert.equal(docStatus("2026-12-24", NOW), "VALID");
  assert.equal(fmtValue("make", null), "—");
  assert.equal(fmtValue("oilTopUpOn", "2026-10-01"), "01-Oct-2026");
  assert.equal(fmtValue("fc", [{ nextRenewalDate: "2026-12-31", attachment: { name: "fc.pdf" } }, { nextRenewalDate: "2027-01-01", attachment: null }]), "renewal 31-Dec-2026, fc.pdf; renewal 01-Jan-2027");
  assert.equal(fmtValue("fc", []), "—");
  assert.equal(fmtValue("insurance", [{}]), "—");
  assert.ok(!/undefined|\[object/.test(fmtValue("fc", [{ attachment: {} }])));
});
