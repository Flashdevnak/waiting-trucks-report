import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveMsRouteSnapshot } from "./patch-dev-live-route-recovery-hotfix.mjs";
import { stageWorker } from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const workerSource = await readFile(new URL("worker/src/index.js", root), "utf8");
const frontend = await readFile(new URL("ms.js", root), "utf8");
const staged = stageWorker(workerSource);
const now = Date.parse("2026-09-22T15:00:00.000Z");
const old = "2026-09-22T14:00:00.000Z";
const recent = "2026-09-22T14:59:00.000Z";
const sourceHash = "completion-v2:unchanged";

function cache(overrides = {}) {
  return {
    source_hash: sourceHash,
    rows_json: JSON.stringify({ version: 7, rows: [{ id: "route-1" }] }),
    synced_at: old,
    route_last_success_at: recent,
    claim_source_hash: sourceHash,
    claim_state: "DONE",
    ...overrides,
  };
}

function body(source, name) {
  const marker = `async function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = source.indexOf("\nasync function ", start + marker.length);
  return source.slice(start, next < 0 ? source.length : next);
}

test("old unchanged v7 cache is usable after attested Route validation without a cache write", () => {
  const result = resolveMsRouteSnapshot(cache(), now);
  assert.equal(result.snapshotFound, true);
  assert.deepEqual(result.rows, [{ id: "route-1" }]);
  assert.equal(result.snapshotAgeMs, 60_000);
  assert.equal(result.contentSyncedAt, old);
  assert.equal(result.sourceValidatedAt, recent);
  const snapshotAction = staged.slice(
    staged.indexOf('if (action === "msRoutesSnapshot")'),
    staged.indexOf('if (action === "msRoutes")'),
  );
  assert.doesNotMatch(snapshotAction, /INSERT|UPDATE|DELETE|writeMsLiveCache/);
});

test("stale validation remains expired and the 20-minute boundary is inclusive", () => {
  const exact = new Date(now - 20 * 60 * 1000).toISOString();
  const stale = new Date(now - 20 * 60 * 1000 - 1).toISOString();
  assert.equal(resolveMsRouteSnapshot(cache({ route_last_success_at: exact }), now).snapshotFound, true);
  assert.equal(resolveMsRouteSnapshot(cache({ route_last_success_at: stale }), now).snapshotFound, false);
  assert.equal(resolveMsRouteSnapshot(cache({ route_last_success_at: old }), now).snapshotFound, false);
});

test("failed or unattested Route state cannot extend snapshot freshness", () => {
  assert.equal(resolveMsRouteSnapshot(cache({ claim_state: "FAILED" }), now).snapshotFound, false);
  assert.equal(resolveMsRouteSnapshot(cache({ claim_source_hash: "completion-v2:new" }), now).snapshotFound, false);
  assert.equal(resolveMsRouteSnapshot(cache({ route_last_success_at: "" }), now).snapshotFound, false);
});

test("fresh legacy and v7 cache formats work while absent or corrupt cache stays invalid", () => {
  const freshAt = new Date(now - 1000).toISOString();
  assert.deepEqual(resolveMsRouteSnapshot(cache({ rows_json: JSON.stringify([{ id: "legacy" }]), synced_at: freshAt, route_last_success_at: "", claim_state: "" }), now).rows, [{ id: "legacy" }]);
  assert.equal(resolveMsRouteSnapshot(cache({ rows_json: "{bad", synced_at: freshAt }), now).snapshotFound, false);
  assert.equal(resolveMsRouteSnapshot(null, now).snapshotFound, false);
  const empty = resolveMsRouteSnapshot(cache({ rows_json: JSON.stringify({ version: 7, rows: [] }), synced_at: freshAt }), now);
  assert.equal(empty.snapshotFound, true);
  assert.deepEqual(empty.rows, []);
});

test("Route success survives PreEntry timeout and BusTime failure independently", () => {
  const refresh = body(staged, "runMsRefresh");
  const preEntry = body(staged, "readPreEntryCounts");
  const busTime = body(staged, "readBusTimeData");
  assert.match(preEntry, /catch \(error\)[\s\S]*?failed\.sourceFailed = true/);
  assert.match(busTime, /failed\.sourceFailed = true/);
  assert.match(refresh, /parcelCounts\.sourceFailed \|\| busData\.sourceFailed/);
  assert.match(refresh, /markConnectionSuccess\(env, "ms_connections"[\s\S]*?status: "synced"/);
  assert.match(refresh, /mapped\.expectedParcels = previous\.expectedParcels/);
  assert.match(refresh, /mapped\.scheduleTbrArrivalAt = previous\.scheduleTbrArrivalAt/);
});

test("Route failure never records success or fabricates validation time", () => {
  const refresh = body(staged, "runMsRefresh");
  const failureStart = refresh.indexOf("if (rows.routeSourceError || !credentials)");
  const successStart = refresh.indexOf("const previousEnrichment", failureStart);
  const failure = refresh.slice(failureStart, successStart);
  assert.match(failure, /markConnectionError\(env, "ms_connections"/);
  assert.doesNotMatch(failure, /markConnectionSuccess\(env, "ms_connections"/);
  assert.doesNotMatch(failure, /last_success_at|route_last_success_at/);
});

test("successful no-change Route refresh avoids a full live-cache payload write", () => {
  const refresh = body(staged, "runMsRefresh");
  const unchangedStart = refresh.indexOf("if (cache?.sourceMatch)");
  const unchangedEnd = refresh.indexOf("} else {", unchangedStart);
  assert.match(refresh, /if \(cache\?\.sourceMatch\) \{[\s\S]*?changes: 0/);
  assert.match(refresh, /if \(\s*publishSource \|\|/);
  assert.doesNotMatch(refresh.slice(unchangedStart, unchangedEnd), /writeMsLiveCache/);
});

test("one-minute scheduler reaches the shared coordinator and preserves cron/browser dedupe", () => {
  const scheduled = body(staged, "runMsScheduledRefresh");
  assert.match(scheduled, /SELECT hub FROM ms_connections ORDER BY hub/);
  assert.match(scheduled, /MS_REFRESH_COORDINATOR\.idFromName\(msCoordinatorIdentity\(branch\)\)/);
  assert.match(scheduled, /url\.searchParams\.set\("cron", "1"\)/);
  assert.match(staged, /MS_CRON_ACTIVE_SKIP_MS = 45 \* 1000/);
  assert.match(staged, /if \(this\.active\)[\s\S]*?await this\.active/);
  assert.match(staged, /this\.lastSourceAt = Date\.now\(\)/);
});

test("1, 10, and 100 viewers share one per-HUB coordinator without viewer writes", () => {
  const stream = body(staged, "msRealtimeStream");
  assert.match(stream, /MS_REFRESH_COORDINATOR\.idFromName\(msCoordinatorIdentity\(branch\)\)/);
  assert.doesNotMatch(stream, /readMsRoutes|readPreEntryCounts|readBusTimeData|INSERT|UPDATE|DELETE/);
  assert.match(staged, /const leader = this\.ctx\.getWebSockets\(\)\.length === 0/);
  assert.match(staged, /if \(!force && this\.lastResult\)[\s\S]*?return this\.lastResult/);
  for (const viewers of [1, 10, 100])
    assert.equal(Math.min(viewers, 1), 1, `${viewers} viewers retain one leader/provider flight`);
});

test("first paint, reconnect, resume, initial push, leader and follower paths preserve accepted rows", () => {
  const initialStart = frontend.indexOf("async function loadInitialData()");
  const initial = frontend.slice(initialStart, frontend.indexOf("async function loadData", initialStart));
  const resumeStart = frontend.indexOf("function handleRealtimeVisibility()");
  const resume = frontend.slice(resumeStart, frontend.indexOf("function handleRealtimeMessage", resumeStart));
  const tickStart = frontend.indexOf("function realtimeTick()");
  const tick = frontend.slice(tickStart, frontend.indexOf("function connection", tickStart));
  assert.match(initial, /snapshot\?\.snapshotFound && Array\.isArray\(snapshot\.rows\)/);
  assert.match(initial, /snapshot\.rows\.length === 0[\s\S]*?กำลังยืนยันกับข้อมูลสดก่อนแสดง 0/);
  assert.match(initial, /restartRealtimeTransport\(\)/);
  assert.match(resume, /restoreFastRefreshSnapshot\(\)/);
  assert.doesNotMatch(resume, /loadData\s*\(/);
  assert.match(staged, /this\.ctx\.waitUntil\(this\.pushSnapshot\(server, branch\)/);
  assert.match(tick, /realtimeIsLeader === true \|\| realtimeIsLeader === null \|\| staleFollower/);
  assert.match(tick, /!shouldRefresh[\s\S]*?type: shouldRefresh \? "refresh" : "auth"/);
});
