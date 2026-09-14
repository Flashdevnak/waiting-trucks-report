const MARKER = "MS_OPERATIONAL_EXPIRY_ANCHOR_V2";
const OVERTIME_MARKER = "MS_OPERATIONAL_OVERTIME_PREDICATE_V2";

function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS operational expiry anchor V2 patch failed: ${label}`);
  return output.slice(0, first) + to + output.slice(first + from.length);
}

function replaceBlock(output, startMarker, endMarker, transform, label) {
  const start = output.indexOf(startMarker);
  const end = output.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end <= start)
    throw new Error(`MS operational expiry anchor V2 patch failed: ${label}`);
  const before = output.slice(0, start);
  const block = output.slice(start, end);
  const after = output.slice(end);
  const next = transform(block);
  if (!next || next === block)
    throw new Error(`MS operational expiry anchor V2 patch failed: ${label} made no change`);
  return before + next + after;
}

export function patchMsOperationalExpiryAnchorV2Frontend(source) {
  let output = String(source || "");
  if (output.includes(MARKER) && output.includes(OVERTIME_MARKER)) return output;
  if (!output.includes("MS_OPERATIONAL_12H_EXPIRY_V1"))
    throw new Error("MS operational expiry anchor V2 requires 12h expiry V1 first");

  output = replaceBlock(
    output,
    "function operationalExpiry12h(row, now = new Date()) {",
    "\nfunction expired12hCurrentRows",
    () => `// ${MARKER}: admission arrival is the primary 12-hour anchor. If arrival
// enrichment is absent but unloading is already proven, use only persisted
// unload-start provenance. Never fall back to ETA or fabricate arrival/departure.
function operationalExpiryAnchor(row) {
  if (!isDestination(row) && !isDrop(row)) return null;

  const arrival = queueAdmissionArrival(row);
  if (arrival) return { at: arrival, source: "ARRIVAL" };

  const scheduleStart = parseDate(row.scheduleUnloadingStartedAt);
  if (scheduleStart)
    return { at: scheduleStart, source: "SCHEDULE_UNLOAD_START" };

  const effectiveStart = parseDate(row.unloadingStartedAt);
  if (effectiveStart)
    return {
      at: effectiveStart,
      source: String(row.unloadingStartSource || "UNLOAD_START"),
    };

  const observedStart = parseDate(row.unloadingStartedObservedAt);
  if (observedStart)
    return { at: observedStart, source: "ROUTE_OBSERVED" };

  return null;
}

function operationalExpiry12h(row, now = new Date()) {
  if (!isDestination(row) && !isDrop(row)) return null;
  // Route departure is final for Drop rows and must beat every operational
  // fallback, including a stale unloadingState=1 and an old unload-start anchor.
  if (isDrop(row) && parseDate(row.actualDepartureAt)) return null;

  const queue = queueInfo(row, now);
  const anchor = operationalExpiryAnchor(row);
  const ageMs = anchor ? now.getTime() - anchor.at.getTime() : Number.NaN;
  const anchorExpired = Number.isFinite(ageMs) && ageMs >= 12 * 36e5;

  // Preserve the V1 queue-expired contract for normal arrival-backed rows, but
  // allow proven unload-start provenance to close the missing-arrival gap.
  if (!anchorExpired) {
    if (!queue.expired || queue.cancelled || queue.done) return null;
  }
  if (queue.cancelled || queue.done || !anchor) return null;

  const expiredAt = new Date(anchor.at.getTime() + 12 * 36e5);
  const drop = isDrop(row);
  return {
    group: drop ? "drop" : "unload-overtime",
    label: drop
      ? "จุดดรอป · หมดอายุ 12 ชม."
      : "ลงรถเกินเวลา · หมดอายุ 12 ชม.",
    detail: drop
      ? "MS ยังไม่ยืนยันออกจากจุดดรอป"
      : "MS ยังไม่ยืนยันจบงาน",
    arrival: anchor.at,
    anchor: anchor.at,
    anchorSource: anchor.source,
    expiredAt,
  };
}

// ${OVERTIME_MARKER}: card, status filter and table selection share one predicate.
function isOperationalOvertime(row, now = new Date()) {
  return (
    isCompletedTodayOvertime(row, now) ||
    operationalExpiry12h(row, now)?.group === "unload-overtime"
  );
}
`,
    "replace 12h expiry with provenance-safe anchor",
  );

  output = replaceBlock(
    output,
    "function operationalExpiry12hRowKey(row) {",
    "\nfunction completedTodayWithExpired12hRows",
    () => `function operationalExpiry12hRowKey(row) {
  const anchor = operationalExpiryAnchor(row);
  const anchorKey = anchor
    ? anchor.at.toISOString()
    : String(
        row.actualArrivalAt ||
          row.scheduleTbrArrivalAt ||
          row.scheduleUnloadingStartedAt ||
          row.unloadingStartedAt ||
          row.unloadingStartedObservedAt ||
          "",
      );
  return String(row.id || row.proofId || "") + "|" + anchorKey;
}
`,
    "dedupe expired rows by effective expiry anchor",
  );

  output = replaceBlock(
    output,
    "function inboundOperationalStage(row, now = new Date()) {",
    "\nfunction renderFilterSummary(rows) {",
    (block) => {
      const from = `  const queue = queueInfo(row, now);\n  if (queue.cancelled || queue.expired) return "none";`;
      const to = `  const queue = queueInfo(row, now);\n  const expiry12h =\n    typeof operationalExpiry12h === "function"\n      ? operationalExpiry12h(row, now)\n      : null;\n  if (queue.cancelled || queue.expired || expiry12h) return "none";`;
      if (!block.includes(from))
        throw new Error("MS operational expiry anchor V2 missing inbound expiry gate");
      return block.replace(from, to);
    },
    "bound state-1 unloading lifecycle by shared expiry",
  );

  output = replaceBlock(
    output,
    "function filteredRows(ignoreSummary = false, queueMode = state.queue) {",
    "\nasync function loadRange() {",
    (block) => {
      let next = block;
      next = replaceUnique(
        next,
        `(state.status === "unload-overtime" && isCompletedTodayOvertime(row));`,
        `(state.status === "unload-overtime" && isOperationalOvertime(row));`,
        "status overtime predicate",
      );
      next = replaceUnique(
        next,
        `(state.summary === "unload-overtime" &&\n          (isCompletedTodayOvertime(row) ||\n            operationalExpiry12h(row)?.group === "unload-overtime")) ||`,
        `(state.summary === "unload-overtime" && isOperationalOvertime(row)) ||`,
        "summary overtime predicate",
      );
      next = replaceUnique(
        next,
        `(queueMode === "queue" && queue.active);`,
        `(queueMode === "queue" && queue.active) ||\n        (queueMode === "queue" && inboundOperationalStage(row) !== "none");`,
        "queue view includes bounded operational unloading truth",
      );
      return next;
    },
    "centralize status/summary/list operational truth",
  );

  for (const expected of [
    MARKER,
    OVERTIME_MARKER,
    "function operationalExpiryAnchor(row)",
    'source: "ROUTE_OBSERVED"',
    "ageMs >= 12 * 36e5",
    "isOperationalOvertime(row)",
    'typeof operationalExpiry12h === "function"',
    'isDrop(row) && parseDate(row.actualDepartureAt)',
    'queueMode === "queue" && inboundOperationalStage(row) !== "none"',
  ]) {
    if (!output.includes(expected))
      throw new Error(`MS operational expiry anchor V2 invariant missing: ${expected}`);
  }
  return output;
}
