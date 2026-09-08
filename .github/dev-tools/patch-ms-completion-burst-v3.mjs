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

  output = replaceUnique(
    output,
    `    let cache = await readMsLiveCache(env, branch, sourceHash);`,
    `    let cache = await readMsLiveCache(env, branch, sourceHash);\n    // A V2 cache containing a proven legacy catch-up burst must not short-circuit repair.\n    if (cache?.sourceMatch && hasLegacyCompletionBurstRows(cache?.rows))\n      cache = { ...cache, sourceMatch: false, legacyCompletionBurst: true };`,
    "force source-match cache through repair",
  );

  output = replaceUnique(
    output,
    `                  String(baselineCache?.sourceHash || "").startsWith("completion-v2:")\n                    ? baselineCache?.rows || null\n                    : null,`,
    `                  String(baselineCache?.sourceHash || "").startsWith("completion-v2:") &&\n                  !hasLegacyCompletionBurstRows(baselineCache?.rows)\n                    ? baselineCache?.rows || null\n                    : null,`,
    "reject polluted V2 cache as diff baseline",
  );

  output = replaceUnique(
    output,
    `async function verifiedCompletionRouteIds(env, hub) {\n  const result = await env.DB.prepare(\n    \`SELECT DISTINCT h2.route_id`,
    `async function verifiedCompletionRouteIds(env, hub) {\n  const legacyBursts = await env.DB.prepare(\n    \`SELECT json_extract(payload_json,'$.unloadingCompletedAt') AS completion_at,\n            COUNT(DISTINCT route_id) AS route_count,\n            MIN(json_extract(payload_json,'$.actualArrivalAt')) AS min_arrival,\n            MAX(json_extract(payload_json,'$.actualArrivalAt')) AS max_arrival\n       FROM ms_route_history\n      WHERE hub=?\n        AND json_valid(payload_json)=1\n        AND COALESCE(json_extract(payload_json,'$.unloadingCompletedAt'),'')<>''\n        AND json_extract(payload_json,'$.unloadingCompletedAt')<'2026-09-08T12:39:00.000Z'\n      GROUP BY json_extract(payload_json,'$.unloadingCompletedAt')\n      HAVING COUNT(DISTINCT route_id)>=8\`,\n  ).bind(hub).all();\n  const legacyBurstKeys = new Set(\n    (legacyBursts.results || [])\n      .filter((row) => {\n        const min = Date.parse(String(row.min_arrival || ""));\n        const max = Date.parse(String(row.max_arrival || ""));\n        return Number.isFinite(min) && Number.isFinite(max) && max - min >= 60 * 60 * 1000;\n      })\n      .map((row) => String(row.completion_at || ""))\n      .filter(Boolean),\n  );\n  const result = await env.DB.prepare(\n    \`SELECT DISTINCT h2.route_id,json_extract(h2.payload_json,'$.unloadingCompletedAt') AS completion_at`,
    "exclude strong legacy burst timestamps from verified transitions",
  );

  output = replaceUnique(
    output,
    `  return new Set((result.results || []).map((row) => String(row.route_id || "")).filter(Boolean));`,
    `  return new Set(\n    (result.results || [])\n      .filter((row) => !legacyBurstKeys.has(String(row.completion_at || "")))\n      .map((row) => String(row.route_id || ""))\n      .filter(Boolean),\n  );`,
    "remove burst route ids from completion truth",
  );

  output = replaceUnique(
    output,
    `  if (!String(cache?.source_hash || "").startsWith(MS_LIVE_CACHE_VERSION + ":")) {`,
    `  // Re-evaluate once per Worker lifetime even when V2 cache already exists; V2 could\n  // misclassify a catch-up poll after a long browser-off gap as a real transition.\n  if (!completionRepairChecked.has(hub)) {`,
    "re-run repair for V2-era polluted rows",
  );

  return output;
}
