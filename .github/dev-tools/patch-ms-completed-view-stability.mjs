function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS completed view stability patch failed: ${label}`);
  return output.replace(from, to);
}

const FRONTEND_MARKER = "const preserveObservedCompletion =";
const DAILY_COUNTS_MARKER = "MS_LOWER_DAILY_COUNTS_0700_V1";

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

  if (output.includes(DAILY_COUNTS_MARKER)) return output;

  output = replaceUnique(
    output,
    `function rowBusinessDay(row) {`,
    `// ${DAILY_COUNTS_MARKER}: Lower summary uses the 07:00-06:59 Bangkok operating day.\nfunction lowerOperatingDayValue(value = new Date()) {\n  const date = parseDate(value);\n  if (!date) return \"\";\n  return bangkokDateValue(new Date(date.getTime() - 7 * 60 * 60 * 1000));\n}\n\nfunction rowBusinessDay(row) {`,
    "add lower 07:00 operating-day helper",
  );

  output = replaceUnique(
    output,
    `  return bangkokDateValue(row.unloadingCompletedAt) === bangkokDateValue(now);`,
    `  return (\n    lowerOperatingDayValue(row.unloadingCompletedAt) ===\n    lowerOperatingDayValue(now)\n  );`,
    "completed summary follows lower operating day",
  );

  output = replaceUnique(
    output,
    `    bangkokDateValue(row.queueCancelledAt) === bangkokDateValue(now)`,
    `    lowerOperatingDayValue(row.queueCancelledAt) ===\n      lowerOperatingDayValue(now)`,
    "cancelled summary follows lower operating day",
  );

  output = replaceUnique(
    output,
    `let lowerDailyDay = bangkokDateValue(new Date());`,
    `let lowerDailyDay = lowerOperatingDayValue(new Date());`,
    "lower daily reset key uses operating day",
  );

  output = replaceUnique(
    output,
    `  const nextDay = bangkokDateValue(new Date());`,
    `  const nextDay = lowerOperatingDayValue(new Date());`,
    "lower daily rollover happens at 07:00",
  );

  output = replaceUnique(
    output,
    `  return \`${"${state.branch}|${bangkokDateValue(new Date())}"}\`;`,
    `  return \`${"${state.branch}|${lowerOperatingDayValue(new Date())}"}\`;`,
    "completed dataset key follows operating day",
  );

  output = replaceUnique(
    output,
    `let completedTodayZeroProbedKey = \"\";`,
    `let completedTodayZeroProbedKey = \"\";\nlet cancelledTodayLoadPromise = null;\nlet cancelledTodayHydratedKey = \"\";`,
    "cancelled daily one-shot hydration state",
  );

  output = replaceUnique(
    output,
    `  state.archiveTotal = 0;\n  state.completedToday = 0;\n  state.archiveLoaded = false;`,
    `  state.archiveTotal = 0;\n  state.completedToday = 0;\n  state.cancelledToday = 0;\n  cancelledTodayLoadPromise = null;\n  cancelledTodayHydratedKey = \"\";\n  state.archiveLoaded = false;`,
    "reset daily count state with HUB archive state",
  );

  output = replaceUnique(
    output,
    `  lowerDailyDay = nextDay;\n  state.completedToday = 0;\n  completedTodayLoadPromise = null;`,
    `  lowerDailyDay = nextDay;\n  state.completedToday = 0;\n  state.cancelledToday = 0;\n  cancelledTodayLoadPromise = null;\n  cancelledTodayHydratedKey = \"\";\n  completedTodayLoadPromise = null;`,
    "reset lower counts at operating-day rollover",
  );

  output = replaceUnique(
    output,
    `function completedTodayDatasetRows() {`,
    `async function loadCancelledTodayCount() {\n  const key = completedTodayDatasetKey();\n  if (cancelledTodayHydratedKey === key) return Number(state.cancelledToday) || 0;\n  if (cancelledTodayLoadPromise) return cancelledTodayLoadPromise;\n  const branch = state.branch;\n  const promise = (async () => {\n    try {\n      const result = await apiGet(\"msCancelledToday\", { branch });\n      if (state.branch !== branch) return 0;\n      state.cancelledToday = Number(result?.total) || 0;\n      cancelledTodayHydratedKey = key;\n      return state.cancelledToday;\n    } finally {\n      if (cancelledTodayLoadPromise === promise) cancelledTodayLoadPromise = null;\n    }\n  })();\n  cancelledTodayLoadPromise = promise;\n  return promise;\n}\n\nfunction completedTodayDatasetRows() {`,
    "add read-only cancelled daily count loader",
  );

  output = replaceUnique(
    output,
    `      const zeroProbeKey = completedTodayDatasetKey();`,
    `      const zeroProbeKey = completedTodayDatasetKey();\n      if (cancelledTodayHydratedKey !== zeroProbeKey && !cancelledTodayLoadPromise) {\n        void loadCancelledTodayCount()\n          .then(() => {\n            if (state.auth && completedTodayDatasetKey() === zeroProbeKey) render();\n          })\n          .catch(() => {});\n      }`,
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
