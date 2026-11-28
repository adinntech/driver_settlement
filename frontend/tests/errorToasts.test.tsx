import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { errorMessages, toastDuration, ToastView, visibleToasts } from "../src/context/ToastContext";

test("each validation message is its own toast, once; a sentence with a semicolon stays whole", () => {
  assert.deepEqual(errorMessages("Client is required; Location is required; Client is required"), ["Client is required", "Location is required"]);
  assert.deepEqual(errorMessages(["Project Code is required", ""]), ["Project Code is required"]);
  assert.deepEqual(errorMessages("A final settlement exists; correct and resubmit it"), ["A final settlement exists; correct and resubmit it"]);
  assert.deepEqual([errorMessages(""), errorMessages(null)], [[], []]);
});

test("errors last 4-5 seconds, connection / session / server errors longer, success unchanged", () => {
  assert.equal(toastDuration("error", "Client is required"), 5000);
  for (const m of ["Cannot reach the server", "Invalid or expired token", "Failed to fetch"]) assert.equal(toastDuration("error", m), 10_000, m);
  assert.equal(toastDuration("success", "Saved"), 3200);
});

test("error toasts have an icon and a close button and are announced; success toasts look as before", () => {
  const html = renderToStaticMarkup(<ToastView toasts={[{ id: 1, kind: "error", text: "Client is required" }, { id: 2, kind: "success", text: "Saved" }]} onClose={() => {}} />);
  assert.ok(html.includes('role="alert"') && html.includes('aria-label="Dismiss"') && html.includes("toast-icon"));
  assert.equal((html.match(/aria-label="Dismiss"/g) ?? []).length, 1);
});

test("no screen keeps a red error summary box", () => {
  const walk = (dir: URL): URL[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, dir)) : e.name.endsWith(".tsx") ? [new URL(e.name, dir)] : []));
  for (const f of walk(new URL("../src/", import.meta.url)))
    assert.ok(!/\{(errors\.length > 0|error|err|deleteError|draftErr) && \(?\s*<\w+ className="[^"]*(alert|field-error)/.test(readFileSync(f, "utf8")), f.pathname);
});

test("one error on screen at a time, oldest first; success toasts are unaffected", () => {
  const queue = [{ id: 1, kind: "error" as const, text: "A" }, { id: 2, kind: "success" as const, text: "Saved" }, { id: 3, kind: "error" as const, text: "B" }];
  assert.deepEqual(visibleToasts(queue).map((t) => t.text), ["A", "Saved"]);
  assert.deepEqual(visibleToasts(queue.slice(1)).map((t) => t.text), ["Saved", "B"]);
});
