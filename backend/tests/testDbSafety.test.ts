import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

/**
 * Guard for the test suite itself: a test that drops its database must prove, right before dropping, that it is connected to a
 * throw-away *_test* database, and must not statically import application code. ES module imports are hoisted above the
 * `process.env.MONGO_URI = ...` lines, so a static import that reaches config would read the development database from .env
 * (this once wiped the local development data through tests/budget.test.ts).
 */
const dir = new URL("./", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".test.ts") && f !== "testDbSafety.test.ts");

test("every test that drops a database asserts a *_test* database name first", () => {
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), "utf8");
    const firstDrop = src.indexOf("dropDatabase()");
    if (firstDrop < 0) continue;
    const guard = src.search(/assert\.match\(mongoose\.connection\.name, \/_test/);
    assert.ok(guard >= 0 && guard < firstDrop, `${f}: assert the test database name before the first dropDatabase()`);
  }
});

test("tests that drop a database load application code only after pointing MONGO_URI at the test database", () => {
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), "utf8");
    if (!src.includes("dropDatabase()")) continue;
    const explicitOverride = /cfg\.mongoUri = /.test(src);
    const staticAppImports = src.split(/\r?\n/).filter((l) => /^import (?!type )[^;]*from "\.\.\/src\//.test(l));
    assert.ok(staticAppImports.length === 0 || explicitOverride, `${f}: static application imports (${staticAppImports.join(" | ")}) need cfg.mongoUri set to the test database`);
    assert.ok(explicitOverride || /process\.env\.MONGO_URI = "mongodb:\/\/127\.0\.0\.1:27017\/driver_settlement_test/.test(src), `${f}: no test database configured`);
  }
});
