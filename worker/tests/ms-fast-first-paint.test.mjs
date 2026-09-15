import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = readFileSync(resolve(here, "../../ms.js"), "utf8");
const worker = readFileSync(resolve(here, "../src/index.js"), "utf8");

test("reload paints accepted browser snapshot before live reconnect", () => {
  assert.match(frontend, /MS_FAST_FIRST_PAINT_V1/);
  assert.match(frontend, /sessionStorage\.setItem\(key, JSON\.stringify\(snapshot\)\)/);
  assert.match(frontend, /restoreFastRefreshSnapshot\(\)/);
  assert.match(frontend, /void loadInitialData\(\)/);
  assert.match(frontend, /restartRealtimeTransport\(\)/);
  assert.doesNotMatch(frontend, /localStorage\.setItem\([^\n]*ms_fast_refresh_snapshot_v1/);
});

test("cold first paint uses Turso live cache without upstream MS refresh", () => {
  const start = worker.indexOf('if (action === "msRoutesSnapshot")');
  const end = worker.indexOf('if (action === "msRoutes")', start + 1);
  assert.ok(start >= 0 && end > start, "msRoutesSnapshot action missing");
  const block = worker.slice(start, end);
  assert.match(block, /FROM ms_live_cache/);
  assert.match(block, /snapshotAgeMs <= 20 \* 60 \* 1000/);
  assert.doesNotMatch(block, /refreshMsIfStale|runMsRefresh|readMsPage|INSERT|UPDATE|DELETE/);
});

test("cached first paint suppresses archive hydration and upstream duplicate work", () => {
  assert.match(frontend, /!fastSnapshotRestoreInProgress && state\.completedToday === 0/);
  assert.match(frontend, /!fastSnapshotRestoreInProgress && shouldHydrateCompletedTodayRows\(\)/);
  const loadInitial = frontend.slice(
    frontend.indexOf("async function loadInitialData()"),
    frontend.indexOf("async function loadData", frontend.indexOf("async function loadInitialData()")),
  );
  assert.match(loadInitial, /apiGet\("msRoutesSnapshot"/);
  assert.match(loadInitial, /restartRealtimeTransport\(\)/);
});
