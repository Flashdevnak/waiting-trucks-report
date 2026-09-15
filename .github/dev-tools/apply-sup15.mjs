import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const write = (file, text) => fs.writeFileSync(path.join(root, file), text, "utf8");

function replaceRequired(file, from, to, label = from.slice(0, 80)) {
  const current = read(file);
  if (!current.includes(from)) throw new Error(`${file}: missing replacement anchor: ${label}`);
  write(file, current.replace(from, to));
}

function replaceRegexRequired(file, regex, to, label) {
  const current = read(file);
  if (!regex.test(current)) throw new Error(`${file}: missing regex anchor: ${label}`);
  write(file, current.replace(regex, to));
}

const contextModule = `// SUPERVISOR_SYSTEM_CONTEXT_V1
// Pure allowlist-only redacted context builder. No transport, DOM, storage, DB,
// source, repair, timer, persistence, or AI work.

const REDACTED = "[REDACTED]";
const UNKNOWN = "UNKNOWN";

function safeCount(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= Number.MAX_SAFE_INTEGER ? number : null;
}

function safeBool(value) {
  return typeof value === "boolean" ? value : null;
}

function safeIso(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function safeHub(value) {
  const text = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9_-]{2,20}$/.test(text) ? text : UNKNOWN;
}

function safeCode(value, fallback = UNKNOWN) {
  const text = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9_:-]{1,80}$/.test(text)) return fallback;
  if (text.length >= 32 && /^[A-Z0-9_-]{32,}$/.test(text)) return REDACTED;
  return text;
}

function safeScope(value) {
  return value === "current-worker-isolate" ? value : UNKNOWN;
}

function safeSource(source) {
  if (!source || typeof source !== "object") return null;
  return {
    state: safeCode(source.state),
    mode: source.mode == null ? null : safeCode(source.mode),
    configured: safeBool(source.configured),
    freshness: safeCode(source.freshness),
    lastSuccessAt: safeIso(source.lastSuccessAt),
    lastUsedAt: safeIso(source.lastUsedAt),
    retryAt: safeIso(source.retryAt),
    recovery: safeCode(source.recovery),
    errorCode: source.errorCode == null ? null : safeCode(source.errorCode),
  };
}

function safeLifecycle(queue) {
  if (!queue || typeof queue !== "object") return null;
  return {
    state: safeCode(queue.state),
    active: safeCount(queue.active),
    waiting: safeCount(queue.waiting),
    unloading: safeCount(queue.unloading),
    destinationActive: safeCount(queue.destinationActive),
    dropActive: safeCount(queue.dropActive),
    awaitingRelease: safeCount(queue.awaitingRelease),
    expired12h: safeCount(queue.expired12h),
    cancelledObserved: safeCount(queue.cancelledObserved),
  };
}

function safeHubView(view) {
  const sources = view?.sources || {};
  return {
    hub: safeHub(view?.hub),
    overall: safeCode(view?.overall),
    lastSuccessAt: safeIso(view?.lastSuccessAt),
    refreshErrorCode: view?.errorCode == null ? null : safeCode(view.errorCode),
    sources: {
      route: safeSource(sources.route),
      preEntry: safeSource(sources.preEntry),
      kitTbr: safeSource(sources.busTime),
      hbi: safeSource(sources.hbiPhotos),
    },
    queueLifecycle: safeLifecycle(view?.queueLifecycle),
  };
}

function safeEvent(event) {
  if (!event || typeof event !== "object") return null;
  const at = safeIso(event.at);
  const hub = safeHub(event.hub);
  const level = safeCode(event.level);
  const code = safeCode(event.code);
  if (!at || hub === UNKNOWN || level === UNKNOWN || code === UNKNOWN) return null;
  return {
    at,
    level,
    code,
    hub,
    source: event.source == null ? null : safeCode(event.source),
  };
}

function safeIncident(item) {
  if (!item || typeof item !== "object") return null;
  return {
    severity: safeCode(item.severity),
    status: safeCode(item.status),
    hub: safeHub(item.hub),
    source: item.source == null ? null : safeCode(item.source),
    state: safeCode(item.state),
    code: item.code == null ? null : safeCode(item.code),
    observedAt: safeIso(item.observedAt),
  };
}

function safeAction(item) {
  if (!item || typeof item !== "object") return null;
  return {
    severity: safeCode(item.severity),
    hub: safeHub(item.hub),
    source: item.source == null ? null : safeCode(item.source),
    kind: safeCode(item.kind),
    mode: safeCode(item.mode),
    canExecute: item.canExecute === false ? false : null,
  };
}

function safeQuotaHub(item) {
  if (!item || typeof item !== "object") return null;
  return {
    hub: safeHub(item.hub),
    state: safeCode(item.state),
    httpRequests: safeCount(item.httpRequests),
    statements: safeCount(item.statements),
    rowsRead: safeCount(item.rowsRead),
    rowsWritten: safeCount(item.rowsWritten),
    errors: safeCount(item.errors),
    providerLimitErrors: safeCount(item.providerLimitErrors),
    heavyReadEvents: safeCount(item.heavyReadEvents),
    providerReadCircuitOpen: safeBool(item.providerReadCircuitOpen),
    since: safeIso(item.since),
    observedAt: safeIso(item.observedAt || item.lastObservedAt),
  };
}

function safeProtection(protection) {
  if (!protection || typeof protection !== "object") return null;
  return {
    availability: safeCode(protection.availability),
    mode: safeCode(protection.mode),
    evidenceScope: safeScope(protection.evidenceScope),
    observedAt: safeIso(protection.observedAt),
    leakSignal: { state: safeCode(protection.leakSignal?.state) },
    circuit: {
      state: safeCode(protection.circuit?.state),
      until: safeIso(protection.circuit?.until),
    },
    backoff: {
      state: safeCode(protection.backoff?.state),
      activeCooldowns: safeCount(protection.backoff?.activeCooldowns),
      until: safeIso(protection.backoff?.until),
    },
    killSwitch: {
      state: safeCode(protection.killSwitch?.state),
      canExecute: protection.killSwitch?.canExecute === false ? false : null,
    },
    policy: {
      providerReadBlockMs: safeCount(protection.policy?.providerReadBlockMs),
      heavyReadCooldownMs: safeCount(protection.policy?.heavyReadCooldownMs),
      heavyReadRowsThreshold: safeCount(protection.policy?.heavyReadRowsThreshold),
    },
  };
}

export function deriveRedactedSystemContext({
  generatedAt,
  workerReachable = false,
  overview,
  hubViews = [],
  eventConsole,
  incidentCenter,
  quotaCenter,
  quotaProtection,
} = {}) {
  const hubs = Array.isArray(hubViews)
    ? hubViews.map(safeHubView).filter((item) => item.hub !== UNKNOWN).sort((a, b) => a.hub.localeCompare(b.hub))
    : [];
  const events = Array.isArray(eventConsole?.events)
    ? eventConsole.events.map(safeEvent).filter(Boolean).slice(-20)
    : [];
  const incidents = Array.isArray(incidentCenter?.incidents)
    ? incidentCenter.incidents.map(safeIncident).filter(Boolean)
    : [];
  const actions = Array.isArray(incidentCenter?.actions)
    ? incidentCenter.actions.map(safeAction).filter(Boolean)
    : [];
  const quotaHubs = Array.isArray(quotaCenter?.hubs)
    ? quotaCenter.hubs.map(safeQuotaHub).filter(Boolean).filter((item) => item.hub !== UNKNOWN)
    : [];

  return {
    schema: "WAITING_TRUCKS_SUPERVISOR_CONTEXT_V1",
    redaction: "ALLOWLIST_ONLY",
    generatedAt: safeIso(generatedAt),
    environment: "DEV",
    mode: "OBSERVE_ONLY",
    current: {
      workerReachable: workerReachable === true,
      snapshot: safeCode(overview?.snapshot),
      overall: safeCode(overview?.overall),
      queueLifecycle: safeLifecycle(overview?.queueLifecycle),
    },
    hubs,
    eventConsole: {
      availability: safeCode(eventConsole?.availability),
      retainedCount: safeCount(eventConsole?.events?.length),
      recent: events,
    },
    incidents: {
      availability: safeCode(incidentCenter?.availability),
      state: safeCode(incidentCenter?.state),
      openCount: safeCount(incidentCenter?.openCount),
      pendingActionCount: safeCount(incidentCenter?.pendingActionCount),
      recentAlerts: safeCount(incidentCenter?.recentAlerts),
      items: incidents,
      actions,
    },
    quota: {
      availability: safeCode(quotaCenter?.availability),
      mode: safeCode(quotaCenter?.mode),
      billingTruth: safeCode(quotaCenter?.billingTruth),
      providerPlanLimit: safeCode(quotaCenter?.providerPlanLimit),
      observedAt: safeIso(quotaCenter?.observedAt),
      coverage: {
        observedHubs: safeCount(quotaCenter?.coverage?.observedHubs),
        quotaObservedHubs: safeCount(quotaCenter?.coverage?.quotaObservedHubs),
      },
      hubs: quotaHubs,
      protection: safeProtection(quotaProtection),
    },
    safety: {
      productionTouched: "NO",
      supervisorExtraUpstream: 0,
      supervisorDbReads: 0,
      supervisorDbWrites: 0,
      directHttp4sPolling: 0,
      hbiBackgroundPolling: 0,
      repairExecution: "DISABLED",
      aiMonitoring: 0,
    },
    omitted: [
      "raw snapshot",
      "credentials and authorization material",
      "cookies and tokens",
      "HAR/session payloads",
      "headers and URL query values",
      "parcel/driver/phone identifiers",
      "free-form event messages",
      "private reasoning",
    ],
  };
}

export function redactSensitiveText(value) {
  return String(value ?? "")
    .replace(/Bearer\\s+[A-Za-z0-9._~+\\/-]+/gi, "Bearer [REDACTED]")
    .replace(/((?:token|secret|password|passwd|cookie|authorization|session[_-]?(?:id|token)?)\\s*[=:]\\s*)[^\\s,;}"]+/gi, "$1[REDACTED]")
    .replace(/https?:\\/\\/[^\\s"']+\\?[^\\s"']+/gi, "[REDACTED_URL_QUERY]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/\\b(?:\\+?66|0)\\d{8,9}\\b/g, "[REDACTED_PHONE]");
}

export function serializeRedactedSystemContext(context) {
  const body = JSON.stringify(context && typeof context === "object" ? context : {}, null, 2);
  return `WAITING_TRUCKS_SUPERVISOR_CONTEXT_V1\\n${redactSensitiveText(body)}`;
}
`;

const contextTest = `import test from "node:test";
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
  assert.equal(/JSON\\.stringify\\(\\s*snapshot/.test(app), false);
  assert.equal(/structuredClone\\(\\s*snapshot/.test(app), false);
});

test("SUP-15 adds no new runtime transport, polling, repair, persistence, or AI work", async () => {
  const contextModule = await read("supervisor-context.js");
  const app = await read("supervisor.js");
  for (const forbidden of ["fetch(", "WebSocket", "EventSource", "setInterval(", "setTimeout(", "localStorage", "document.", "navigator.", "/api/", "openai", "repairMs"])
    assert.equal(contextModule.includes(forbidden), false, `context module must not contain ${forbidden}`);
  assert.equal((app.match(/fetch\\(/g) || []).length, 1, "Supervisor must retain one snapshot fetch only");
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
`;

write("supervisor-context.js", contextModule);
write("worker/tests/supervisor-system-context.test.mjs", contextTest);

replaceRequired(
  "supervisor.html",
  '<script type="module" src="supervisor.js?v=20260915-sup14"></script>',
  '<script type="module" src="supervisor.js?v=20260915-sup15"></script>',
  "SUP-15 supervisor.js cache key",
);

{
  const file = "supervisor.html";
  let html = read(file);
  const needle = '<p class="card-label">SYSTEM CONTEXT</p>';
  const marker = html.indexOf(needle);
  if (marker < 0) throw new Error("supervisor.html: SYSTEM CONTEXT card missing");
  const start = html.lastIndexOf('            <article class="surface span-2">', marker);
  const close = html.indexOf("            </article>", marker);
  if (start < 0 || close < 0) throw new Error("supervisor.html: SYSTEM CONTEXT card bounds missing");
  const end = close + "            </article>".length;
  const replacement = `            <article class="surface span-2" data-system-context>
              <!-- SUPERVISOR_SYSTEM_CONTEXT_V1: allowlist-only browser copy from already-sanitized shared facts. -->
              <div class="surface-head"><div><p class="card-label">SYSTEM CONTEXT</p><h3>Redacted System Context</h3></div><span id="system-context-state" class="status-tag unknown">LOCKED</span></div>
              <p id="system-context-detail" class="body-copy">ปุ่ม Copy จะเปิดเมื่อมี sanitized snapshot และ redaction tests ผ่านแล้ว</p>
              <ul class="contract-list">
                <li><span>Raw snapshot</span><strong>OMITTED</strong></li>
                <li><span>Credentials / tokens / cookies</span><strong>OMITTED</strong></li>
                <li><span>HAR / session payload</span><strong>OMITTED</strong></li>
                <li><span>Free-form event message</span><strong>OMITTED</strong></li>
                <li><span>Parcel / driver identifiers</span><strong>OMITTED</strong></li>
              </ul>
              <button id="copy-system-context" class="button button-quiet full" type="button" disabled>Copy Current System Context</button>
              <p id="system-context-copy-state" class="truth-note">Browser-only clipboard · no extra server request</p>
            </article>`;
  html = html.slice(0, start) + replacement + html.slice(end);
  write(file, html);
}

replaceRequired(
  "supervisor.js",
  "// SUPERVISOR_GUIDE_V1\n",
  "// SUPERVISOR_GUIDE_V1\n// SUPERVISOR_SYSTEM_CONTEXT_V1\n",
  "SUP-15 marker",
);
replaceRequired(
  "supervisor.js",
  'import { applySupervisorLanguage, nextSupervisorLanguage, readSupervisorLanguage, syncSupervisorLanguageControls, writeSupervisorLanguage } from "./supervisor-i18n.js?v=20260915-sup14";\n',
  'import { applySupervisorLanguage, nextSupervisorLanguage, readSupervisorLanguage, syncSupervisorLanguageControls, writeSupervisorLanguage } from "./supervisor-i18n.js?v=20260915-sup14";\nimport { deriveRedactedSystemContext, serializeRedactedSystemContext } from "./supervisor-context.js?v=20260915-sup15";\n',
  "SUP-15 context import",
);
replaceRequired(
  "supervisor.js",
  'let supervisorLanguage = readSupervisorLanguage();\n',
  'let supervisorLanguage = readSupervisorLanguage();\nlet systemContextText = null;\n',
  "SUP-15 context state",
);

const contextUiFunctions = `function renderSystemContext(context) {
  const state = document.getElementById("system-context-state");
  const detail = document.getElementById("system-context-detail");
  const copyButton = document.getElementById("copy-system-context");
  const copyState = document.getElementById("system-context-copy-state");
  if (!state || !detail || !copyButton || !copyState) return;

  systemContextText = context ? serializeRedactedSystemContext(context) : null;
  copyButton.disabled = !context;
  state.textContent = context ? "READY" : "LOCKED";
  state.className = `status-tag ${context ? "healthy" : "unknown"}`;
  detail.textContent = "ปุ่ม Copy จะเปิดเมื่อมี sanitized snapshot และ redaction tests ผ่านแล้ว";
  copyState.textContent = context
    ? "Browser-only clipboard · allowlist/redaction PASS · no extra server request"
    : "Browser-only clipboard · no extra server request";
  applyCurrentLanguage();
}

function bindSystemContextControl() {
  const copyButton = document.getElementById("copy-system-context");
  if (!copyButton) return;
  copyButton.addEventListener("click", async () => {
    if (!systemContextText) return;
    try {
      await navigator.clipboard.writeText(systemContextText);
      copyButton.textContent = "คัดลอกแล้ว";
    } catch {
      copyButton.textContent = "คัดลอกถูกบล็อก";
    }
    applyCurrentLanguage();
  });
}

`;
replaceRequired(
  "supervisor.js",
  "// SUPERVISOR_INCIDENT_ACTION_RENDER_V1\n\nfunction bindShell() {",
  `// SUPERVISOR_INCIDENT_ACTION_RENDER_V1\n\n${contextUiFunctions}function bindShell() {`,
  "SUP-15 UI functions insertion",
);
replaceRequired(
  "supervisor.js",
  "  bindTerminalControls();\n}",
  "  bindTerminalControls();\n  bindSystemContextControl();\n}",
  "SUP-15 bind context control",
);
replaceRequired(
  "supervisor.js",
  "  const overview = deriveOverview(snapshot, module, { moduleCount: moduleRegistry.list().length, workerReachable, nowMs });\n",
  `  const overview = deriveOverview(snapshot, module, { moduleCount: moduleRegistry.list().length, workerReachable, nowMs });\n  const systemContext = workerReachable && snapshot\n    ? deriveRedactedSystemContext({\n        generatedAt: new Date(nowMs).toISOString(),\n        workerReachable,\n        overview,\n        hubViews,\n        eventConsole,\n        incidentCenter,\n        quotaCenter,\n        quotaProtection,\n      })\n    : null;\n`,
  "SUP-15 derive context",
);
replaceRequired(
  "supervisor.js",
  "  renderTerminalConsole(snapshot);\n  applyCurrentLanguage();\n}",
  "  renderTerminalConsole(snapshot);\n  renderSystemContext(systemContext);\n  applyCurrentLanguage();\n}",
  "SUP-15 render context",
);

replaceRequired(
  "worker/package.json",
  "node --check ../supervisor.js && node --check ../supervisor-i18n.js",
  "node --check ../supervisor.js && node --check ../supervisor-context.js && node --check ../supervisor-i18n.js",
  "SUP-15 context syntax check",
);
replaceRequired(
  "worker/package.json",
  "tests/supervisor-language-contract.test.mjs tests/supervisor-guide-contract.test.mjs tests/bus-enrichment.test.mjs",
  "tests/supervisor-language-contract.test.mjs tests/supervisor-guide-contract.test.mjs tests/supervisor-system-context.test.mjs tests/bus-enrichment.test.mjs",
  "SUP-15 test suite",
);

replaceRequired(
  ".github/workflows/deploy-worker-dev.yml",
  "      - supervisor.js\n      - supervisor-i18n.js",
  "      - supervisor.js\n      - supervisor-context.js\n      - supervisor-i18n.js",
  "SUP-15 deploy trigger",
);
replaceRequired(
  ".github/workflows/deploy-worker-dev.yml",
  "../supervisor.html ../supervisor.js ../supervisor-i18n.js",
  "../supervisor.html ../supervisor.js ../supervisor-context.js ../supervisor-i18n.js",
  "SUP-15 staged asset",
);
replaceRequired(
  ".github/workflows/deploy-worker-dev.yml",
  "          node --check .dev-assets/supervisor.js\n          node --check .dev-assets/supervisor-i18n.js",
  "          node --check .dev-assets/supervisor.js\n          node --check .dev-assets/supervisor-context.js\n          node --check .dev-assets/supervisor-i18n.js",
  "SUP-15 staged syntax check",
);

replaceRegexRequired(
  "worker/tests/supervisor-guide-contract.test.mjs",
  /test\("SUP-14 keeps System Context copy locked for SUP-15"[\s\S]*?\n\}\);\n\ntest\("SUP-14 only cache-busts existing frontend assets and adds no guide runtime transport", async \(\) => \{[\s\S]*?\n\}\);\n/,
  `test("SUP-14 guide delegates System Context copy to the SUP-15 redaction contract", async () => {\n  const html = await read("supervisor.html");\n  const panel = html.slice(html.indexOf('data-panel="guide"'), html.indexOf('<dialog id="why-dialog"'));\n  assert.ok(panel.includes("SUPERVISOR_SYSTEM_CONTEXT_V1"));\n  assert.match(panel, /id="copy-system-context"[^>]+disabled/);\n  assert.equal(/data-repair|onclick=|fetch\\(|WebSocket|EventSource|setInterval\\(/.test(panel), false);\n});\n\ntest("SUP-14 guide keeps its frontend-only contract under the SUP-15 cache revision", async () => {\n  const html = await read("supervisor.html");\n  const app = await read("supervisor.js");\n  assert.ok(html.includes("supervisor.css?v=20260915-sup14"));\n  assert.ok(html.includes("supervisor.js?v=20260915-sup15"));\n  assert.ok(app.includes("./supervisor-i18n.js?v=20260915-sup14"));\n  assert.ok(app.includes("./supervisor-context.js?v=20260915-sup15"));\n  assert.equal(app.includes("loadGuide"), false);\n});\n`,
  "SUP-14 delegation tests",
);

replaceRequired(
  "worker/tests/supervisor-language-contract.test.mjs",
  'assert.ok(html.includes("supervisor.js?v=20260915-sup14"));',
  'assert.ok(html.includes("supervisor.js?v=20260915-sup15"));',
  "SUP-13 current app cache expectation",
);

console.log("SUP15_PATCH_APPLIED=PASS");
console.log("SUP15_BASE=5ef1c592fac91244bad211952fc780a40f0766bc");
console.log("PRODUCTION_TOUCHED=NO");
