const FRONTEND_MARKER = "MS_LOWER_CARD_FILTER_TRUTH_V1";
const WORKER_MARKER = "MS_COMPLETED_CALENDAR_DAY_TRUTH_V2";

function replaceBlock(output, startMarker, endMarker, transform, label) {
  const start = output.indexOf(startMarker);
  const end = output.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end <= start)
    throw new Error(`lower-card truth patch failed: ${label}`);
  const block = output.slice(start, end);
  const next = transform(block);
  if (!next || next === block)
    throw new Error(`lower-card truth patch failed: ${label} made no change`);
  return output.slice(0, start) + next + output.slice(end);
}

export function patchMsLowerCardTruthFrontend(source) {
  let output = String(source || "");
  if (output.includes(FRONTEND_MARKER)) return output;
  if (!output.includes("function trustedLowerCompletionAt(row)"))
    throw new Error("lower-card truth patch requires trustedLowerCompletionAt(row)");

  output = replaceBlock(
    output,
    "function isCompletedToday(row, now = new Date()) {",
    "\nfunction isCompletedAccumulated(row)",
    () => `// ${FRONTEND_MARKER}: daily completion belongs to the Bangkok calendar day\n// of the trusted unload-completion timestamp, never the planned/arrival business day.\nfunction isCompletedToday(row, now = new Date()) {\n  if (row.queueCancelledAt) return false;\n  if ((!isDestination(row) && !isDrop(row)) || Number(row.unloadingState) !== 2)\n    return false;\n  const completedAt = trustedLowerCompletionAt(row);\n  return Boolean(completedAt) &&\n    bangkokDateValue(completedAt) === bangkokDateValue(now);\n}\n`,
    "frontend completed calendar day",
  );

  // Staging can insert helper functions between matchesOvertimeContext() and
  // the operation renderer. Replace only this one function and stop at the
  // next top-level function declaration instead of depending on a later name.
  output = replaceBlock(
    output,
    "function matchesOvertimeContext(row) {",
    "\nfunction ",
    () => `function matchesLowerCardContext(row, day) {\n  const haystack = [row.proofId, row.routeName, row.vehicleType, row.plate, row.driverName, row.supplier]\n    .join(" ").toLowerCase();\n  const status = routeState(row);\n  const statusMatch =\n    state.status === "all" ||\n    status.key === state.status ||\n    (state.status === "arrival-ontime" &&\n      isDestination(row) &&\n      punctuality(row).key === "ontime") ||\n    (state.status === "arrival-late" && status.arrivalLate) ||\n    (state.status === "departure-ontime" &&\n      isOrigin(row) &&\n      punctuality(row).key === "ontime") ||\n    (state.status === "departure-late" && status.departureLate) ||\n    (state.status === "unload-overtime" && isOperationalOvertime(row));\n  return (!state.query || haystack.includes(state.query)) &&\n    (!state.dateFrom || day >= state.dateFrom) &&\n    (!state.dateTo || day <= state.dateTo) &&\n    (state.attendance === "all" || normalizeAttendance(row.attendanceType) === state.attendance) &&\n    (state.attribute === "all" || row.routeAttribute === state.attribute) &&\n    (state.region === "all" || row.region === state.region) &&\n    (state.route === "all" || row.routeType === state.route) &&\n    statusMatch;\n}\n\nfunction matchesCompletedContext(row) {\n  const completedAt = trustedLowerCompletionAt(row);\n  const day = completedAt ? bangkokDateValue(completedAt) : "";\n  return Boolean(day) && matchesLowerCardContext(row, day);\n}\n\nfunction matchesOvertimeContext(row) {\n  return matchesLowerCardContext(row, rowBusinessDay(row));\n}\n`,
    "lower-card common filter context",
  );

  output = output.replace(
    /isCompletedTodayOvertime\(row\) && matchesOvertimeContext\(row\)/g,
    "isCompletedTodayOvertime(row) && matchesCompletedContext(row)",
  );

  output = replaceBlock(
    output,
    "function filteredRows(ignoreSummary = false, queueMode = state.queue) {",
    "\nasync function loadRange()",
    (block) => {
      let next = block;
      const from = "      const arrivalDate = rowBusinessDay(row);";
      const to = `      const completedAtForFilter = trustedLowerCompletionAt(row);\n      const useCompletionDay =\n        !ignoreSummary &&\n        (state.summary === "completed" || state.summary === "unload-overtime");\n      const arrivalDate =\n        useCompletionDay && completedAtForFilter\n          ? bangkokDateValue(completedAtForFilter)\n          : rowBusinessDay(row);`;
      if (!next.includes(from))
        throw new Error("lower-card truth patch missing filteredRows day");
      next = next.replace(from, to);

      const sortAnchor = "    .sort((a, b) => {";
      if (!next.includes(sortAnchor))
        throw new Error("lower-card truth patch missing filteredRows sort anchor");
      next = next.replace(
        sortAnchor,
        `${sortAnchor}\n      if (!ignoreSummary && state.summary === "origin") {\n        const aDeparture = parseDate(a.estimatedDepartureAt)?.getTime();\n        const bDeparture = parseDate(b.estimatedDepartureAt)?.getTime();\n        const aPlanned = Number.isFinite(aDeparture) ? aDeparture : Number.POSITIVE_INFINITY;\n        const bPlanned = Number.isFinite(bDeparture) ? bDeparture : Number.POSITIVE_INFINITY;\n        if (aPlanned !== bPlanned) return aPlanned - bPlanned;\n      }`,
      );
      return next;
    },
    "completed filter day and origin release sort",
  );

  output = replaceBlock(
    output,
    "function renderFilterSummary(rows) {",
    "\nasync function applyMetricFilter(metric) {",
    (block) => {
      let next = block;
      const completedCount = /(completed:\s*completedTodayDatasetRows\(\)\s*\.filter\()matchesOvertimeContext(\)\s*\.filter\(\(row\) => isDestination\(row\)\)\.length,)/;
      if (!completedCount.test(next))
        throw new Error("lower-card truth patch could not locate completed-card count");
      next = next.replace(completedCount, "$1matchesCompletedContext$2");

      next = next.replace(
        /\n\s*state\.query = "";\n\s*state\.dateFrom = "";\n\s*state\.dateTo = "";\n\s*state\.attendance = "all";\n\s*state\.attribute = "all";\n\s*state\.region = "all";\n\s*state\.route = "all";\n\s*state\.status = "all";\n\s*el\("search-input"\)\.value = "";\n\s*el\("date-from"\)\.value = "";\n\s*el\("date-to"\)\.value = "";\n\s*el\("attendance-filter"\)\.value = "all";\n\s*el\("attribute-filter"\)\.value = "all";\n\s*el\("region-filter"\)\.value = "all";\n\s*el\("route-filter"\)\.value = "all";\n\s*el\("status-filter"\)\.value = "all";/,
        "\n            // Preserve active filters: lower card total must equal the rows opened by the card.",
      );
      if (!next.includes("Preserve active filters"))
        throw new Error("lower-card truth patch could not preserve lower-card filters");
      if (!/completed:\s*completedTodayDatasetRows\(\)[\s\S]*?\.filter\(matchesCompletedContext\)[\s\S]*?\.filter\(\(row\) => isDestination\(row\)\)\.length,/.test(next))
        throw new Error("lower-card truth patch did not bind completed-card count to completion-day context");
      return next;
    },
    "lower-card count and click context",
  );

  return output;
}

export function patchMsLowerCardTruthWorker(source) {
  let output = String(source || "");
  if (output.includes(WORKER_MARKER)) return output;

  output = replaceBlock(
    output,
    "function msCompletedRowBusinessDay(row) {",
    "\nfunction isCompletedForThaiDay(row, day) {",
    () => `// ${WORKER_MARKER}: state 2 remains Route truth, while daily membership\n// follows the trusted completion timestamp in Bangkok calendar time.\nfunction msCompletedRowBusinessDay(row) {\n  if (Number(row?.unloadingState) !== 2) return "";\n  const scheduleAt = String(row?.scheduleUnloadingCompletedAt || "");\n  if (Number.isFinite(Date.parse(scheduleAt))) return thaiDayForValue(scheduleAt);\n  const recordedAt = String(row?.unloadingCompletedAt || "");\n  const recordedTrusted =\n    Number.isFinite(Date.parse(recordedAt)) &&\n    (row?.completionObservedLive !== false || row?.completionSource === "SCHEDULE");\n  return recordedTrusted ? thaiDayForValue(recordedAt) : "";\n}\n`,
    "worker completed calendar day",
  );

  output = output.replace(/cache\?\.format === 6/g, "cache?.format === 7");
  output = output.replace(/cache\?\.format !== 6/g, "cache?.format !== 7");
  output = output.replace(/version:\s*6,/g, "version: 7,");
  if (!output.includes("cache?.format === 7") || !output.includes("version: 7,"))
    throw new Error("lower-card truth patch failed to bump completedToday cache");
  return output;
}
