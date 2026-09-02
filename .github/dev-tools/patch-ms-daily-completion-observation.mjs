function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS daily completion observation patch failed: ${label}`);
  return output.replace(from, to);
}

const FRONTEND_MARKER = "function resetLowerDailyViewOnBangkokDayChange()";
const WORKER_MARKER = "completion cache only trusts observed live unloading transitions";

export function patchMsDailyCompletionObservationFrontend(source) {
  let output = String(source || "");
  if (output.includes(FRONTEND_MARKER)) return output;

  output = replaceUnique(
    output,
    `async function loadData(silent = false) {`,
    `let lowerDailyDay = bangkokDateValue(new Date());\n\nfunction resetLowerDailyViewOnBangkokDayChange() {\n  const nextDay = bangkokDateValue(new Date());\n  if (!nextDay || nextDay === lowerDailyDay) return;\n  lowerDailyDay = nextDay;\n  state.completedToday = 0;\n  if (state.summary === \"completed\" || state.summary === \"cancelled\") {\n    state.summary = \"all\";\n    state.queue = \"queue\";\n    state.archiveView = false;\n    if (el(\"queue-filter\")) el(\"queue-filter\").value = \"queue\";\n  }\n}\n\nasync function loadData(silent = false) {`,
    "add Bangkok midnight lower daily view reset",
  );

  output = replaceUnique(
    output,
    `    const result = await apiGet("msRoutes", { branch: state.branch });`,
    `    const result = await apiGet("msRoutes", { branch: state.branch });\n    resetLowerDailyViewOnBangkokDayChange();`,
    "run daily rollover check after live polling succeeds",
  );

  return output;
}

export function patchMsDailyCompletionObservationWorker(source) {
  let output = String(source || "");
  if (output.includes(WORKER_MARKER)) return output;

  output = replaceUnique(
    output,
    `          JSON.stringify(item.snapshot),`,
    `          JSON.stringify({\n            ...item.snapshot,\n            completionObservedLive:\n              Number(item.snapshot?.unloadingState) === 2 &&\n              Boolean(old) &&\n              Number(old?.unloading_state) !== 2,\n          }),`,
    "persist whether completion was an observed transition",
  );

  output = replaceUnique(
    output,
    `    return {\n      ...item.snapshot,\n      syncedAt: changed ? now : previous?.syncedAt || now,`,
    `    return {\n      ...item.snapshot,\n      completionObservedLive:\n        Number(item.snapshot?.unloadingState) === 2 &&\n        Boolean(old) &&\n        Number(old?.unloading_state) !== 2,\n      syncedAt: changed ? now : previous?.syncedAt || now,`,
    "expose observed completion transition in live cache rows",
  );

  output = replaceUnique(
    output,
    `    Number(row?.unloadingState) === 2 &&\n    thaiDayForValue(row?.unloadingCompletedAt) === day`,
    `    Number(row?.unloadingState) === 2 &&\n    row?.completionObservedLive === true &&\n    thaiDayForValue(row?.unloadingCompletedAt) === day`,
    "daily completion requires an observed live transition",
  );

  output = replaceUnique(
    output,
    `      "SELECT route_id,payload_json,synced_by FROM ms_route_history WHERE hub=? AND snapshot_at>=? ORDER BY snapshot_at ASC",`,
    `      "SELECT route_id,payload_json,action,synced_by FROM ms_route_history WHERE hub=? AND snapshot_at>=? ORDER BY snapshot_at ASC",`,
    "bootstrap includes FIRST_SEEN versus UPDATED action",
  );

  output = replaceUnique(
    output,
    `      const row = JSON.parse(item.payload_json || "{}");\n      row.id = row.id || item.route_id;\n      if (row.id && isCompletedForThaiDay(row, day)) completed.set(row.id, row);`,
    `      const row = JSON.parse(item.payload_json || "{}");\n      row.id = row.id || item.route_id;\n      if (typeof row.completionObservedLive !== "boolean")\n        row.completionObservedLive =\n          item.action !== "FIRST_SEEN" && item.synced_by !== "MS_RANGE";\n      if (row.id && isCompletedForThaiDay(row, day)) completed.set(row.id, row);`,
    "legacy bootstrap never treats FIRST_SEEN already-completed rows as today completion",
  );

  output = replaceUnique(
    output,
    `    const completedDay = thaiDay();\n    const priorCompleted =\n      cache?.format === 2 && cache.completedDay === completedDay\n        ? cache.completedRows\n        : await bootstrapCompletedToday(env, branch, completedDay);`,
    `    const completedDay = thaiDay();\n    const completionCacheReady =\n      cache?.format === 2 &&\n      cache.completedDay === completedDay &&\n      cache.completedRows.every(\n        (row) => typeof row?.completionObservedLive === "boolean",\n      );\n    const priorCompleted = completionCacheReady\n      ? cache.completedRows\n      : await bootstrapCompletedToday(env, branch, completedDay);`,
    "rebuild legacy polluted daily cache once",
  );

  output = replaceUnique(
    output,
    `      (cache?.sourceMatch &&\n        (cache?.format !== 2 || cache?.completedDay !== completedDay))`,
    `      (cache?.sourceMatch &&\n        (cache?.format !== 2 ||\n          cache?.completedDay !== completedDay ||\n          !completionCacheReady))`,
    "publish corrected completion cache even when route source is unchanged",
  );

  output = replaceUnique(
    output,
    `  const previous =\n    cache?.format === 2 && cache.completedDay === day\n      ? cache.completedRows\n      : await bootstrapCompletedToday(env, hub, day);`,
    `  const completionCacheReady =\n    cache?.format === 2 &&\n    cache.completedDay === day &&\n    cache.completedRows.every(\n      (row) => typeof row?.completionObservedLive === "boolean",\n    );\n  const previous = completionCacheReady\n    ? cache.completedRows\n    : await bootstrapCompletedToday(env, hub, day);`,
    "completed-today endpoint rejects legacy unmarked cache",
  );

  output = replaceUnique(
    output,
    `      "SELECT route_id,payload_json,snapshot_at,synced_by FROM ms_route_history WHERE hub=? ORDER BY snapshot_at DESC LIMIT 10000",`,
    `      "SELECT route_id,payload_json,action,snapshot_at,synced_by FROM ms_route_history WHERE hub=? ORDER BY snapshot_at DESC LIMIT 10000",`,
    "archive reads completion observation action",
  );

  output = replaceUnique(
    output,
    `      if (row?.unloadingCompletedAt)\n        completionObserved.set(item.route_id, item.synced_by !== "MS_RANGE");`,
    `      if (row?.unloadingCompletedAt) {\n        const explicit = row?.completionObservedLive;\n        completionObserved.set(\n          item.route_id,\n          explicit === true ||\n            (typeof explicit !== "boolean" &&\n              item.action !== "FIRST_SEEN" &&\n              item.synced_by !== "MS_RANGE"),\n        );\n      }`,
    "archive excludes first-seen already-completed rows from daily completion",
  );

  output = output.replace(
    `async function markConnectionSuccess(env, table, hub, now = new Date().toISOString()) {`,
    `// ${WORKER_MARKER}\nasync function markConnectionSuccess(env, table, hub, now = new Date().toISOString()) {`,
  );

  return output;
}
