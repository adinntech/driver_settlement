import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { sendResponse } from "../src/utils/sendResponse.js";
import { errorHandler, notFound } from "../src/middleware/errorHandler.js";
import { AppError } from "../src/utils/AppError.js";

test("success with object data", () => {
  assert.deepEqual(sendResponse(true, "ok", { id: "1" }), { success: true, message: "ok", data: { id: "1" } });
});
test("success with array data", () => {
  assert.deepEqual(sendResponse(true, "ok", [1, 2]).data, [1, 2]);
});
test("success with null data", () => {
  assert.equal(sendResponse(true, "ok", null).data, null);
});
test("failure with object data", () => {
  const r = sendResponse(false, "Validation failed", { field: "email" });
  assert.equal(r.success, false);
  assert.deepEqual(r.data, { field: "email" });
});
test("failure with null data", () => {
  assert.deepEqual(sendResponse(false, "err", null), { success: false, message: "err", data: null });
});
test("success is boolean", () => {
  assert.equal(typeof sendResponse(true, "m").success, "boolean");
  assert.equal(typeof sendResponse(false, "m").success, "boolean");
});
test("message is string", () => {
  assert.equal(sendResponse(true, "hello").message, "hello");
  assert.equal(sendResponse(true, "").message, "");
});
test("exactly three keys", () => {
  assert.deepEqual(Object.keys(sendResponse(true, "m", 1)), ["success", "message", "data"]);
});
test("data key always exists (omitted / undefined)", () => {
  assert.ok("data" in sendResponse(true, "m"));
  assert.ok("data" in sendResponse(true, "m", undefined));
});
test("null stays real JSON null", () => {
  assert.equal(JSON.stringify(sendResponse(true, "m")), '{"success":true,"message":"m","data":null}');
});

// ---- Express integration ----
const buildApp = () => {
  const app = express();
  app.get("/ok", (_q, r) => r.status(200).json(sendResponse(true, "Fetched", { id: "123" })));
  app.get("/invalid", (_q, r) => r.status(400).json(sendResponse(false, "Validation failed", { field: "email" })));
  app.get("/unauth", (_q, r) => r.status(401).json(sendResponse(false, "Unauthorized", null)));
  app.get("/notfound", (_q, _r, next) => next(new AppError("Record not found", 404)));
  app.get("/boom", () => {
    throw new Error("boom");
  });
  app.use(notFound);
  app.use(errorHandler);
  return app;
};

const call = async (path: string) => {
  const server = buildApp().listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
};

test("express: success", async () => {
  const r = await call("/ok");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { success: true, message: "Fetched", data: { id: "123" } });
});
test("express: validation error", async () => {
  const r = await call("/invalid");
  assert.equal(r.status, 400);
  assert.equal(r.body.success, false);
  assert.deepEqual(r.body.data, { field: "email" });
});
test("express: unauthorized", async () => {
  const r = await call("/unauth");
  assert.equal(r.status, 401);
  assert.deepEqual(r.body, { success: false, message: "Unauthorized", data: null });
});
test("express: not found", async () => {
  const r = await call("/nope");
  assert.equal(r.status, 404);
  assert.deepEqual(Object.keys(r.body), ["success", "message", "data"]);
  assert.equal(r.body.data, null);
});
test("express: unexpected server error", async () => {
  const orig = console.error;
  console.error = () => {};
  try {
    const r = await call("/boom");
    assert.equal(r.status, 500);
    assert.equal(r.body.success, false);
    assert.equal(r.body.data, null);
  } finally {
    console.error = orig;
  }
});
