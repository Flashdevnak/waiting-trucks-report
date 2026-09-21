// SUPERVISOR_OVERVIEW_HUB_VIEW_V1
// SUPERVISOR_SOURCE_HEALTH_V1
// SUPERVISOR_QUEUE_LIFECYCLE_V1
// Pure view derivation only: no transport, timers, storage, database, or repair.
const STATES = new Set([
  "HEALTHY", "WARNING", "CRITICAL", "STALE", "PARTIAL", "AUTH_REQUIRED",
  "SOURCE_UNAVAILABLE", "ERROR", "BLOCKED", "UNKNOWN", "RECOVERED",
]);
export const SOURCE_STALE_AFTER_MS = 20 * 60 * 1000;

export function safeState(value) {
  const state = String(value || "").toUpperCase();
  return STATES.has(state) ? state : "UNKNOWN";
}

function validTime(value) {
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
}

function safeCount(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

export function ageView(value, nowMs = Date.now()) {
  const time = validTime(value);
  if (time == null || !Number.isFinite(nowMs)) return { seconds: null, label: "UNKNOWN" };
  const seconds = Math.max(0, Math.floor((nowMs - time) / 1000));
  if (seconds < 60) return { seconds, label: `${seconds} วินาที` };
  if (seconds < 3600) return { seconds, label: `${Math.floor(seconds / 60)} นาที` };
  if (seconds < 86400) return { seconds, label: `${Math.floor(seconds / 3600)} ชั่วโมง` };
  return { seconds, label: `${Math.floor(seconds / 86400)} วัน` };
}

function metricValue(metrics, id) {
  const metric = Array.isArray(metrics) ? metrics.find((item) => item?.id === id) : null;
  return Number.isFinite(Number(metric?.value)) ? Number(metric.value) : null;
}

function aggregateStates(states) {
  const values = states.map(safeState).filter((state) => state !== "UNKNOWN");
  if (!values.length) return "UNKNOWN";
  if (values.some((state) => ["CRITICAL", "ERROR", "BLOCKED"].includes(state))) return "ERROR";
  if (values.some((state) => state === "AUTH_REQUIRED")) return "AUTH_REQUIRED";
  if (values.some((state) => ["WARNING", "STALE", "PARTIAL"].includes(state))) return "WARNING";
  return values.every((state) => ["HEALTHY", "RECOVERED"].includes(state)) ? "HEALTHY" : "UNKNOWN";
}

function aggregateHubState(hubs) {
  if (!hubs.length) return "UNKNOWN";
  return aggregateStates(hubs.map((hub) => hub?.health));
}

function hasSourceEvidence(source) {
  if (!source || typeof source !== "object") return false;
  return safeState(source.state) !== "UNKNOWN"
    || typeof source.configured === "boolean"
    || validTime(source.lastSuccessAt) != null
    || validTime(source.lastUsedAt) != null
    || Boolean(source.errorCode);
}

function sourceFreshness(source, nowMs) {
  const mode = String(source?.mode || "").toUpperCase();
  if (mode === "CLICK_ONLY" || mode === "ON_DEMAND") return "ON_DEMAND";
  const code = String(source?.errorCode || source?.lastError || "").toUpperCase();
  if (
    source?.sourceUnavailable === true ||
    safeState(source?.state) === "SOURCE_UNAVAILABLE" ||
    safeState(source?.state) === "AUTH_REQUIRED" ||
    /(?:401|403|AUTH_REQUIRED|SESSION_EXPIRED|INVALID_SESSION|CREDENTIAL_ERROR|NEEDS_LOGIN)/.test(code)
  ) return "SOURCE_UNAVAILABLE";
  const at = validTime(source?.lastSuccessAt);
  if (at == null || !Number.isFinite(nowMs)) return "UNKNOWN";
  return Math.max(0, nowMs - at) > SOURCE_STALE_AFTER_MS ? "STALE" : "FRESH";
}

export function deriveSourceView(source, nowMs = Date.now(), fallbackState = "UNKNOWN") {
  const raw = source && typeof source === "object" ? source : null;
  const baseState = raw ? safeState(raw.state) : safeState(fallbackState);
  const configured = typeof raw?.configured === "boolean" ? raw.configured : null;
  const lastSuccessAt = validTime(raw?.lastSuccessAt) == null ? null : raw.lastSuccessAt;
  const lastUsedAt = validTime(raw?.lastUsedAt) == null ? null : raw.lastUsedAt;
  const retryAt = validTime(raw?.retryAt) == null ? null : raw.retryAt;
  const freshness = sourceFreshness(raw, nowMs);
  const authUnavailable = /(?:401|403|AUTH_REQUIRED|SESSION_EXPIRED|INVALID_SESSION|CREDENTIAL_ERROR|NEEDS_LOGIN)/
    .test(String(raw?.errorCode || raw?.lastError || "").toUpperCase());
  const state = freshness === "SOURCE_UNAVAILABLE"
    ? authUnavailable || baseState === "AUTH_REQUIRED" ? "AUTH_REQUIRED" : "SOURCE_UNAVAILABLE"
    : freshness === "STALE" && ["HEALTHY", "RECOVERED"].includes(baseState)
      ? "STALE"
      : baseState;
  return {
    state,
    configured,
    lastSuccessAt,
    lastAttemptAt: validTime(raw?.lastAttemptAt) == null ? null : raw.lastAttemptAt,
    lastMeaningfulObservationAt: validTime(raw?.lastMeaningfulObservationAt) == null ? null : raw.lastMeaningfulObservationAt,
    lastErrorAt: validTime(raw?.lastErrorAt) == null ? null : raw.lastErrorAt,
    dataObservedAt: validTime(raw?.dataObservedAt) == null ? null : raw.dataObservedAt,
    sourceValueTimestamp: validTime(raw?.sourceValueTimestamp) == null ? null : raw.sourceValueTimestamp,
    acceptedDataAt: validTime(raw?.acceptedDataAt) == null ? null : raw.acceptedDataAt,
    lastUsedAt,
    successAge: ageView(lastSuccessAt, nowMs),
    freshness,
    errorCode: /^[A-Z0-9_:-]{2,80}$/.test(String(raw?.errorCode || "")) ? String(raw.errorCode) : null,
    recovery: /^[A-Z0-9_:-]{2,80}$/.test(String(raw?.recovery || "")) ? String(raw.recovery) : "UNKNOWN",
    retryAt,
    mode: String(raw?.mode || "").toUpperCase() === "CLICK_ONLY"
      ? "CLICK_ONLY"
      : String(raw?.mode || "").toUpperCase() === "ON_DEMAND"
        ? "ON_DEMAND"
        : "REFRESH",
    observed: raw?.observed === true,
  };
}

export function deriveLifecycleView(lifecycle, nowMs = Date.now()) {
  const raw = lifecycle && typeof lifecycle === "object" ? lifecycle : null;
  const counts = {
    rowsObserved: safeCount(raw?.rowsObserved),
    active: safeCount(raw?.active),
    waiting: safeCount(raw?.waiting),
    unloading: safeCount(raw?.unloading),
    destinationActive: safeCount(raw?.destinationActive),
    dropActive: safeCount(raw?.dropActive),
    awaitingRelease: safeCount(raw?.awaitingRelease),
    expired12h: safeCount(raw?.expired12h),
    cancelledObserved: safeCount(raw?.cancelledObserved),
  };
  const required = Object.values(counts);
  const structurallyValid =
    raw?.state === "AVAILABLE" &&
    required.every((value) => value !== null) &&
    counts.active === counts.waiting + counts.unloading &&
    counts.active === counts.destinationActive + counts.dropActive;
  const observedAt = validTime(raw?.observedAt) == null ? null : raw.observedAt;
  const age = ageView(observedAt, nowMs);
  const freshness = observedAt == null || !Number.isFinite(nowMs)
    ? "UNKNOWN"
    : Math.max(0, nowMs - Date.parse(observedAt)) > SOURCE_STALE_AFTER_MS
      ? "STALE"
      : "FRESH";
  const state = !structurallyValid
    ? "UNKNOWN"
    : freshness === "STALE"
      ? "STALE"
      : freshness === "UNKNOWN"
        ? "PARTIAL"
        : "AVAILABLE";
  return {
    state,
    observedAt,
    age,
    freshness,
    basis: raw?.basis === "ACCEPTED_CURRENT_ROWS" ? "ACCEPTED_CURRENT_ROWS" : "UNKNOWN",
    policy: raw?.policy === "MS_OPERATIONAL_STAGE_SHARED_V1" ? "MS_OPERATIONAL_STAGE_SHARED_V1" : "UNKNOWN",
    ...counts,
  };
}

function sourceAggregateForHub(hub, nowMs = Date.now()) {
  const sources = hub?.sources || {};
  const values = ["route", "preEntry", "busTime", "hbiPhotos"]
    .map((key) => sources?.[key])
    .filter(hasSourceEvidence)
    .map((source) => deriveSourceView(source, nowMs))
    .filter((source) => !(source.mode === "CLICK_ONLY" && source.state === "UNKNOWN"))
    .map((source) => source.state);
  return values.length ? aggregateStates(values) : "UNKNOWN";
}

function aggregateObservedSources(hubs, nowMs = Date.now()) {
  const sourceStates = hubs.map((hub) => sourceAggregateForHub(hub, nowMs)).filter((state) => state !== "UNKNOWN");
  return sourceStates.length ? aggregateStates(sourceStates) : aggregateHubState(hubs);
}

function aggregateLifecycle(hubs, nowMs = Date.now()) {
  const views = hubs.map((hub) => deriveLifecycleView(hub?.lifecycle, nowMs));
  const observed = views.filter((view) => view.state !== "UNKNOWN");
  const usable = observed.filter((view) => ["AVAILABLE", "STALE", "PARTIAL"].includes(view.state));
  const state = !observed.length
    ? "UNKNOWN"
    : observed.some((view) => view.state === "STALE")
      ? "STALE"
      : observed.length < hubs.length || observed.some((view) => view.state === "PARTIAL")
        ? "PARTIAL"
        : "AVAILABLE";
  const sum = (key) => usable.reduce((total, view) => total + (Number.isInteger(view[key]) ? view[key] : 0), 0);
  return {
    state,
    observedHubs: observed.length,
    totalHubs: hubs.length,
    active: sum("active"),
    waiting: sum("waiting"),
    unloading: sum("unloading"),
    destinationActive: sum("destinationActive"),
    dropActive: sum("dropActive"),
    awaitingRelease: sum("awaitingRelease"),
    expired12h: sum("expired12h"),
    cancelledObserved: sum("cancelledObserved"),
  };
}

export function deriveOverview(snapshot, evaluatedModule, options = {}) {
  const waitingTrucks = snapshot?.modules?.waitingTrucks || {};
  const hubs = Array.isArray(waitingTrucks.hubs) ? waitingTrucks.hubs : [];
  const metrics = evaluatedModule?.metrics || [];
  const availability = snapshot?.availability === "AVAILABLE" ? "AVAILABLE" : "UNAVAILABLE";
  const acceptedAvailable = hubs.filter((hub) => hub?.accepted?.state === "AVAILABLE").length;
  const acceptedState = !hubs.length ? "UNKNOWN" : acceptedAvailable === hubs.length ? "AVAILABLE" : acceptedAvailable ? "PARTIAL" : "UNKNOWN";
  const warningCount = hubs.filter((hub) => ["WARNING", "STALE", "PARTIAL", "AUTH_REQUIRED"].includes(safeState(hub?.health))).length;
  const criticalCount = hubs.filter((hub) => ["CRITICAL", "ERROR", "BLOCKED"].includes(safeState(hub?.health))).length;
  const contracts = snapshot?.contracts || {};
  const supervisorQuotaSafe = ["additionalUpstreamPolls", "databaseReads", "databaseWrites", "aiCalls"]
    .every((key) => Number(contracts[key]) === 0);
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const observedSourceState = aggregateObservedSources(hubs, nowMs);
  const queueLifecycle = aggregateLifecycle(hubs, nowMs);

  return {
    overall: safeState(evaluatedModule?.health?.state),
    impact: evaluatedModule?.health?.impact || "ยังไม่มีหลักฐาน shared runtime เพียงพอ",
    snapshot: availability,
    cards: [
      { id: "configured-modules", label: "Configured Modules", value: String(options.moduleCount ?? 0), status: safeState(evaluatedModule?.health?.state) },
      { id: "configured-hubs", label: "Configured HUB", value: "UNKNOWN", status: "UNKNOWN" },
      { id: "observed-hubs", label: "Observed HUB", value: String(metricValue(metrics, "observed-hubs") ?? hubs.length), status: hubs.length ? "PARTIAL" : "UNKNOWN" },
      { id: "healthy-hubs", label: "Healthy observed HUB", value: String(metricValue(metrics, "healthy-observed-hubs") ?? hubs.filter((hub) => safeState(hub?.health) === "HEALTHY").length), status: hubs.length ? "HEALTHY" : "UNKNOWN" },
      { id: "warning-hubs", label: "Warning observed HUB", value: String(warningCount), status: warningCount ? "WARNING" : hubs.length ? "HEALTHY" : "UNKNOWN" },
      { id: "critical-hubs", label: "Critical observed HUB", value: String(criticalCount), status: criticalCount ? "CRITICAL" : hubs.length ? "HEALTHY" : "UNKNOWN" },
      { id: "realtime", label: "Realtime", value: "UNKNOWN", status: "UNKNOWN", detail: "ไม่มี transport health ใน snapshot นี้" },
      { id: "worker", label: "Worker", value: options.workerReachable ? "HEALTHY" : "UNKNOWN", status: options.workerReachable ? "HEALTHY" : "UNKNOWN", detail: "ยืนยันจากการตอบ snapshot endpoint" },
      { id: "database", label: "Database", value: "UNKNOWN", status: "UNKNOWN", detail: "Supervisor ไม่ query DB เพื่อวัด health" },
      { id: "sources", label: "Observed source flow", value: observedSourceState, status: observedSourceState },
      { id: "accepted", label: "Accepted State", value: acceptedState, status: acceptedState === "AVAILABLE" ? "HEALTHY" : acceptedState },
      { id: "queue-lifecycle", label: "Queue / Lifecycle", value: queueLifecycle.state, status: queueLifecycle.state, detail: queueLifecycle.state === "UNKNOWN" ? "ยังไม่มี accepted lifecycle telemetry" : `active ${queueLifecycle.active} · waiting ${queueLifecycle.waiting} · unloading ${queueLifecycle.unloading}` },
      { id: "incidents", label: "Open incidents", value: "UNKNOWN", status: "UNKNOWN", detail: "Incident feed ยังไม่อยู่ใน checkpoint นี้" },
      { id: "actions", label: "Pending actions", value: "UNKNOWN", status: "UNKNOWN", detail: "Action feed ยังไม่อยู่ใน checkpoint นี้" },
      { id: "quota", label: "Supervisor Quota Guard", value: supervisorQuotaSafe ? "SAFE" : "UNKNOWN", status: supervisorQuotaSafe ? "HEALTHY" : "UNKNOWN", detail: "เฉพาะ Supervisor extra activity; provider quota ยัง UNKNOWN" },
      { id: "deployment", label: "Latest DEV deployment", value: "UNKNOWN", status: "UNKNOWN", detail: "ไม่มี deployment telemetry ใน runtime snapshot" },
      { id: "bot", label: "Bot Mode", value: "OBSERVE ONLY", status: "HEALTHY" },
    ],
    map: {
      sources: observedSourceState,
      coordinator: availability === "AVAILABLE" ? "HEALTHY" : "UNKNOWN",
      accepted: acceptedState === "AVAILABLE" ? "HEALTHY" : acceptedState,
      queue: queueLifecycle.state,
    },
    queueLifecycle,
  };
}

export function deriveHubView(hub, nowMs = Date.now()) {
  const code = /^[A-Z0-9_-]{2,20}$/.test(String(hub?.hub || "")) ? String(hub.hub) : "UNKNOWN";
  const overall = safeState(hub?.health);
  const acceptedState = hub?.accepted?.state === "AVAILABLE" ? "AVAILABLE" : "UNKNOWN";
  const sources = {
    route: deriveSourceView(hub?.sources?.route, nowMs, overall),
    preEntry: deriveSourceView(hub?.sources?.preEntry, nowMs),
    busTime: deriveSourceView(hub?.sources?.busTime, nowMs),
    hbiPhotos: deriveSourceView(hub?.sources?.hbiPhotos, nowMs),
  };
  const connectorStates = [sources.route, sources.preEntry, sources.busTime, sources.hbiPhotos]
    .filter((source) => source.configured !== false)
    .filter((source) => source.mode !== "CLICK_ONLY" || source.state !== "UNKNOWN")
    .map((source) => source.state);
  const connectorSession = connectorStates.length ? aggregateStates(connectorStates) : "UNKNOWN";
  const sourceActionRequired = Object.values(sources).some((source) =>
    ["AUTH_REQUIRED", "ERROR", "CRITICAL", "BLOCKED"].includes(source.state));
  const queueLifecycle = deriveLifecycleView(hub?.lifecycle, nowMs);
  return {
    hub: code,
    overall,
    route: sources.route.state,
    preEntry: sources.preEntry.state,
    kitTbr: sources.busTime.state,
    hbi: sources.hbiPhotos.state,
    optionalSources: aggregateStates([sources.preEntry.state, sources.hbiPhotos.state]),
    connectorSession,
    sources,
    lastSuccessAt: validTime(hub?.lastSuccessAt) == null ? null : hub.lastSuccessAt,
    age: ageView(hub?.lastSuccessAt, nowMs),
    accepted: { state: acceptedState, rows: acceptedState === "AVAILABLE" && Number.isInteger(hub?.accepted?.rows) ? hub.accepted.rows : null },
    queueHealth: queueLifecycle.state,
    queueLifecycle,
    errorCode: /^[A-Z0-9_:-]{2,80}$/.test(String(hub?.errorCode || "")) ? String(hub.errorCode) : null,
    quota: "UNKNOWN",
    pendingAction: sourceActionRequired || ["ERROR", "CRITICAL", "BLOCKED", "AUTH_REQUIRED"].includes(overall) ? "REVIEW_REQUIRED" : "UNKNOWN",
  };
}
