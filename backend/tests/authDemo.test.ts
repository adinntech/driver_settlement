/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/driver_settlement_test_auth_demo";
process.env.JWT_SECRET = "test-secret";
delete process.env.DEMO_LOGIN_HINTS;
for (const [r, p] of [["RSOP", "p1"], ["RBP", "p2"], ["RSOM", "p3"], ["RSA", "p4"], ["RSO", "p5"]]) {
  process.env[`${r}_USERNAME`] = r;
  process.env[`${r}_PASSWORD`] = p;
}

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";

const { config: cfg } = await import("../src/config/index.js");
const { default: app } = await import("../src/app.js");

let server: Server;
let base = "";
const get = async () => {
  const r = await fetch(`${base}/auth/demo-credentials`);
  return { status: r.status, body: (await r.json()) as any, cache: r.headers.get("cache-control") };
};
before(() => {
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});
after(() => server.close());

test("demo credentials are off by default (404, nothing revealed)", async () => {
  cfg.demoLoginHints = false;
  cfg.env = "development";
  const r = await get();
  assert.equal(r.status, 404);
  assert.equal(r.body.data, null);
});

test("with DEMO_LOGIN_HINTS=true in development they come from the configured env values, never cached", async () => {
  cfg.demoLoginHints = true;
  cfg.env = "development";
  const r = await get();
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body.data).sort(), ["RBP", "RSA", "RSO", "RSOM", "RSOP"]);
  assert.deepEqual(r.body.data.RSO, { username: "RSO", password: "p5" });
  assert.equal(r.cache, "no-store");
});

test("in production the endpoint is always 404, even when the flag is set", async () => {
  cfg.demoLoginHints = true;
  cfg.env = "production";
  const r = await get();
  assert.equal(r.status, 404);
  assert.ok(!JSON.stringify(r.body).includes("p5"));
  cfg.env = "development";
  cfg.demoLoginHints = false;
});
