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
  const startLabel = "// SUPERVISOR_QUOTA_CENTER_V1: pure derivation";
  const endLabel = "// SUPERVISOR_QUOTA_CENTER_RENDER_V1";
  const start = supervisorFront.indexOf(startLabel);
  const end = supervisorFront.indexOf(endLabel, start + startLabel.length);
  assert.ok(start >= 0 && end > start, "SUP-11 pure quota derivation block missing");
  const source = supervisorFront.slice(start, end);
  const context = { Date, Array, Object, String, Number, Boolean, Set };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.deriveQuotaCenter = deriveQuotaCenter;`, context);
  return { deriveQuotaCenter: context.deriveQuotaCenter, source };
}

function hub(overrides = {}) {
  return {
    hub: "ZX9",
    state: "AVAILABLE",
    scope: "current-worker-isolate",
    observedAt: "2026-09-15T01:00:00.000Z",
    since: "2026-09-15T00:00:00.000Z",
    httpRequests: 12,
    statements: 7,
    rowsRead: 140,
    rowsWritten: 2,
    errors: 0,
    providerLimitErrors: 0,
    heavyReadEvents: 1,
    providerReadCircuitOpen: false,
    lastObservedAt: "2026-09-15T01:00:00.000Z",
    ...overrides,
  };
}

function telemetry(overrides = {}) {
  return {
    availability: "AVAILABLE",
    mode: "PIGGYBACK_ISOLATE_COUNTERS",
    billingTruth: "UNKNOWN",
    observedAt: "2026-09-15T01:00:00.000Z",
    coverage: { observedHubs: 1, quotaObservedHubs: 1 },
    hubs: [hub()],
    ...overrides,
  };
}

test("SUP-11 presents isolate-local quota evidence without promoting it to provider truth", () => {
  const { deriveQuotaCenter } = pureRuntime();
  const center = deriveQuotaCenter(telemetry());
  assert.equal(center.availability, "AVAILABLE");
  assert.equal(center.mode, "PIGGYBACK_ISOLATE_COUNTERS");
  assert.equal(center.billingTruth, "UNKNOWN");
  assert.equal(center.providerPlanLimit, "UNKNOWN");
  assert.equal(center.hubs.length, 1);
  assert.equal(center.hubs[0].rowsRead, 140);
  assert.equal(center.hubs[0].scope, "current-worker-isolate");
  assert.equal("totalRowsRead" in center, false);
  assert.equal("totalHttpRequests" in center, false);
});

test("SUP-11 never coerces malformed or string counters into zero", () => {
  const { deriveQuotaCenter } = pureRuntime();
  const center = deriveQuotaCenter(telemetry({
    availability: "PARTIAL",
    hubs: [hub({ httpRequests: "12", rowsRead: null, rowsWritten: -1, errors: Number.NaN, providerReadCircuitOpen: "false" })],
  }));
  assert.equal(center.availability, "PARTIAL");
  assert.equal(center.hubs[0].httpRequests, null);
  assert.equal(center.hubs[0].rowsRead, null);
  assert.equal(center.hubs[0].rowsWritten, null);
  assert.equal(center.hubs[0].errors, null);
  assert.equal(center.hubs[0].providerReadCircuitOpen, null);
});

test("SUP-11 missing quota evidence stays UNKNOWN instead of healthy or zero", () => {
  const { deriveQuotaCenter } = pureRuntime();
  const center = deriveQuotaCenter(null);
  assert.equal(center.availability, "UNKNOWN");
  assert.equal(center.billingTruth, "UNKNOWN");
  assert.equal(center.providerPlanLimit, "UNKNOWN");
  assert.equal(center.hubs.length, 0);
});

test("SUP-11 inconsistent coverage is downgraded to PARTIAL", () => {
  const { deriveQuotaCenter } = pureRuntime();
  const center = deriveQuotaCenter(telemetry({ coverage: { observedHubs: 3, quotaObservedHubs: 3 }, hubs: [hub()] }));
  assert.equal(center.availability, "PARTIAL");
  assert.equal(center.coverage.observedHubs, 3);
  assert.equal(center.coverage.quotaObservedHubs, 1);
});

test("SUP-11 unknown observed HUB denominator is downgraded to PARTIAL", () => {
  const { deriveQuotaCenter } = pureRuntime();
  const center = deriveQuotaCenter(telemetry({ coverage: { quotaObservedHubs: 1 }, hubs: [hub()] }));
  assert.equal(center.availability, "PARTIAL");
  assert.equal(center.coverage.observedHubs, null);
  assert.equal(center.coverage.quotaObservedHubs, 1);
});

test("SUP-11 client presentation remains bounded to 50 HUB observations", () => {
  const { deriveQuotaCenter } = pureRuntime();
  const hubs = Array.from({ length: 60 }, (_, index) => hub({ hub: `H${String(index).padStart(2, "0")}` }));
  const center = deriveQuotaCenter(telemetry({
    coverage: { observedHubs: 60, quotaObservedHubs: 60 },
    hubs,
  }));
  assert.equal(center.hubs.length, 50);
  assert.equal(center.availability, "PARTIAL");
});

test("SUP-11 derivation is pure and adds no provider, source, DB, timer, persistence, repair, or AI work", () => {
  const { source } = pureRuntime();
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|setInterval\s*\(|setTimeout\s*\(|env\.DB|\.prepare\s*\(|SELECT\s|INSERT\s|UPDATE\s|DELETE\s|storage\.(?:put|delete)|openai|anthropic|gemini|invokeAi|callAiProvider/i);
  assert.doesNotMatch(source, /repair\s*\(|execute\s*\(|POST|PUT|PATCH/i);
});

test("SUP-11 uses the existing one-shot snapshot transport and exposes truth-safe Quota Center anchors", () => {
  assert.match(supervisorFront, /SUPERVISOR_QUOTA_CENTER_V1/);
  assert.equal((supervisorFront.match(/\bfetch\s*\(/g) || []).length, 1);
  assert.match(supervisorFront, /fetch\("\/api\/supervisor\/snapshot"/);
  assert.doesNotMatch(supervisorFront, /setInterval|setTimeout|new\s+WebSocket|new\s+EventSource/);
  assert.match(supervisorHtml, /id="quota-center-state"/);
  assert.match(supervisorHtml, /id="quota-center-summary"/);
  assert.match(supervisorHtml, /id="quota-hub-list"/);
  assert.match(supervisorHtml, /Provider billing truth/);
  assert.match(supervisorHtml, /supervisor\.js\?v=20260915-sup14/);
});
