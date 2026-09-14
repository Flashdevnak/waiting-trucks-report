import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const SUPERVISOR_QUEUE_LIFECYCLE_MARKER = "SUPERVISOR_QUEUE_LIFECYCLE_V1";
const SUPERVISOR_SOURCE_HEALTH_MARKER = "SUPERVISOR_SOURCE_HEALTH_V1";

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0 || first !== source.lastIndexOf(from))
    throw new Error(`Supervisor queue/lifecycle patch failed: ${label}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

export function patchSupervisorQueueLifecycle(source) {
  let output = String(source || "");
  if (output.includes(SUPERVISOR_QUEUE_LIFECYCLE_MARKER)) return output;
  if (!output.includes(SUPERVISOR_SOURCE_HEALTH_MARKER))
    throw new Error("Supervisor queue/lifecycle requires SUP-06 source health first");

  const sourceMarker = `// ${SUPERVISOR_SOURCE_HEALTH_MARKER}: piggyback source outcomes already produced`;
  output = replaceOnce(
    output,
    sourceMarker,
    `// ${SUPERVISOR_QUEUE_LIFECYCLE_MARKER}: derive bounded queue/lifecycle facts only from\n// accepted current rows already produced by the existing shared refresh. No source call,\n// DB read/write, timer, subscription, persistence, repair, or AI work is added.\nfunction supervisorLifecycleDate(value) {\n  const at = Date.parse(String(value || ""));\n  return Number.isFinite(at) ? new Date(at) : null;\n}\nfunction supervisorLifecycleAttendance(row) {\n  const text = String(row?.attendanceType || "").trim();\n  if (text.includes("จุดดร")) return "drop";\n  if (text.includes("ปลายทาง")) return "destination";\n  if (text.includes("ต้นทาง")) return "origin";\n  return "other";\n}\nfunction supervisorLifecycleAdmissionArrival(row) {\n  const attendance = supervisorLifecycleAttendance(row);\n  if (attendance !== "destination" && attendance !== "drop") return null;\n  const kit = supervisorLifecycleDate(row?.actualArrivalAt);\n  const tbr = supervisorLifecycleDate(row?.scheduleTbrArrivalAt);\n  if (kit && tbr) return kit <= tbr ? kit : tbr;\n  return kit || tbr || null;\n}\nfunction supervisorLifecycleExpiryAnchor(row) {\n  const attendance = supervisorLifecycleAttendance(row);\n  if (attendance !== "destination" && attendance !== "drop") return null;\n  return supervisorLifecycleAdmissionArrival(row)\n    || supervisorLifecycleDate(row?.scheduleUnloadingStartedAt)\n    || supervisorLifecycleDate(row?.unloadingStartedAt)\n    || supervisorLifecycleDate(row?.unloadingStartedObservedAt)\n    || null;\n}\nfunction supervisorLifecycleCancelled(row) {\n  return Boolean(supervisorLifecycleDate(row?.queueCancelledAt) || String(row?.queueCancelledAt || "").trim());\n}\nfunction supervisorLifecycleDone(row) {\n  const attendance = supervisorLifecycleAttendance(row);\n  if (attendance === "destination") return Number(row?.unloadingState) === 2;\n  if (attendance === "drop") return Boolean(supervisorLifecycleDate(row?.actualDepartureAt));\n  return true;\n}\nfunction supervisorLifecycleExpired12h(row, nowMs = Date.now()) {\n  const attendance = supervisorLifecycleAttendance(row);\n  if (attendance !== "destination" && attendance !== "drop") return false;\n  if (supervisorLifecycleCancelled(row) || supervisorLifecycleDone(row)) return false;\n  if (attendance === "drop" && supervisorLifecycleDate(row?.actualDepartureAt)) return false;\n  const anchor = supervisorLifecycleExpiryAnchor(row);\n  return Boolean(anchor && Number.isFinite(nowMs) && nowMs - anchor.getTime() >= 12 * 36e5);\n}\nfunction supervisorLifecycleStage(row, nowMs = Date.now()) {\n  const attendance = supervisorLifecycleAttendance(row);\n  if (attendance !== "destination" && attendance !== "drop") return "none";\n  if (supervisorLifecycleCancelled(row)) return "none";\n  if (attendance === "drop" && supervisorLifecycleDate(row?.actualDepartureAt)) return "none";\n  if (supervisorLifecycleExpired12h(row, nowMs)) return "none";\n\n  const unloadingState = Number(row?.unloadingState);\n  const scheduleStart = supervisorLifecycleDate(row?.scheduleUnloadingStartedAt)\n    || supervisorLifecycleDate(row?.unloadingStartedAt)\n    || supervisorLifecycleDate(row?.unloadingStartedObservedAt);\n  const scheduleEnd = supervisorLifecycleDate(row?.scheduleUnloadingCompletedAt);\n\n  if (unloadingState === 1) return "unloading";\n  if (attendance === "drop") {\n    if (unloadingState === 2 || scheduleEnd || scheduleStart) return "unloading";\n  } else {\n    if (unloadingState === 2 || scheduleEnd) return "none";\n    if (scheduleStart) return "unloading";\n  }\n\n  const arrival = supervisorLifecycleAdmissionArrival(row);\n  if (!arrival) return "none";\n  if (!Number.isFinite(nowMs) || nowMs - arrival.getTime() >= 12 * 36e5) return "none";\n  return "waiting";\n}\nfunction supervisorLifecycleTelemetry(rows, observedAt = "", nowMs = Date.now()) {\n  if (!Array.isArray(rows)) return null;\n  const counts = {\n    waiting: 0, unloading: 0, active: 0, destinationActive: 0, dropActive: 0,\n    awaitingRelease: 0, expired12h: 0, cancelledObserved: 0,\n  };\n  for (const row of rows) {\n    const attendance = supervisorLifecycleAttendance(row);\n    if (supervisorLifecycleCancelled(row)) counts.cancelledObserved += 1;\n    if (supervisorLifecycleExpired12h(row, nowMs)) counts.expired12h += 1;\n    const stage = supervisorLifecycleStage(row, nowMs);\n    if (stage === "waiting") counts.waiting += 1;\n    if (stage === "unloading") counts.unloading += 1;\n    if (stage === "waiting" || stage === "unloading") {\n      counts.active += 1;\n      if (attendance === "destination") counts.destinationActive += 1;\n      if (attendance === "drop") counts.dropActive += 1;\n    }\n    if (\n      stage === "unloading" && attendance === "drop" &&\n      !supervisorLifecycleDate(row?.actualDepartureAt) &&\n      (Number(row?.unloadingState) === 2 || supervisorLifecycleDate(row?.scheduleUnloadingCompletedAt))\n    ) counts.awaitingRelease += 1;\n  }\n  return {\n    state: "AVAILABLE",\n    observedAt: typeof observedAt === "string" && Number.isFinite(Date.parse(observedAt)) ? observedAt : "",\n    basis: "ACCEPTED_CURRENT_ROWS",\n    policy: "MS_OPERATIONAL_STAGE_SHARED_V1",\n    rowsObserved: rows.length,\n    ...counts,\n  };\n}\nfunction supervisorSanitizedLifecycleTelemetry(value) {\n  const item = value && typeof value === "object" ? value : null;\n  const count = (input) => {\n    const number = Number(input);\n    return Number.isInteger(number) && number >= 0 ? number : null;\n  };\n  if (!item) return null;\n  const result = {\n    state: String(item.state || "").toUpperCase() === "AVAILABLE" ? "AVAILABLE" : "UNKNOWN",\n    observedAt: typeof item.observedAt === "string" && Number.isFinite(Date.parse(item.observedAt)) ? item.observedAt : "",\n    basis: item.basis === "ACCEPTED_CURRENT_ROWS" ? "ACCEPTED_CURRENT_ROWS" : "UNKNOWN",\n    policy: item.policy === "MS_OPERATIONAL_STAGE_SHARED_V1" ? "MS_OPERATIONAL_STAGE_SHARED_V1" : "UNKNOWN",\n    rowsObserved: count(item.rowsObserved),\n    active: count(item.active),\n    waiting: count(item.waiting),\n    unloading: count(item.unloading),\n    destinationActive: count(item.destinationActive),\n    dropActive: count(item.dropActive),\n    awaitingRelease: count(item.awaitingRelease),\n    expired12h: count(item.expired12h),\n    cancelledObserved: count(item.cancelledObserved),\n  };\n  const required = ["rowsObserved", "active", "waiting", "unloading", "destinationActive", "dropActive", "awaitingRelease", "expired12h", "cancelledObserved"];\n  if (required.some((key) => result[key] === null) || result.active !== result.waiting + result.unloading)\n    result.state = "UNKNOWN";\n  return result;\n}\n\n${sourceMarker}`,
    "queue/lifecycle helper",
  );

  output = replaceOnce(
    output,
    `    const cleanTime = (input) => typeof input === "string" && Number.isFinite(Date.parse(input)) ? input : null;`,
    `    const cleanTime = (input) => typeof input === "string" && Number.isFinite(Date.parse(input)) ? input : null;\n    const lifecycleInput = result?.lifecycleTelemetry && typeof result.lifecycleTelemetry === "object" ? result.lifecycleTelemetry : null;\n    const previousLifecycle = previous?.lifecycle && typeof previous.lifecycle === "object" ? previous.lifecycle : null;\n    const lifecycleCount = (input) => { const number = Number(input); return Number.isInteger(number) && number >= 0 ? number : null; };\n    let lifecycle = previousLifecycle || { state: "UNKNOWN", observedAt: null, basis: "UNKNOWN", policy: "UNKNOWN", rowsObserved: null, active: null, waiting: null, unloading: null, destinationActive: null, dropActive: null, awaitingRelease: null, expired12h: null, cancelledObserved: null };\n    if (lifecycleInput) {\n      const nextLifecycle = {\n        state: String(lifecycleInput.state || "").toUpperCase() === "AVAILABLE" ? "AVAILABLE" : "UNKNOWN",\n        observedAt: cleanTime(lifecycleInput.observedAt),\n        basis: lifecycleInput.basis === "ACCEPTED_CURRENT_ROWS" ? "ACCEPTED_CURRENT_ROWS" : "UNKNOWN",\n        policy: lifecycleInput.policy === "MS_OPERATIONAL_STAGE_SHARED_V1" ? "MS_OPERATIONAL_STAGE_SHARED_V1" : "UNKNOWN",\n        rowsObserved: lifecycleCount(lifecycleInput.rowsObserved),\n        active: lifecycleCount(lifecycleInput.active),\n        waiting: lifecycleCount(lifecycleInput.waiting),\n        unloading: lifecycleCount(lifecycleInput.unloading),\n        destinationActive: lifecycleCount(lifecycleInput.destinationActive),\n        dropActive: lifecycleCount(lifecycleInput.dropActive),\n        awaitingRelease: lifecycleCount(lifecycleInput.awaitingRelease),\n        expired12h: lifecycleCount(lifecycleInput.expired12h),\n        cancelledObserved: lifecycleCount(lifecycleInput.cancelledObserved),\n      };\n      const requiredLifecycle = ["rowsObserved", "active", "waiting", "unloading", "destinationActive", "dropActive", "awaitingRelease", "expired12h", "cancelledObserved"];\n      if (requiredLifecycle.some((key) => nextLifecycle[key] === null) || nextLifecycle.active !== nextLifecycle.waiting + nextLifecycle.unloading)\n        nextLifecycle.state = "UNKNOWN";\n      lifecycle = nextLifecycle;\n    }`,
    "sanitize queue/lifecycle snapshot",
  );

  output = replaceOnce(
    output,
    `      sources,\n      errorCode:`,
    `      sources,\n      lifecycle,\n      errorCode:`,
    "store queue/lifecycle snapshot",
  );

  output = replaceOnce(
    output,
    `          sourceTelemetry: result?.sourceTelemetry ? supervisorSanitizedSourceTelemetry(result.sourceTelemetry) : null,\n        },`,
    `          sourceTelemetry: result?.sourceTelemetry ? supervisorSanitizedSourceTelemetry(result.sourceTelemetry) : null,\n          lifecycleTelemetry: Array.isArray(result?.rows)\n            ? supervisorSanitizedLifecycleTelemetry(supervisorLifecycleTelemetry(result.rows, result?.syncedAt || ""))\n            : null,\n        },`,
    "publish queue/lifecycle aggregate only",
  );

  return output;
}

const invokedPath = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedPath) {
  const target = process.argv[2];
  if (!target) throw new Error("Usage: node patch-supervisor-queue-lifecycle.mjs <worker-index.js>");
  await writeFile(target, patchSupervisorQueueLifecycle(await readFile(target, "utf8")), "utf8");
}
