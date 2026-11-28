/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.ROADSHOW = "on";
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_delivery";
process.env.JWT_SECRET = "test-secret";
process.env.RSOP_USERNAME = "RSOP";
process.env.RSOP_PASSWORD = "pass2";
process.env.RBP_USERNAME = "RBP";
process.env.RBP_PASSWORD = "123123";
process.env.RSOM_USERNAME = "RSOM";
process.env.RSOM_PASSWORD = "pass3";
process.env.RSA_USERNAME = "RSA";
process.env.RSA_PASSWORD = "pass4";
process.env.STORAGE_TYPE = "local";

import { perVehicleTrackups } from "./legacyNumbers.js";
import test from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import mongoose from "mongoose";

// SAFETY: modules are imported dynamically after the config points at the throw-away test database.
const { config: cfg } = await import("../src/config/index.js");
cfg.mongoUri = "mongodb://127.0.0.1:27017/driver_settlement_test_delivery";
cfg.storage.type = "local";
const { default: app } = await import("../src/app.js");
const { connectDB } = await import("../src/db/connect.js");
const { seedUsers } = await import("../src/services/auth.service.js");
const { User } = await import("../src/models/User.js");
const { Vehicle } = await import("../src/models/Vehicle.js");
const { Driver } = await import("../src/models/Driver.js");
const { DriverAdvance } = await import("../src/models/DriverAdvance.js");
const { TrackingProject } = await import("../src/models/TrackingProject.js");
const { TrackingVehicle } = await import("../src/models/TrackingVehicle.js");
const { Budget, BudgetVersion } = await import("../src/models/Budget.js");
const { VehicleAllotment, AllotmentEvent } = await import("../src/models/VehicleAllotment.js");
const { RsaPayment, Counter } = await import("../src/models/RsaPayment.js");
const { addDays, todayYmd } = await import("../src/validators/vehicle.validator.js");

const today = todayYmd();
const d = (n: number) => addDays(today, n);

let server: Server;
let base = "";
{
  await connectDB();
  assert.match(mongoose.connection.name, /_test_/, "refusing to drop a non-test database");
  await mongoose.connection.dropDatabase();
  await Promise.all([User.init(), Vehicle.init(), Driver.init(), DriverAdvance.init(), TrackingProject.init(), TrackingVehicle.init(), Budget.init(), BudgetVersion.init(), VehicleAllotment.init(), AllotmentEvent.init(), RsaPayment.init(), Counter.init()]);
  await seedUsers();
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
}
const call = async (path: string, method = "GET", body?: unknown, token?: string) => {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as { success: boolean; message: string; data: any } };
};
const login = async (role: string, u: string, p: string) => (await call("/auth/login", "POST", { role, username: u, password: p })).body.data.token as string;
let tk: Record<"rbp" | "rsop" | "rsom" | "rsa", string> | undefined;
const { Clearance, ClearanceEvent } = await import("../src/models/Clearance.js");
const { Notification } = await import("../src/models/Approval.js");
const { VehicleDelivery, DeliveryEvent } = await import("../src/models/Delivery.js");
const fs = await import("node:fs");
const os = await import("node:os");
const path = await import("node:path");
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-delivery-test-"));
cfg.storage.localDir = storageDir; // uploads go to a throw-away folder, never the real public folder

const T = async () => (tk ??= { rbp: await login("RBP", "RBP", "123123"), rsop: await login("RSOP", "RSOP", "pass2"), rsom: await login("RSOM", "RSOM", "pass3"), rsa: await login("RSA", "RSA", "pass4") });
const keys = (b: any) => Object.keys(b).sort();
const rsa = async (p: string, method = "GET", body?: unknown) => call(`/rsa-clearances${p}`, method, body, (await T()).rsa);
const rbp = async (p: string, method = "GET", body?: unknown) => call(`/on-road-vehicles${p}`, method, body, (await T()).rbp);

let seq = 0;
const mkVehicle = async () => {
  const r = await call("/vehicles", "POST", {
    vehicleNo: `TN${30 + (seq % 60)}DL${5000 + seq++}`, make: "Tata", model: "Ace", type: "Dynamic", yearOfManufacture: 2022, purchaseDate: "2022-06-15", currentRunning: 1, totalRunning: 2,
    fc: [], insurance: [], rtoPermission: [], policePermission: [], permit: [], availability: { status: "AVAILABLE" },
  }, (await T()).rbp);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data as any;
};
let phone = 9500000000;
const mkDriver = async (name: string) => {
  const r = await call("/drivers", "POST", {
    driverName: name, driverType: "COMPANY_DRIVER", mobileNumber: String(phone++), salary: 400, accountName: name, accountNumber: "123456789012", ifscCode: "SBIN0001234", bankName: "SBI", availability: { status: "AVAILABLE" },
  }, (await T()).rbp);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data as any;
};
const bn = (() => { let n = 0; return () => `BUD-DL-${++n}`; })();
const mkBudget = (tvx: any, proj: any) =>
  Budget.create({ budgetNumber: bn(), vehicle: tvx._id, project: proj._id, data: { foodAmount: 100 }, total: 90000, currentVersion: 1, createdBy: "RBP", updatedBy: "RBP", reviewedBy: "RSOM", reviewedAt: new Date(), approvalStatus: "APPROVED", approvedVersion: 1 });
const mkProject = async (body: unknown) => {
  const r = await call("/tracking", "POST", body, (await T()).rsop);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return perVehicleTrackups<any>(r.body.data);
};
const sched = { expectedReleaseDate: d(3), expectedReleaseTime: "20:00", nextAvailableDate: d(4), nextAvailableTime: "09:00" };
const sig = await mkProject({ projectType: "SIGNAGE", details: { projectCode: "15000001", client: "Kensign Lifestyles", jobSheetNumber: "ZZDL-1", location: "Coimbatore", date: d(0), fromDate: d(0), toDate: d(9), numberOfVehicles: 10, vehicleTypes: [{ code: "CENTRE_NO_ROOF", quantity: 10 }] } });
const road = await mkProject({ projectType: "ROADSHOW", details: { projectCode: "15000002", billingName: "Ken Roadshow Pvt", stateCode: "33", startDate: d(0), endDate: d(8), reportingDate: d(3), sundayHalt: "NO", numberOfVans: 6, vehicleTypes: [{ code: "CENTRE_NO_ROOF", quantity: 6 }], reportingLocations: ["Chennai", "Trichy"] } });
const nextIdx = new Map<any, number>();
let next = 0;
/** A fresh project vehicle with budget + vehicle + driver allotted through the real API; the clearance is created by the assignment. */
const fresh = async (proj = sig, driverName = `Delivery Driver ${String.fromCharCode(65 + next)}`) => {
  const i = nextIdx.get(proj) ?? 0;
  nextIdx.set(proj, i + 1);
  next++;
  const tvx = proj.vehicles[i];
  await mkBudget(tvx, proj);
  const veh = await mkVehicle();
  const drv = await mkDriver(driverName);
  const r = await call("/vehicle-allotments", "POST", { vehicleId: veh._id, pifNumber: tvx.pifNumber, ...sched, driverId: drv._id }, (await T()).rbp);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const c: any = await Clearance.findOne({ trackingVehicle: tvx._id }).lean();
  return { tvx, veh, drv, allotment: r.body.data, cid: String(c._id) };
};
const approve = async (cid: string) => { const r = await rsa(`/${cid}/approve`, "POST", {}); assert.equal(r.status, 200, JSON.stringify(r.body)); };
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(512, 3)]);
const upload = async (cid: string, kind: string, buf: Buffer, name = "photo.jpg", mime = "image/jpeg", token?: string) => {
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(buf)], { type: mime }), name);
  const res = await fetch(`${base}/on-road-vehicles/${cid}/photos/${kind}`, { method: "POST", headers: { Authorization: `Bearer ${token ?? (await T()).rbp}` }, body: fd });
  return { status: res.status, body: (await res.json()) as { success: boolean; message: string; data: any } };
};
const photos = async (cid: string) => {
  const s = await upload(cid, "speedometer", JPG, "speedo.jpg");
  const e = await upload(cid, "evidence", PNG, "driver-van.png", "image/png");
  assert.equal(s.status, 201, JSON.stringify(s.body));
  assert.equal(e.status, 201, JSON.stringify(e.body));
  return { s: s.body.data, e: e.body.data };
};
const deliver = (cid: string, body: unknown) => rbp(`/${cid}/deliver`, "POST", body);
const payload = (p: { s: any; e: any }, over: Record<string, unknown> = {}) => ({ description: "Vehicle handed over to the assigned driver for the approved campaign.", speedometerPhoto: { key: p.s.key }, evidencePhoto: { key: p.e.key }, ...over });
const rsaUser: any = await User.findOne({ role: "RSA" }).lean();

// states: P = pending (never approved), R = rejected, Y = approved & yet to deliver, X = delivered
const P = await fresh();
const R = await fresh();
assert.equal((await rsa(`/${R.cid}/reject`, "POST", { reason: "Missing Documents" })).status, 200);
const Y = await fresh(sig, "Approved Not Delivered");
await approve(Y.cid);
const X = await fresh(road, "Delivered Driver");
await approve(X.cid);
const xp = await photos(X.cid);
const xr = await deliver(X.cid, payload(xp));
assert.equal(xr.status, 201, JSON.stringify(xr.body));

// ================================================================== listing / summary / filters
test("summary uses real counts; approved = yet to deliver + delivered (no double counting)", async () => {
  const r = await rbp("/summary");
  assert.equal(r.status, 200);
  assert.deepEqual(keys(r.body), ["data", "message", "success"]);
  assert.deepEqual(r.body.data, { total: 4, approved: 2, yetToApprove: 1, rejected: 1, yetToDeliver: 1, delivered: 1 });
  assert.equal(r.body.data.approved, r.body.data.yetToDeliver + r.body.data.delivered);
  assert.deepEqual(Object.keys((await rsa("/summary")).body.data).sort(), ["approved", "rejected", "total", "yetToApprove"]); // the RSA summary contract is unchanged
});

test("status filter: all / yet to deliver / yet to approve / rejected / approved / delivered, with delivery status per row", async () => {
  const q = async (qs: string) => (await rbp(`?${qs}`)).body.data;
  const tn = (r: any) => r.items.map((x: any) => x.trackupNumber).sort();
  assert.equal((await q("")).total, 4);
  assert.deepEqual(tn(await q("status=YET_TO_DELIVER")), [Y.tvx.trackupNumber]);
  assert.deepEqual(tn(await q("status=YET_TO_APPROVE")), [P.tvx.trackupNumber]);
  assert.deepEqual(tn(await q("status=REJECTED")), [R.tvx.trackupNumber]);
  assert.deepEqual(tn(await q("status=APPROVED")), [X.tvx.trackupNumber, Y.tvx.trackupNumber].sort());
  assert.deepEqual(tn(await q("status=DELIVERED")), [X.tvx.trackupNumber]);
  const all = (await q("limit=100")).items;
  const by = (c: any) => all.find((x: any) => x.trackupNumber === c.tvx.trackupNumber);
  assert.deepEqual([by(P).deliveryStatus, by(R).deliveryStatus, by(Y).deliveryStatus, by(X).deliveryStatus], [null, null, "YET_TO_DELIVER", "DELIVERED"]); // rejected / pending are never deliverable
  assert.ok(by(X).deliveredAt && by(X).deliveredBy === "RBP" && by(X).approvedAt && by(X).approvedBy === "RSA");
  assert.equal(by(Y).deliveredAt, null);
});

test("mass search (incl. project name), combined filters, pagination, latest first", async () => {
  const q = async (qs: string) => (await rbp(`?${qs}`)).body.data;
  for (const term of [Y.tvx.trackupNumber, Y.tvx.pifNumber, "kensign", Y.veh.vehicleNo.toLowerCase(), "approved not", Y.drv.driverNumber]) assert.ok((await q(`q=${encodeURIComponent(term)}`)).items.some((x: any) => x.trackupNumber === Y.tvx.trackupNumber), term);
  const pn = ((await Clearance.findOne({ _id: Y.cid }).lean()) as any).projectName;
  if (pn) assert.ok((await q(`q=${encodeURIComponent(pn)}`)).total >= 1); // project name is searchable
  assert.equal((await q("status=YET_TO_DELIVER&projectType=ROADSHOW")).total, 0); // filters work together
  assert.equal((await q("status=DELIVERED&projectType=ROADSHOW")).total, 1);
  assert.equal((await q(`status=DELIVERED&q=${X.drv.driverNumber}`)).total, 1);
  assert.equal((await q(`from=${d(0)}&to=${d(0)}`)).total, 4);
  assert.equal((await q(`from=${d(1)}`)).total, 0);
  const p1 = await q("limit=3&page=1"), p2 = await q("limit=3&page=2");
  assert.deepEqual([p1.items.length, p2.items.length, p1.total], [3, 1, 4]);
  const t = (await q("limit=100")).items.map((x: any) => +new Date(x.submittedAt));
  assert.deepEqual(t, [...t].sort((a, b) => b - a));
});

// ================================================================== eligibility
test("only RSA-approved, not-yet-delivered allocations can be delivered", async () => {
  const pend = await photosTry(P.cid);
  assert.equal(pend.status, 409);
  assert.equal(pend.body.message, "RSA approval is required before delivery");
  const rej = await photosTry(R.cid);
  assert.equal(rej.status, 409);
  assert.match(rej.body.message, /rejected allocation cannot be delivered/);
  for (const cid of [P.cid, R.cid]) {
    const r = await deliver(cid, { description: "Handover done", speedometerPhoto: { key: xp.s.key }, evidencePhoto: { key: xp.e.key } });
    assert.equal(r.status, 409, cid);
    assert.equal(r.body.data, null);
  }
  assert.equal(await VehicleDelivery.countDocuments({ clearance: { $in: [P.cid, R.cid] } }), 0);
  assert.equal(((await Clearance.findById(R.cid).lean()) as any).status, "REJECTED"); // rejection record untouched
});
async function photosTry(cid: string) { return upload(cid, "speedometer", JPG); }

test("delivered allocation cannot be delivered again; uploads are refused too", async () => {
  const again = await photos(Y.cid).catch(() => null);
  assert.ok(again); // Y is still deliverable (control)
  const r = await upload(X.cid, "speedometer", JPG);
  assert.equal(r.status, 409);
  assert.match(r.body.message, /already been delivered/);
  const r2 = await deliver(X.cid, payload(await photos(Y.cid).then((p) => p), {})); // another clearance's photos on a delivered one
  assert.equal(r2.status, 409);
});

// ================================================================== photo validation
test("photo upload: formats, content, size, kind, role", async () => {
  const ok = await upload(Y.cid, "speedometer", JPG, "meter.JPG");
  assert.equal(ok.status, 201);
  assert.deepEqual(keys(ok.body), ["data", "message", "success"]);
  assert.equal(ok.body.data.kind, "SPEEDOMETER");
  assert.match(ok.body.data.key, /^driver_settlement\/delivery-photos\/\d{4}\/\d{2}\/[0-9a-f-]{36}-meter\.JPG$/i);
  assert.ok(ok.body.data.url.includes("/files/"));
  assert.ok(fs.existsSync(path.join(storageDir, ok.body.data.key))); // stored through the existing storage service
  assert.equal((await upload(Y.cid, "evidence", PNG, "a.png", "image/png")).status, 201);
  assert.equal((await upload(Y.cid, "evidence", Buffer.alloc(900, 1).fill(1), "a.webp", "image/webp")).status, 400); // not really webp
  assert.equal((await upload(Y.cid, "evidence", Buffer.from("%PDF-1.4 x"), "doc.pdf", "application/pdf")).status, 400); // pdf is not a photo
  assert.equal((await upload(Y.cid, "evidence", Buffer.from("hello world"), "a.jpg", "image/jpeg")).status, 400); // renamed text file
  assert.equal((await upload(Y.cid, "evidence", PNG, "a.jpg", "image/jpeg")).status, 400); // content does not match the type
  assert.equal((await upload(Y.cid, "evidence", Buffer.alloc(0), "a.jpg", "image/jpeg")).status, 400);
  assert.equal((await upload(Y.cid, "evidence", Buffer.concat([JPG, Buffer.alloc(11 * 1024 * 1024)]), "big.jpg")).status, 413);
  assert.equal((await upload(Y.cid, "odometer", JPG)).status, 400);
  const none = await fetch(`${base}/on-road-vehicles/${Y.cid}/photos/speedometer`, { method: "POST", headers: { Authorization: `Bearer ${(await T()).rbp}` }, body: new FormData() });
  assert.equal(none.status, 400);
  assert.equal((await upload(Y.cid, "speedometer", JPG, "a.jpg", "image/jpeg", (await T()).rsa)).status, 403);
  assert.equal((await upload(Y.cid, "speedometer", JPG, "a.jpg", "image/jpeg", (await T()).rsom)).status, 403);
  assert.equal((await upload("bad", "speedometer", JPG)).status, 400);
});

test("delivery validation: description, both photos mandatory, valid keys, no cross-allocation evidence", async () => {
  const p = await photos(Y.cid);
  const base = payload(p);
  const fail = async (body: any, re?: RegExp) => {
    const r = await deliver(Y.cid, body);
    assert.equal(r.status, 400, JSON.stringify(body) + JSON.stringify(r.body));
    assert.equal(r.body.data, null);
    if (re) assert.match(r.body.message, re);
  };
  await fail({ ...base, description: "" }, /description is required/);
  await fail({ ...base, description: "   " }, /description is required/);
  await fail({ ...base, description: "abc" }, /at least/);
  await fail({ ...base, description: "x".repeat(1001) }, /too long/);
  await fail({ ...base, speedometerPhoto: undefined }, /Speedometer photo is required/);
  await fail({ ...base, evidencePhoto: undefined }, /handover photo is required/);
  await fail({ ...base, speedometerPhoto: { key: "../../etc/passwd" } }, /invalid/);
  await fail({ ...base, evidencePhoto: { key: p.s.key } }, /two different photos/);
  await fail({ ...base, speedometerPhoto: { key: p.e.key }, evidencePhoto: { key: p.s.key } }, /does not belong/); // kinds swapped
  const other = await photos(Y.cid);
  assert.equal((await deliver(Y.cid, { ...base, speedometerPhoto: { key: "driver_settlement/vehicles/2026/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa-x.jpg" } })).status, 400); // never uploaded
  void other;
  // evidence uploaded for another allocation (wrong vehicle / project) is refused
  const Z = await fresh(sig, "Cross Mapping Driver");
  await approve(Z.cid);
  const zp = await photos(Z.cid);
  const cross = await deliver(Y.cid, { ...base, speedometerPhoto: { key: zp.s.key } });
  assert.equal(cross.status, 400);
  assert.match(cross.body.message, /does not belong to this vehicle delivery/);
  assert.equal(await VehicleDelivery.countDocuments({ clearance: Y.cid }), 0);
  assert.equal(((await Clearance.findById(Y.cid).lean()) as any).deliveryStatus ?? null, null);
});

// ================================================================== successful delivery
test("delivered record: server time, RBP user, file references only, history, notification, RSA records untouched", async () => {
  const D = await fresh(road, "Happy Path Driver");
  await approve(D.cid);
  const clrBefore = JSON.stringify(await Clearance.findById(D.cid).lean());
  const rsaEventsBefore = await ClearanceEvent.countDocuments({ clearance: D.cid });
  const allotBefore = JSON.stringify(await VehicleAllotment.findById(D.allotment._id).lean());
  const drvBefore = JSON.stringify(await Driver.findById(D.drv._id).lean());
  const p = await photos(D.cid);
  const t0 = Date.now();
  const r = await deliver(D.cid, payload(p, { deliveredAt: "2001-01-01T00:00:00Z", deliveredBy: "HACKER", version: 1 }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(keys(r.body), ["data", "message", "success"]);
  const doc: any = await VehicleDelivery.findOne({ clearance: D.cid }).lean();
  assert.equal(doc.deliveredBy, "RBP"); // the logged-in user, not the body
  assert.ok(+new Date(doc.deliveredAt) >= t0 - 1000 && +new Date(doc.deliveredAt) <= Date.now() + 1000); // server time, not the body
  assert.equal(doc.approvalVersion, 1);
  assert.equal(doc.approvedBy, "RSA");
  assert.equal(String(doc.allotment), String(D.allotment._id));
  assert.equal(doc.speedometerPhoto.key, p.s.key);
  assert.equal(doc.evidencePhoto.key, p.e.key);
  assert.ok(JSON.stringify(doc).length < 3000 && !/base64|data:image/.test(JSON.stringify(doc))); // references only, no image data
  assert.ok(fs.existsSync(path.join(storageDir, doc.speedometerPhoto.key)) && fs.existsSync(path.join(storageDir, doc.evidencePhoto.key)));
  const c: any = await Clearance.findById(D.cid).lean();
  assert.deepEqual([c.status, c.deliveryStatus, c.deliveredBy, c.reviewedBy, c.currentVersion], ["APPROVED", "DELIVERED", "RBP", "RSA", 1]);
  assert.equal(await ClearanceEvent.countDocuments({ clearance: D.cid }), rsaEventsBefore); // RSA approval history not touched
  const strip = (j: string) => { const o = JSON.parse(j); for (const k of ["deliveryStatus", "deliveredAt", "deliveredBy", "delivery", "updatedAt", "__v"]) delete o[k]; return JSON.stringify(o); };
  assert.equal(strip(JSON.stringify(c)), strip(clrBefore)); // only the delivery fields changed on the clearance
  assert.equal(JSON.stringify(await VehicleAllotment.findById(D.allotment._id).lean()), allotBefore); // allotment + driver availability untouched
  assert.equal(JSON.stringify(await Driver.findById(D.drv._id).lean()), drvBefore);
  const ev = (await DeliveryEvent.find({ clearance: D.cid }).sort({ at: 1, _id: 1 }).lean()) as any[];
  assert.deepEqual(ev.map((e) => e.action), ["SPEEDOMETER_PHOTO_UPLOADED", "EVIDENCE_PHOTO_UPLOADED", "DELIVERED"]);
  const n: any[] = await Notification.find({ recipient: rsaUser._id, type: "VEHICLE_DELIVERED", "meta.trackupNumber": D.tvx.trackupNumber }).lean();
  assert.equal(n.length, 1);
  assert.match(n[0].message, /Vehicle delivery completed successfully for JS-/);
  assert.deepEqual([n[0].meta.deliveredBy, n[0].meta.vehicleNo, n[0].meta.driverName], ["RBP", D.veh.vehicleNo, "Happy Path Driver"]);
  // immutable
  await assert.rejects(DeliveryEvent.updateOne({ _id: ev[0]._id }, { $set: { username: "x" } }), /immutable/);
  await assert.rejects(DeliveryEvent.deleteMany({}), /immutable/);
});

test("duplicate delivery: same request replays (one record, one notification); different photos / concurrent requests are blocked", async () => {
  const before = await VehicleDelivery.countDocuments({ clearance: X.cid });
  const replay = await deliver(X.cid, payload(xp));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.message, "Vehicle was already delivered");
  assert.equal(await VehicleDelivery.countDocuments({ clearance: X.cid }), before);
  assert.equal(await Notification.countDocuments({ type: "VEHICLE_DELIVERED", "meta.trackupNumber": X.tvx.trackupNumber }), 1);
  const other = await photos(Y.cid);
  assert.equal((await deliver(X.cid, payload(other))).status, 409);
  // concurrency on a different allocation
  const C = await fresh(sig, "Concurrent Driver");
  await approve(C.cid);
  const cp = await photos(C.cid);
  const rs = await Promise.all([deliver(C.cid, payload(cp)), deliver(C.cid, payload(cp)), deliver(C.cid, payload(cp))]);
  assert.ok(rs.every((x) => x.status === 201 || x.status === 200 || x.status === 409), JSON.stringify(rs.map((x) => x.status)));
  assert.equal(rs.filter((x) => x.status === 201).length, 1);
  assert.equal(await VehicleDelivery.countDocuments({ clearance: C.cid }), 1);
  assert.equal(await Notification.countDocuments({ type: "VEHICLE_DELIVERED", "meta.trackupNumber": C.tvx.trackupNumber }), 1);
});

test("failed / incomplete delivery leaves nothing Delivered and can be retried with the photos already uploaded", async () => {
  const F = await fresh(sig, "Retry Driver");
  await approve(F.cid);
  const s = await upload(F.cid, "speedometer", JPG, "s.jpg");
  const early = await deliver(F.cid, { description: "Handing over now", speedometerPhoto: { key: s.body.data.key } });
  assert.equal(early.status, 400); // evidence photo missing
  assert.equal(await VehicleDelivery.countDocuments({ clearance: F.cid }), 0);
  assert.equal(((await Clearance.findById(F.cid).lean()) as any).deliveryStatus ?? null, null);
  const bad = await upload(F.cid, "evidence", Buffer.from("not an image"), "e.png", "image/png"); // upload fails
  assert.equal(bad.status, 400);
  assert.equal(await DeliveryEvent.countDocuments({ clearance: F.cid, action: "EVIDENCE_PHOTO_UPLOADED" }), 0);
  const e = await upload(F.cid, "evidence", PNG, "e.png", "image/png"); // retry only the failed photo
  const ok = await deliver(F.cid, payload({ s: s.body.data, e: e.body.data }));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(await VehicleDelivery.countDocuments({ clearance: F.cid }), 1);
  // the clearance flip loses a race (allocation changed while delivering): the delivery row is removed again
  const G = await fresh(sig, "Race Driver");
  await approve(G.cid);
  const gp = await photos(G.cid);
  const orig = Clearance.findOneAndUpdate.bind(Clearance);
  (Clearance as any).findOneAndUpdate = () => { (Clearance as any).findOneAndUpdate = orig; return { lean: async () => null }; };
  const lost = await deliver(G.cid, payload(gp));
  (Clearance as any).findOneAndUpdate = orig;
  assert.equal(lost.status, 409);
  assert.equal(await VehicleDelivery.countDocuments({ clearance: G.cid }), 0);
  assert.equal(((await Clearance.findById(G.cid).lean()) as any).deliveryStatus ?? null, null);
  assert.equal((await deliver(G.cid, payload(gp))).status, 201); // safe retry
});

test("a resubmitted / changed allocation needs fresh RSA approval before delivery; old delivery is preserved", async () => {
  const al: any = await VehicleAllotment.findOne({ trackingVehicle: X.tvx._id, status: "ACTIVE" }).lean();
  const newDrv = await mkDriver("Replacement After Delivery");
  assert.equal((await call(`/vehicle-allotments/${al._id}/change-driver`, "POST", { driverId: newDrv._id, reason: "Swap" }, (await T()).rbp)).status, 200);
  const c: any = await Clearance.findById(X.cid).lean();
  assert.deepEqual([c.status, c.currentVersion, c.deliveryStatus ?? null, c.driverName], ["YET_TO_APPROVE", 2, null, "Replacement After Delivery"]);
  assert.equal(await VehicleDelivery.countDocuments({ clearance: X.cid }), 1); // v1 delivery kept
  const r = await upload(X.cid, "speedometer", JPG);
  assert.equal(r.status, 409);
  assert.equal(r.body.message, "RSA approval is required before delivery");
  assert.equal((await deliver(X.cid, payload(xp))).status, 409); // old photos / old approval cannot deliver v2
  await approve(X.cid);
  const p = await photos(X.cid);
  assert.equal((await deliver(X.cid, payload(p))).status, 201);
  assert.equal(await VehicleDelivery.countDocuments({ clearance: X.cid }), 2);
  const hist = (await rbp(`/${X.cid}`)).body.data.deliveryHistory;
  assert.equal(hist[0].action, "DELIVERED");
  assert.equal(hist[0].version, 2);
  assert.ok(hist.some((h: any) => h.version === 1 && h.action === "DELIVERED"));
});

// ================================================================== detail
test("detail: form data auto-populated, canDeliver rules, delivered view with photo URLs, history latest first", async () => {
  const y = (await rbp(`/${Y.cid}`)).body.data;
  assert.equal(y.canDeliver, true);
  assert.equal(y.deliveryStatus, "YET_TO_DELIVER");
  assert.equal(y.project.trackupNumber, Y.tvx.trackupNumber);
  assert.equal(y.project.clientName, "Kensign Lifestyles");
  assert.equal(y.project.location, "Coimbatore");
  assert.ok(y.project.projectFrom && y.project.projectTo);
  assert.equal(y.vehicle.vehicleNo, Y.veh.vehicleNo);
  assert.equal(y.vehicle.make, "Tata");
  assert.ok(y.vehicle.allottedAt);
  assert.equal(y.approvedAt, y.reviewedAt);
  assert.equal(y.driver.driverNumber, Y.drv.driverNumber);
  assert.ok(y.driver.assignedAt && y.driver.mobileNumber);
  assert.equal(y.delivery, null);
  assert.equal((await rbp(`/${P.cid}`)).body.data.canDeliver, false);
  assert.equal((await rbp(`/${R.cid}`)).body.data.canDeliver, false);
  const x = (await rbp(`/${X.cid}`)).body.data;
  assert.equal(x.canDeliver, false);
  assert.equal(x.deliveryStatus, "DELIVERED");
  assert.equal(x.delivery.description.length > 4, true);
  assert.ok(x.delivery.speedometerPhoto.url.includes("/files/") && x.delivery.evidencePhoto.url.includes("/files/"));
  assert.equal(x.delivery.deliveredBy, "RBP");
  const times = x.deliveryHistory.map((h: any) => +new Date(h.at));
  assert.deepEqual(times, [...times].sort((a: number, b: number) => b - a));
  assert.ok(x.deliveryHistory.some((h: any) => h.action === "RSA_APPROVED"));
  assert.ok(x.deliveryHistory.some((h: any) => h.action === "SPEEDOMETER_PHOTO_UPLOADED"));
});

// ================================================================== access + regression
test("access control and the sendResponse envelope on every new endpoint", async () => {
  const t = await T();
  assert.equal((await call(`/on-road-vehicles/${Y.cid}/deliver`, "POST", {})).status, 401);
  for (const [p, m, tok] of [[`/on-road-vehicles/${Y.cid}/deliver`, "POST", t.rsa], [`/on-road-vehicles/${Y.cid}/deliver`, "POST", t.rsop], ["/on-road-vehicles/summary", "GET", t.rsa]] as const) {
    const r = await call(p, m, m === "POST" ? {} : undefined, tok);
    assert.equal(r.status, 403);
    assert.equal(r.body.data, null);
  }
  for (const [p, m, body] of [["/on-road-vehicles/summary", "GET"], [`/on-road-vehicles/${Y.cid}`, "GET"], [`/on-road-vehicles/${Y.cid}/deliver`, "POST", {}], ["/on-road-vehicles/bad/deliver", "POST", {}], ["/on-road-vehicles/aaaaaaaaaaaaaaaaaaaaaaaa/deliver", "POST", {}]] as const) {
    const r = await call(p, m, body, t.rbp);
    assert.deepEqual(keys(r.body), ["data", "message", "success"], p);
    if (!r.body.success) assert.equal(r.body.data, null);
  }
  assert.equal((await call("/on-road-vehicles/bad/deliver", "POST", {}, t.rbp)).status, 400);
  assert.equal((await call("/on-road-vehicles/aaaaaaaaaaaaaaaaaaaaaaaa/deliver", "POST", payload(xp), t.rbp)).status, 404);
});

test("regression: RSA clearance, payments and the other modules still work; delivery never alters financial or master records", async () => {
  const t = await T();
  for (const [p, tok] of [["/tracking", t.rsop], ["/approvals", t.rsom], ["/vehicles", t.rbp], ["/vehicle-allotments", t.rbp], ["/drivers", t.rbp], ["/rsa/projects", t.rsa], ["/rsa/payments", t.rsa], ["/rsa-clearances", t.rsa], ["/rsa-clearances/summary", t.rsa], ["/notifications", t.rsa]] as const) {
    const r = await call(p, "GET", undefined, tok);
    assert.equal(r.status, 200, p);
    assert.deepEqual(keys(r.body), ["data", "message", "success"], p);
  }
  const rsaList = (await rsa("?limit=100")).body.data;
  assert.ok(rsaList.items.every((x: any) => ["YET_TO_APPROVE", "APPROVED", "REJECTED"].includes(x.status)));
  assert.equal((await rsa(`?status=APPROVED`)).body.data.items.length >= 2, true);
  const snap = async () => JSON.stringify({ b: await Budget.find().sort({ _id: 1 }).lean(), a: await DriverAdvance.find().sort({ _id: 1 }).lean(), tp: await TrackingProject.find().sort({ _id: 1 }).lean(), pay: await RsaPayment.countDocuments(), al: await VehicleAllotment.find().sort({ _id: 1 }).lean() });
  const before = await snap();
  await rbp("?limit=100");
  await rbp("/summary");
  await rbp(`/${X.cid}`);
  assert.equal(await snap(), before);
});

test("additional photos: several optional extra photos, bound to this delivery, stored and returned with preview urls", async () => {
  const A = await fresh(road, "Extra Photos Driver");
  await approve(A.cid);
  const p = await photos(A.cid);
  const ex1 = await upload(A.cid, "additional", JPG, "side-left.jpg");
  const ex2 = await upload(A.cid, "additional", PNG, "branding.png", "image/png");
  assert.equal(ex1.status, 201, JSON.stringify(ex1.body));
  assert.equal(ex1.body.data.kind, "ADDITIONAL");
  assert.equal((await upload(A.cid, "additional", Buffer.from("not an image"), "x.jpg")).status, 400); // content is checked
  assert.equal((await upload(A.cid, "selfie", JPG)).status, 400); // unknown photo kind
  // refused: a photo of another delivery, a duplicate, the speedometer photo reused, too many, not a list
  const otherKey = xp.s.key; // stored for vehicle X, as a speedometer photo
  for (const [extra, re] of [
    [[{ key: otherKey }], /does not belong to this vehicle delivery/],
    [[{ key: ex1.body.data.key }, { key: ex1.body.data.key }], /duplicate/],
    [[{ key: p.s.key }], /duplicate/],
    [Array.from({ length: 11 }, () => ({ key: ex1.body.data.key })), /max 10/],
    ["nope", /must be a list/],
  ] as [unknown, RegExp][]) {
    const r = await deliver(A.cid, payload(p, { additionalPhotos: extra }));
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.match(r.body.message, re);
  }
  assert.equal((await Clearance.findById(A.cid).lean() as any).deliveryStatus ?? "YET_TO_DELIVER", "YET_TO_DELIVER"); // nothing delivered by the refusals
  const ok = await deliver(A.cid, payload(p, { additionalPhotos: [{ key: ex1.body.data.key }, { key: ex2.body.data.key }] }));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.data.additionalPhotos.map((x: any) => x.name), ["side-left.jpg", "branding.png"]);
  const doc: any = await VehicleDelivery.findOne({ clearance: A.cid }).lean();
  assert.equal(doc.additionalPhotos.length, 2);
  assert.ok(doc.additionalPhotos.every((x: any) => x.key && typeof x.url === "string")); // metadata and the stored public URL
  // the View screen (RBP) and the RSA review both return every photo with a url for the preview
  const view = (await rbp(`/${A.cid}`)).body.data;
  assert.ok(view.delivery.speedometerPhoto.url && view.delivery.evidencePhoto.url);
  assert.equal(view.delivery.additionalPhotos.length, 2);
  assert.ok(view.delivery.additionalPhotos.every((x: any) => typeof x.url === "string" && x.url.length > 0));
  assert.ok(view.deliveryHistory.some((e: any) => e.action === "ADDITIONAL_PHOTO_UPLOADED"));
  // a retry with the same photos returns the delivery instead of creating another
  const again = await deliver(A.cid, payload(p, { additionalPhotos: [{ key: ex1.body.data.key }, { key: ex2.body.data.key }] }));
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(await VehicleDelivery.countDocuments({ clearance: A.cid }), 1);
  // older deliveries without extra photos still read fine
  assert.deepEqual((await rbp(`/${X.cid}`)).body.data.delivery.additionalPhotos, []);
});

test("On Road Vehicles: delivered + still allotted vehicles for RBP and RSA, daily payment state, other roles refused", async () => {
  const t = await T();
  const list = async (token: string, qs = "") => call(`/settlements/on-road${qs}`, "GET", undefined, token);
  for (const token of [t.rbp, t.rsa]) {
    const r = await list(token);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const tv = new Set(r.body.data.items.map((x: any) => x.trackingVehicle));
    assert.ok(tv.has(String(X.tvx._id)), "delivered vehicle is on road");
    assert.ok(!tv.has(String(Y.tvx._id)), "approved but not delivered is not on road");
    assert.ok(!tv.has(String(P.tvx._id)) && !tv.has(String(R.tvx._id)), "pending / rejected are not on road");
    const x = r.body.data.items.find((i: any) => i.trackingVehicle === String(X.tvx._id));
    const cur: any = await Clearance.findById(X.cid).lean(); // an earlier test changed this vehicle's driver after delivery
    assert.deepEqual([x.vehicleNo, x.driverName, x.projectType], [cur.vehicleNo, cur.driverName, "ROADSHOW"]);
    assert.ok(x.deliveredAt && x.deliveredBy === "RBP");
    assert.deepEqual(x.dailyPayments, { count: 0, pending: 0, rejected: 0, lastPaidUpTo: null });
  }
  assert.equal((await list(t.rbp, `?q=${encodeURIComponent(X.veh.vehicleNo)}`)).body.data.items.length, 1);
  assert.equal((await list(t.rbp, "?projectType=SIGNAGE")).body.data.items.some((i: any) => i.trackingVehicle === String(X.tvx._id)), false);
  assert.equal((await list(t.rsom)).status, 403);
  assert.equal((await list(t.rsop)).status, 403);
  // released: no longer on road
  const rel = await call(`/vehicle-allotments/${X.allotment._id}/release`, "POST", { reason: "Campaign ended" }, t.rbp);
  assert.equal(rel.status, 200, JSON.stringify(rel.body));
  assert.ok(!(await list(t.rbp)).body.data.items.some((i: any) => i.trackingVehicle === String(X.tvx._id)));
});

test("On Road Vehicles regression: list never uses a payment id; vehicles with and without payments, filters, valid daily-payment targets, bad ids", async () => {
  const t = await T();
  const onRoad = async (token: string, qs = "") => call(`/settlements/on-road${qs}`, "GET", undefined, token);
  const deliverNew = async (proj: any, name: string) => {
    const v = await fresh(proj, name);
    await approve(v.cid);
    const ph = await photos(v.cid);
    const r = await deliver(v.cid, payload(ph));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return v;
  };
  // three delivered vehicles on two projects: one paid by RBP, one paid by RSA and approved by RSOM, one never paid
  const paidRbp = await deliverNew(sig, "Paid By RBP Driver");
  const paidRsa = await deliverNew(sig, "Paid By RSA Driver");
  const unpaid = await deliverNew(road, "Never Paid Driver");
  let k = 0;
  const pay = async (token: string, v: any) => {
    const c = (await call(`/settlements/projects/${v.tvx._id}`, "GET", undefined, token)).body.data;
    const r = await call(`/settlements/projects/${v.tvx._id}/daily`, "POST", { paymentFor: c.projectType, fromDate: c.campaign.fromDate, toDate: c.campaign.fromDate, foodAmount: "300", idempotencyKey: `onroad-regression-${++k}` }, token);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.data;
  };
  await pay(t.rbp, paidRbp);
  const second = await pay(t.rsa, paidRsa);
  const ap = await call(`/settlements/${second._id}/approve`, "POST", { version: second.version }, t.rsom); // RSOM approval workflow unchanged
  assert.equal(ap.status, 200, JSON.stringify(ap.body));

  for (const [role, token] of [["RBP", t.rbp], ["RSA", t.rsa]] as const) {
    const r = await onRoad(token, "?limit=100");
    assert.equal(r.status, 200, `${role}: ${JSON.stringify(r.body)}`); // never "Invalid payment id": /on-road is not read as /:id
    const row = (v: any) => r.body.data.items.find((i: any) => i.trackingVehicle === String(v.tvx._id));
    assert.ok(row(unpaid), `${role}: a vehicle without any payment is listed`);
    assert.deepEqual(row(unpaid).dailyPayments, { count: 0, pending: 0, rejected: 0, lastPaidUpTo: null });
    assert.deepEqual([row(paidRbp).dailyPayments.count, row(paidRbp).dailyPayments.pending], [1, 1]);
    assert.deepEqual([row(paidRsa).dailyPayments.count, row(paidRsa).dailyPayments.pending], [1, 0]); // approved by RSOM
    assert.ok(row(paidRbp).dailyPayments.lastPaidUpTo);
    assert.equal(r.body.data.total, r.body.data.items.length);
    // every row's Daily Vehicle Payment target (the project vehicle id) opens the existing payment context for this role
    for (const item of r.body.data.items) {
      assert.match(item.trackingVehicle, /^[a-f0-9]{24}$/);
      const ctx = await call(`/settlements/projects/${item.trackingVehicle}`, "GET", undefined, token);
      assert.equal(ctx.status, 200, `${role} ${item.trackupNumber}: ${JSON.stringify(ctx.body)}`);
      assert.equal(ctx.body.data.trackupNumber, item.trackupNumber);
      assert.equal(ctx.body.data.vehicleNo, item.vehicleNo);
    }
    // filters: project type and search (trackup, vehicle no, driver name)
    const types = (await onRoad(token, "?projectType=SIGNAGE&limit=100")).body.data.items;
    assert.ok(types.length >= 2 && types.every((i: any) => i.projectType === "SIGNAGE"));
    assert.ok(!types.some((i: any) => i.trackingVehicle === String(unpaid.tvx._id)));
    assert.ok((await onRoad(token, "?projectType=ROADSHOW&limit=100")).body.data.items.some((i: any) => i.trackingVehicle === String(unpaid.tvx._id)));
    for (const q of [unpaid.tvx.trackupNumber, unpaid.veh.vehicleNo, "never paid"]) {
      const hit = (await onRoad(token, `?q=${encodeURIComponent(q)}`)).body.data.items;
      assert.deepEqual(hit.map((i: any) => i.trackingVehicle), [String(unpaid.tvx._id)], q);
    }
    assert.deepEqual((await onRoad(token, "?q=%25.*%5B")).body.data.items, []); // regex characters are escaped
    assert.equal((await onRoad(token, "?projectType=NOPE")).status, 200); // an unknown type is ignored, not an error
    // pagination
    const p1 = (await onRoad(token, "?limit=1&page=1")).body.data;
    const p2 = (await onRoad(token, "?limit=1&page=2")).body.data;
    assert.equal(p1.items.length, 1);
    assert.notEqual(p1.items[0].trackingVehicle, p2.items[0]?.trackingVehicle);
  }
  // invalid / missing ids give precise errors on their own routes; the list itself never needs one
  assert.equal((await call("/settlements/projects/not-an-id", "GET", undefined, t.rbp)).status, 400);
  assert.equal((await call(`/settlements/projects/${"0".repeat(24)}`, "GET", undefined, t.rbp)).status, 404);
  const badPay = await call("/settlements/not-an-id", "GET", undefined, t.rbp);
  assert.deepEqual([badPay.status, badPay.body.message], [400, "Invalid payment id"]);
  assert.equal((await call(`/settlements/${"0".repeat(24)}`, "GET", undefined, t.rbp)).status, 404);
  // permissions unchanged: only the entry roles see the list; no token is refused
  assert.equal((await onRoad(t.rsom)).status, 403);
  assert.equal((await onRoad(t.rsop)).status, 403);
  assert.equal((await call("/settlements/on-road")).status, 401);
});

test("cleanup", async () => {
  assert.match(mongoose.connection.name, /_test_/);
  await mongoose.connection.dropDatabase();
  fs.rmSync(storageDir, { recursive: true, force: true });
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
});
