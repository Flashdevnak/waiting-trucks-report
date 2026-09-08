import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { patchDevDurableCoordinator } from "./patch-ms-durable-coordinator.mjs";
import { patchMsConnectionErrorKvFrontend } from "./patch-ms-connection-error-kv.mjs";
import {
  ManifestRefreshCache,
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

test("DEV routes cross-isolate refresh through one Durable Object per HUB", () => {
  assert.match(worker, /export class MsRefreshCoordinator/);
  assert.match(worker, /MS_REFRESH_COORDINATOR\.idFromName\(branch\)/);
  assert.match(worker, /MS_REFRESH_COORDINATOR\.get\(id\)/);
  assert.match(worker, /stub\.fetch\(new Request\(url\)\)/);
  assert.match(worker, /if \(this\.active\)/);
  assert.match(worker, /if \(!force && this\.lastResult\) return this\.lastResult/);
  assert.match(worker, /runMsRefresh\(this\.env, branch\)/);
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
  assert.match(workflow, /stage-dev-runtime\.mjs \.dev-assets\/ms\.js src\/index\.js/);
  assert.match(stage, /patchDevDurableCoordinator/);
  assert.match(stage, /output = patchDevDurableCoordinator\(output\)/);
  assert.match(workflow, /node --check src\/index\.js/);
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

test("five-source HAR setup stacks every source on its own row across devices without extra polling", () => {
  for (const marker of [
    "MS_CONNECTION_RESPONSIVE_V2",
    "อัปโหลด HAR ทั้ง 5 แหล่ง",
    "5. LH Manifest (พัสดุออกจริง / น้ำหนัก Kg)",
    "5. HAR LH Manifest · พัสดุออกจริง + น้ำหนัก Kg",
    "5. เปิด LH Manifest (หลังเข้า HBI SSO)",
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
  assert.equal(ORIGIN_MANIFEST_POLICY.refreshMs, 300000);
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
  assert.match(worker, /MS_REFRESH_COORDINATOR\.idFromName\(branch\)/);
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

test("shared 5-minute cache coalesces concurrent clients", async () => {
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
  now += 300001;
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

test("frontend addon shows origin parcels and Kg and polls source only every five minutes", async () => {
  const source = originManifestFrontendSource();
  for (const marker of [
    "MS_ORIGIN_LH_MANIFEST_V1",
    "พัสดุออกจริง",
    "น้ำหนัก",
    " Kg",
    "msOriginManifestLive",
    "saveMsOriginManifestConnection",
    "5 * 60 * 1000",
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