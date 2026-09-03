function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS quota-safe live patch failed: ${label}`);
  return output.replace(from, to);
}

const MARKER = "MS_QUOTA_SAFE_LIVE_V1";

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
    `      priorCompletedAt = old?.unloading_completed_at,`,
    `      priorCompletedAt = old?.unloadingCompletedAt,`,
    "read completion timestamp from normalized baseline snapshot",
  );

  output = replaceUnique(
    output,
    `  const plan = planMsChanges(\n      oldRows.map(output),`,
    `  const plan = planMsChanges(\n      oldRows,`,
    "diff normalized snapshots directly",
  );

  const stateNeedle = `Number(old?.unloading_state) !== 2`;
  const stateCount = output.split(stateNeedle).length - 1;
  if (stateCount !== 2)
    throw new Error(
      `MS quota-safe live patch failed: expected 2 normalized completion comparisons, got ${stateCount}`,
    );
  output = output.replaceAll(
    stateNeedle,
    `Number(old?.unloadingState) !== 2`,
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
    `            sync = await syncMs(\n              { branch, rows: mappedRows },\n              { username: "MS_AUTO", role: "admin", branches: ["*"] },\n              env,\n            );`,
    `            sync = await syncMs(\n              {\n                branch,\n                rows: mappedRows,\n                baselineRows: (currentCache || cache)?.rows || null,\n              },\n              { username: "MS_AUTO", role: "admin", branches: ["*"] },\n              env,\n            );`,
    "pass current live-cache snapshot into changed-source sync",
  );

  return output;
}
