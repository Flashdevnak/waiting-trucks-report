import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stageFrontend, stageWorker } from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const frontendSource = await readFile(new URL("ms.js", root), "utf8");
const workerSource = await readFile(
  new URL("worker/src/index.js", root),
  "utf8",
);
const frontend = stageFrontend(frontendSource);
const worker = stageWorker(workerSource);

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

test("Turso 524 preserves accepted in-memory snapshot without extra DB read/write", () => {
  const refresh = functionBody(worker, "runMsRefresh");
  assert.match(refresh, /TURSO_TRANSIENT_CACHE_CONTINUITY_V1/);
  assert.match(refresh, /errorCode === "TURSO_NETWORK_ERROR"/);
  assert.match(
    refresh,
    /errorCode === "TURSO_PROTOCOL_ERROR"[\s\S]*?Turso returned an unreadable response/,
  );
  assert.match(refresh, /const remembered = recentMsSync\.get\(branch\)\?\.result;/);
  assert.match(refresh, /if \(Array\.isArray\(remembered\?\.rows\)\)/);
  assert.match(
    refresh,
    /\.\.\.remembered,[\s\S]*?status:\s*"degraded",[\s\S]*?changes:\s*0/,
    "degraded memory fallback must retain the accepted rows and original syncedAt",
  );
  assert.match(
    refresh,
    /\.\.\.remembered,[\s\S]*?errorCode:\s*errorCode \|\| "MS_NETWORK_ERROR"/,
    "degraded memory fallback must retain truthful technical error metadata",
  );
  assert.match(
    refresh,
    /if \(!tursoAvailability\) \{\s*const fallback = await readMsLiveCache\(env, branch\);/,
    "Turso availability failures must not issue an immediate second DB read",
  );
  assert.match(
    refresh,
    /if \(!tursoAvailability\) \{\s*await safeStatusWrite\(/,
    "Turso availability failures must not attempt a DB error-status write",
  );
  assert.match(
    refresh,
    /ฐานข้อมูลตอบช้าชั่วคราว ระบบยังแสดงข้อมูลล่าสุดตามเวลาที่รับสำเร็จล่าสุด/,
  );

  const rememberedResultStart = refresh.indexOf("const result = {\n          ...remembered,");
  assert.notEqual(
    rememberedResultStart,
    -1,
    "degraded remembered-result block must exist",
  );
  const rememberedResultEnd = refresh.indexOf(
    "recentMsSync.set(branch",
    rememberedResultStart,
  );
  assert.notEqual(
    rememberedResultEnd,
    -1,
    "degraded remembered-result block must be cached",
  );
  const rememberedResultBlock = refresh.slice(
    rememberedResultStart,
    rememberedResultEnd,
  );
  assert.doesNotMatch(
    rememberedResultBlock,
    /syncedAt:\s*new Date\(/,
    "Turso fallback must preserve remembered syncedAt rather than fabricate freshness",
  );
  assert.doesNotMatch(
    rememberedResultBlock,
    /readMsLiveCache|readMsRoutes|readPreEntryCounts|readBusTimeData|safeStatusWrite/,
    "remembered Turso fallback must not issue a DB/upstream call or status write",
  );
});

test("Turso transient classification is limited to unreadable provider 5xx responses", () => {
  const refresh = functionBody(worker, "runMsRefresh");
  assert.match(
    refresh,
    /Turso returned an unreadable response \\\((?:5\\d\\d\|unknown|\(\?:5\\d\\d\|unknown\))\\\)/,
  );
  assert.doesNotMatch(
    refresh,
    /errorCode === "TURSO_PROTOCOL_ERROR"\s*\|\|/,
    "malformed successful responses must not all be hidden as transient",
  );
});

test("Turso fallback remains HUB-isolated and a real success clears degraded state", () => {
  const refresh = functionBody(worker, "runMsRefresh");
  assert.match(refresh, /recentMsSync\.get\(branch\)\?\.result/);
  assert.doesNotMatch(refresh, /recentMsSync\.values\(\)|recentMsSync\.entries\(\)/);
  assert.match(
    refresh,
    /const result = \{\s*status:\s*"synced",[\s\S]*?recentMsSync\.set\(branch/,
    "the next genuine success must replace degraded state naturally",
  );
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
    /const sourceHash = MS_LIVE_CACHE_VERSION \+ ":" \+ await sha\(canonicalMsSource\(mappedRows\)\)/,
    "versioned source hash must be computed only after last-known enrichment is restored",
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
    /ตอบช้าชั่วคราว · แสดงข้อมูลล่าสุด · กำลังลองใหม่ทุก 4 วินาที/,
    "degraded UI must remain truthful without coupling the contract to a cosmetic prefix",
  );
});

test("realtime recovery staging does not alter polling, cron, queue, or archive policy", () => {
  assert.match(frontend, /pollMs:\s*4000/);
  assert.doesNotMatch(
    frontend,
    /if \(!silent && !state\.archiveLoaded\) scheduleArchiveLoad\(\)/,
  );
  assert.match(frontend, /function queueInfo\(/);
  assert.match(worker, /recentMsSync = new Map\(\)/);
  assert.match(worker, /activeMsSync = new Map\(\)/);
});
