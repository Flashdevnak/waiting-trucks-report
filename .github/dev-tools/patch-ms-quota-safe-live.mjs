function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS quota-safe live patch failed: ${label}`);
  return output.replace(from, to);
}

const MARKER = "MS_QUOTA_SAFE_LIVE_V1";
const COMPLETION_HISTORY_MARKER = "MS_COMPLETION_DAILY_HISTORY_TRUTH_V2";
const COMPLETION_ARCHIVE_MARKER = "MS_COMPLETION_ARCHIVE_TRUTH_V2";

function patchArchiveCompletionTruth(source) {
  let output = String(source || "");
  if (output.includes(COMPLETION_ARCHIVE_MARKER)) return output;
  const start = output.indexOf("async function msArchive(env, actor, hub) {");
  const end = output.indexOf("\nasync function msCryptoKey", start);
  if (start < 0 || end < 0)
    throw new Error("MS quota-safe live patch failed: archive truth section");
  let section = output.slice(start, end);
  const rowAnchor = "  const rows = [...latest.values()];";
  const fallbackAnchor = "  const totalDistinct = Math.max(";
  let insertAt = section.indexOf(rowAnchor);
  if (insertAt < 0) insertAt = section.indexOf(fallbackAnchor);
  if (insertAt < 0 || !section.includes("const latest = new Map()"))
    throw new Error("MS quota-safe live patch failed: archive truth anchor");
  const truth = `  // ${COMPLETION_ARCHIVE_MARKER}: never expose a completion timestamp unless history proves an observed 0/1 -> 2 transition.\n  const archiveVerifiedCompletionRoutes = await verifiedCompletionRouteIds(env, hub);\n  for (const row of latest.values()) {\n    row.completionObservedLive =\n      Boolean(row.unloadingCompletedAt) &&\n      archiveVerifiedCompletionRoutes.has(String(row.id || \"\"));\n    if (row.unloadingCompletedAt && !row.completionObservedLive)\n      row.unloadingCompletedAt = \"\";\n  }\n\n`;
  section = section.slice(0, insertAt) + truth + section.slice(insertAt);
  return output.slice(0, start) + section + output.slice(end);
}

export function patchMsQuotaSafeLiveWorker(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;

  output = replaceUnique(
    output,
    `async function syncMs(body, actor, env) {\n  if (!Array.isArray(body.rows) || body.rows.length > 2000)`,
    `// ${MARKER}: live source changes diff against the existing live-cache snapshot.\n// A full ms_routes read remains only as a cold-cache / explicit-sync fallback.\nasync function syncMs(body, actor, env) {\n  if (!Array.isArray(body.rows) || body.rows.length > 2000)`,
    "add quota-safe marker",
  );

  output = replaceUnique(
    output,
    `  const [oldRowsResult, cancellationResult] = await Promise.all([\n    env.DB.prepare("SELECT * FROM ms_routes WHERE hub=?").bind(branch).all(),\n    env.DB.prepare(\n      "SELECT route_id,proof_id,cancelled_at,cancelled_by,reason FROM ms_route_cancellations WHERE hub=? AND active=1",\n    )\n      .bind(branch)\n      .all(),\n  ]);\n  const oldRows = oldRowsResult.results;\n  const cancellationById = new Map(\n    cancellationResult.results.map((row) => [String(row.route_id), row]),\n  );\n  const oldById = new Map(oldRows.map((row) => [row.id, row]));`,
    `  const cacheBaseline = Array.isArray(body.baselineRows)\n    ? body.baselineRows\n    : null;\n  const [oldRowsResult, cancellationResult] = await Promise.all([\n    cacheBaseline\n      ? Promise.resolve({ results: [] })\n      : env.DB.prepare("SELECT * FROM ms_routes WHERE hub=?").bind(branch).all(),\n    env.DB.prepare(\n      "SELECT route_id,proof_id,cancelled_at,cancelled_by,reason FROM ms_route_cancellations WHERE hub=? AND active=1",\n    )\n      .bind(branch)\n      .all(),\n  ]);\n  const oldRows = cacheBaseline || oldRowsResult.results.map(output);\n  const cancellationById = new Map(\n    cancellationResult.results.map((row) => [String(row.route_id), row]),\n  );\n  const oldById = new Map(oldRows.map((row) => [row.id, row]));`,
    "use live-cache baseline while preserving cancellation overlay",
  );

  output = replaceUnique(
    output,
    `  const plan = planMsChanges(\n      oldRows.map(output),`,
    `  const plan = planMsChanges(\n      oldRows,`,
    "diff normalized snapshots directly",
  );

  output = replaceUnique(
    output,
    `          JSON.stringify(output(old)),`,
    `          JSON.stringify(old),`,
    "persist normalized removed snapshot",
  );

  output = replaceUnique(
    output,
    `    const previous = old ? output(old) : null;`,
    `    const previous = old || null;`,
    "reuse normalized prior snapshot in response",
  );

  output = replaceUnique(
    output,
    `      statements.push(\n        env.DB.prepare(\n          "INSERT OR IGNORE INTO ms_route_registry(hub,route_id,first_seen_at) VALUES(?,?,?)",\n        ).bind(branch, item.id, now),\n      );`,
    `      if (!old)\n        statements.push(\n          env.DB.prepare(\n            "INSERT OR IGNORE INTO ms_route_registry(hub,route_id,first_seen_at) VALUES(?,?,?)",\n          ).bind(branch, item.id, now),\n        );`,
    "avoid registry write attempt for already-known routes",
  );

  output = replaceUnique(
    output,
    `    return {\n      format: legacy ? 1 : Number(parsed.version) || 0,`,
    `    return {\n      sourceHash: String(row.source_hash || ""),\n      format: legacy ? 1 : Number(parsed.version) || 0,`,
    "expose cache hash so pre-fix baselines are never trusted",
  );

  output = replaceUnique(
    output,
    `            sync = await syncMs(\n              { branch, rows: mappedRows },\n              { username: "MS_AUTO", role: "admin", branches: ["*"] },\n              env,\n            );`,
    `            const baselineCache = currentCache || cache;\n            sync = await syncMs(\n              {\n                branch,\n                rows: mappedRows,\n                baselineRows:\n                  String(baselineCache?.sourceHash || "").startsWith("completion-v2:")\n                    ? baselineCache?.rows || null\n                    : null,\n              },\n              { username: "MS_AUTO", role: "admin", branches: ["*"] },\n              env,\n            );`,
    "pass only completion-v2 live-cache snapshot into changed-source sync",
  );

  output = replaceUnique(
    output,
    `  const cancellations = new Map(\n    cancellationResult.results.map((row) => [row.route_id, row]),\n  );\n  const rows = [];`,
    `  // ${COMPLETION_HISTORY_MARKER}: history reads expose only completion times backed by a recorded 0/1 -> 2 transition.\n  const verifiedCompletionRoutes = await verifiedCompletionRouteIds(env, hub);\n  const cancellations = new Map(\n    cancellationResult.results.map((row) => [row.route_id, row]),\n  );\n  const rows = [];`,
    "daily history loads verified completion evidence on demand",
  );

  output = replaceUnique(
    output,
    `      row.archivedAt = item.snapshot_at;\n      row.businessDay = item.business_day;`,
    `      row.archivedAt = item.snapshot_at;\n      row.businessDay = item.business_day;\n      row.completionObservedLive =\n        Boolean(row.unloadingCompletedAt) &&\n        verifiedCompletionRoutes.has(String(row.id || ""));\n      if (row.unloadingCompletedAt && !row.completionObservedLive)\n        row.unloadingCompletedAt = "";`,
    "daily history never exports fabricated completion timestamp",
  );

  output = patchArchiveCompletionTruth(output);
  return output;
}
