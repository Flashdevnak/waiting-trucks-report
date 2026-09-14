// SUPERVISOR_OVERVIEW_HUB_VIEW_V1
// Pure view derivation only: no transport, timers, storage, database, or repair.
const STATES = new Set([
  "HEALTHY", "WARNING", "CRITICAL", "STALE", "PARTIAL", "AUTH_REQUIRED",
  "ERROR", "BLOCKED", "UNKNOWN", "RECOVERED",
]);

export function safeState(value) {
  const state = String(value || "").toUpperCase();
  return STATES.has(state) ? state : "UNKNOWN";
}

function validTime(value) {
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
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

function aggregateHubState(hubs) {
  if (!hubs.length) return "UNKNOWN";
  const states = hubs.map((hub) => safeState(hub?.health));
  if (states.some((state) => ["CRITICAL", "ERROR", "BLOCKED"].includes(state))) return "ERROR";
  if (states.some((state) => ["WARNING", "STALE", "PARTIAL", "AUTH_REQUIRED"].includes(state))) return "WARNING";
  return states.every((state) => ["HEALTHY", "RECOVERED"].includes(state)) ? "HEALTHY" : "UNKNOWN";
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
      { id: "database", label: "Database", value: "UNKNOWN", status: "UNKNOWN", detail: "SUP-05 ไม่ query DB เพื่อวัด health" },
      { id: "sources", label: "Observed source flow", value: aggregateHubState(hubs), status: aggregateHubState(hubs) },
      { id: "accepted", label: "Accepted State", value: acceptedState, status: acceptedState === "AVAILABLE" ? "HEALTHY" : acceptedState },
      { id: "incidents", label: "Open incidents", value: "UNKNOWN", status: "UNKNOWN", detail: "Incident feed ยังไม่อยู่ใน checkpoint นี้" },
      { id: "actions", label: "Pending actions", value: "UNKNOWN", status: "UNKNOWN", detail: "Action feed ยังไม่อยู่ใน checkpoint นี้" },
      { id: "quota", label: "Supervisor Quota Guard", value: supervisorQuotaSafe ? "SAFE" : "UNKNOWN", status: supervisorQuotaSafe ? "HEALTHY" : "UNKNOWN", detail: "เฉพาะ Supervisor extra activity; provider quota ยัง UNKNOWN" },
      { id: "deployment", label: "Latest DEV deployment", value: "UNKNOWN", status: "UNKNOWN", detail: "ไม่มี deployment telemetry ใน runtime snapshot" },
      { id: "bot", label: "Bot Mode", value: "OBSERVE ONLY", status: "HEALTHY" },
    ],
    map: {
      sources: aggregateHubState(hubs),
      coordinator: availability === "AVAILABLE" ? "HEALTHY" : "UNKNOWN",
      accepted: acceptedState === "AVAILABLE" ? "HEALTHY" : acceptedState,
      queue: "UNKNOWN",
    },
  };
}

export function deriveHubView(hub, nowMs = Date.now()) {
  const code = /^[A-Z0-9_-]{2,20}$/.test(String(hub?.hub || "")) ? String(hub.hub) : "UNKNOWN";
  const overall = safeState(hub?.health);
  const acceptedState = hub?.accepted?.state === "AVAILABLE" ? "AVAILABLE" : "UNKNOWN";
  return {
    hub: code,
    overall,
    route: overall,
    kitTbr: "UNKNOWN",
    optionalSources: "UNKNOWN",
    connectorSession: "UNKNOWN",
    lastSuccessAt: validTime(hub?.lastSuccessAt) == null ? null : hub.lastSuccessAt,
    age: ageView(hub?.lastSuccessAt, nowMs),
    accepted: { state: acceptedState, rows: acceptedState === "AVAILABLE" && Number.isInteger(hub?.accepted?.rows) ? hub.accepted.rows : null },
    queueHealth: "UNKNOWN",
    errorCode: /^[A-Z0-9_:-]{2,80}$/.test(String(hub?.errorCode || "")) ? String(hub.errorCode) : null,
    quota: "UNKNOWN",
    pendingAction: ["ERROR", "CRITICAL", "BLOCKED", "AUTH_REQUIRED"].includes(overall) ? "REVIEW_REQUIRED" : "UNKNOWN",
  };
}
