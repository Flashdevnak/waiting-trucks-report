import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  deriveRedactedSystemContext,
  redactSensitiveText,
  serializeRedactedSystemContext,
} from "../../supervisor-context.js";

const root = new URL("../../", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");

function fixture() {
  return {
    generatedAt: "2026-09-15T13:30:00.000Z",
    workerReachable: true,
    overview: {
      snapshot: "AVAILABLE",
      overall: "PARTIAL",
      queueLifecycle: { state: "PARTIAL", active: 4, waiting: 2, unloading: 2, destinationActive: 3, dropActive: 1, awaitingRelease: 1, expired12h: 0, cancelledObserved: 0 },
      rawSecret: "Bearer OVERVIEW_SECRET_123",
    },
    hubViews: [{
      hub: "EA2",
      overall: "ERROR",
      lastSuccessAt: "2026-09-15T13:29:00.000Z",
      errorCode: "ROUTE_401",
      connectorSession: "Bearer CONNECTOR_SECRET_123",
      sources: {
        route: { state: "ERROR", configured: true, freshness: "FRESH", lastSuccessAt: "2026-09-15T13:29:00.000Z", errorCode: "ROUTE_401", authorization: "Bearer ROUTE_SECRET_123" },
        preEntry: { state: "HEALTHY", configured: true, freshness: "FRESH" },
        busTime: { state: "AUTH_REQUIRED", configured: true, freshness: "STALE", errorCode: "AUTH_REQUIRED", cookie: "sid=COOKIE_SECRET_123" },
        hbiPhotos: { state: "UNKNOWN", configured: true, mode: "CLICK_ONLY", freshness: "UNKNOWN" },
      },
      queueLifecycle: { state: "PARTIAL", active: 4, waiting: 2, unloading: 2, destinationActive: 3, dropActive: 1, awaitingRelease: 1, expired12h: 0, cancelledObserved: 0 },
      parcels: [{ barcode: "TH1234567890" }],
      driverPhone: "0812345678",
    }],
    eventConsole: {
      availability: "AVAILABLE",
      events: [{ at: "2026-09-15T13:29:30.000Z", level: "ERROR", code: "REFRESH_ERROR", hub: "EA2", source: "ROUTE", message: "Authorization: Bearer EVENT_SECRET_123 email ops@example.com phone 0812345678" }],
    },
    incidentCenter: {
      availability: "AVAILABLE",
      state: "ERROR",
      openCount: 1,
      pendingActionCount: 1,
      recentAlerts: 1,
      incidents: [{ severity: "ERROR", status: "OPEN", hub: "EA2", source: "ROUTE", state: "ERROR", code: "ROUTE_401", observedAt: "2026-09-15T13:29:30.000Z", title: "cookie=INCIDENT_SECRET_123", evidence: "Bearer INCIDENT_SECRET_456" }],
      actions: [{ severity: "ERROR", hub: "EA2", source: "ROUTE", kind: "MANUAL_SOURCE_REVIEW", mode: "OBSERVE_ONLY", canExecute: false, nextStep: "token=ACTION_SECRET_123" }],
    },
    quotaCenter: {
      availability: "PARTIAL",
      mode: "PIGGYBACK_ISOLATE_COUNTERS",
      billingTruth: "UNKNOWN",
      providerPlanLimit: "UNKNOWN",
      observedAt: "2026-09-15T13:29:50.000Z",
      coverage: { observedHubs: 2, quotaObservedHubs: 1 },
      hubs: [{ hub: "EA2", state: "AVAILABLE", httpRequests: 10, statements: 9, rowsRead: 100, rowsWritten: 0, errors: 1, providerLimitErrors: 0, heavyReadEvents: 0, providerReadCircuitOpen: false, since: "2026-09-15T13:00:00.000Z", observedAt: "2026-09-15T13:29:50.000Z", authToken: "QUOTA_SECRET_123" }],
    },
    quotaProtection: {
      availability: "AVAILABLE",
      mode: "OBSERVE_ONLY",
      evidenceScope: "current-worker-isolate",
      observedAt: "2026-09-15T13:29:50.000Z",
      leakSignal: { state: "NO_LOCAL_GUARD_SIGNAL_OBSERVED" },
      circuit: { state: "CLOSED", until: null },
      backoff: { state: "CLEAR", activeCooldowns: 0, until: null },
      killSwitch: { state: "NOT_CONFIGURED", canExecute: false },
      policy: { providerReadBlockMs: 60000, heavyReadCooldownMs: 300000, heavyReadRowsThreshold: 100000 },
    },
  };
}

test("SUP-15 builds context from an explicit operational allowlist only", () => {
  const context = deriveRedactedSystemContext(fixture());
  const text = serializeRedactedSystemContext(context);
  for (const secret of ["OVERVIEW_SECRET_123", "CONNECTOR_SECRET_123", "ROUTE_SECRET_123", "COOKIE_SECRET_123", "EVENT_SECRET_123", "INCIDENT_SECRET_123", "INCIDENT_SECRET_456", "ACTION_SECRET_123", "QUOTA_SECRET_123", "TH1234567890", "0812345678", "ops@example.com"])
    assert.equal(text.includes(secret), false, secret);
  assert.ok(text.includes("EA2"));
  assert.ok(text.includes("ROUTE_401"));
  assert.ok(text.includes("AUTH_REQUIRED"));
  assert.ok(text.includes("CLICK_ONLY"));
  assert.equal(context.safety.productionTouched, "NO");
  assert.equal(context.safety.supervisorExtraUpstream, 0);
  assert.equal(context.safety.supervisorDbReads, 0);
  assert.equal(context.safety.supervisorDbWrites, 0);
});

test("SUP-15 defense-in-depth text redaction masks common secret shapes", () => {
  const raw = "Bearer abc.def token=tok_123 password=hunter2 cookie=sid123 https://example.test/x?a=secret ops@example.com 0812345678";
  const safe = redactSensitiveText(raw);
  for (const value of ["abc.def", "tok_123", "hunter2", "sid123", "a=secret", "ops@example.com", "0812345678"])
    assert.equal(safe.includes(value), false, value);
  assert.ok(safe.includes("[REDACTED]"));
  assert.ok(safe.includes("[REDACTED_URL_QUERY]"));
});

test("SUP-15 copied context excludes free-form event/incident/action text", () => {
  const context = deriveRedactedSystemContext(fixture());
  assert.deepEqual(Object.keys(context.eventConsole.recent[0]).sort(), ["at", "code", "hub", "level", "source"].sort());
  assert.equal("message" in context.eventConsole.recent[0], false);
  assert.equal("title" in context.incidents.items[0], false);
  assert.equal("evidence" in context.incidents.items[0], false);
  assert.equal("nextStep" in context.incidents.actions[0], false);
});

test("SUP-15 UI starts locked and enables copy only from the accepted sanitized snapshot path", async () => {
  const html = await read("supervisor.html");
  const app = await read("supervisor.js");
  assert.ok(html.includes("SUPERVISOR_SYSTEM_CONTEXT_V1"));
  assert.match(html, /id="copy-system-context"[^>]+disabled/);
  assert.ok(app.includes("deriveRedactedSystemContext({"));
  assert.ok(app.includes("workerReachable && snapshot"));
  assert.ok(app.includes("copyButton.disabled = !context"));
  assert.ok(app.includes("navigator.clipboard.writeText(systemContextText)"));
  assert.equal(/JSON\.stringify\(\s*snapshot/.test(app), false);
  assert.equal(/structuredClone\(\s*snapshot/.test(app), false);
});

test("SUP-15 adds no new runtime transport, polling, repair, persistence, or AI work", async () => {
  const contextModule = await read("supervisor-context.js");
  const app = await read("supervisor.js");
  for (const forbidden of ["fetch(", "WebSocket", "EventSource", "setInterval(", "setTimeout(", "localStorage", "document.", "navigator.", "/api/", "openai", "repairMs"])
    assert.equal(contextModule.includes(forbidden), false, "context module must not contain " + forbidden);
  assert.equal((app.match(/fetch\(/g) || []).length, 1, "Supervisor must retain one snapshot fetch only");
});

test("SUP-15 DEV deployment stages and syntax-checks the context asset", async () => {
  const workflow = await read(".github/workflows/deploy-worker-dev.yml");
  const pkg = await read("worker/package.json");
  assert.ok(workflow.includes("- supervisor-context.js"));
  assert.ok(workflow.includes("../supervisor-context.js"));
  assert.ok(workflow.includes("node --check .dev-assets/supervisor-context.js"));
  assert.ok(pkg.includes("node --check ../supervisor-context.js"));
  assert.ok(pkg.includes("tests/supervisor-system-context.test.mjs"));
});
