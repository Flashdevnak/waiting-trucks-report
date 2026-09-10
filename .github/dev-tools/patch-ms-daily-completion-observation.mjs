function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS daily completion observation patch failed: ${label}`);
  return output.replace(from, to);
}

const FRONTEND_MARKER = "function resetLowerDailyViewOnBangkokDayChange()";
const FRONTEND_TRUTH_MARKER = "MS_COMPLETION_TIME_TRUTH_UI_V2";
const WORKER_MARKER = "completion cache only trusts observed live unloading transitions";
const COMPLETION_TRUTH_MARKER = "MS_COMPLETION_TIME_TRUTH_V2";

export function patchMsDailyCompletionObservationFrontend(source) {
  let output = String(source || "");

  if (!output.includes(FRONTEND_MARKER)) {
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
  }

  if (!output.includes(FRONTEND_TRUTH_MARKER)) {
    output = replaceUnique(
      output,
      `    end = parseDate(row.unloadingCompletedAt) || new Date(),`,
      `    completion = parseDate(row.unloadingCompletedAt),\n    end = completion || (Number(row.unloadingState) === 2 ? null : new Date()),`,
      "completed route without verified completion time must not keep counting",
    );

    output = replaceUnique(
      output,
      `  if (!start) return { minutes: null, standard, over: false };`,
      `  if (!start || !end) return { minutes: null, standard, over: false };`,
      "unknown completion duration is not fabricated",
    );

    output = output.replace(
      `function waitInfo(row) {`,
      `// ${FRONTEND_TRUTH_MARKER}: state 2 without a verified end time stays unknown.\nfunction waitInfo(row) {`,
    );
  }

  return output;
}

export function patchMsDailyCompletionObservationWorker(source) {
  let output = String(source || "");
  if (output.includes(WORKER_MARKER)) return output;

  output = replaceUnique(
    output,
    `import { canonicalMsSource, planMsChanges } from "./sync-policy.js";`,
    `import { canonicalMsSource, planMsChanges, resolveCompletionTruth } from "./sync-policy.js";`,
    "wire completion truth resolver",
  );

  output = replaceUnique(
    output,
    `const MS_SYNC_TTL = 3000;`,
    `const MS_SYNC_TTL = 3000;\nconst MS_LIVE_CACHE_VERSION = "completion-v2";\nconst completionRepairChecked = new Set();`,
    "version live cache for completion repair",
  );

  output = replaceUnique(
    output,
    `      priorCompletedAt = old?.unloading_completed_at,\n      unloadingCompletedAt =\n        unloadingState === 2\n          ? Number.isFinite(Date.parse(priorCompletedAt || ""))\n            ? priorCompletedAt\n            : now\n          : "";`,
    `      completionTruth = resolveCompletionTruth(
        old,
        unloadingState,
        r.scheduleUnloadingCompletedAt,
        now,
      ),
      unloadingCompletedAt = completionTruth.at;`,
    "never stamp FIRST_SEEN state 2 with worker now",
  );

  output = replaceUnique(
    output,
    `      unloadingCompletedAt: values[21],\n      sourceUpdatedAt: values[22],`,
    `      unloadingCompletedAt: values[21],
      completionSource: completionTruth.source,
      scheduleUnloadingStartedAt: date(r.scheduleUnloadingStartedAt),
      scheduleUnloadingCompletedAt: date(r.scheduleUnloadingCompletedAt),
      sourceUpdatedAt: values[22],`,
    "persist completion provenance in snapshots and live cache",
  );

  output = replaceUnique(
    output,
    `  const [oldRowsResult, cancellationResult] = await Promise.all([`,
    `  await ensureMsCompletionRepair(env, branch);\n  const [oldRowsResult, cancellationResult] = await Promise.all([`,
    "repair legacy fabricated current completion before sync",
  );

  output = replaceUnique(
    output,
    `          JSON.stringify(item.snapshot),`,
    `          JSON.stringify({\n            ...item.snapshot,\n            completionObservedLive: Boolean(item.snapshot?.unloadingCompletedAt),\n          }),`,
    "persist verified completion truth",
  );

  output = replaceUnique(
    output,
    `    return {\n      ...item.snapshot,\n      syncedAt: changed ? now : previous?.syncedAt || now,`,
    `    return {\n      ...item.snapshot,\n      completionObservedLive: Boolean(item.snapshot?.unloadingCompletedAt),\n      syncedAt: changed ? now : previous?.syncedAt || now,`,
    "expose verified completion truth in live cache rows",
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
    `      "SELECT route_id,payload_json,event_type AS action,synced_by FROM ms_route_history WHERE hub=? AND snapshot_at>=? ORDER BY snapshot_at ASC",`,
    "bootstrap includes FIRST_SEEN versus UPDATED event type",
  );

  output = replaceUnique(
    output,
    `      const row = JSON.parse(item.payload_json || "{}");\n      row.id = row.id || item.route_id;\n      if (row.id && isCompletedForThaiDay(row, day)) completed.set(row.id, row);`,
    `      const row = JSON.parse(item.payload_json || "{}");\n      row.id = row.id || item.route_id;\n      if (typeof row.completionObservedLive !== "boolean")\n        row.completionObservedLive =\n          Boolean(row.unloadingCompletedAt) &&\n          item.action !== "FIRST_SEEN" && item.synced_by !== "MS_RANGE";\n      if (row.id && isCompletedForThaiDay(row, day)) completed.set(row.id, row);`,
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
    `    const sourceHash = await sha(canonicalMsSource(mappedRows));`,
    `    const sourceHash = MS_LIVE_CACHE_VERSION + ":" + await sha(canonicalMsSource(mappedRows));`,
    "invalidate pre-fix live cache once",
  );

  output = replaceUnique(
    output,
    `async function readMsLiveCache(env, hub, sourceHash = "") {`,
    `// ${COMPLETION_TRUTH_MARKER}: completion time is authoritative only when this system observed 0/1 -> 2.\nasync function verifiedCompletionRouteIds(env, hub) {\n  // MS_SCHEDULE_COMPLETION_TRUTH_V4: Route owns status; safely matched Schedule E\n  // remains trusted completion timing evidence without restoring correlated scans.\n  const result = await env.DB.prepare(\n    \`WITH ordered AS (\n       SELECT route_id,snapshot_at,rowid,event_type,synced_by,payload_json,\n              CAST(json_extract(payload_json,'$.unloadingState') AS INTEGER) AS current_state,\n              LAG(CAST(json_extract(payload_json,'$.unloadingState') AS INTEGER))\n                OVER (PARTITION BY route_id ORDER BY snapshot_at,rowid) AS previous_state,\n              COALESCE(json_extract(payload_json,'$.unloadingCompletedAt'),'') AS completion_at,\n              COALESCE(json_extract(payload_json,'$.completionSource'),'') AS completion_source,\n              COALESCE(json_extract(payload_json,'$.actualArrivalAt'),'') AS actual_arrival\n         FROM ms_route_history\n        WHERE hub=? AND json_valid(payload_json)=1\n     ),\n     transitions AS (\n       SELECT route_id,completion_at\n         FROM ordered\n        WHERE current_state=2\n          AND completion_at<>''\n          AND (\n            completion_source='SCHEDULE'\n            OR (\n              previous_state IN (0,1)\n              AND COALESCE(event_type,'UPDATED')<>'FIRST_SEEN'\n              AND COALESCE(synced_by,'')<>'MS_RANGE'\n            )\n          )\n     ),\n     legacy_bursts AS (\n       SELECT completion_at\n         FROM ordered\n        WHERE completion_at<>''\n          AND completion_at<'2026-09-08T12:39:00.000Z'\n        GROUP BY completion_at\n       HAVING COUNT(DISTINCT route_id)>=8\n          AND (julianday(MAX(actual_arrival))-julianday(MIN(actual_arrival))) * 86400000 >= 3600000\n     )\n     SELECT DISTINCT route_id\n       FROM transitions\n      WHERE completion_at NOT IN (SELECT completion_at FROM legacy_bursts)\`,\n  ).bind(hub).all();\n  return new Set((result.results || []).map((row) => String(row.route_id || '')).filter(Boolean));\n}\n\nasync function ensureMsCompletionRepair(env, hub) {\n  if (completionRepairChecked.has(hub)) return;\n  const cache = await env.DB.prepare(\n    "SELECT source_hash FROM ms_live_cache WHERE hub=?",\n  ).bind(hub).first();\n  if (!String(cache?.source_hash || "").startsWith(MS_LIVE_CACHE_VERSION + ":")) {\n    const verified = await verifiedCompletionRouteIds(env, hub);\n    const polluted = (\n      await env.DB.prepare(\n        "SELECT id FROM ms_routes WHERE hub=? AND unloading_state=2 AND COALESCE(unloading_completed_at,'')<>''",\n      ).bind(hub).all()\n    ).results\n      .map((row) => String(row.id || ""))\n      .filter((id) => id && !verified.has(id));\n    if (polluted.length) {\n      const statements = polluted.map((id) =>\n        env.DB.prepare(\n          "UPDATE ms_routes SET unloading_completed_at='' WHERE hub=? AND id=?",\n        ).bind(hub, id),\n      );\n      await batches(env, statements);\n    }\n  }\n  completionRepairChecked.add(hub);\n}\n\nasync function readMsLiveCache(env, hub, sourceHash = "") {`,
    "inject one-time completion repair and verified history evidence",
  );

  output = output.replace(
    `async function markConnectionSuccess(env, table, hub, now = new Date().toISOString()) {`,
    `// ${WORKER_MARKER}\nasync function markConnectionSuccess(env, table, hub, now = new Date().toISOString()) {`,
  );

  return output;
}
