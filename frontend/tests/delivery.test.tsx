import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { NAV } from "../src/components/AppShell";
import { ClearanceFiltersBar, DeliverySummaryCards } from "../src/components/Clearance";
import { PhotoPicker, PhotoThumb } from "../src/components/DeliveryForm";
import { emptyClearanceFilters } from "../src/utils/clearance";
import {
  DESCRIPTION_MAX, EVIDENCE_HELPER, MAX_PHOTO_BYTES, RBP_STATUS_OPTIONS, canShowDeliver, fileSizeText, validateDeliveryForm, validatePhoto,
} from "../src/utils/delivery";

const noop = () => {};
const jpg = { name: "speedo.jpg", type: "image/jpeg", size: 120_000 };
const png = { name: "driver.PNG", type: "image/png", size: 300_000 };

test("sidebar: the RBP menu is renamed to Vehicle Deliver on the same route; other RBP entries and roles unchanged", () => {
  assert.deepEqual(NAV.RBP.map((n) => n.label), ["Projects & Budgets", "Vehicle Management", "Driver Management", "Vehicle Deliver", "Driver Payments"]); // payments appended after the existing entries
  assert.equal(NAV.RBP[3].href, "/rbp/on-road"); // no duplicate module / route
  assert.ok(!NAV.RBP.some((n) => n.label === "On-Road Vehicles"));
  assert.deepEqual(NAV.RSA.map((n) => n.label), ["Payments", "Vehicle & Driver Clearance", "Driver Payments", "Settlement Payments", "Payment Completed"]); // settlement pages appended
  assert.deepEqual(NAV.RSOM, [{ href: "/rsom", label: "Budget Approvals" }, { href: "/rsom/payments", label: "Daily Payment Approvals" }]);
  assert.deepEqual(NAV.RSOP.map((n) => n.label), ["Dashboard", "New Tracking Request"]);
});

test("status filter: exactly the six options in order, and RSA keeps its own filter", () => {
  assert.deepEqual(RBP_STATUS_OPTIONS.map((o) => o.label), ["All", "Yet to Deliver", "Yet to Approve", "Rejected by RSA", "Approved by RSA", "Delivered"]);
  assert.deepEqual(RBP_STATUS_OPTIONS.map((o) => o.value), ["", "YET_TO_DELIVER", "YET_TO_APPROVE", "REJECTED", "APPROVED", "DELIVERED"]);
  const rbp = renderToStaticMarkup(<ClearanceFiltersBar mode="RBP" f={emptyClearanceFilters()} onChange={noop} onClear={noop} searchHint="Search" />);
  for (const t of ["Yet to Deliver", "Rejected by RSA", "Approved by RSA", "Delivered", "Mass search", "Project type filter", "Allocation date from", "Clear Filters"]) assert.match(rbp, new RegExp(t));
  const rsa = renderToStaticMarkup(<ClearanceFiltersBar f={emptyClearanceFilters()} onChange={noop} onClear={noop} searchHint="Search" />);
  assert.ok(!rsa.includes("Yet to Deliver"));
});

test("summary cards: six real counts", () => {
  const html = renderToStaticMarkup(<DeliverySummaryCards s={{ total: 10, approved: 5, yetToApprove: 2, rejected: 3, yetToDeliver: 3, delivered: 2 }} />);
  for (const t of ["Total Allocations", "Approved by RSA", "Yet to Approve", "Rejected by RSA", "Yet to Deliver", "Delivered", ">10<", ">5<", ">2<", ">3<"]) assert.match(html, new RegExp(t));
});

test("Deliver is offered only for RSA-approved, undelivered allocations", () => {
  assert.equal(canShowDeliver({ status: "APPROVED", deliveryStatus: "YET_TO_DELIVER" }), true);
  assert.equal(canShowDeliver({ status: "APPROVED", deliveryStatus: undefined }), true);
  assert.equal(canShowDeliver({ status: "APPROVED", deliveryStatus: "DELIVERED" }), false);
  assert.equal(canShowDeliver({ status: "REJECTED", deliveryStatus: null }), false);
  assert.equal(canShowDeliver({ status: "YET_TO_APPROVE", deliveryStatus: null }), false);
});

test("photo validation: formats, size, empty, missing", () => {
  assert.equal(validatePhoto(jpg, "Speedometer photo"), null);
  assert.equal(validatePhoto(png, "Photo"), null);
  assert.equal(validatePhoto({ name: "a.webp", type: "image/webp", size: 10 }, "Photo"), null);
  assert.equal(validatePhoto({ name: "a.jpeg", type: "image/jpeg", size: 10 }, "Photo"), null);
  assert.match(validatePhoto(null, "Speedometer photo") ?? "", /Speedometer photo is required/);
  assert.match(validatePhoto({ name: "a.pdf", type: "application/pdf", size: 10 }, "Photo") ?? "", /JPG, PNG or WEBP/);
  assert.match(validatePhoto({ name: "a.gif", type: "image/gif", size: 10 }, "Photo") ?? "", /JPG, PNG or WEBP/);
  assert.match(validatePhoto({ name: "a.jpg", type: "image/jpeg", size: 0 }, "Photo") ?? "", /empty/);
  assert.match(validatePhoto({ name: "a.jpg", type: "image/jpeg", size: MAX_PHOTO_BYTES + 1 }, "Photo") ?? "", /too large/);
  assert.equal(validatePhoto({ name: "a.jpg", type: "image/jpeg", size: MAX_PHOTO_BYTES }, "Photo"), null);
});

test("delivery form validation: description + both photos are mandatory", () => {
  assert.deepEqual(validateDeliveryForm("Vehicle handed over to the driver", jpg, png), []);
  assert.deepEqual(validateDeliveryForm("", jpg, png), ["Delivery description is required"]);
  assert.deepEqual(validateDeliveryForm("   ", jpg, png), ["Delivery description is required"]);
  assert.match(validateDeliveryForm("abc", jpg, png)[0], /at least 5/);
  assert.match(validateDeliveryForm("x".repeat(DESCRIPTION_MAX + 1), jpg, png)[0], /too long/);
  assert.deepEqual(validateDeliveryForm("Handed over ok", null, png), ["Speedometer photo is required"]);
  assert.deepEqual(validateDeliveryForm("Handed over ok", jpg, null), ["Driver & vehicle handover photo is required"]);
  assert.equal(validateDeliveryForm("", null, null).length, 3);
  assert.equal(fileSizeText(2 * 1024 * 1024), "2.0 MB");
  assert.equal(fileSizeText(2048), "2 KB");
});

test("photo picker: camera capture + device choose, empty state; evidence helper text", () => {
  const html = renderToStaticMarkup(<PhotoPicker label="Driver & Vehicle Handover Photo" helper={EVIDENCE_HELPER} file={null} onChange={noop} camera />);
  assert.match(html, /Driver &amp; Vehicle Handover Photo \*/);
  assert.match(html, /capture="environment"/); // mobile camera
  assert.match(html, /accept="image\/\*"/);
  assert.match(html, /Take Photo/);
  assert.match(html, /Choose from Device/);
  assert.match(html, /No photo selected/);
  assert.ok(!html.includes("Remove")); // nothing to remove yet
  assert.match(html, /standing in front of or seated inside the allocated vehicle/);
  assert.match(html, /both the driver and vehicle are clearly visible/);
});

test("delivered photo view: preview image, file info; missing photo handled", () => {
  const html = renderToStaticMarkup(<PhotoThumb label="Speedometer Photo" photo={{ key: "k", name: "speedo.jpg", size: 2048, mimeType: "image/jpeg", url: "http://x/files/k" }} />);
  assert.match(html, /src="http:\/\/x\/files\/k"/);
  assert.match(html, /speedo\.jpg/);
  assert.match(renderToStaticMarkup(<PhotoThumb label="Speedometer Photo" photo={null} />), /not available/);
});
