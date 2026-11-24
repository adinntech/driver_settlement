import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { apiActivity, cachedGet, fetchCached, invalidateApiCache, request, tokenStore } from "../src/services/api";

// stub fetch: counts calls per URL, answers with the sendResponse envelope
const calls: string[] = [];
let release: (() => void) | null = null;
const g = globalThis as unknown as { fetch: typeof fetch };
g.fetch = (async (url: string, init?: RequestInit) => {
  calls.push(`${init?.method ?? "GET"} ${url}`);
  if (String(url).includes("/slow")) await new Promise<void>((r) => (release = r));
  return new Response(JSON.stringify({ success: true, message: "ok", data: { url: String(url), n: calls.length } }), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

beforeEach(() => {
  calls.length = 0;
  invalidateApiCache();
});

test("identical concurrent GETs share one network call, and the result is cached for revisits", async () => {
  const [a, b, c] = await Promise.all([fetchCached("/x?page=1"), fetchCached("/x?page=1"), fetchCached("/x?page=1")]);
  assert.equal(calls.length, 1, "deduplicated");
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
  assert.deepEqual(cachedGet("/x?page=1"), a, "a revisit can render instantly from the cache");
  await fetchCached("/x?page=2");
  assert.equal(calls.length, 2, "a different page is a different request");
});

test("any change (POST) and any login / logout clears the cache, so no role sees stale data", async () => {
  await fetchCached("/list");
  assert.ok(cachedGet("/list"));
  await request("/list/1/approve", "POST", {});
  assert.equal(cachedGet("/list"), undefined, "a mutation invalidates");
  await fetchCached("/list");
  tokenStore.set("another-user-token");
  assert.equal(cachedGet("/list"), undefined, "a new login starts clean");
  await fetchCached("/list");
  tokenStore.clear();
  assert.equal(cachedGet("/list"), undefined, "logout clears");
});

test("a response that started before an invalidation is not cached (no stale write-back)", async () => {
  const p = fetchCached("/slow");
  await new Promise((r) => setTimeout(r, 5));
  invalidateApiCache();
  release?.();
  await p;
  assert.equal(cachedGet("/slow"), undefined);
});

test("activity counter reports in-flight requests (drives the progress bar)", async () => {
  const seen: number[] = [];
  const off = apiActivity.subscribe(() => seen.push(apiActivity.count()));
  const p = fetchCached("/slow");
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(apiActivity.count(), 1);
  release?.();
  await p;
  off();
  assert.equal(apiActivity.count(), 0);
  assert.deepEqual(seen, [1, 0]);
});
