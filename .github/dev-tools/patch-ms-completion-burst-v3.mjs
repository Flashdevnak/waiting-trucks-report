const MARKER = "MS_COMPLETION_BURST_TRUTH_V3";
export const LEGACY_COMPLETION_BURST_MIN_ROUTES = 8;
export const LEGACY_COMPLETION_BURST_MIN_SPREAD_MS = 60 * 60 * 1000;
export const LEGACY_COMPLETION_CONTINUOUS_CRON_AT = Date.parse("2026-09-08T12:39:00.000Z");

function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS completion burst V3 patch failed: ${label}`);
  return output.replace(from, to);
}

export function hasLegacyCompletionBurstRows(rows, options = {}) {
  const minRoutes = Number(options.minRoutes) || LEGACY_COMPLETION_BURST_MIN_ROUTES;
  const minSpreadMs = Number(options.minSpreadMs) || LEGACY_COMPLETION_BURST_MIN_SPREAD_MS;
  const legacyBefore = Number(options.legacyBefore) || LEGACY_COMPLETION_CONTINUOUS_CRON_AT;
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const completion = String(row?.unloadingCompletedAt ?? row?.unloading_completed_at ?? "");
    const completionMs = Date.parse(completion);
    const arrivalMs = Date.parse(String(row?.actualArrivalAt ?? row?.actual_arrival_at ?? ""));
    const id = String(row?.id ?? row?.route_id ?? row?.proofId ?? "");
    if (!id || !Number.isFinite(completionMs) || !Number.isFinite(arrivalMs)) continue;
    if (completionMs >= legacyBefore) continue;
    const group = groups.get(completion) || { ids: new Set(), minArrival: Infinity, maxArrival: -Infinity };
    group.ids.add(id);
    group.minArrival = Math.min(group.minArrival, arrivalMs);
    group.maxArrival = Math.max(group.maxArrival, arrivalMs);
    groups.set(completion, group);
  }
  return [...groups.values()].some(
    (group) => group.ids.size >= minRoutes && group.maxArrival - group.minArrival >= minSpreadMs,
  );
}

export function patchMsCompletionBurstWorker(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;

  output = replaceUnique(
    output,
    `async function runMsRefresh(env, branch) {`,
    `// ${MARKER}: legacy mass catch-up observations are not authoritative unload-finish times.\nfunction hasLegacyCompletionBurstRows(rows) {\n  const groups = new Map();\n  const legacyBefore = Date.parse("2026-09-08T12:39:00.000Z");\n  for (const row of Array.isArray(rows) ? rows : []) {\n    const completion = String(row?.unloadingCompletedAt ?? row?.unloading_completed_at ?? "");\n    const completionMs = Date.parse(completion);\n    const arrivalMs = Date.parse(String(row?.actualArrivalAt ?? row?.actual_arrival_at ?? ""));\n    const id = String(row?.id ?? row?.route_id ?? row?.proofId ?? "");\n    if (!id || !Number.isFinite(completionMs) || !Number.isFinite(arrivalMs)) continue;\n    if (completionMs >= legacyBefore) continue;\n    const group = groups.get(completion) || { ids: new Set(), minArrival: Infinity, maxArrival: -Infinity };\n    group.ids.add(id);\n    group.minArrival = Math.min(group.minArrival, arrivalMs);\n    group.maxArrival = Math.max(group.maxArrival, arrivalMs);\n    groups.set(completion, group);\n  }\n  return [...groups.values()].some((group) =>\n    group.ids.size >= 8 && group.maxArrival - group.minArrival >= 60 * 60 * 1000\n  );\n}\n\nasync function runMsRefresh(env, branch) {`,
    "add legacy burst classifier",
  );











  return output;
}
