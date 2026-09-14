import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const SUPERVISOR_QUOTA_PIGGYBACK_MARKER = "SUPERVISOR_QUOTA_PIGGYBACK_V1";
const SUPERVISOR_EVENT_CONSOLE_MARKER = "SUPERVISOR_EVENT_CONSOLE_V1";
const QUOTA_HUB_LIMIT = 50;

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0 || first !== source.lastIndexOf(from))
    throw new Error(`Supervisor quota piggyback patch failed: ${label}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

export function patchSupervisorQuotaInstrumentation(source) {
  let output = String(source || "");
  if (output.includes(SUPERVISOR_QUOTA_PIGGYBACK_MARKER)) return output;
  if (!output.includes(SUPERVISOR_EVENT_CONSOLE_MARKER))
    throw new Error("Supervisor quota piggyback requires SUP-08 event console first");

  const eventMarker = `// ${SUPERVISOR_EVENT_CONSOLE_MARKER}: material runtime transitions only. Events are`;
  output = replaceOnce(
    output,
    eventMarker,
    `// ${SUPERVISOR_QUOTA_PIGGYBACK_MARKER}: quota evidence is sampled only from the\n// existing in-memory Turso runtime diagnostics after normal per-HUB work already ran.\n// It does not query a provider, call a source, read/write the database, start a timer,\n// subscribe to anything, persist telemetry, execute repair, or invoke AI. Values are\n// isolate-local runtime observations, never provider billing/account quota truth.\nconst SUPERVISOR_QUOTA_HUB_LIMIT = ${QUOTA_HUB_LIMIT};\nfunction supervisorQuotaTime(value) {\n  const parsed = Date.parse(String(value || ""));\n  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;\n}\nfunction supervisorQuotaCounter(value) {\n  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;\n}\nfunction supervisorQuotaObservation(value, observedAt) {\n  if (!value || typeof value !== "object" || String(value.scope || "") !== "current-worker-isolate") return null;\n  const counters = {\n    httpRequests: supervisorQuotaCounter(value.httpRequests),\n    statements: supervisorQuotaCounter(value.statements),\n    rowsRead: supervisorQuotaCounter(value.rowsRead),\n    rowsWritten: supervisorQuotaCounter(value.rowsWritten),\n    errors: supervisorQuotaCounter(value.errors),\n    providerLimitErrors: supervisorQuotaCounter(value.providerLimitErrors),\n    heavyReadEvents: supervisorQuotaCounter(value.heavyReadEvents),\n  };\n  const circuit = typeof value.providerReadCircuitOpen === "boolean" ? value.providerReadCircuitOpen : null;\n  const providerReadCircuitUntil = supervisorQuotaTime(value.providerReadCircuitUntil);\n  const heavyReadCooldownsActive = supervisorQuotaCounter(value.heavyReadCooldownsActive);\n  const heavyReadCooldownUntil = supervisorQuotaTime(value.heavyReadCooldownUntil);\n  const rawPolicy = value.localGuardPolicy && typeof value.localGuardPolicy === "object" ? value.localGuardPolicy : {};\n  const localGuardPolicy = {\n    providerReadBlockMs: supervisorQuotaCounter(rawPolicy.providerReadBlockMs),\n    heavyReadCooldownMs: supervisorQuotaCounter(rawPolicy.heavyReadCooldownMs),\n    heavyReadRowsThreshold: supervisorQuotaCounter(rawPolicy.heavyReadRowsThreshold),\n  };\n  const globalKillSwitchConfigured = typeof value.globalKillSwitchConfigured === "boolean" ? value.globalKillSwitchConfigured : null;\n  const since = supervisorQuotaTime(value.since);\n  const lastObservedAt = supervisorQuotaTime(value.lastObservedAt);\n  const envelopeObservedAt = supervisorQuotaTime(observedAt);\n  const hasEvidence = Object.values(counters).some((item) => item !== null) || circuit !== null || heavyReadCooldownsActive !== null || globalKillSwitchConfigured !== null || Boolean(since) || Boolean(lastObservedAt);\n  if (!hasEvidence) return null;\n  const complete = Object.values(counters).every((item) => item !== null) && circuit !== null;\n  return {\n    state: complete ? "AVAILABLE" : "PARTIAL",\n    scope: "current-worker-isolate",\n    observedAt: envelopeObservedAt || lastObservedAt,\n    since,\n    ...counters,\n    providerReadCircuitOpen: circuit,\n    providerReadCircuitUntil,\n    heavyReadCooldownsActive,\n    heavyReadCooldownUntil,\n    localGuardPolicy,\n    globalKillSwitchConfigured,\n    lastObservedAt,\n  };\n}\nfunction supervisorQuotaProtection(quotaHubs) {\n  const unknown = {\n    availability: "UNKNOWN", mode: "OBSERVE_ONLY", evidenceScope: "current-worker-isolate",\n    leakSignal: { state: "UNKNOWN", basis: "LOCAL_GUARD_EVENTS_ONLY" },\n    circuit: { state: "UNKNOWN", until: null, enforcement: "LOCAL_READ_GUARD" },\n    backoff: { state: "UNKNOWN", activeCooldowns: null, until: null, enforcement: "LOCAL_HEAVY_READ_FINGERPRINT_GUARD" },\n    killSwitch: { state: "UNKNOWN", canExecute: false },\n    policy: { providerReadBlockMs: null, heavyReadCooldownMs: null, heavyReadRowsThreshold: null },\n    observedAt: null,\n  };\n  const candidates = (Array.isArray(quotaHubs) ? quotaHubs : []).filter((item) => item && typeof item === "object");\n  if (!candidates.length) return unknown;\n  const latest = [...candidates].sort((left, right) => {\n    const leftAt = Date.parse(String(left.observedAt || left.lastObservedAt || ""));\n    const rightAt = Date.parse(String(right.observedAt || right.lastObservedAt || ""));\n    return (Number.isFinite(leftAt) ? leftAt : 0) - (Number.isFinite(rightAt) ? rightAt : 0);\n  }).at(-1);\n  const circuitState = latest.providerReadCircuitOpen === true ? "OPEN" : latest.providerReadCircuitOpen === false ? "CLOSED" : "UNKNOWN";\n  const backoffState = Number.isSafeInteger(latest.heavyReadCooldownsActive) && latest.heavyReadCooldownsActive >= 0\n    ? latest.heavyReadCooldownsActive > 0 ? "ACTIVE" : "CLEAR"\n    : "UNKNOWN";\n  const leakSignal = Number.isSafeInteger(latest.providerLimitErrors) && latest.providerLimitErrors >= 0 && Number.isSafeInteger(latest.heavyReadEvents) && latest.heavyReadEvents >= 0\n    ? latest.providerLimitErrors > 0 || latest.heavyReadEvents > 0 ? "SIGNAL_OBSERVED" : "NO_LOCAL_GUARD_SIGNAL_OBSERVED"\n    : "UNKNOWN";\n  const killSwitchState = latest.globalKillSwitchConfigured === false ? "NOT_CONFIGURED" : latest.globalKillSwitchConfigured === true ? "CONFIGURED_NON_EXECUTABLE" : "UNKNOWN";\n  const policy = latest.localGuardPolicy && typeof latest.localGuardPolicy === "object" ? latest.localGuardPolicy : {};\n  const policyComplete = [policy.providerReadBlockMs, policy.heavyReadCooldownMs, policy.heavyReadRowsThreshold].every((item) => Number.isSafeInteger(item) && item >= 0);\n  const availability = circuitState !== "UNKNOWN" && backoffState !== "UNKNOWN" && leakSignal !== "UNKNOWN" && killSwitchState !== "UNKNOWN" && policyComplete ? "AVAILABLE" : "PARTIAL";\n  return {\n    availability, mode: "OBSERVE_ONLY", evidenceScope: "current-worker-isolate",\n    leakSignal: { state: leakSignal, basis: "LOCAL_GUARD_EVENTS_ONLY" },\n    circuit: { state: circuitState, until: latest.providerReadCircuitUntil || null, enforcement: "LOCAL_READ_GUARD" },\n    backoff: { state: backoffState, activeCooldowns: Number.isSafeInteger(latest.heavyReadCooldownsActive) ? latest.heavyReadCooldownsActive : null, until: latest.heavyReadCooldownUntil || null, enforcement: "LOCAL_HEAVY_READ_FINGERPRINT_GUARD" },\n    killSwitch: { state: killSwitchState, canExecute: false },\n    policy: {\n      providerReadBlockMs: Number.isSafeInteger(policy.providerReadBlockMs) ? policy.providerReadBlockMs : null,\n      heavyReadCooldownMs: Number.isSafeInteger(policy.heavyReadCooldownMs) ? policy.heavyReadCooldownMs : null,\n      heavyReadRowsThreshold: Number.isSafeInteger(policy.heavyReadRowsThreshold) ? policy.heavyReadRowsThreshold : null,\n    },\n    observedAt: latest.observedAt || latest.lastObservedAt || null,\n  };\n}\n\n${eventMarker}`,
    "quota sanitizers",
  );

  output = replaceOnce(
    output,
    `    const previous = this.supervisorHubs.get(hub) || null;\n    const result = value?.result && typeof value.result === "object" ? value.result : {};`,
    `    const previous = this.supervisorHubs.get(hub) || null;\n    const quotaObservation = supervisorQuotaObservation(value?.quotaObservation, value?.observedAt);\n    if (quotaObservation) {\n      if (!this.supervisorQuotaByHub) this.supervisorQuotaByHub = new Map();\n      this.supervisorQuotaByHub.delete(hub);\n      this.supervisorQuotaByHub.set(hub, { hub, ...quotaObservation });\n      while (this.supervisorQuotaByHub.size > SUPERVISOR_QUOTA_HUB_LIMIT) {\n        const oldestHub = this.supervisorQuotaByHub.keys().next().value;\n        if (!oldestHub) break;\n        this.supervisorQuotaByHub.delete(oldestHub);\n      }\n    }\n    const result = value?.result && typeof value.result === "object" ? value.result : {};`,
    "ingest sanitized quota observation",
  );

  output = replaceOnce(
    output,
    `    const hasError = hubs.some((hub) => hub.health === "ERROR");\n    return {`,
    `    const hasError = hubs.some((hub) => hub.health === "ERROR");\n    const observedHubSet = new Set(hubs.map((hub) => hub.hub));\n    const quotaHubs = [...(this.supervisorQuotaByHub?.values() || [])]\n      .filter((item) => observedHubSet.has(item.hub))\n      .sort((left, right) => left.hub.localeCompare(right.hub))\n      .slice(0, SUPERVISOR_QUOTA_HUB_LIMIT);\n    const quotaObservedAt = quotaHubs.map((item) => item.observedAt).filter(Boolean).sort().at(-1) || null;\n    const quotaAvailability = !quotaHubs.length\n      ? "UNKNOWN"\n      : quotaHubs.length < hubs.length || quotaHubs.some((item) => item.state !== "AVAILABLE")\n        ? "PARTIAL"\n        : "AVAILABLE";\n    const quotaProtection = supervisorQuotaProtection(quotaHubs);\n    return {`,
    "derive bounded quota snapshot",
  );

  output = replaceOnce(
    output,
    `      eventConsole: {\n        availability: "AVAILABLE",`,
    `      quotaTelemetry: {\n        availability: quotaAvailability,\n        mode: "PIGGYBACK_ISOLATE_COUNTERS",\n        billingTruth: "UNKNOWN",\n        observedAt: quotaObservedAt,\n        coverage: { observedHubs: hubs.length, quotaObservedHubs: quotaHubs.length },\n        protection: quotaProtection,\n        hubs: quotaHubs,\n      },\n      eventConsole: {\n        availability: "AVAILABLE",`,
    "publish quota telemetry",
  );

  output = replaceOnce(
    output,
    `  publishSupervisorSnapshot(branch, result) {\n    if (!this.env.MS_REFRESH_COORDINATOR) return Promise.resolve();\n    const id = this.env.MS_REFRESH_COORDINATOR.idFromName("__SUPERVISOR_SHARED_STATE_V1");`,
    `  publishSupervisorSnapshot(branch, result) {\n    if (!this.env.MS_REFRESH_COORDINATOR) return Promise.resolve();\n    const observedAt = new Date().toISOString();\n    let quotaObservation = null;\n    try {\n      const diagnostics = typeof this.env?.QUOTA_DIAGNOSTICS === "function" ? this.env.QUOTA_DIAGNOSTICS() : null;\n      quotaObservation = supervisorQuotaObservation(diagnostics, observedAt);\n    } catch {}\n    const id = this.env.MS_REFRESH_COORDINATOR.idFromName("__SUPERVISOR_SHARED_STATE_V1");`,
    "sample existing runtime diagnostics",
  );

  output = replaceOnce(
    output,
    `        hub: branch,\n        observedAt: new Date().toISOString(),\n        result: {`,
    `        hub: branch,\n        observedAt,\n        quotaObservation,\n        result: {`,
    "piggyback quota on existing ingest message",
  );

  output = replaceOnce(
    output,
    `    eventConsole: { availability: "UNAVAILABLE", mode: "EPHEMERAL_MEMORY", limit: SUPERVISOR_EVENT_RING_LIMIT, events: [] },\n    contracts: { additionalUpstreamPolls: 0, databaseReads: 0, databaseWrites: 0, aiCalls: 0 },`,
    `    quotaTelemetry: { availability: "UNAVAILABLE", mode: "PIGGYBACK_ISOLATE_COUNTERS", billingTruth: "UNKNOWN", observedAt: null, coverage: { observedHubs: 0, quotaObservedHubs: 0 }, protection: supervisorQuotaProtection([]), hubs: [] },\n    eventConsole: { availability: "UNAVAILABLE", mode: "EPHEMERAL_MEMORY", limit: SUPERVISOR_EVENT_RING_LIMIT, events: [] },\n    contracts: { additionalUpstreamPolls: 0, databaseReads: 0, databaseWrites: 0, aiCalls: 0 },`,
    "truth-safe unavailable quota telemetry",
  );

  return output;
}

const invokedPath = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedPath) {
  const target = process.argv[2];
  if (!target) throw new Error("Usage: node patch-supervisor-quota-instrumentation.mjs <worker-index.js>");
  await writeFile(target, patchSupervisorQuotaInstrumentation(await readFile(target, "utf8")), "utf8");
}
