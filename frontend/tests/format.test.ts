import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { copyText, countDays, formatDate, formatDateTime, formatInr } from "../src/utils/format";

const g = globalThis as Record<string, unknown>;
const saved = { navigator: g.navigator, document: g.document };
afterEach(() => {
  Object.defineProperty(g, "navigator", { value: saved.navigator, configurable: true });
  Object.defineProperty(g, "document", { value: saved.document, configurable: true });
});
const stub = (k: string, v: unknown) => Object.defineProperty(g, k, { value: v, configurable: true });

test("formatDateTime converts UTC to IST and rolls the date over", () => {
  assert.equal(formatDateTime("2026-11-23T05:00:00.000Z"), "23-Nov-2026, 10:30 AM");
  assert.equal(formatDateTime("2026-11-23T20:00:00.000Z"), "24-Nov-2026, 01:30 AM");
  assert.equal(formatDateTime(undefined), "—");
  assert.equal(formatDateTime("bad"), "—");
});

test("formatDate has no timezone shift; formatInr formats rupees", () => {
  assert.equal(formatDate("2026-10-22"), "22-Oct-2026");
  assert.equal(formatDate("x"), "—");
  assert.ok(formatInr(25000).includes("25,000"));
  assert.equal(formatInr(null), "—");
});

test("countDays matches the backend rule", () => {
  assert.equal(countDays("2026-10-22", "2026-10-23", false), 2);
  assert.equal(countDays("2026-10-24", "2026-10-26", false), 3);
  assert.equal(countDays("2026-10-24", "2026-10-26", true), 2);
  assert.equal(countDays("2026-10-26", "2026-10-24", false), 0);
});

test("copyText uses the clipboard API", async () => {
  let copied = "";
  stub("navigator", { clipboard: { writeText: async (t: string) => { copied = t; } } });
  assert.equal(await copyText("JS-22351/2026-27"), true);
  assert.equal(copied, "JS-22351/2026-27");
});

test("copyText returns false when clipboard and fallback both fail", async () => {
  stub("navigator", { clipboard: { writeText: async () => { throw new Error("no"); } } });
  stub("document", { createElement: () => { throw new Error("no dom"); } });
  assert.equal(await copyText("x"), false);
});
