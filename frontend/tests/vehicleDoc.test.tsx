import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import RenewalModal from "../src/components/RenewalModal";
import VehicleDocSection from "../src/components/VehicleDocSection";
import type { DocRow } from "../src/utils/vehicleForm";

const noop = () => {};

test("+ popup shows exactly Renewal Type, Next Renewal Date and Attachments with Save / Close", () => {
  const html = renderToStaticMarkup(<RenewalModal initialType="insurance" onSave={noop} onClose={noop} />);
  for (const t of ["Vehicle Detail", "Renewal Type", "Next Renewal Date", "Attachments", "Save", "Close", "...."]) assert.ok(html.includes(t), t);
  assert.match(html, /<option value="insurance" selected="">Insurance<\/option>/); // preselected from the section that opened it
  for (const label of ["FC", "Insurance", "RTO Permission", "Police Permission", "Permit"]) assert.ok(html.includes(`>${label}</option>`), label);
  assert.ok(html.includes('type="date"'));
  assert.ok(html.includes('type="file"') && html.includes("hidden"));
  assert.ok(!/undefined/.test(html));
});

test("popup in edit mode shows the saved date and attachment name", () => {
  const initial = {
    nextRenewalDate: "2027-03-05",
    attachment: { storage: "local" as const, key: "driver_settlement/vehicles/2026/x", name: "rc.pdf", size: 10, mimeType: "application/pdf" },
  };
  const html = renderToStaticMarkup(<RenewalModal initialType="fc" initial={initial} onSave={noop} onClose={noop} />);
  assert.ok(html.includes('value="2027-03-05"'));
  assert.ok(html.includes('value="rc.pdf"'));
});

test("section: + opens the popup, V is present but disabled, entries list date, status and attachment link", () => {
  const rows: DocRow[] = [
    { id: "a", nextRenewalDate: "2099-01-01", attachment: { storage: "local", key: "k", name: "fc.pdf", size: 1, mimeType: "application/pdf", url: "http://x/files/k" } },
    { id: "b", nextRenewalDate: "2000-01-01", attachment: null },
  ];
  const html = renderToStaticMarkup(<VehicleDocSection k="fc" rows={rows} onAdd={noop} onEdit={noop} onRemove={noop} />);
  assert.ok(html.includes("FC"));
  assert.ok(html.includes('aria-label="Add FC entry"'));
  assert.match(html, /<button[^>]*disabled=""[^>]*aria-label="View FC \(coming soon\)"|<button[^>]*aria-label="View FC \(coming soon\)"[^>]*disabled=""/);
  assert.ok(html.includes('href="http://x/files/k"') && html.includes("fc.pdf"));
  assert.ok(html.includes("01-Jan-2099") && html.includes("Valid"));
  assert.ok(html.includes("Expired") && html.includes("No attachment"));
  const empty = renderToStaticMarkup(<VehicleDocSection k="permit" rows={[]} onAdd={noop} onEdit={noop} onRemove={noop} />);
  assert.ok(empty.includes("No Permit entries"));
});
