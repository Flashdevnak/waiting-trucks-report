import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { patchDevDurableCoordinator } from "./patch-ms-durable-coordinator.mjs";
import { patchMsConnectionErrorKvFrontend } from "./patch-ms-connection-error-kv.mjs";
import {
  ManifestRefreshCache,
  OriginManifestCoordinator,
  ORIGIN_MANIFEST_POLICY,
  activeOriginDays,
  applyManifestToRows,
  normalizeManifestRows,
  originManifestFrontendSource,
  readManifestPage,
  wrapOriginManifestAssets,
} from "../../worker/src/origin-manifest-v1.js";

const root = new URL("../../", import.meta.url);
const workerSource = await readFile(new URL("worker/src/index.js", root), "utf8");
const tursoIndexSource = await readFile(new URL("worker/src/turso-index.js", root), "utf8");
const msFrontendSource = await readFile(new URL("ms.js", root), "utf8");
const config = JSON.parse(
  await readFile(new URL("worker/wrangler.dev.jsonc", root), "utf8"),
);
const workflow = await readFile(
  new URL(".github/workflows/deploy-worker-dev.yml", root),
  "utf8",
);
const stage = await readFile(
  new URL(".github/dev-tools/stage-dev-runtime.mjs", root),
  "utf8",
);
const worker = patchDevDurableCoordinator(workerSource);
const connectionFrontend = patchMsConnectionErrorKvFrontend(msFrontendSource);

test("DEV routes cross-isolate refresh through one fresh Durable Object generation per HUB", () => {
  assert.match(worker, /export class MsRefreshCoordinator/);
  assert.match(worker, /const MS_COORDINATOR_GENERATION = "runtime-v2"/);
  assert.match(worker, /function msCoordinatorIdentity\(branch\)/);
  assert.equal((worker.match(/MS_REFRESH_COORDINATOR\.idFromName\(msCoordinatorIdentity\(branch\)\)/g) || []).length, 3);
  assert.doesNotMatch(worker, /MS_REFRESH_COORDINATOR\.idFromName\(branch\)/);
  assert.match(worker, /MS_REFRESH_COORDINATOR\.get\(id\)/);
  assert.match(worker, /stub\.fetch\(new Request\(url\)\)/);
  assert.match(worker, /if \(this\.active\)/);
  assert.match(worker, /if \(!force && this\.lastResult\) return this\.lastResult/);
  assert.match(worker, /runMsRefresh\(this\.env, branch\)/);
});


test("coordinator generation reset keeps DO state memory-only and adds no source cadence", () => {
  assert.doesNotMatch(worker, /ctx\.storage|this\.ctx\.storage|storage\./);
  assert.match(worker, /MS_CRON_ACTIVE_SKIP_MS = 45 \* 1000/);
  assert.match(workerSource, /const MS_SYNC_TTL = 3000/);
  const patchStart = worker.indexOf("const MS_COORDINATOR_GENERATION");
  const patchEnd = worker.indexOf("async function runMsRefresh", patchStart);
  const block = worker.slice(patchStart, patchEnd);
  assert.doesNotMatch(block, /setInterval\s*\(|setTimeout\s*\(|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM/i);
});

test("DEV coordinator preserves 4-second frontend cadence without D1 lease writes", () => {
  assert.match(workerSource, /const MS_SYNC_TTL = 3000/);
  assert.doesNotMatch(worker, /ms_refresh_leases|INSERT INTO ms_refresh|UPDATE ms_refresh/i);
  assert.match(
    worker,
    /recentMsSync\.set\(branch, \{ until: Date\.now\(\) \+ MS_SYNC_TTL, result \}\)/,
  );
});

test("DEV Wrangler binds one SQLite-backed Durable Object class", () => {
  const binding = config.durable_objects?.bindings?.find(
    (item) => item.name === "MS_REFRESH_COORDINATOR",
  );
  assert.equal(binding?.class_name, "MsRefreshCoordinator");
  const migration = config.migrations?.find((item) =>
    item.new_sqlite_classes?.includes("MsRefreshCoordinator"),
  );
  assert.ok(migration, "SQLite Durable Object migration must exist");
});

test("DEV deployment stages and validates coordinator before deploy", () => {
  assert.match(workflow, /ms-durable-coordinator\.test\.mjs/);
  assert.match(workflow, /cp -R src \.dev-runtime\/src/);
  assert.match(workflow, /stage-dev-runtime\.mjs \.dev-assets\/ms\.js \.dev-runtime\/src\/index\.js/);
  assert.match(stage, /patchDevDurableCoordinator/);
  assert.match(stage, /output = patchDevDurableCoordinator\(output\)/);
  assert.match(workflow, /node --check \.dev-runtime\/src\/index\.js/);
  assert.match(workflow, /node --check src\/index\.js/);
  assert.doesNotMatch(workflow, /stage-dev-runtime\.mjs \.dev-assets\/ms\.js src\/index\.js/);
});

test("existing one-minute cron keeps main MS routes alive after every browser closes", () => {
  assert.deepEqual(config.triggers?.crons, ["* * * * *"]);
  for (const marker of [
    "MS_CRON_LIVE_REFRESH_V1",
    "export async function runMsScheduledRefresh",
    "SELECT hub FROM ms_connections ORDER BY hub",
    'url.searchParams.set("cron", "1")',
    "MS_CRON_ACTIVE_SKIP_MS = 45 * 1000",
    "nowMs - this.lastSourceAt < MS_CRON_ACTIVE_SKIP_MS",
    "this.lastSourceAt = Date.now()",
  ]) assert.ok(worker.includes(marker), `staged cron worker missing ${marker}`);
  assert.match(tursoIndexSource, /runProofScheduled\(runtimeEnv\)/);
  assert.match(tursoIndexSource, /workerModule\.runMsScheduledRefresh\(runtimeEnv\)/);
  const start = worker.indexOf("MS_CRON_LIVE_REFRESH_V1");
  const end = worker.indexOf("async function runMsRefresh", start);
  const cronBlock = worker.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(cronBlock, /INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM/i);
  assert.doesNotMatch(cronBlock, /setInterval\s*\(/);
});

test("six-source HAR setup stacks every source on its own row across devices without extra polling", () => {
  for (const marker of [
    "MS_CONNECTION_RESPONSIVE_V2",
    "อัปโหลด HAR ทั้ง 6 แหล่ง",
    "5. ปริ้นบาร์โค้ดรถ",
    "5. HAR ปริ้นบาร์โค้ดรถ",
    "6. LH Manifest (พัสดุออกจริง / น้ำหนัก Kg)",
    "6. HAR LH Manifest · พัสดุออกจริง + น้ำหนัก Kg",
    "6. เปิด LH Manifest (หลังเข้า HBI SSO)",
    "NEED_LOGIN",
    "HBI SSO แยกจากการล็อกอินหน้า MS",
    "ms-har-cards-v2",
  ]) assert.ok(connectionFrontend.includes(marker), `connection UI missing ${marker}`);
  assert.ok((connectionFrontend.match(/grid-template-columns:1fr/g) || []).length >= 3);
  assert.doesNotMatch(connectionFrontend, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(connectionFrontend, /@media\(max-width:760px\)/);
  assert.match(connectionFrontend, /@media\(max-width:420px\)/);
  const start = connectionFrontend.indexOf("function installMsConnectionResponsiveV2");
  const end = connectionFrontend.indexOf("async function loadMsConnectionObservedError", start);
  const responsiveBlock = connectionFrontend.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(responsiveBlock, /\bfetch\s*\(|\bapiGet\s*\(|\bapiPost\s*\(|setInterval\s*\(/);
});

test("Origin LH Manifest V1 keeps authority and quota boundaries", () => {
  assert.equal(ORIGIN_MANIFEST_POLICY.marker, "MS_ORIGIN_LH_MANIFEST_V1");
  assert.equal(ORIGIN_MANIFEST_POLICY.refreshMs, 120000);
  assert.equal(ORIGIN_MANIFEST_POLICY.adaptiveRefresh, true);
  assert.equal(ORIGIN_MANIFEST_POLICY.refreshMinMs, 120000);
  assert.equal(ORIGIN_MANIFEST_POLICY.refreshSteadyMs, 180000);
  assert.equal(ORIGIN_MANIFEST_POLICY.refreshIdleMs, 300000);
  assert.equal(ORIGIN_MANIFEST_POLICY.errorBackoffMs, 300000);
  assert.equal(ORIGIN_MANIFEST_POLICY.sharedPerHub, true);
  assert.equal(ORIGIN_MANIFEST_POLICY.originOnly, true);
  assert.equal(ORIGIN_MANIFEST_POLICY.matchKey, "proofId");
  assert.equal(ORIGIN_MANIFEST_POLICY.pageSize, 100);
  assert.equal(ORIGIN_MANIFEST_POLICY.weightUnit, "Kg");
  assert.equal(ORIGIN_MANIFEST_POLICY.dataPersistenceWrites, 0);
  assert.equal(ORIGIN_MANIFEST_POLICY.analyticsWrites, 0);
  assert.equal(ORIGIN_MANIFEST_POLICY.extraMsPolling, 0);
  assert.equal(ORIGIN_MANIFEST_POLICY.queueAuthority, false);
  assert.equal(ORIGIN_MANIFEST_POLICY.actualArrivalAuthority, "ROUTE");
});

test("Origin LH Manifest V1 is staged into existing shared coordinator and APIs", () => {
  for (const marker of [
    'from "./origin-manifest-v1.js"',
    "wrapOriginManifestAssets(env)",
    'action === "msOriginManifestStatus"',
    'action === "msOriginManifestLive"',
    'action === "saveMsOriginManifestConnection"',
    'this.originManifest = new OriginManifestCoordinator(ctx, env)',
    'url.pathname.startsWith("/origin-manifest/")',
  ]) assert.ok(worker.includes(marker), `staged worker missing ${marker}`);
  assert.match(worker, /MS_REFRESH_COORDINATOR\.idFromName\(msCoordinatorIdentity\(branch\)\)/);
  assert.doesNotMatch(worker, /originManifestHbiCredentials/);
  assert.doesNotMatch(worker, /d1_databases|origin_manifest_cache|manifest_history/i);
});

test("ten simultaneous origin trucks use one business day source set", () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({
    proofId: `NE1-${index}`,
    attendanceType: "ต้นทาง",
    estimatedDepartureAt: "2026-09-08T03:00:00.000Z",
    actualDepartureAt: "",
  }));
  rows.push({ proofId: "DEST", attendanceType: "ปลายทาง", estimatedDepartureAt: "2026-09-08T03:00:00.000Z" });
  rows.push({ proofId: "DONE", attendanceType: "ต้นทาง", estimatedDepartureAt: "2026-09-08T03:00:00.000Z", actualDepartureAt: "2026-09-08T04:00:00.000Z" });
  assert.deepEqual(activeOriginDays(rows), ["2026-09-08"]);
});

test("shared two-minute cache coalesces concurrent clients at its exact boundary", async () => {
  let calls = 0;
  let now = Date.parse("2026-09-08T03:00:00.000Z");
  const cache = new ManifestRefreshCache({
    now: () => now,
    loader: async (day) => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { day, rows: [{ proofId: "A", actual_shipment_total: 10, weight: 50 }], total: 1, pages: 1, upstreamRequests: 1, fetchedAt: new Date(now).toISOString() };
    },
  });
  const results = await Promise.all(Array.from({ length: 10 }, () => cache.get("2026-09-08")));
  assert.equal(calls, 1);
  assert.equal(results.length, 10);
  await cache.get("2026-09-08");
  assert.equal(calls, 1);
  now += 119999;
  await cache.get("2026-09-08");
  assert.equal(calls, 1, "inside the fast shared TTL");
  now += 1;
  await cache.get("2026-09-08");
  assert.equal(calls, 2);
});

test("manifest joins by proofId and enriches origin rows only", () => {
  const manifest = normalizeManifestRows([
    { proofId: "ABC 123", actual_shipment_total: "1,250", weight: "8742.50" },
    { proofId: "ABC123", actual_shipment_total: "1249", weight: "8700" },
  ], "2026-09-08T03:00:00.000Z");
  const rows = applyManifestToRows([
    { proofId: "ABC123", attendanceType: "ต้นทาง" },
    { proofId: "ABC123", attendanceType: "ปลายทาง" },
  ], manifest);
  assert.equal(rows[0].manifestShippedParcels, 1250);
  assert.equal(rows[0].manifestWeightKg, 8742.5);
  assert.equal(rows[0].manifestSource, "LH_MANIFEST");
  assert.equal(rows[1].manifestShippedParcels, undefined);
});

test("manifest page reads HUB summary in one 100-row request", async () => {
  let seenUrl = "";
  let seenBody = "";
  const result = await readManifestPage({
    auth: "test-auth",
    lang: "th",
    fbid: "fbid",
    time: "123",
    webSign: "hbi",
    _from: "web",
    storeFrom: "TH27011602",
  }, "2026-09-08", 1, async (url, init) => {
    seenUrl = String(url);
    seenBody = String(init.body);
    return new Response(JSON.stringify({
      code: 1,
      data: { DataList: [{ proofId: "A", actual_shipment_total: 10, weight: 20.5 }], total: 1 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const url = new URL(seenUrl);
  assert.equal(url.pathname, "/api/route/route_outhouse");
  assert.equal(url.searchParams.get("storeFrom"), "TH27011602");
  assert.equal(url.searchParams.get("page_size"), "100");
  assert.match(seenBody, /auth=test-auth/);
  assert.match(seenBody, /webSign=hbi/);
  assert.equal(result.total, 1);
});

test("frontend addon exposes adaptive refresh and independent error backoff", async () => {
  const source = originManifestFrontendSource();
  for (const marker of [
    "MS_ORIGIN_LH_MANIFEST_V1",
    "พัสดุออกจริง",
    "น้ำหนัก",
    " Kg",
    "msOriginManifestLive",
    "saveMsOriginManifestConnection",
    "manifestRefreshFastMs = 2 * 60 * 1000",
    "manifestRefreshSteadyMs = 3 * 60 * 1000",
    "manifestRefreshIdleMs = 5 * 60 * 1000",
    "manifestErrorBackoffMs = 5 * 60 * 1000",
    "Shared refresh ทุก 2–5 นาที",
    "queueInfo(row).active",
    "localStorage",
  ]) assert.ok(source.includes(marker), `frontend missing ${marker}`);

  const env = {
    ASSETS: {
      fetch: async (request) => new Response(
        new URL(request.url).pathname === "/ms.js" ? "console.log('base');" : "plain",
        { status: 200, headers: { "content-type": "application/javascript" } },
      ),
    },
    DB: { sentinel: true },
  };
  const wrapped = wrapOriginManifestAssets(env);
  assert.equal(wrapped.DB, env.DB);
  const js = await (await wrapped.ASSETS.fetch(new Request("https://dev.test/ms.js"))).text();
  assert.match(js, /console\.log\('base'\)/);
  assert.match(js, /MS_ORIGIN_LH_MANIFEST_V1/);
  const other = await (await wrapped.ASSETS.fetch(new Request("https://dev.test/style.css"))).text();
  assert.equal(other, "plain");
});

test("fresh Manifest cache missing a new TBR Origin proof wakes one shared HUB refresh and preserves accepted metrics", async () => {
  const source = originManifestFrontendSource();
  const start = source.indexOf("  const manifestCache = new Map();");
  const end = source.indexOf("  function installManifestScheduler()", start);
  assert.ok(start >= 0 && end > start);
  let now = Date.parse("2026-09-28T16:00:00Z");
  const storage = new Map();
  const calls = [];
  let sourceRows = [{ proofId: "A", manifestShippedParcels: 10, manifestWeightKg: 50 }];
  const state = {
    auth: { token: "test" }, branch: "NE1", archiveView: false,
    currentRows: [{ proofId: "A", attendanceType: "ต้นทาง", estimatedDepartureAt: "2026-09-28T16:00:00Z" }],
  };
  state.rows = state.currentRows;
  const context = {
    state,
    Date: class extends Date { static now() { return now; } },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    isOrigin: (row) => row.attendanceType === "ต้นทาง",
    queueInfo: () => ({ active: true }),
    bangkokDateValue: () => "2026-09-28",
    apiGet: async (action, args) => {
      calls.push({ action, args });
      return { rows: sourceRows, refreshedAt: new Date(now).toISOString() };
    },
    render() {},
    console,
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + "\nglobalThis.manifestTest = { maybeSyncManifest, applyCachedManifest };", context);
  storage.set("ms_origin_manifest_v1_NE1", JSON.stringify({ rows: sourceRows.map((row) => ({ ...row, manifestOccurrenceKey: "A|ต้นทาง|2026-09-28T16:00:00Z" })), savedAt: now, refreshedAt: "" }));
  await context.manifestTest.maybeSyncManifest();
  assert.equal(calls.length, 0, "a present proof reuses the fresh cache");
  assert.equal(state.currentRows[0].manifestShippedParcels, 10);
  assert.equal(state.currentRows[0].manifestWeightKg, 50);

  state.currentRows = [
    { proofId: "A", attendanceType: "ต้นทาง", estimatedDepartureAt: "2026-09-28T16:00:00Z" },
    { proofId: "B", attendanceType: "ต้นทาง", estimatedDepartureAt: "2026-09-28T16:00:00Z", scheduleTbrArrivalAt: "2026-09-28T15:59:00Z" },
  ];
  state.rows = state.currentRows;
  await context.manifestTest.maybeSyncManifest();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, "msOriginManifestLive");
  assert.equal(calls[0].args.completeness, "1");
  assert.equal(state.currentRows[1].manifestShippedParcels, undefined, "missing source cannot fabricate a count");
  await context.manifestTest.maybeSyncManifest();
  assert.equal(calls.length, 1, "same missing proof cannot create a retry loop");

  state.currentRows.push({ proofId: "C", attendanceType: "ต้นทาง", estimatedDepartureAt: "2026-09-28T16:00:00Z" });
  await context.manifestTest.maybeSyncManifest();
  assert.equal(calls.length, 1, "new proofs inside 30 seconds coalesce");
  now += 30_001;
  sourceRows = [...sourceRows, { proofId: "C", manifestShippedParcels: 3, manifestWeightKg: 12 }];
  await context.manifestTest.maybeSyncManifest();
  assert.equal(calls.length, 2, "one HUB request covers multiple active proofs");
  assert.equal(state.currentRows[2].manifestWeightKg, 12);
  assert.equal(state.currentRows[1].manifestWeightKg, undefined);

  state.currentRows = [
    { proofId: "A", attendanceType: "ต้นทาง", estimatedDepartureAt: "2026-09-28T16:00:00Z", scheduleTbrArrivalAt: "2026-09-28T15:59:00Z" },
    { proofId: "C", attendanceType: "ต้นทาง", estimatedDepartureAt: "2026-09-28T16:00:00Z", scheduleKitArrivalAt: "2026-09-28T16:03:00Z" },
  ];
  state.rows = state.currentRows;
  context.manifestTest.applyCachedManifest();
  assert.equal(state.currentRows[0].manifestShippedParcels, 10, "WebSocket base replacement retains accepted metrics");
  assert.equal(state.currentRows[1].manifestWeightKg, 12, "TBR placeholder to Route row retains metrics by proof");
});

function manifestBrowserHarness({ proofs = ["A"], cached = null, initialRows = [] } = {}) {
  const source = originManifestFrontendSource();
  const start = source.indexOf("  const manifestCache = new Map();");
  const end = source.indexOf("  function installManifestScheduler()", start);
  let now = Date.parse("2026-09-28T17:50:21.353Z");
  let sourceRows = initialRows;
  const storage = new Map();
  const calls = [];
  const makeRow = (proofId, extra = {}) => ({ proofId, attendanceType: "ต้นทาง", estimatedDepartureAt: "2026-09-28T16:00:00Z", ...extra });
  const state = { auth: { token: "test" }, branch: "NE1", archiveView: false, currentRows: proofs.map((proof) => makeRow(proof)) };
  state.rows = state.currentRows;
  const context = {
    state, Date: class extends Date { static now() { return now; } },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    isOrigin: (row) => row.attendanceType === "ต้นทาง",
    queueInfo: () => ({ active: true }), bangkokDateValue: () => "2026-09-28",
    apiGet: async (action, args) => {
      calls.push({ action, args, at: now });
      return { rows: sourceRows, refreshedAt: new Date(now).toISOString() };
    },
    render() {}, console,
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + "\nglobalThis.manifestTest = { maybeSyncManifest, applyCachedManifest };", context);
  if (cached) storage.set("ms_origin_manifest_v1_NE1", JSON.stringify({ savedAt: now, refreshedAt: "", ...cached }));
  return {
    state, calls, makeRow,
    readCache: () => JSON.parse(storage.get("ms_origin_manifest_v1_NE1") || "null"),
    setSource: (rows) => { sourceRows = rows; },
    advance: (ms) => { now += ms; },
    sync: (force = false) => context.manifestTest.maybeSyncManifest(force),
    replace: (rows) => { state.currentRows = rows; state.rows = rows; context.manifestTest.applyCachedManifest(); },
  };
}

test("empty Manifest cache retries the same proof at 30, 60, 120 seconds, while normal adaptive refresh preserves the exhausted budget", async () => {
  const h = manifestBrowserHarness({ cached: { rows: [] } });
  await h.sync();
  assert.equal(h.calls.length, 1, "first missing proof wakes immediately");
  assert.equal(h.calls[0].args.completeness, "1");
  await h.sync();
  assert.equal(h.calls.length, 1);
  h.advance(30_001); await h.sync();
  assert.equal(h.calls.length, 2);
  h.advance(60_001); await h.sync();
  assert.equal(h.calls.length, 3);
  h.advance(30_000); await h.sync();
  assert.equal(h.calls.length, 4, "normal two-minute refresh runs independently");
  assert.equal(h.calls[3].args.completeness, undefined);
  assert.equal(h.readCache().missingRetries.A.attemptCount, 3, "normal refresh preserves retry history");
  h.advance(90_001); await h.sync();
  assert.equal(h.calls.length, 5);
  assert.equal(h.readCache().missingRetries.A.attemptCount, 4);
  h.advance(30_001); await h.sync();
  assert.equal(h.calls.length, 6, "only the due normal refresh follows; finite budget prevents endless 30-second polling");
  h.advance(60_000); await h.sync();
  assert.equal(h.calls.length, 6, "normal refresh cannot reopen the exhausted burst");
  assert.equal(h.calls[5].args.completeness, undefined);
  assert.equal(h.readCache().missingRetries.A.attemptCount, 4);
  assert.equal(h.calls.every(({ action }) => action === "msOriginManifestLive"), true);
});

test("old attemptedMissing cache self-recovers and 139-second delayed source enriches 18 of 27 active proofs", async () => {
  const proofs = Array.from({ length: 27 }, (_, i) => `P${i}`);
  const h = manifestBrowserHarness({ proofs, cached: { rows: [], attemptedMissing: proofs.slice(0, 25) } });
  await h.sync();
  assert.equal(h.calls.length, 1, "two new proofs coalesce in one HUB wake-up");
  assert.equal(h.readCache().attemptedMissing, undefined, "legacy set migrates without manual clear");
  assert.equal(h.readCache().missingRetries.P0.attemptCount, 1, "legacy attempted proof has one prior bounded attempt");
  h.advance(60_001);
  await h.sync();
  assert.equal(h.calls.length, 2);
  h.advance(79_299); // 139.3 seconds since the empty cache, after the two-minute normal refresh becomes due.
  h.setSource(proofs.slice(0, 18).map((proofId) => ({ proofId, manifestShippedParcels: 1074, manifestWeightKg: 1076.945 })));
  await h.sync();
  assert.equal(h.calls.length, 3);
  assert.equal(h.calls[2].at - h.calls[0].at, 139_300);
  assert.equal(h.state.currentRows.filter((row) => row.manifestShippedParcels === 1074).length, 18);
  assert.equal(h.state.currentRows.filter((row) => row.manifestShippedParcels === undefined).length, 9);
  assert.equal(h.readCache().rows.length, 18);
  assert.equal(Object.keys(h.readCache().missingRetries).length, 9);
  assert.deepEqual(h.calls.map((call) => call.args.completeness), ["1", "1", undefined]);
});

test("accepted Manifest metrics survive a transient empty result, update on newer data, and remain beyond fetch TTL only for the same occurrence", async () => {
  const h = manifestBrowserHarness({ proofs: ["A", "B"], cached: { rows: [{ proofId: "A", manifestOccurrenceKey: "A|ต้นทาง|2026-09-28T16:00:00Z", manifestShippedParcels: 10, manifestWeightKg: 50 }] } });
  await h.sync();
  assert.equal(h.calls.length, 1, "one missing proof wakes while A applies from fresh cache");
  assert.equal(h.state.currentRows[0].manifestShippedParcels, 10);
  h.advance(30_001);
  h.setSource([{ proofId: "A", manifestShippedParcels: 12, manifestWeightKg: 51 }]);
  await h.sync();
  assert.equal(h.state.currentRows[0].manifestShippedParcels, 12, "newer real metric updates accepted value");
  h.advance(60_001);
  h.setSource([]);
  await h.sync();
  assert.equal(h.readCache().rows[0].manifestShippedParcels, 12, "empty source does not erase accepted active proof");
  assert.equal(h.state.currentRows[1].manifestShippedParcels, undefined, "missing proof has no fabricated metric");
  h.advance(5 * 60 * 1000 + 1);
  h.setSource([]);
  await h.sync();
  assert.equal(h.readCache().rows[0].manifestShippedParcels, 12, "accepted truth has no fetch TTL");
  h.replace([h.makeRow("A"), h.makeRow("B")]);
  assert.equal(h.state.currentRows[0].manifestShippedParcels, 12);
  h.replace([h.makeRow("A", { id: "new-occurrence" })]);
  assert.equal(h.state.currentRows[0].manifestShippedParcels, undefined, "reused proof cannot inherit another occurrence truth");
});

test("TBR-first row receives Manifest values and Route replacement keeps them without Destination or Drop enrichment", async () => {
  const h = manifestBrowserHarness({ proofs: ["TBR"], cached: { rows: [] } });
  h.replace([h.makeRow("TBR", { scheduleTbrArrivalAt: "2026-09-28T15:59:00Z" })]);
  h.setSource([{ proofId: "TBR", manifestShippedParcels: 7, manifestWeightKg: 12.5 }]);
  await h.sync();
  assert.equal(h.state.currentRows[0].manifestWeightKg, 12.5);
  h.replace([
    h.makeRow("TBR", { scheduleKitArrivalAt: "2026-09-28T16:03:00Z" }),
    h.makeRow("TBR", { attendanceType: "ปลายทาง" }),
    h.makeRow("TBR", { attendanceType: "จุดดรอป" }),
  ]);
  assert.equal(h.state.currentRows[0].manifestShippedParcels, 7);
  assert.equal(h.state.currentRows[1].manifestShippedParcels, undefined);
  assert.equal(h.state.currentRows[2].manifestShippedParcels, undefined);
});

test("shared Manifest coordinator bypasses the shared fast cache only once per 30-second HUB wake-up", async () => {
  let now = Date.parse("2026-09-28T16:00:00Z");
  let calls = 0;
  let rows = [{ proofId: "A", actual_shipment_total: 10, weight: 50 }];
  const coordinator = new OriginManifestCoordinator({}, {}, {
    now: () => now,
    fetchImpl: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 3));
      return Response.json({ code: 1, data: { DataList: rows, total: rows.length } });
    },
  });
  coordinator.getCredentials = async () => ({ auth: "test", fbid: "test", time: "test", storeFrom: "test" });
  const request = (completeness = false) => new Request("https://internal/origin-manifest/refresh", {
    method: "POST", body: JSON.stringify({ hub: "NE1", days: ["2026-09-28"], completeness }),
  });
  const baseline = await (await coordinator.fetch(request())).json();
  assert.equal(baseline.rows[0].manifestShippedParcels, 10);
  assert.equal(calls, 1);
  rows = [...rows, { proofId: "B", actual_shipment_total: 2, weight: 8 }];
  const normal = await (await coordinator.fetch(request())).json();
  assert.equal(normal.rows.length, 1, "server cache is time-fresh but incomplete");
  const simultaneous = await Promise.all(Array.from({ length: 8 }, async () =>
    (await coordinator.fetch(request(true))).json()));
  assert.equal(calls, 2, "eight clients share one forced day fetch");
  assert.ok(simultaneous.some((result) => result.rows.some((row) => row.proofId === "B")));
  rows = [...rows, { proofId: "C", actual_shipment_total: 1, weight: 4 }];
  await coordinator.fetch(request(true));
  assert.equal(calls, 2, "rate gate ignores repeated browser wake-ups");
  now += 30_001;
  const later = await (await coordinator.fetch(request(true))).json();
  assert.equal(calls, 3);
  assert.ok(later.rows.some((row) => row.proofId === "C"));
  assert.equal(ORIGIN_MANIFEST_POLICY.completenessMinMs, 30_000);
  assert.equal(ORIGIN_MANIFEST_POLICY.dataPersistenceWrites, 0);
});

test("Origin Manifest badge coexists with local barcode and never adorns Destination or Drop", () => {
  const source = originManifestFrontendSource();
  const start = source.indexOf("  const kgf = new Intl.NumberFormat");
  const end = source.indexOf("  function parseResponseJson", start);
  const context = {
    globalThis: {}, Intl,
    nf: new Intl.NumberFormat("th-TH"), esc: (value) => String(value),
    isOrigin: (row) => row.attendanceType === "ต้นทาง",
    tableRow: () => '<div class="route-plate">ทะเบียน -</div><div class="local-route-barcode">▥ ดูบาร์โค้ด</div>',
    card: () => '<p>ทะเบียน -</p><div>▥ ดูบาร์โค้ด</div>',
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + "\nglobalThis.wrapRenderers = wrapRenderers;", context);
  context.wrapRenderers();
  const origin = { attendanceType: "ต้นทาง", manifestShippedParcels: 7, manifestWeightKg: 12.5 };
  const html = context.tableRow(origin);
  assert.match(html, /▥ ดูบาร์โค้ด/);
  assert.match(html, /พัสดุออกจริง.*7 ชิ้น/);
  assert.match(html, /น้ำหนัก.*12\.5 Kg/);
  assert.match(context.card(origin), /พัสดุออกจริง/);
  for (const attendanceType of ["ปลายทาง", "จุดดรอป"])
    assert.doesNotMatch(context.tableRow({ ...origin, attendanceType }), /พัสดุออกจริง/);
});
