import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../../", import.meta.url);
const [supervisorFront, supervisorHtml] = await Promise.all([
  readFile(new URL("supervisor.js", root), "utf8"),
  readFile(new URL("supervisor.html", root), "utf8"),
]);

function pureRuntime() {
  const startLabel = "// SUPERVISOR_INCIDENT_ACTION_V1: pure derivation";
  const endLabel = "// SUPERVISOR_INCIDENT_ACTION_RENDER_V1";
  const start = supervisorFront.indexOf(startLabel);
  const end = supervisorFront.indexOf(endLabel, start + startLabel.length);
  assert.ok(start >= 0 && end > start, "SUP-09 pure derivation block missing");
  const source = supervisorFront.slice(start, end);
  const context = { Date, Array, Object, String, Number, Set };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.deriveIncidentActionCenter = deriveIncidentActionCenter;`, context);
  return { deriveIncidentActionCenter: context.deriveIncidentActionCenter, source };
}

function source(state = "HEALTHY", overrides = {}) {
  return {
    state,
    configured: true,
    freshness: "FRESH",
    mode: "REFRESH",
    lastSuccessAt: "2026-09-14T16:00:00.000Z",
    errorCode: null,
    ...overrides,
  };
}

function hubView(overrides = {}) {
  return {
    hub: "ZX9",
    overall: "HEALTHY",
    lastSuccessAt: "2026-09-14T16:00:00.000Z",
    errorCode: null,
    sources: {
      route: source(),
      preEntry: source("UNKNOWN", { configured: false, freshness: "UNKNOWN", lastSuccessAt: null }),
      busTime: source(),
      hbiPhotos: source("UNKNOWN", { mode: "CLICK_ONLY", freshness: "UNKNOWN", lastSuccessAt: null }),
    },
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    id: "event-1",
    at: "2026-09-14T16:01:00.000Z",
    level: "WARN",
    code: "SOURCE_STATE_CHANGED",
    hub: "ZX9",
    source: "KIT_TBR",
    message: "KIT_TBR HEALTHY -> AUTH_REQUIRED · NEEDS_LOGIN",
    ...overrides,
  };
}

test("SUP-09 creates one deduped manual re-auth incident from current AUTH_REQUIRED truth", () => {
  const { deriveIncidentActionCenter } = pureRuntime();
  const view = hubView({
    overall: "WARNING",
    sources: {
      ...hubView().sources,
      busTime: source("AUTH_REQUIRED", { errorCode: "NEEDS_LOGIN" }),
    },
  });
  const center = deriveIncidentActionCenter([view], [event()], "AVAILABLE");
  assert.equal(center.availability, "AVAILABLE");
  assert.equal(center.openCount, 1);
  assert.equal(center.pendingActionCount, 1);
  assert.equal(center.incidents[0].key, "SOURCE:ZX9:KIT_TBR");
  assert.equal(center.incidents[0].severity, "WARN");
  assert.equal(center.incidents[0].status, "OPEN");
  assert.equal(center.actions[0].kind, "MANUAL_REAUTH");
  assert.equal(center.actions[0].canExecute, false);
  assert.equal(center.actions[0].mode, "OBSERVE_ONLY");
  assert.match(center.actions[0].nextStep, /session \/ HAR จริง/);
});

test("SUP-09 current recovered state closes historical warning instead of keeping a phantom incident", () => {
  const { deriveIncidentActionCenter } = pureRuntime();
  const center = deriveIncidentActionCenter([hubView()], [event()], "AVAILABLE");
  assert.equal(center.openCount, 0);
  assert.equal(center.pendingActionCount, 0);
  assert.equal(center.recentAlerts, 1);
  assert.equal(center.state, "HEALTHY");
});

test("SUP-09 event history alone never asserts that an incident is still open", () => {
  const { deriveIncidentActionCenter } = pureRuntime();
  const center = deriveIncidentActionCenter([], [event({ level: "ERROR" })], "AVAILABLE");
  assert.equal(center.availability, "UNAVAILABLE");
  assert.equal(center.state, "UNKNOWN");
  assert.equal(center.openCount, 0);
  assert.equal(center.pendingActionCount, 0);
  assert.equal(center.recentAlerts, 1);
});

test("SUP-09 queue-count event remains informational and does not become an incident", () => {
  const { deriveIncidentActionCenter } = pureRuntime();
  const center = deriveIncidentActionCenter([
    hubView(),
  ], [event({ level: "WARN", code: "QUEUE_COUNTS_CHANGED", source: "QUEUE", message: "active 9" })], "AVAILABLE");
  assert.equal(center.openCount, 0);
  assert.equal(center.pendingActionCount, 0);
});

test("SUP-09 source incidents dedupe by current HUB/source key", () => {
  const { deriveIncidentActionCenter } = pureRuntime();
  const view = hubView({
    overall: "ERROR",
    sources: {
      ...hubView().sources,
      route: source("ERROR", { errorCode: "SOURCE_DOWN" }),
    },
  });
  const center = deriveIncidentActionCenter([view], [
    event({ source: "ROUTE", level: "ERROR", message: "ROUTE HEALTHY -> ERROR" }),
    event({ id: "event-2", source: "ROUTE", level: "ERROR", message: "ROUTE ERROR -> ERROR" }),
  ], "AVAILABLE");
  assert.equal(center.incidents.filter((item) => item.key === "SOURCE:ZX9:ROUTE").length, 1);
  assert.equal(center.incidents.some((item) => item.key === "HUB:ZX9"), false);
});

test("SUP-09 derivation is pure and introduces no source, DB, timer, transport, persistence, repair, or AI work", () => {
  const { source: pureSource } = pureRuntime();
  assert.doesNotMatch(pureSource, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|setInterval\s*\(|setTimeout\s*\(|env\.DB|\.prepare\s*\(|SELECT\s|INSERT\s|UPDATE\s|DELETE\s|storage\.(?:put|delete)|openai|anthropic|gemini|invokeAi|callAiProvider/i);
  assert.doesNotMatch(pureSource, /repair\s*\(|execute\s*\(|POST|PUT|PATCH/i);
});

test("SUP-09 frontend preserves one-shot snapshot transport and disabled action execution", () => {
  assert.match(supervisorFront, /SUPERVISOR_INCIDENT_ACTION_V1/);
  assert.equal((supervisorFront.match(/\bfetch\s*\(/g) || []).length, 1);
  assert.match(supervisorFront, /fetch\("\/api\/supervisor\/snapshot"/);
  assert.doesNotMatch(supervisorFront, /setInterval|setTimeout|new\s+WebSocket|new\s+EventSource/);
  assert.match(supervisorFront, /actionExecution: "DISABLED_OBSERVE_ONLY"/);
  assert.match(supervisorFront, /canExecute: false/);
  assert.match(supervisorFront, /current open เท่านั้น/);
  assert.match(supervisorHtml, /supervisor\.js\?v=20260914-sup09/);
});
