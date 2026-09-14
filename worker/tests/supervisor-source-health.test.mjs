import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SOURCE_STALE_AFTER_MS,
  deriveHubView,
  deriveSourceView,
} from "../../supervisor-view.js";
import { stageWorker } from "../../.github/dev-tools/stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const [canonical, frontend, viewSource] = await Promise.all([
  readFile(new URL("src/index.js", new URL("../", import.meta.url)), "utf8"),
  readFile(new URL("supervisor.js", root), "utf8"),
  readFile(new URL("supervisor-view.js", root), "utf8"),
]);
const staged = stageWorker(canonical);

test("SUP-06 derives freshness without fabricating source health", () => {
  const now = Date.parse("2026-09-14T15:00:00.000Z");
  const fresh = deriveSourceView({
    state: "HEALTHY",
    configured: true,
    lastSuccessAt: new Date(now - SOURCE_STALE_AFTER_MS + 1).toISOString(),
    observed: true,
  }, now);
  assert.equal(fresh.state, "HEALTHY");
  assert.equal(fresh.freshness, "FRESH");

  const stale = deriveSourceView({
    state: "HEALTHY",
    configured: true,
    lastSuccessAt: new Date(now - SOURCE_STALE_AFTER_MS - 1).toISOString(),
    observed: true,
  }, now);
  assert.equal(stale.state, "STALE");
  assert.equal(stale.freshness, "STALE");

  const unknown = deriveSourceView(null, now);
  assert.equal(unknown.state, "UNKNOWN");
  assert.equal(unknown.freshness, "UNKNOWN");
});

test("SUP-06 keeps HBI click-only and never marks it stale from age alone", () => {
  const now = Date.parse("2026-09-14T15:00:00.000Z");
  const hbi = deriveSourceView({
    state: "HEALTHY",
    configured: true,
    mode: "CLICK_ONLY",
    lastSuccessAt: "2026-09-10T00:00:00.000Z",
    lastUsedAt: "2026-09-10T00:00:00.000Z",
    observed: true,
  }, now);
  assert.equal(hbi.state, "HEALTHY");
  assert.equal(hbi.freshness, "ON_DEMAND");
  assert.equal(hbi.mode, "CLICK_ONLY");
});

test("SUP-06 HUB view exposes source-specific auth/error state and action", () => {
  const now = Date.parse("2026-09-14T15:00:00.000Z");
  const view = deriveHubView({
    hub: "ZX9",
    health: "WARNING",
    lastSuccessAt: "2026-09-14T14:59:00.000Z",
    accepted: { state: "AVAILABLE", rows: 11 },
    sources: {
      route: { state: "AUTH_REQUIRED", configured: true, errorCode: "MS_SESSION_HTTP_401", recovery: "AUTH_REQUIRED", observed: true },
      preEntry: { state: "HEALTHY", configured: true, lastSuccessAt: "2026-09-14T14:59:30.000Z", observed: true },
      busTime: { state: "WARNING", configured: true, lastSuccessAt: "2026-09-14T14:58:30.000Z", retryAt: "2026-09-14T15:02:00.000Z", recovery: "RETRY_WAIT", observed: true },
      hbiPhotos: { state: "UNKNOWN", configured: true, mode: "CLICK_ONLY", observed: false },
    },
  }, now);
  assert.equal(view.route, "AUTH_REQUIRED");
  assert.equal(view.preEntry, "HEALTHY");
  assert.equal(view.kitTbr, "WARNING");
  assert.equal(view.hbi, "UNKNOWN");
  assert.equal(view.connectorSession, "AUTH_REQUIRED");
  assert.equal(view.pendingAction, "REVIEW_REQUIRED");
});

test("SUP-06 staged telemetry is piggyback-only and sanitized", () => {
  assert.match(staged, /SUPERVISOR_SOURCE_HEALTH_V1/);
  assert.match(staged, /supervisorRefreshSourceTelemetry\(branch, credentials, rows, parcelCounts, busData\)/);
  assert.match(staged, /sourceTelemetry: supervisorSourceTelemetry/);
  assert.match(staged, /sourceTelemetry: result\?\.sourceTelemetry \? supervisorSanitizedSourceTelemetry/);
  assert.match(staged, /mode: "CLICK_ONLY"/);

  const start = staged.indexOf("// SUPERVISOR_SOURCE_HEALTH_V1:");
  const end = staged.indexOf("\nasync function runMsRefresh", start);
  assert.ok(start >= 0 && end > start, "source-health helper block missing");
  const helper = staged.slice(start, end);
  assert.doesNotMatch(helper, /env\.DB|\.prepare\s*\(|\bfetch\s*\(|setInterval\s*\(|setTimeout\s*\(|new\s+WebSocket|EventSource|AI\s*call/i);
  assert.doesNotMatch(helper, /route_followstart|fleet_time|getList|readMsRoutes\s*\(|readPreEntryCounts\s*\(|readBusTimeData\s*\(/i);
});

test("SUP-06 frontend remains one-shot snapshot only", () => {
  assert.equal((frontend.match(/\bfetch\s*\(/g) || []).length, 1);
  assert.match(frontend, /fetch\("\/api\/supervisor\/snapshot"/);
  assert.doesNotMatch(frontend, /setInterval|setTimeout|new\s+WebSocket|new\s+EventSource/);
  assert.match(frontend, /HBI เป็น click-only/);
  assert.match(viewSource, /SOURCE_STALE_AFTER_MS = 20 \* 60 \* 1000/);
  assert.doesNotMatch(`${frontend}\n${viewSource}`, /EA2|NE1/);
});
