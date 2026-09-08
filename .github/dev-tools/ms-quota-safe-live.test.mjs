import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stageWorker } from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const workerSource = await readFile(new URL("worker/src/index.js", root), "utf8");
const frontendSource = await readFile(new URL("ms.js", root), "utf8");
const staged = stageWorker(workerSource);

function section(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0 && end > start, `${startNeedle} section missing`);
  return source.slice(start, end);
}

test("changed live source diffs against existing completion-v2 cache before Turso route-table fallback", () => {
  assert.match(staged, /MS_QUOTA_SAFE_LIVE_V1/);
  const sync = section(staged, "async function syncMs", "async function refreshMsIfStale");
  assert.match(sync, /const cacheBaseline = Array\.isArray\(body\.baselineRows\)/);
  assert.match(sync, /cacheBaseline\s*\? Promise\.resolve\(\{ results: \[\] \}\)\s*:\s*env\.DB\.prepare\("SELECT \* FROM ms_routes WHERE hub=\?"\)/);
  assert.match(sync, /const oldRows = cacheBaseline \|\| oldRowsResult\.results\.map\(output\)/);
  assert.match(sync, /const plan = planMsChanges\(\s*oldRows,/);
  assert.doesNotMatch(sync, /oldRows\.map\(output\)/);
});

test("live refresh trusts a cache baseline only after completion-v2 migration", () => {
  const live = section(staged, "async function runMsRefresh", "async function readMsLiveCache");
  assert.match(live, /let cache = await readMsLiveCache\(env, branch, sourceHash\)/);
  assert.match(live, /if \(cache\?\.sourceMatch\)/);
  assert.match(live, /const baselineCache = currentCache \|\| cache/);
  assert.match(live, /String\(baselineCache\?\.sourceHash \|\| ""\)\.startsWith\("completion-v2:"\)/);
  assert.match(live, /baselineRows:[\s\S]*?baselineCache\?\.rows \|\| null[\s\S]*?: null/);
  assert.match(live, /publishSource = true/);
  assert.match(live, /writeMsLiveCache\(/);
});

test("quota optimization preserves cancellation and truth-only completion history", () => {
  const sync = section(staged, "async function syncMs", "async function refreshMsIfStale");
  assert.match(sync, /SELECT route_id,proof_id,cancelled_at,cancelled_by,reason FROM ms_route_cancellations/);
  assert.match(sync, /snapshot\.queueCancelledAt = cancellation\.cancelled_at/);
  assert.match(sync, /INSERT INTO ms_route_history VALUES/);
  assert.match(sync, /completionObservedLive/);
  assert.match(sync, /resolveUnloadingCompletedAt\(old, unloadingState, now\)/);
  assert.match(sync, /if \(!old\)\s*statements\.push\(\s*env\.DB\.prepare\(\s*"INSERT OR IGNORE INTO ms_route_registry/);
  assert.match(sync, /SELECT \* FROM ms_routes WHERE hub=\?/);
  assert.match(staged, /MS_COMPLETION_DAILY_HISTORY_TRUTH_V2/);
  assert.match(staged, /MS_COMPLETION_ARCHIVE_TRUTH_V2/);
  assert.match(staged, /ensureMsCompletionRepair/);
});

test("frontend realtime cadence remains exactly four seconds", () => {
  assert.match(frontendSource, /pollMs:\s*4000/);
});
