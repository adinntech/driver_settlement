import test from "node:test";
import assert from "node:assert/strict";
import {
  financialYear,
  generateDisplayNumber,
  generatePifNumber,
  generateTrackupNumber,
} from "../src/utils/numbers.js";
import { countDays } from "../src/utils/days.js";
import { allocateOne, type NumberSet, type NumberStore } from "../src/services/numberAllocator.js";
import { validateTracking } from "../src/validators/tracking.validator.js";

test("financial year: April starts new FY, March belongs to previous", () => {
  assert.equal(financialYear(new Date("2026-04-01T00:00:00+05:30")), "2026-27");
  assert.equal(financialYear(new Date("2027-03-31T23:00:00+05:30")), "2026-27");
  assert.equal(financialYear(new Date("2026-03-31T10:00:00+05:30")), "2025-26");
  assert.equal(financialYear(new Date("2099-05-01T10:00:00+05:30")), "2099-00");
});

test("number formats", () => {
  for (let i = 0; i < 200; i++) {
    assert.match(generateTrackupNumber(new Date("2026-10-22")), /^JS-\d{5}\/2026-27$/);
    assert.match(generatePifNumber(), /^PIF-\d{5}$/);
    assert.match(generateDisplayNumber(), /^\d{4}$/);
  }
  assert.ok(Number(generateDisplayNumber()) >= 1000);
});

test("countDays: inclusive, Sunday halt excludes Sundays", () => {
  assert.equal(countDays("2026-10-22", "2026-10-23", false), 2);
  assert.equal(countDays("2026-10-22", "2026-10-23", true), 2);
  // 2026-10-25 is a Sunday
  assert.equal(countDays("2026-10-24", "2026-10-26", false), 3);
  assert.equal(countDays("2026-10-24", "2026-10-26", true), 2);
  assert.equal(countDays("2026-10-26", "2026-10-24", false), 0);
});

function memoryStore(taken: NumberSet[] = []): NumberStore & { rows: NumberSet[] } {
  const rows = [...taken];
  return {
    rows,
    exists: async (s) =>
      rows.some(
        (r) =>
          r.trackupNumber === s.trackupNumber ||
          r.pifNumber === s.pifNumber ||
          r.displayNumber === s.displayNumber,
      ),
    insert: async (s) => {
      if (
        rows.some(
          (r) =>
            r.trackupNumber === s.trackupNumber ||
            r.pifNumber === s.pifNumber ||
            r.displayNumber === s.displayNumber,
        )
      )
        throw Object.assign(new Error("dup"), { code: 11000 });
      rows.push(s);
    },
  };
}

test("allocateOne skips an already used number", async () => {
  const store = memoryStore([{ trackupNumber: "JS-11111/2026-27", pifNumber: "PIF-11111", displayNumber: "1111" }]);
  const seq = ["JS-11111/2026-27", "JS-22222/2026-27"];
  let i = 0;
  const set = await allocateOne(store, 1, {
    trackup: () => seq[Math.min(i++, 1)],
    pif: () => "PIF-33333",
    display: () => "3333",
  });
  assert.equal(set.trackupNumber, "JS-22222/2026-27");
});

test("allocateOne retries when the DB unique index rejects (race)", async () => {
  const store = memoryStore();
  let first = true;
  const original = store.insert;
  store.insert = async (s, n) => {
    if (first) {
      first = false;
      throw Object.assign(new Error("dup"), { code: 11000 });
    }
    return original(s, n);
  };
  const set = await allocateOne(store, 1);
  assert.equal(store.rows.length, 1);
  assert.ok(set.trackupNumber.startsWith("JS-"));
});

test("allocateOne rethrows non-duplicate errors and gives up when exhausted", async () => {
  const bad = memoryStore();
  bad.insert = async () => {
    throw new Error("boom");
  };
  await assert.rejects(allocateOne(bad, 1), /boom/);
  const always = memoryStore();
  always.exists = async () => true;
  await assert.rejects(allocateOne(always, 1), /exhausted/);
});

test("concurrent allocation yields all-unique numbers", async () => {
  const store = memoryStore();
  const sets = await Promise.all(Array.from({ length: 100 }, (_, i) => allocateOne(store, i + 1)));
  for (const k of ["trackupNumber", "pifNumber", "displayNumber"] as const)
    assert.equal(new Set(sets.map((s) => s[k])).size, 100);
});

const roadshow = {
  billingName: "Sapphire Foods (KFC)",
  stateCode: "33",
  numberOfVans: 7,
  startDate: "2026-10-22",
  endDate: "2026-10-23",
  reportingDate: "2026-10-22",
  sundayHalt: "NO",
  reportingLocations: ["Madurai", "Salem"],
  contactNumber: "75488 10034",
  email: "deluxshan@sapphirefoods.in",
};
const signage = {
  date: "2026-10-20",
  client: "DALMIA",
  jobSheetNumber: "22070649",
  location: "RAMNAD",
  numberOfVehicles: 2,
  fromDate: "2026-10-21",
  toDate: "2026-10-26",
  arrivedBudget: 25000,
};

test("roadshow validation: valid sample, computed days, count", () => {
  const r = validateTracking("ROADSHOW", roadshow);
  assert.deepEqual(r.errors, []);
  assert.equal(r.vehicleCount, 7);
  assert.equal(r.clientName, "Sapphire Foods (KFC)");
  assert.equal(r.details.numberOfDays, 2);
});

test("roadshow validation: rejects bad input", () => {
  const r = validateTracking("ROADSHOW", {
    ...roadshow,
    billingName: "",
    endDate: "2026-10-01",
    email: "nope",
    contactNumber: "12",
    reportingLocations: [],
    numberOfVans: 0,
    sundayHalt: "MAYBE",
  });
  assert.ok(r.errors.length >= 6);
});

test("signage validation: valid, auto total days, bad range", () => {
  const ok = validateTracking("SIGNAGE", signage);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.details.totalDaysOfWork, 6);
  const manual = validateTracking("SIGNAGE", { ...signage, totalDaysOfWork: 4 });
  assert.equal(manual.details.totalDaysOfWork, 4);
  assert.ok(validateTracking("SIGNAGE", { ...signage, toDate: "2026-10-01" }).errors.length > 0);
});

test("unknown project type rejected", () => {
  assert.ok(validateTracking("OTHER", {}).errors.some((e) => /Project type/.test(e)));
});
