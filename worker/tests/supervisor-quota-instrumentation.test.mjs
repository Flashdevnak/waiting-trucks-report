import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { stageWorker } from "../../.github/dev-tools/stage-dev-runtime.mjs";
import { databaseEnv, tursoRuntimeDiagnostics } from "../src/turso-d1.js";

const root = new URL("../../", import.meta.url);
const [canonicalWorker, quotaPatch, wrapper] = await Promise.all([
  readFile(new URL("src/index.js", new URL("../", import.meta.url)), "utf8"),
  readFile(new URL(".github/dev-tools/patch-supervisor-quota-instrumentation.mjs", root), "utf8"),
  readFile(new URL(".github/dev-tools/patch-supervisor-shared-snapshot.mjs", root), "utf8"),
]);
const stagedWorker = stageWorker(canonicalWorker);

function between(text, startLabel, endLabel) {
  const start = text.indexOf(startLabel);
  const end = text.indexOf(endLabel, start + startLabel.length);
  assert.ok(start >= 0 && end > start, `missing block ${startLabel}`);
  return text.slice(start, end);
}

function quotaRuntime() {
  const source = between(
    stagedWorker,
    "// SUPERVISOR_QUOTA_PIGGYBACK_V1:",
    "// SUPERVISOR_EVENT_CONSOLE_V1:",
  );
  const context = { Date, Object, Number, String, Array };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.quotaObservation = supervisorQuotaObservation;`, context);
  return { quotaObservation: context.quotaObservation, source };
}

function runnableWorker() {
  return stagedWorker
    .replace(
      `import {\n  OriginManifestCoordinator,\n  originManifestLive,\n  originManifestStatus,\n  saveOriginManifestConnection,\n  wrapOriginManifestAssets,\n} from "./origin-manifest-v1.js";`,
      `const OriginManifestCoordinator = class {};\nconst originManifestLive = () => null;\nconst originManifestStatus = () => null;\nconst saveOriginManifestConnection = () => null;\nconst wrapOriginManifestAssets = (env) => env;`,
    )
    .replace(
      'import { canonicalMsSource, planMsChanges, resolveCompletionTruth } from "./sync-policy.js";',
      `const canonicalMsSource = (value) => JSON.stringify(value);\nconst planMsChanges = () => ({ changedIds: [], removedIds: [] });\nconst resolveCompletionTruth = () => null;`,
    )
    .replace(
      `import {
  MS_CANONICAL_BUSINESS_DAY_SQL,
  canonicalMsBusinessDay,
  canonicalMsSourceFreshness,
} from "./ms-operational-truth-v1.js";`,
      `const MS_CANONICAL_BUSINESS_DAY_SQL = "NULL";\nconst canonicalMsBusinessDay = () => ({ businessDay: "", authority: "UNKNOWN", valueTimestamp: "" });\nconst canonicalMsSourceFreshness = () => ({ freshness: "UNKNOWN", mode: "REFRESH", lastAttemptAt: "", lastSuccessAt: "", lastMeaningfulObservationAt: "", lastErrorAt: "", sourceValueTimestamp: "", dataObservedAt: "", acceptedDataAt: "" });`,
    );
}

function context() {
  return { waitUntil() {}, getWebSockets() { return []; }, acceptWebSocket() {} };
}

function quota(overrides = {}) {
  return {
    scope: "current-worker-isolate",
    since: "2026-09-14T17:00:00.000Z",
    httpRequests: 8,
    statements: 13,
    rowsRead: 144,
    rowsWritten: 2,
    errors: 1,
    providerLimitErrors: 0,
    heavyReadEvents: 1,
    providerReadCircuitOpen: false,
    lastObservedAt: "2026-09-14T17:29:59.000Z",
    ...overrides,
  };
}

test("SUP-10 sanitizer exposes only bounded isolate-local quota facts", () => {
  const { quotaObservation } = quotaRuntime();
  const observed = quotaObservation(
    { ...quota(), token: "secret", sql: "SELECT secret", url: "https://private.example" },
    "2026-09-14T17:30:00.000Z",
  );
  assert.equal(observed.state, "AVAILABLE");
  assert.equal(observed.scope, "current-worker-isolate");
  assert.equal(observed.observedAt, "2026-09-14T17:30:00.000Z");
  assert.equal(observed.httpRequests, 8);
  assert.equal(observed.rowsRead, 144);
  assert.equal(observed.providerReadCircuitOpen, false);
  assert.equal("token" in observed, false);
  assert.equal("sql" in observed, false);
  assert.equal("url" in observed, false);
  assert.doesNotMatch(JSON.stringify(observed), /secret|SELECT|private\.example/i);
});

test("SUP-10 malformed counters remain partial instead of fabricating usage", () => {
  const { quotaObservation } = quotaRuntime();
  const observed = quotaObservation(
    quota({ httpRequests: -1, statements: "bad", rowsRead: Number.NaN }),
    "not-a-time",
  );
  assert.equal(observed.state, "PARTIAL");
  assert.equal(observed.httpRequests, null);
  assert.equal(observed.statements, null);
  assert.equal(observed.rowsRead, null);
  assert.equal(observed.observedAt, "2026-09-14T17:29:59.000Z");
  assert.equal(quotaObservation({ ...quota(), scope: "provider-account" }, "2026-09-14T17:30:00.000Z"), null);
});

test("SUP-10 shared snapshot publishes quota telemetry without claiming provider billing truth", async () => {
  const runnable = runnableWorker();
  assert.doesNotMatch(runnable, /^import\s/m);
  const runtime = await import(`data:text/javascript;base64,${Buffer.from(runnable).toString("base64")}#sup10-snapshot`);
  const coordinator = new runtime.MsRefreshCoordinator(context(), {});
  await coordinator.fetch(new Request("https://internal/supervisor/ingest", {
    method: "POST",
    body: JSON.stringify({
      hub: "ZX9",
      observedAt: "2026-09-14T17:30:00.000Z",
      quotaObservation: { ...quota(), password: "never-publish" },
      result: { status: "synced", syncedAt: "2026-09-14T17:29:58.000Z", acceptedRows: 3 },
    }),
  }));
  const snapshot = await (await coordinator.fetch(new Request("https://internal/supervisor/snapshot"))).json();
  assert.equal(snapshot.quotaTelemetry.availability, "AVAILABLE");
  assert.equal(snapshot.quotaTelemetry.mode, "PIGGYBACK_ISOLATE_COUNTERS");
  assert.equal(snapshot.quotaTelemetry.billingTruth, "UNKNOWN");
  assert.deepEqual(snapshot.quotaTelemetry.coverage, { observedHubs: 1, quotaObservedHubs: 1 });
  assert.equal(snapshot.quotaTelemetry.hubs[0].hub, "ZX9");
  assert.equal(snapshot.quotaTelemetry.hubs[0].rowsRead, 144);
  assert.equal(JSON.stringify(snapshot).includes("never-publish"), false);
});

test("SUP-10 quota coverage is partial when an observed HUB has no quota evidence", async () => {
  const runnable = runnableWorker();
  const runtime = await import(`data:text/javascript;base64,${Buffer.from(runnable).toString("base64")}#sup10-partial`);
  const coordinator = new runtime.MsRefreshCoordinator(context(), {});
  await coordinator.fetch(new Request("https://internal/supervisor/ingest", {
    method: "POST",
    body: JSON.stringify({ hub: "ZX9", observedAt: "2026-09-14T17:30:00.000Z", quotaObservation: quota(), result: { status: "synced", acceptedRows: 1 } }),
  }));
  await coordinator.fetch(new Request("https://internal/supervisor/ingest", {
    method: "POST",
    body: JSON.stringify({ hub: "ZY8", observedAt: "2026-09-14T17:30:01.000Z", result: { status: "synced", acceptedRows: 1 } }),
  }));
  const snapshot = await (await coordinator.fetch(new Request("https://internal/supervisor/snapshot"))).json();
  assert.equal(snapshot.quotaTelemetry.availability, "PARTIAL");
  assert.deepEqual(snapshot.quotaTelemetry.coverage, { observedHubs: 2, quotaObservedHubs: 1 });
});

test("SUP-10 quota ring is bounded to 50 sanitized HUB observations", async () => {
  const runnable = runnableWorker();
  const runtime = await import(`data:text/javascript;base64,${Buffer.from(runnable).toString("base64")}#sup10-bound`);
  const coordinator = new runtime.MsRefreshCoordinator(context(), {});
  for (let index = 0; index < 55; index += 1) {
    const hub = `Q${String(index).padStart(2, "0")}`;
    await coordinator.fetch(new Request("https://internal/supervisor/ingest", {
      method: "POST",
      body: JSON.stringify({ hub, observedAt: "2026-09-14T17:30:00.000Z", quotaObservation: quota({ httpRequests: index }), result: { status: "synced", acceptedRows: 0 } }),
    }));
  }
  const snapshot = await (await coordinator.fetch(new Request("https://internal/supervisor/snapshot"))).json();
  assert.equal(snapshot.quotaTelemetry.hubs.length, 50);
  assert.equal(snapshot.quotaTelemetry.coverage.observedHubs, 55);
  assert.equal(snapshot.quotaTelemetry.coverage.quotaObservedHubs, 50);
});

test("SUP-10 piggybacks onto the existing ingest request and adds no quota measurement I/O", () => {
  const { source } = quotaRuntime();
  assert.match(stagedWorker, /SUPERVISOR_QUOTA_PIGGYBACK_V1/);
  assert.match(stagedWorker, /typeof this\.env\?\.QUOTA_DIAGNOSTICS === "function" \? this\.env\.QUOTA_DIAGNOSTICS\(\) : null/);
  assert.match(stagedWorker, /observedAt,\s*quotaObservation,\s*result:/);
  assert.equal((stagedWorker.match(/https:\/\/ms-refresh\.internal\/supervisor\/ingest/g) || []).length, 1);
  assert.doesNotMatch(source, /env\.DB|\.prepare\s*\(|\bfetch\s*\(|setInterval\s*\(|setTimeout\s*\(|new\s+WebSocket|EventSource|storage\.(?:put|delete)|ctx\.storage|api\.turso|cloudflare\.com|AI\s*call/i);
  assert.doesNotMatch(quotaPatch, /env\.DB|\.prepare\s*\(|setInterval\s*\(|setTimeout\s*\(|api\.turso|cloudflare\.com/i);
  assert.match(wrapper, /patchSupervisorQuotaInstrumentation\(\s*patchSupervisorEventConsole/);
});

test("Turso runtime diagnostics are passive snapshots of work that already occurred", () => {
  const before = tursoRuntimeDiagnostics();
  const env = databaseEnv({ DB_BACKEND: "turso", TURSO_DATABASE_URL: "https://example.turso.io", TURSO_AUTH_TOKEN: "secret" });
  assert.equal(typeof env.QUOTA_DIAGNOSTICS, "function");
  const viaEnv = env.QUOTA_DIAGNOSTICS();
  const after = tursoRuntimeDiagnostics();
  for (const key of ["httpRequests", "statements", "rowsRead", "rowsWritten", "errors", "providerLimitErrors", "heavyReadEvents"]) {
    assert.equal(viaEnv[key], before[key]);
    assert.equal(after[key], before[key]);
  }
  assert.equal(viaEnv.scope, "current-worker-isolate");
  assert.equal("sql" in viaEnv, false);
  assert.equal("url" in viaEnv, false);
  assert.equal("token" in viaEnv, false);
});
