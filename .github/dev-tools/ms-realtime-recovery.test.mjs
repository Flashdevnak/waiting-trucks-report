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
  assert.match(frontend, /requestTimeoutMs:\s*32000/);
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

test("DEV worker tolerates transient upstream slowness without treating session as expired", () => {
  assert.match(worker, /MS_SYNC_TTL = 3000/);
  assert.match(worker, /UPSTREAM_FETCH_TIMEOUT_MS = 9000/);
  assert.match(worker, /async function fetchWithTimeout/);
  assert.match(worker, /timeoutError\.code = "UPSTREAM_TIMEOUT"/);
  assert.match(worker, /timeoutError\.status = 504/);
  assert.match(worker, /clearTimeout\(timeout\)/);
  assert.match(
    worker,
    /response\.status === 401 \|\| response\.status === 403[\s\S]*?"MS_SESSION_EXPIRED"/,
  );
  assert.match(worker, /status:\s*"degraded"/);
  assert.match(worker, /const fallback = await readMsLiveCache\(env, branch\)/);
  assert.match(worker, /MS ตอบช้าชั่วคราว ระบบแสดงข้อมูลล่าสุดและจะลองใหม่อัตโนมัติ/);

  for (const name of ["readMsPage", "readPreEntryPage", "readBusPage"]) {
    const body = functionBody(worker, name);
    assert.match(body, /await fetchWithTimeout\(url, \{/);
    assert.doesNotMatch(body, /await fetch\(url, \{/);
  }
});

test("optional enrichment runs in parallel so it cannot serially stall live routes", () => {
  const body = functionBody(worker, "runMsRefresh");
  assert.match(
    body,
    /const \[parcelCounts, busData\] = await Promise\.all\(\[\s*readPreEntryCounts\(env, branch\),\s*readBusTimeData\(env, branch\),\s*\]\);/,
  );
  assert.doesNotMatch(
    body,
    /const parcelCounts = await readPreEntryCounts\(env, branch\);\s*const busData = await readBusTimeData\(env, branch\);/,
  );
});

test("failed optional enrichment preserves last-known fields instead of churning source hash", () => {
  const preEntry = functionBody(worker, "readPreEntryCounts");
  const bus = functionBody(worker, "readBusTimeData");
  const refresh = functionBody(worker, "runMsRefresh");

  assert.match(preEntry, /failed\.sourceFailed = true;/);
  assert.match(bus, /failed\.sourceFailed = true;/);
  assert.match(
    refresh,
    /parcelCounts\.sourceFailed \|\| busData\.sourceFailed[\s\S]*?await readMsLiveCache\(env, branch\)/,
  );

  for (const field of [
    "expectedParcels",
    "enteredParcels",
    "pendingParcels",
    "scheduleKitArrivalAt",
    "scheduleTbrArrivalAt",
    "arrivedParcels",
    "arrivedBags",
  ]) {
    assert.match(
      refresh,
      new RegExp(`mapped\\.${field} = previous\\.${field}`),
      `${field} must preserve the last-known enrichment value`,
    );
  }

  assert.match(
    refresh,
    /const sourceHash = await sha\(canonicalMsSource\(mappedRows\)\)/,
    "source hash must be computed only after last-known enrichment is restored",
  );
});

test("frontend keeps transient degraded mode connected and visible without toast spam", () => {
  assert.match(
    frontend,
    /state\.msStatus !== "error" && state\.msStatus !== "not_configured"/,
  );
  assert.match(frontend, /state\.msStatus !== "degraded"/);
  assert.match(
    frontend,
    /MS ตอบช้าชั่วคราว · แสดงข้อมูลล่าสุด · กำลังลองใหม่ทุก 4 วินาที/,
  );
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
