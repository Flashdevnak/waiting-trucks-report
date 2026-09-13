function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS completed view stability patch failed: ${label}`);
  return output.replace(from, to);
}

const FRONTEND_MARKER = "const preserveObservedCompletion =";
const DAILY_COUNTS_MARKER = "MS_LOWER_DAILY_COUNTS_MIDNIGHT_V2";
const SLA_EARLIEST_MARKER = "MS_SLA_EARLIEST_ARRIVAL_V2";
const TRUSTED_SCHEDULE_MARKER = "MS_DAILY_COMPLETION_TRUSTED_SCHEDULE_V1";
const DROP_CARD_FLOW_MARKER = "MS_DROP_QUEUE_FLOW_V2";
const QUEUE_SOURCE_LABEL_MARKER = "MS_QUEUE_SOURCE_LABEL_V1";

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

  if (!output.includes(QUEUE_SOURCE_LABEL_MARKER)) {
    output = replaceUnique(
      output,
      `function attendanceLabel(row) {`,
      `// ${QUEUE_SOURCE_LABEL_MARKER}: show the source that actually admitted the\n// inbound trip. KIT wins ties; a later Route/KIT must not relabel a TBR-first queue.\nfunction queueAdmissionSource(row) {\n  if (!isDestination(row) && !isDrop(row)) return "";\n  const kit = parseDate(row.actualArrivalAt);\n  const tbr = parseDate(row.scheduleTbrArrivalAt);\n  if (kit && (!tbr || kit <= tbr)) return "KIT";\n  if (tbr) return "TBR";\n  return "";\n}\n\nfunction attendanceLabel(row) {`,
      "add deterministic KIT/TBR queue admission source label",
    );

    output = replaceUnique(
      output,
      `      classicOperationFact(\n        parseDate(row.actualArrivalAt) ? "ถึงคลังจริง" : parseDate(row.scheduleTbrArrivalAt) ? "เข้าคิวจาก TBR" : "ถึงคลังจริง",\n        shortDateTime(queueAdmissionArrival(row)),\n      ),`,
      `      classicOperationFact(\n        queueAdmissionSource(row)\n          ? "เข้าคิวจาก " + queueAdmissionSource(row)\n          : "ยังไม่มีเวลาเข้าคิว",\n        shortDateTime(queueAdmissionArrival(row)),\n      ),`,
      "destination operation names the actual queue admission source",
    );

    output = replaceUnique(
      output,
      `      classicOperationFact(\n        parseDate(row.actualArrivalAt) ? "ถึงจุดดรอปจริง" : parseDate(row.scheduleTbrArrivalAt) ? "เข้าคิวจาก TBR" : "ถึงจุดดรอปจริง",\n        shortDateTime(queueAdmissionArrival(row)),\n      ),`,
      `      classicOperationFact(\n        queueAdmissionSource(row)\n          ? "เข้าคิวจาก " + queueAdmissionSource(row)\n          : "ยังไม่มีเวลาเข้าคิว",\n        shortDateTime(queueAdmissionArrival(row)),\n      ),`,
      "drop operation names the actual queue admission source",
    );
  }

  if (!output.includes(DROP_CARD_FLOW_MARKER)) {
    output = replaceUnique(
      output,
      `    unloadingState = Number(row.unloadingState),\n    done = isDestination(row)\n      ? unloadingState === 2\n      : isDrop(row)\n        ? unloadingState === 2 && Boolean(row.actualDepartureAt)\n        : Boolean(row.actualDepartureAt),\n    started =\n      (isDestination(row) || isDrop(row)) &&\n      (unloadingState === 1 || unloadingState === 2),\n    active = inboundQueue && Boolean(arrival) && !done && !cancelled && ageHours <= 12;`,
      `    unloadingState = Number(row.unloadingState),\n    unloadFinished =\n      (isDestination(row) || isDrop(row)) &&\n      (unloadingState === 2 ||\n        Boolean(parseDate(row.scheduleUnloadingCompletedAt))),\n    released = Boolean(parseDate(row.actualDepartureAt)),\n    done = isDestination(row) ? unloadFinished : released,\n    started =\n      (isDestination(row) || isDrop(row)) &&\n      (unloadingState === 1 ||\n        unloadFinished ||\n        Boolean(parseDate(row.scheduleUnloadingStartedAt))),\n    awaitingRelease = isDrop(row) && unloadFinished && !released,\n    active = inboundQueue && Boolean(arrival) && !done && !cancelled && ageHours <= 12;`,
      "drop queue state keeps unload completion separate from actual release",
    );

    output = replaceUnique(
      output,
      `  return {\n    active,\n    done,\n    started,\n    cancelled,`,
      `  return {\n    active,\n    done,\n    started,\n    unloadFinished,\n    awaitingRelease,\n    released,\n    cancelled,`,
      "expose drop lifecycle state to summary cards",
    );

    output = replaceUnique(
      output,
      `  if (Number(row.unloadingState) === 2)\n    return {`,
      `  // ${DROP_CARD_FLOW_MARKER}: schedule-management timing can advance the\n  // visible unload stage while Route is stale; actualDepartureAt alone releases\n  // a drop trip into the final จุดดรอป card.\n  if (\n    Number(row.unloadingState) === 2 ||\n    ((isDestination(row) || isDrop(row)) &&\n      Boolean(parseDate(row.scheduleUnloadingCompletedAt)))\n  )\n    return {`,
      "schedule completion advances visible unload state while Route is stale",
    );

    output = replaceUnique(
      output,
      `  if (Number(row.unloadingState) === 1)\n    return {`,
      `  if (\n    Number(row.unloadingState) === 1 ||\n    ((isDestination(row) || isDrop(row)) &&\n      Boolean(parseDate(row.scheduleUnloadingStartedAt)))\n  )\n    return {`,
      "schedule start advances visible unload state while Route is stale",
    );

    output = replaceUnique(
      output,
      `    (!ignoreSummary &&\n      (state.summary === "completed" || state.summary === "unload-overtime"));`,
      `    (!ignoreSummary &&\n      (state.summary === "completed" ||\n        state.summary === "unload-overtime" ||\n        state.summary === "drop"));`,
      "drop card reads completed-today dataset after release",
    );

    output = replaceUnique(
      output,
      `        (state.summary === "waiting" && isDestination(row) && status.key === "arrived") ||\n        (state.summary === "unloading" && isDestination(row) && status.key === "unloading") ||\n        (state.summary === "completed" && isCompletedToday(row)) ||`,
      `        (state.summary === "waiting" &&\n          (isDestination(row) || isDrop(row)) &&\n          queue.active &&\n          !queue.started &&\n          !queue.awaitingRelease) ||\n        (state.summary === "unloading" &&\n          (isDestination(row) || isDrop(row)) &&\n          queue.active &&\n          queue.started &&\n          !queue.awaitingRelease) ||\n        (state.summary === "completed" && isDestination(row) && isCompletedToday(row)) ||`,
      "drop joins waiting and unloading cards before unload completion",
    );

    output = replaceUnique(
      output,
      `        (state.summary === "origin" && isOrigin(row) && !queue.done && !queue.cancelled) ||`,
      `        (state.summary === "origin" &&\n          ((isOrigin(row) && !queue.done && !queue.cancelled) ||\n            (isDrop(row) && queue.active && queue.awaitingRelease))) ||`,
      "unloaded drop waits in release card until actual departure",
    );

    output = replaceUnique(
      output,
      `        (state.summary === "drop" && isDrop(row) && !queue.done && !queue.cancelled) ||`,
      `        (state.summary === "drop" &&\n          isDrop(row) &&\n          queue.done &&\n          queue.released &&\n          !queue.cancelled) ||`,
      "drop card only after actual release",
    );

    output = replaceUnique(
      output,
      `      const queueMatch =\n        queueMode === "all" ||\n        (queueMode === "completed" && (queue.done || queue.expired)) ||\n        (queueMode === "queue" && queue.active);`,
      `      const queueMatch =\n        (!ignoreSummary &&\n          state.summary === "drop" &&\n          queue.done &&\n          queue.released) ||\n        queueMode === "all" ||\n        (queueMode === "completed" && (queue.done || queue.expired)) ||\n        (queueMode === "queue" && queue.active);`,
      "released drop remains visible when drop card is selected",
    );

    output = replaceUnique(
      output,
      `    completed: completedTodayDatasetRows().filter(matchesOvertimeContext).length,\n    origin: 0,\n    drop: 0,`,
      `    completed: completedTodayDatasetRows()\n      .filter(matchesOvertimeContext)\n      .filter((row) => isDestination(row)).length,\n    origin: 0,\n    drop: completedTodayDatasetRows()\n      .filter(matchesOvertimeContext)\n      .filter((row) => isDrop(row) && queueInfo(row).done && queueInfo(row).released)\n      .length,`,
      "completed and drop cards are mutually exclusive",
    );

    output = replaceUnique(
      output,
      `    const key = routeState(row).key;\n    const queue = queueInfo(row);\n    if (queue.active && isDestination(row) && key === "arrived") counts.waiting++;\n    if (queue.active && isDestination(row) && key === "unloading") counts.unloading++;\n    if (queue.active && isOrigin(row)) counts.origin++;\n    if (queue.active && isDrop(row)) counts.drop++;\n    if (queue.cancelled && isCancelledToday(row)) counts.cancelled++;`,
      `    const queue = queueInfo(row);\n    if (\n      queue.active &&\n      (isDestination(row) || isDrop(row)) &&\n      !queue.started &&\n      !queue.awaitingRelease\n    ) counts.waiting++;\n    if (\n      queue.active &&\n      (isDestination(row) || isDrop(row)) &&\n      queue.started &&\n      !queue.awaitingRelease\n    ) counts.unloading++;\n    if (\n      (queue.active && isOrigin(row)) ||\n      (queue.active && isDrop(row) && queue.awaitingRelease)\n    ) counts.origin++;\n    if (queue.cancelled && isCancelledToday(row)) counts.cancelled++;`,
      "summary counts follow wait unload release-wait then released-drop flow",
    );

    output = replaceUnique(
      output,
      `        if (value === "completed" || value === "unload-overtime") {`,
      `        if (value === "completed" || value === "unload-overtime" || value === "drop") {`,
      "drop card hydrates completed-today rows before filtering",
    );
  }

  if (output.includes(DAILY_COUNTS_MARKER)) return output;
  if (output.includes("MS_LOWER_DAILY_COUNTS_0700_V1") || output.includes("lowerOperatingDayValue("))
    throw new Error("MS lower daily counts must reset at Bangkok midnight, not 07:00");

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
    "reset lower counts at Bangkok midnight rollover",
  );

  output = replaceUnique(
    output,
    `function completedTodayDatasetRows() {`,
    `// ${DAILY_COUNTS_MARKER}: completed/overtime/cancelled cards reset at Bangkok midnight.\nasync function loadCancelledTodayCount() {\n  const key = completedTodayDatasetKey();\n  if (cancelledTodayHydratedKey === key) return Number(state.cancelledToday) || 0;\n  if (cancelledTodayLoadPromise) return cancelledTodayLoadPromise;\n  const branch = state.branch;\n  const promise = (async () => {\n    try {\n      const result = await apiGet(\"msCancelledToday\", { branch });\n      if (state.branch !== branch) return 0;\n      state.cancelledToday = Number(result?.total) || 0;\n      cancelledTodayHydratedKey = key;\n      return state.cancelledToday;\n    } finally {\n      if (cancelledTodayLoadPromise === promise) cancelledTodayLoadPromise = null;\n    }\n  })();\n  cancelledTodayLoadPromise = promise;\n  return promise;\n}\n\nfunction completedTodayDatasetRows() {`,
    "add read-only cancelled daily count loader",
  );

  output = replaceUnique(
    output,
    `  const zeroProbeKey = completedTodayDatasetKey();`,
    `  const zeroProbeKey = completedTodayDatasetKey();\n    if (cancelledTodayHydratedKey !== zeroProbeKey && !cancelledTodayLoadPromise) {\n      void loadCancelledTodayCount()\n        .then(() => {\n          if (state.auth && completedTodayDatasetKey() === zeroProbeKey) render();\n        })\n        .catch(() => {});\n    }`,
    "hydrate cancelled count once per HUB calendar day",
  );

  output = replaceUnique(
    output,
    `    if (queue.cancelled && isCancelledToday(row)) counts.cancelled++;\n  }`,
    `    if (queue.cancelled && isCancelledToday(row)) counts.cancelled++;\n  }\n  counts.cancelled = Math.max(\n    counts.cancelled,\n    Number(state.cancelledToday) || 0,\n  );\n  // MS_LOWER_NUMERIC_ZERO_V1: a real zero is always rendered as 0, never ellipsis.\n  const cancelledDisplay = nf.format(counts.cancelled);`,
    "use authoritative cancelled count with numeric zero",
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
