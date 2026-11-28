process.env.ROADSHOW = "on";
import test from "node:test";
import assert from "node:assert/strict";
import {
  financialYear,
  generatePifNumber,
  generateTrackupNumber,
} from "../src/utils/numbers.js";
import { countDays } from "../src/utils/days.js";
import { allocatePif, sharedTrackup, type PifStore, type TrackupStore } from "../src/services/numberAllocator.js";
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
  }
});

test("countDays: inclusive, Sunday halt excludes Sundays", () => {
  assert.equal(countDays("2026-10-22", "2026-10-23", false), 2);
  assert.equal(countDays("2026-10-22", "2026-10-23", true), 2);
  // 2026-10-25 is a Sunday
  assert.equal(countDays("2026-10-24", "2026-10-26", false), 3);
  assert.equal(countDays("2026-10-24", "2026-10-26", true), 2);
  assert.equal(countDays("2026-10-26", "2026-10-24", false), 0);
});

function trackupStore(current: string | null = null, taken: string[] = []): TrackupStore & { value: () => string | null } {
  let value = current;
  return {
    value: () => value,
    find: async () => value,
    used: async (n) => taken.includes(n),
    claim: async (n) => {
      if (value) throw Object.assign(new Error("dup"), { code: 11000 });
      value = n;
    },
  };
}

test("sharedTrackup: reuses the group's number, skips used ones, and adopts the winner of a race", async () => {
  assert.equal(await sharedTrackup(trackupStore("JS-1")), "JS-1");
  const seq = ["JS-2", "JS-3"];
  assert.equal(await sharedTrackup(trackupStore(null, ["JS-2"]), () => seq.shift()!), "JS-3");
  const raced = trackupStore();
  const claim = raced.claim;
  raced.claim = async () => {
    await claim("JS-9"); // someone else claims the group first
    throw Object.assign(new Error("dup"), { code: 11000 });
  };
  assert.equal(await sharedTrackup(raced), "JS-9");
});

function pifStore(taken: string[] = []): PifStore & { rows: string[] } {
  const rows = [...taken];
  return {
    rows,
    exists: async (p) => rows.includes(p),
    insert: async (p) => {
      if (rows.includes(p)) throw Object.assign(new Error("dup"), { code: 11000 });
      rows.push(p);
    },
  };
}

test("allocatePif skips used numbers, retries a rejected insert, rethrows other errors and gives up", async () => {
  const seq = ["PIF-1", "PIF-2"];
  assert.equal(await allocatePif(pifStore(["PIF-1"]), () => seq.shift()!), "PIF-2");
  const race = pifStore();
  const insert = race.insert;
  let first = true;
  race.insert = async (p) => {
    if (first) {
      first = false;
      throw Object.assign(new Error("dup"), { code: 11000 });
    }
    return insert(p);
  };
  assert.match(await allocatePif(race), /^PIF-/);
  assert.equal(race.rows.length, 1);
  const bad = pifStore();
  bad.insert = async () => {
    throw new Error("boom");
  };
  await assert.rejects(allocatePif(bad), /boom/);
  await assert.rejects(allocatePif({ exists: async () => true, insert: async () => {} }), /exhausted/);
});

test("concurrent allocation yields all-unique PIF numbers", async () => {
  const store = pifStore();
  const pifs = await Promise.all(Array.from({ length: 100 }, () => allocatePif(store)));
  assert.equal(new Set(pifs).size, 100);
});

const roadshow = {
  projectCode: "20000001",
  billingName: "Sapphire Foods (KFC)",
  stateCode: "33",
  numberOfVans: 7, vehicleTypes: [{ code: "CENTRE_NO_ROOF", quantity: 7 }],
  startDate: "2027-10-22",
  endDate: "2027-10-23",
  reportingDate: "2027-10-22",
  sundayHalt: "NO",
  reportingLocations: ["Madurai", "Salem"],
  contactNumber: "75488 10034",
  email: "deluxshan@sapphirefoods.in",
};
const signage = {
  projectCode: "20000002",
  date: "2026-10-20",
  client: "DALMIA",
  jobSheetNumber: "22070649",
  location: "RAMNAD",
  numberOfVehicles: 2, vehicleTypes: [{ code: "CENTRE_NO_ROOF", quantity: 2 }],
  fromDate: "2026-10-21",
  toDate: "2026-10-26",
  arrivedBudget: 25000,
};

test("roadshow validation: valid sample, computed days, count", () => {
  const r = validateTracking("ROADSHOW", roadshow, { allowPastStart: true }); // number / day rules only; start-date window: dateRules.test.ts
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
    numberOfVans: 0, vehicleTypes: [{ code: "CENTRE_NO_ROOF", quantity: 0 }],
    sundayHalt: "MAYBE",
  });
  assert.ok(r.errors.length >= 6);
});

test("signage validation: valid, auto total days, bad range", () => {
  const ok = validateTracking("SIGNAGE", signage, { allowPastStart: true });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.details.totalDaysOfWork, 6);
  const manual = validateTracking("SIGNAGE", { ...signage, totalDaysOfWork: 4 }, { allowPastStart: true });
  assert.equal(manual.details.totalDaysOfWork, 4);
  assert.ok(validateTracking("SIGNAGE", { ...signage, toDate: "2026-10-01" }).errors.length > 0);
});

test("unknown project type rejected", () => {
  assert.ok(validateTracking("OTHER", {}).errors.some((e) => /Project type/.test(e)));
});
