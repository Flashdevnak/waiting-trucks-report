// SUPERVISOR_SYSTEM_CONTEXT_V1
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
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]")
    .replace(/((?:token|secret|password|passwd|cookie|authorization|session[_-]?(?:id|token)?)\s*[=:]\s*)[^\s,;}"]+/gi, "$1[REDACTED]")
    .replace(/https?:\/\/[^\s"']+\?[^\s"']+/gi, "[REDACTED_URL_QUERY]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/\b(?:\+?66|0)\d{8,9}\b/g, "[REDACTED_PHONE]");
}

export function serializeRedactedSystemContext(context) {
  const body = JSON.stringify(context && typeof context === "object" ? context : {}, null, 2);
  return "WAITING_TRUCKS_SUPERVISOR_CONTEXT_V1\n" + redactSensitiveText(body);
}
