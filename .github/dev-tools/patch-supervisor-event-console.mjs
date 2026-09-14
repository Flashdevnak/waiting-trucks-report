import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const SUPERVISOR_EVENT_CONSOLE_MARKER = "SUPERVISOR_EVENT_CONSOLE_V1";
const SUPERVISOR_QUEUE_LIFECYCLE_MARKER = "SUPERVISOR_QUEUE_LIFECYCLE_V1";
const EVENT_LIMIT = 120;

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0 || first !== source.lastIndexOf(from))
    throw new Error(`Supervisor event-console patch failed: ${label}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

export function patchSupervisorEventConsole(source) {
  let output = String(source || "");
  if (output.includes(SUPERVISOR_EVENT_CONSOLE_MARKER)) return output;
  if (!output.includes(SUPERVISOR_QUEUE_LIFECYCLE_MARKER))
    throw new Error("Supervisor event console requires SUP-07 queue/lifecycle first");

  const queueMarker = `// ${SUPERVISOR_QUEUE_LIFECYCLE_MARKER}: derive bounded queue/lifecycle facts only from`;
  output = replaceOnce(
    output,
    queueMarker,
    `// ${SUPERVISOR_EVENT_CONSOLE_MARKER}: material runtime transitions only. Events are\n// bounded, sanitized and ephemeral in the existing Supervisor singleton Durable Object.\n// No upstream call, DB read/write, timer, subscription, persistent storage, repair, or AI\n// work is added. A missing timestamp is dropped rather than fabricated.\nconst SUPERVISOR_EVENT_RING_LIMIT = ${EVENT_LIMIT};\nfunction supervisorEventTime(value) {\n  const at = Date.parse(String(value || ""));\n  return Number.isFinite(at) ? new Date(at).toISOString() : null;\n}\nfunction supervisorEventToken(value, fallback = "UNKNOWN") {\n  const text = String(value || "").trim().toUpperCase();\n  return /^[A-Z0-9_:-]{2,80}$/.test(text) ? text : fallback;\n}\nfunction supervisorEventLevel(state) {\n  const value = supervisorEventToken(state);\n  if (["ERROR", "CRITICAL", "BLOCKED"].includes(value)) return "ERROR";\n  if (["WARNING", "STALE", "PARTIAL", "AUTH_REQUIRED"].includes(value)) return "WARN";\n  if (["HEALTHY", "RECOVERED", "AVAILABLE"].includes(value)) return "PASS";\n  return "INFO";\n}\nfunction supervisorMaterialEvents(previous, next) {\n  if (!next || typeof next !== "object") return [];\n  const hub = /^[A-Z0-9_-]{2,20}$/.test(String(next.hub || "")) ? String(next.hub) : "";\n  const at = supervisorEventTime(next.observedAt || next.lastSuccessAt);\n  if (!hub || !at) return [];\n  const events = [];\n  const push = (level, code, source, message) => {\n    const cleanLevel = ["INFO", "PASS", "WARN", "ERROR"].includes(level) ? level : "INFO";\n    const cleanCode = supervisorEventToken(code, "EVENT");\n    const cleanSource = source ? supervisorEventToken(source, "UNKNOWN") : null;\n    const cleanMessage = String(message || "").replace(/[\\r\\n\\t]+/g, " ").trim().slice(0, 220);\n    if (!cleanMessage) return;\n    events.push({ at, level: cleanLevel, code: cleanCode, hub, source: cleanSource, message: cleanMessage });\n  };\n\n  if (!previous) push("INFO", "HUB_OBSERVED", null, `shared coordinator observed ${hub}`);\n  if (previous && previous.health !== next.health)\n    push(supervisorEventLevel(next.health), "HUB_HEALTH_CHANGED", null, `health ${supervisorEventToken(previous.health)} -> ${supervisorEventToken(next.health)}`);\n\n  const sourceLabels = { route: "ROUTE", preEntry: "PREENTRY", busTime: "KIT_TBR", hbiPhotos: "HBI" };\n  for (const [key, label] of Object.entries(sourceLabels)) {\n    const before = previous?.sources?.[key] && typeof previous.sources[key] === "object" ? previous.sources[key] : null;\n    const after = next?.sources?.[key] && typeof next.sources[key] === "object" ? next.sources[key] : null;\n    if (!after) continue;\n    const beforeState = supervisorEventToken(before?.state);\n    const afterState = supervisorEventToken(after?.state);\n    const beforeCode = supervisorEventToken(before?.errorCode, "");\n    const afterCode = supervisorEventToken(after?.errorCode, "");\n    const material = !previous\n      ? afterState !== "UNKNOWN" || Boolean(afterCode)\n      : beforeState !== afterState || beforeCode !== afterCode;\n    if (!material) continue;\n    const suffix = afterCode ? ` · ${afterCode}` : "";\n    push(supervisorEventLevel(afterState), "SOURCE_STATE_CHANGED", label, `${label} ${beforeState} -> ${afterState}${suffix}`);\n  }\n\n  const beforeError = supervisorEventToken(previous?.errorCode, "");\n  const afterError = supervisorEventToken(next?.errorCode, "");\n  if (afterError && afterError !== beforeError)\n    push("ERROR", "REFRESH_ERROR", null, `refresh error ${afterError}`);\n  if (previous && beforeError && !afterError)\n    push("PASS", "REFRESH_RECOVERED", null, "refresh recovered from previous observed error");\n\n  const beforeLifecycle = previous?.lifecycle && typeof previous.lifecycle === "object" ? previous.lifecycle : null;\n  const afterLifecycle = next?.lifecycle && typeof next.lifecycle === "object" ? next.lifecycle : null;\n  if (afterLifecycle?.state === "AVAILABLE") {\n    const keys = ["active", "waiting", "unloading", "awaitingRelease", "expired12h", "cancelledObserved"];\n    const changed = beforeLifecycle?.state !== "AVAILABLE" || keys.some((key) => Number(beforeLifecycle?.[key]) !== Number(afterLifecycle?.[key]));\n    if (changed) {\n      const n = (key) => Number.isInteger(Number(afterLifecycle?.[key])) && Number(afterLifecycle[key]) >= 0 ? Number(afterLifecycle[key]) : 0;\n      push("INFO", "QUEUE_COUNTS_CHANGED", "QUEUE", `active ${n("active")} · waiting ${n("waiting")} · unloading ${n("unloading")} · awaiting release ${n("awaitingRelease")} · expired12h ${n("expired12h")} · cancelled ${n("cancelledObserved")}`);\n    }\n  }\n  return events;\n}\n\n${queueMarker}`,
    "event helpers",
  );

  output = replaceOnce(
    output,
    `    this.supervisorHubs.set(hub, next);\n    return { ok: true };`,
    `    this.supervisorHubs.set(hub, next);\n    const emitted = supervisorMaterialEvents(previous, next);\n    if (emitted.length) {\n      if (!Array.isArray(this.supervisorEvents)) this.supervisorEvents = [];\n      if (!Number.isInteger(this.supervisorEventSequence)) this.supervisorEventSequence = 0;\n      for (const event of emitted) {\n        this.supervisorEventSequence += 1;\n        this.supervisorEvents.push({ ...event, id: `${event.at}|${event.hub}|${event.code}|${this.supervisorEventSequence}` });\n      }\n      if (this.supervisorEvents.length > SUPERVISOR_EVENT_RING_LIMIT)\n        this.supervisorEvents.splice(0, this.supervisorEvents.length - SUPERVISOR_EVENT_RING_LIMIT);\n    }\n    return { ok: true, emittedEvents: emitted.length };`,
    "append bounded event ring",
  );

  output = replaceOnce(
    output,
    `      },\n      contracts: {\n        additionalUpstreamPolls: 0,`,
    `      },\n      eventConsole: {\n        availability: "AVAILABLE",\n        mode: "EPHEMERAL_MEMORY",\n        limit: SUPERVISOR_EVENT_RING_LIMIT,\n        events: [...(this.supervisorEvents || [])].slice(-SUPERVISOR_EVENT_RING_LIMIT),\n      },\n      contracts: {\n        additionalUpstreamPolls: 0,`,
    "publish event console in shared snapshot",
  );

  output = replaceOnce(
    output,
    `    modules: { waitingTrucks: { health: { state: "UNKNOWN", observedAt: null, evidence: [], impact: "Shared runtime state is unavailable." }, metrics: [], incidents: [], hubs: [] } },\n    contracts: { additionalUpstreamPolls: 0, databaseReads: 0, databaseWrites: 0, aiCalls: 0 },`,
    `    modules: { waitingTrucks: { health: { state: "UNKNOWN", observedAt: null, evidence: [], impact: "Shared runtime state is unavailable." }, metrics: [], incidents: [], hubs: [] } },\n    eventConsole: { availability: "UNAVAILABLE", mode: "EPHEMERAL_MEMORY", limit: SUPERVISOR_EVENT_RING_LIMIT, events: [] },\n    contracts: { additionalUpstreamPolls: 0, databaseReads: 0, databaseWrites: 0, aiCalls: 0 },`,
    "truth-safe unavailable event console",
  );

  return output;
}

const invokedPath = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedPath) {
  const target = process.argv[2];
  if (!target) throw new Error("Usage: node patch-supervisor-event-console.mjs <worker-index.js>");
  await writeFile(target, patchSupervisorEventConsole(await readFile(target, "utf8")), "utf8");
}
