import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stageWorker } from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const canonical = await readFile(new URL("worker/src/index.js", root), "utf8");
const staged = stageWorker(canonical);
const frontend = await readFile(new URL("supervisor.js", root), "utf8");
const tbrPatch = await readFile(new URL("cloudflare-browser-test/scripts/patch-dev-tbr-shadow-split-v2.mjs", root), "utf8");
const runnable = staged
  .replace(
    `import {
  OriginManifestCoordinator,
  originManifestLive,
  originManifestStatus,
  saveOriginManifestConnection,
  wrapOriginManifestAssets,
} from "./origin-manifest-v1.js";`,
    `const OriginManifestCoordinator = class {};
const originManifestLive = () => null;
const originManifestStatus = () => null;
const saveOriginManifestConnection = () => null;
const wrapOriginManifestAssets = (env) => env;`,
  )
  .replace(
    'import { canonicalMsSource, planMsChanges, resolveCompletionTruth } from "./sync-policy.js";',
    `const canonicalMsSource = (value) => JSON.stringify(value);
const planMsChanges = () => ({ changedIds: [], removedIds: [] });
const resolveCompletionTruth = () => null;`,
  )
  .replace(
    `import {
  MS_CANONICAL_BUSINESS_DAY_SQL,
  canonicalMsBusinessDay,
  canonicalMsSourceFreshness,
} from "./ms-operational-truth-v1.js";`,
    `const MS_CANONICAL_BUSINESS_DAY_SQL = "NULL";
const canonicalMsBusinessDay = () => ({ businessDay: "", authority: "UNKNOWN", valueTimestamp: "" });
const canonicalMsSourceFreshness = () => ({ freshness: "UNKNOWN", mode: "REFRESH", lastAttemptAt: "", lastSuccessAt: "", lastMeaningfulObservationAt: "", lastErrorAt: "", sourceValueTimestamp: "", dataObservedAt: "", acceptedDataAt: "" });`,
  );
assert.doesNotMatch(runnable, /^import\s/m);
const runtime = await import(`data:text/javascript;base64,${Buffer.from(runnable).toString("base64")}#snapshot`);

function context() {
  return { waitUntil() {}, getWebSockets() { return []; }, acceptWebSocket() {} };
}

test("SUP-04 shares sanitized coordinator state without persistence", async () => {
  const coordinator = new runtime.MsRefreshCoordinator(context(), {});
  await coordinator.fetch(new Request("https://internal/supervisor/ingest", {
    method: "POST",
    body: JSON.stringify({ hub: "BAG4", observedAt: "2026-09-14T12:00:01.000Z", result: { status: "synced", syncedAt: "2026-09-14T12:00:00.000Z", acceptedRows: 1 } }),
  }));
  const snapshot = await (await coordinator.fetch(new Request("https://internal/supervisor/snapshot"))).json();
  assert.equal(snapshot.availability, "AVAILABLE");
  assert.equal(snapshot.modules.waitingTrucks.health.state, "PARTIAL");
  assert.equal(snapshot.modules.waitingTrucks.hubs[0].hub, "BAG4");
  assert.equal(snapshot.modules.waitingTrucks.hubs[0].accepted.rows, 1);
  assert.equal(JSON.stringify(snapshot).includes("secret-row"), false);
  assert.deepEqual(snapshot.contracts, { additionalUpstreamPolls: 0, databaseReads: 0, databaseWrites: 0, aiCalls: 0 });
});

test("SUP-05 carries only a sanitized degraded source code", async () => {
  const coordinator = new runtime.MsRefreshCoordinator(context(), {});
  await coordinator.fetch(new Request("https://internal/supervisor/ingest", {
    method: "POST",
    body: JSON.stringify({ hub: "ZX9", observedAt: "2026-09-14T12:02:00.000Z", result: { status: "degraded", errorCode: "MS_ROUTE_RATE_LIMIT", acceptedRows: 3 } }),
  }));
  const hub = (await (await coordinator.fetch(new Request("https://internal/supervisor/snapshot"))).json()).modules.waitingTrucks.hubs[0];
  assert.equal(hub.health, "WARNING");
  assert.equal(hub.errorCode, "MS_ROUTE_RATE_LIMIT");
  assert.equal(hub.accepted.rows, 3);
});

test("SUP-04 preserves last accepted evidence across a later refresh error", async () => {
  const coordinator = new runtime.MsRefreshCoordinator(context(), {});
  await coordinator.fetch(new Request("https://internal/supervisor/ingest", { method: "POST", body: JSON.stringify({ hub: "BAG4", observedAt: "2026-09-14T12:00:01.000Z", result: { status: "synced", syncedAt: "2026-09-14T12:00:00.000Z", acceptedRows: 2 } }) }));
  await coordinator.fetch(new Request("https://internal/supervisor/ingest", { method: "POST", body: JSON.stringify({ hub: "BAG4", observedAt: "2026-09-14T12:01:01.000Z", result: { status: "error", error: "private credential detail" } }) }));
  const hub = (await (await coordinator.fetch(new Request("https://internal/supervisor/snapshot"))).json()).modules.waitingTrucks.hubs[0];
  assert.equal(hub.health, "ERROR");
  assert.equal(hub.accepted.state, "AVAILABLE");
  assert.equal(hub.accepted.rows, 2);
  assert.equal(hub.lastSuccessAt, "2026-09-14T12:00:00.000Z");
  assert.equal(JSON.stringify(hub).includes("private credential detail"), false);
});

test("SUP-04 state path is bounded, side-car, and zero-extra-polling", () => {
  assert.match(staged, /SUPERVISOR_SHARED_SNAPSHOT_V1/);
  assert.match(staged, /this\.ctx\.waitUntil\(this\.publishSupervisorSnapshot\(branch, result\)\.catch/);
  assert.match(staged, /url\.pathname === "\/api\/supervisor\/snapshot"/);
  assert.match(staged, /acceptedRows: Array\.isArray\(result\?\.rows\) \? result\.rows\.length : null/);
  assert.match(staged, /availability: "AVAILABLE"/);
  assert.match(staged, /availability: "UNAVAILABLE"/);
  assert.match(staged, /errorCode: result\?\.errorCode \|\| ""/);
  assert.doesNotMatch(staged, /JSON\.stringify\(\{ hub: branch, observedAt: new Date\(\)\.toISOString\(\), result \}\)/);
  assert.doesNotMatch(canonical, /SUPERVISOR_SHARED_SNAPSHOT_V1/);
  assert.equal((frontend.match(/\bfetch\s*\(/g) || []).length, 1);
  assert.match(frontend, /fetch\("\/api\/supervisor\/snapshot"/);
  assert.doesNotMatch(frontend, /setInterval|setTimeout|new\s+WebSocket|new\s+EventSource/);
});

test("SUP-04 remains compatible with the downstream DEV TBR quota guard", () => {
  assert.match(tbrPatch, /const fetchAnchor = `    if \(url\.pathname\.startsWith/);
  assert.doesNotMatch(tbrPatch, /const fetchAnchor = `  async fetch/);
  assert.match(tbrPatch, /const thenAnchor = `    const task = runMsRefresh[\s\S]*?this\.lastResult = result;`/);
});
