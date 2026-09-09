function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS completed view stability patch failed: ${label}`);
  return output.replace(from, to);
}

const FRONTEND_MARKER = "const preserveObservedCompletion =";
const DAILY_COUNTS_MARKER = "MS_LOWER_DAILY_COUNTS_0700_V2";
const SLA_EARLIEST_MARKER = "MS_SLA_EARLIEST_ARRIVAL_V2";
const TRUSTED_SCHEDULE_MARKER = "MS_DAILY_COMPLETION_TRUSTED_SCHEDULE_V1";

export function patchMsCompletedViewStabilityFrontend(source) {
  let output = String(source || "");

  if (!output.includes(FRONTEND_MARKER)) {
    output = replaceUnique(
      output,
      `function mergeLatest(archive, current) {\n  const latest = new Map(\n    (archive || []).map((row) => [row.id || row.proofId, row]),\n  );\n  for (const row of current || []) latest.set(row.id || row.proofId, row);\n  return [...latest.values()];\n}`,
      `function mergeLatest(archive, current) {\n  const latest = new Map(\n    (archive || []).map((row) => [row.id || row.proofId, row]),\n  );\n  for (const row of current || []) {\n    const key = row.id || row.proofId;\n    const previous = latest.get(key);\n    const sameCompletionObservation =\n      !row?.unloadingCompletedAt ||\n      !previous?.unloadingCompletedAt ||\n      String(row.unloadingCompletedAt) === String(previous.unloadingCompletedAt);\n    const preserveObservedCompletion =\n      previous?.completionObservedLive === true &&\n      Number(previous?.unloadingState) === 2 &&\n      Number(row?.unloadingState) === 2 &&\n      sameCompletionObservation;\n    latest.set(\n      key,\n      preserveObservedCompletion\n        ? {\n            ...row,\n            unloadingCompletedAt:\n              row?.unloadingCompletedAt || previous?.unloadingCompletedAt,\n            completionObservedLive: true,\n          }\n        : row,\n    );\n  }\n  return [...latest.values()];\n}`,
      "live polling must not erase an already-observed daily completion",
    );
  }

  if (!output.includes(SLA_EARLIEST_MARKER)) {
    output = replaceUnique(
      output,
      `function unloadTiming(row, now = new Date()) {\n  const start = parseDate(row.scheduleUnloadingStartedAt);\n  const completed = Number(row.unloadingState) === 2;\n  const finish = completed ? parseDate(row.unloadingCompletedAt) : null;\n  const arrival = parseDate(row.actualArrivalAt);`,
      `// ${SLA_EARLIEST_MARKER}: SLA starts at the earliest confirmed Route/KIT/TBR arrival.\nfunction unloadTiming(row, now = new Date()) {\n  const start = parseDate(row.scheduleUnloadingStartedAt);\n  const completed = Number(row.unloadingState) === 2;\n  const finish = completed ? parseDate(row.unloadingCompletedAt) : null;\n  const arrival = confirmedEffectiveArrival(row);`,
      "SLA Route must use the earliest confirmed arrival source",
    );
    output = replaceUnique(
      output,
      `  // Route actualArrivalAt is the sole operational clock authority. Waiting\n  // and active rows keep counting; completed rows still require trusted E.`,
      `  // Route confirms that the trip has arrived; the SLA clock itself starts\n  // from the earliest matched Route/KIT/TBR timestamp. Completed rows still\n  // require the trusted unloading completion timestamp.`,
      "clarify SLA earliest-arrival authority",
    );
    output = replaceUnique(
      output,
      `    const slaRange = done ? "Route ถึงจริง → ลงเสร็จจริง" : "Route ถึงจริง → เวลาปัจจุบัน";`,
      `    const slaRange = done ? "เวลาถึงที่เร็วที่สุด → ลงเสร็จจริง" : "เวลาถึงที่เร็วที่สุด → เวลาปัจจุบัน";`,
      "show SLA range truth",
    );
  }

  if (!output.includes(TRUSTED_SCHEDULE_MARKER)) {
    output = replaceUnique(
      output,
      `  if (row.completionObservedLive === false) return false;`,
      `  // ${TRUSTED_SCHEDULE_MARKER}: safely matched Schedule E is accepted completion truth too.\n  if (row.completionObservedLive === false && row.completionSource !== "SCHEDULE") return false;`,
      "daily completed card accepts trusted Schedule E",
    );
  }

  if (output.includes(DAILY_COUNTS_MARKER)) return output;

  output = replaceUnique(
    output,
    `let completedTodayZeroProbedKey = \"\";`,
    `let completedTodayZeroProbedKey = \"\";\nlet cancelledTodayLoadPromise = null;\nlet cancelledTodayHydratedKey = \"\";`,
    "cancelled daily one-shot hydration state",
  );

  output = replaceUnique(
    output,
    `  state.completedToday = 0;\n  state.archiveLoaded = false;`,
    `  state.completedToday = 0;\n  state.cancelledToday = 0;\n  cancelledTodayLoadPromise = null;\n  cancelledTodayHydratedKey = \"\";\n  state.archiveLoaded = false;`,
    "reset daily count state with HUB archive state",
  );

  output = replaceUnique(
    output,
    `  lowerDailyDay = nextDay;\n  state.completedToday = 0;\n  completedTodayLoadPromise = null;`,
    `  lowerDailyDay = nextDay;\n  state.completedToday = 0;\n  state.cancelledToday = 0;\n  cancelledTodayLoadPromise = null;\n  cancelledTodayHydratedKey = \"\";\n  completedTodayLoadPromise = null;`,
    "reset lower counts at Bangkok 07:00 operating-day rollover",
  );

  output = replaceUnique(
    output,
    `function completedTodayDatasetRows() {`,
    `// ${DAILY_COUNTS_MARKER}: completed/overtime/cancelled cards reset at Bangkok 07:00.\nasync function loadCancelledTodayCount() {\n  const key = completedTodayDatasetKey();\n  if (cancelledTodayHydratedKey === key) return Number(state.cancelledToday) || 0;\n  if (cancelledTodayLoadPromise) return cancelledTodayLoadPromise;\n  const branch = state.branch;\n  const promise = (async () => {\n    try {\n      const result = await apiGet(\"msCancelledToday\", { branch });\n      if (state.branch !== branch) return 0;\n      state.cancelledToday = Number(result?.total) || 0;\n      cancelledTodayHydratedKey = key;\n      return state.cancelledToday;\n    } finally {\n      if (cancelledTodayLoadPromise === promise) cancelledTodayLoadPromise = null;\n    }\n  })();\n  cancelledTodayLoadPromise = promise;\n  return promise;\n}\n\nfunction completedTodayDatasetRows() {`,
    "add read-only cancelled operating-day count loader",
  );

  output = replaceUnique(
    output,
    `    const zeroProbeKey = completedTodayDatasetKey();`,
    `    const zeroProbeKey = completedTodayDatasetKey();\n    if (cancelledTodayHydratedKey !== zeroProbeKey && !cancelledTodayLoadPromise) {\n      void loadCancelledTodayCount()\n        .then(() => {\n          if (state.auth && completedTodayDatasetKey() === zeroProbeKey) render();\n        })\n        .catch(() => {});\n    }`,
    "hydrate cancelled count once per HUB operating day",
  );

  output = replaceUnique(
    output,
    `    if (queue.cancelled && isCancelledToday(row)) counts.cancelled++;\n  }\n  const completedDisplay =`,
    `    if (queue.cancelled && isCancelledToday(row)) counts.cancelled++;\n  }\n  counts.cancelled = Math.max(\n    counts.cancelled,\n    Number(state.cancelledToday) || 0,\n  );\n  const cancelledDisplay =\n    cancelledTodayHydratedKey === completedTodayDatasetKey()\n      ? nf.format(counts.cancelled)\n      : \"…\";\n  const completedDisplay =`,
    "use authoritative cancelled count without transient zero",
  );

  output = replaceUnique(
    output,
    `<span>ยกเลิกรถ</span><strong>\${nf.format(counts.cancelled)}</strong>`,
    `<span>ยกเลิกรถ</span><strong>\${cancelledDisplay}</strong>`,
    "cancelled card displays hydrated count",
  );

  output = replaceUnique(
    output,
    `  state.cancelledRouteIds.add(id);`,
    `  const wasAlreadyCancelled =\n    Boolean(result?.alreadyCancelled) ||\n    state.cancelledRouteIds.has(id) ||\n    state.currentRows.some(\n      (row) => String(row.id || \"\") === id && Boolean(row.queueCancelledAt),\n    );\n  state.cancelledRouteIds.add(id);\n  if (!wasAlreadyCancelled)\n    state.cancelledToday = (Number(state.cancelledToday) || 0) + 1;\n  cancelledTodayHydratedKey = completedTodayDatasetKey();`,
    "local cancellation updates authoritative daily card immediately",
  );

  return output;
}
