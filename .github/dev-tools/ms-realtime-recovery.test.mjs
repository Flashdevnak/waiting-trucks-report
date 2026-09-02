import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  patchDevMsArchive,
  patchDevWorkerCompletedSummary,
} from "../../worker/scripts/patch-dev-ms-archive.mjs";
import {
  patchDevRealtimeFrontend,
  patchDevRealtimeWorker,
} from "./patch-ms-realtime-recovery.mjs";

const root = new URL("../../", import.meta.url);
const frontendSource = await readFile(new URL("ms.js", root), "utf8");
const workerSource = await readFile(
  new URL("worker/src/index.js", root),
  "utf8",
);
const stagedFrontend = patchDevMsArchive(frontendSource);
const stagedWorker = patchDevWorkerCompletedSummary(workerSource);
const frontend = patchDevRealtimeFrontend(stagedFrontend);
const worker = patchDevRealtimeWorker(stagedWorker);

function functionBody(source, name) {
  const marker = `async function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = source.indexOf("\nasync function ", start + marker.length);
  return source.slice(start, next < 0 ? source.length : next);
}

test("hung frontend polling request aborts and can release state.loading", () => {
  assert.match(frontend, /pollMs:\s*4000/);
  assert.match(frontend, /requestTimeoutMs:\s*22000/);
  assert.match(frontend, /new AbortController\(\)/);
  assert.match(frontend, /signal:\s*controller\.signal/);
  assert.match(frontend, /timeoutError\.code = "REQUEST_TIMEOUT"/);
  assert.match(frontend, /clearTimeout\(timeout\)/);
  assert.match(frontend, /if \(state\.loading\) return;/);
  assert.match(
    frontend,
    /finally \{\s*state\.loading = false;\s*\}/,
    "loadData must release its loading lock after timeout/error",
  );
});

test("DEV worker bounds all upstream sources used by live msRoutes refresh", () => {
  assert.match(worker, /MS_SYNC_TTL = 3000/);
  assert.match(worker, /UPSTREAM_FETCH_TIMEOUT_MS = 6000/);
  assert.match(worker, /async function fetchWithTimeout/);
  assert.match(worker, /timeoutError\.code = "UPSTREAM_TIMEOUT"/);
  assert.match(worker, /timeoutError\.status = 504/);
  assert.match(worker, /clearTimeout\(timeout\)/);

  for (const name of ["readMsPage", "readPreEntryPage", "readBusPage"]) {
    const body = functionBody(worker, name);
    assert.match(body, /await fetchWithTimeout\(url, \{/);
    assert.doesNotMatch(body, /await fetch\(url, \{/);
  }
});

test("realtime recovery patch does not alter polling, cron, queue, or archive policy", () => {
  assert.match(frontend, /pollMs:\s*4000/);
  assert.doesNotMatch(
    frontend,
    /if \(!silent && !state\.archiveLoaded\) scheduleArchiveLoad\(\)/,
  );
  assert.match(frontend, /function queueInfo\(/);
  assert.match(worker, /recentMsSync = new Map\(\)/);
  assert.match(worker, /activeMsSync = new Map\(\)/);
});
