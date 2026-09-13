const FRONTEND_MARKER = "MS_UNLOADING_OPERATIONAL_TRUTH_V2";
const WORKER_MARKER = "MS_UNLOADING_START_TRUTH_V2";
const PARSER_MARKER = "MS_SCHEDULE_UNLOAD_TIMING_PARSE_V2";
const UPPER_METRIC_MARKER = "MS_UNLOADING_METRIC_TRUTH_V3";
const HBI_DROP_PHOTO_FRONTEND_MARKER = "HBI_DROP_PHOTO_FRONTEND_V2";
const HBI_DROP_PHOTO_WORKER_MARKER = "HBI_DROP_PHOTO_WORKER_V2";

function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS unloading start truth V2 patch failed: ${label}`);
  return output.slice(0, first) + to + output.slice(first + from.length);
}

export function patchMsUnloadingStartTruthFrontend(source) {
  let output = String(source || "");
  if (
    output.includes(FRONTEND_MARKER) &&
    output.includes(UPPER_METRIC_MARKER) &&
    output.includes(HBI_DROP_PHOTO_FRONTEND_MARKER)
  ) return output;

  if (!output.includes(FRONTEND_MARKER)) {
    const start = output.indexOf("function inboundOperationalStage(row, now = new Date()) {");
    const end = output.indexOf("\nfunction renderFilterSummary(rows) {", start);
    if (start < 0 || end <= start)
      throw new Error("MS unloading start truth V2 patch failed: inbound operational stage");

    const block = `// ${FRONTEND_MARKER}: Route unloadingState is the primary operational truth.
// KIT/TBR/arrival decides waiting admission only. Schedule S is a fallback when
// Route status is stale, and Drop remains active until Route release/departure.
function inboundOperationalStage(row, now = new Date()) {
  if (!isDestination(row) && !isDrop(row)) return "none";

  const queue = queueInfo(row);
  if (queue.cancelled) return "none";

  const unloadingState = Number(row.unloadingState);
  const scheduleStart =
    parseDate(row.scheduleUnloadingStartedAt) ||
    parseDate(row.unloadingStartedAt) ||
    parseDate(row.unloadingStartedObservedAt);
  const scheduleEnd = parseDate(row.scheduleUnloadingCompletedAt);
  const released = Boolean(parseDate(row.actualDepartureAt));

  // Original contract: Route state 1 means the truck is unloading now. Do not
  // hide it merely because admission/arrival enrichment is delayed.
  if (unloadingState === 1) return "unloading";

  if (isDrop(row)) {
    if (released) return "none";
    if (unloadingState === 2 || scheduleEnd || scheduleStart) return "unloading";
  } else {
    if (unloadingState === 2 || scheduleEnd) return "none";
    if (scheduleStart) return "unloading";
  }

  // Only the waiting card depends on queue-admission truth and the active age
  // window. Operational unloading truth above must never be gated by this.
  const arrival = queueAdmissionArrival(row);
  if (!arrival) return "none";
  const ageHours = (now - arrival) / 36e5;
  if (ageHours > 12) return "none";
  return "waiting";
}
`;
    output = output.slice(0, start) + block + output.slice(end);

    output = replaceUnique(
      output,
      `  const start = parseDate(row.scheduleUnloadingStartedAt);`,
      `  const start =
    parseDate(row.scheduleUnloadingStartedAt) ||
    parseDate(row.unloadingStartedAt) ||
    parseDate(row.unloadingStartedObservedAt);`,
      "unload timing start truth fallback",
    );
  }

  if (!output.includes(UPPER_METRIC_MARKER)) {
    output = replaceUnique(
      output,
      `  setMetric(
    "metric-unloading",
    active.filter((row) => Number(row.unloadingState) === 1).length,
  );`,
      `  // ${UPPER_METRIC_MARKER}: the upper and lower \"กำลังลงรถ\" cards must
  // count the exact same operational truth. Do not re-gate Route state 1 or
  // Schedule-start/Drop-awaiting-release through queueInfo.active.
  setMetric(
    "metric-unloading",
    state.currentRows.filter(
      (row) => inboundOperationalStage(row) === "unloading",
    ).length,
  );`,
      "upper unloading metric shares operational stage truth",
    );

    output = replaceUnique(
      output,
      `  if (metric === "unloading") {
    state.queue = "queue";
    state.status = "unloading";
  }`,
      `  if (metric === "unloading") {
    state.queue = "queue";
    state.status = "all";
    state.summary = "unloading";
  }`,
      "upper unloading metric opens the shared operational view",
    );
  }

  if (!output.includes(HBI_DROP_PHOTO_FRONTEND_MARKER)) {
    output = replaceUnique(
      output,
      `// HBI_TRUCK_PHOTO_LAZY_V1: destination only. No URL and no <img> exists before a click.
function truckPhotoButton(row) {
  if (!isDestination(row) || !String(row?.proofId || "").trim()) return "";
  return \`<button type="button" class="truck-photo-toggle" data-truck-photo="\${esc(encodeURIComponent(String(row.proofId).trim()))}">ดูรูปท้ายรถ</button>\`;
}`,
      `// HBI_TRUCK_PHOTO_LAZY_V1: click-only. No URL and no <img> exists before a click.
// ${HBI_DROP_PHOTO_FRONTEND_MARKER}: inbound Destination and Drop share the same
// proofId photo action, including a Drop that has already been released.
function truckPhotoButton(row) {
  if ((!isDestination(row) && !isDrop(row)) || !String(row?.proofId || "").trim()) return "";
  return \`<button type="button" class="truck-photo-toggle" data-truck-photo="\${esc(encodeURIComponent(String(row.proofId).trim()))}">ดูรูปท้ายรถ</button>\`;
}`,
      "allow click-only truck photos on Drop rows",
    );
  }

  return output;
}

export function patchMsUnloadingStartTruthWorker(source) {
  let output = String(source || "");
  if (output.includes(WORKER_MARKER)) return output;

  const parserStart = output.indexOf("export function parseScheduleUnloadingEnd(field) {");
  const parserEnd = output.indexOf("\nexport function scheduleStoreMatchesHub", parserStart);
  if (parserStart < 0 || parserEnd <= parserStart)
    throw new Error("MS unloading start truth V2 patch failed: Schedule parser section");

  const parserBlock = `// ${PARSER_MARKER}: MS may reorder S/E/W/D entries. Parse by tag, never array index.
function scheduleUnloadingTaggedValue(field, tag) {
  if (!Array.isArray(field)) return "";
  const pattern = new RegExp("^" + tag + ":\\\\s*(.+)$", "i");
  for (const entry of field) {
    const raw = String(entry?.value || "").trim();
    const match = raw.match(pattern);
    if (match?.[1] && match[1] !== "-") return match[1].trim();
  }
  return "";
}

function parseScheduleUnloadingDurationMs(field) {
  if (!Array.isArray(field)) return null;
  for (const entry of field) {
    const raw = String(entry?.value || "").trim();
    const match = raw.match(/^D:\\s*(\\d{1,3}):([0-5]\\d):([0-5]\\d)$/i);
    if (!match) continue;
    return (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000;
  }
  return null;
}

export function parseScheduleUnloadingEnd(field) {
  const raw = scheduleUnloadingTaggedValue(field, "E");
  return raw ? msDate(raw) : "";
}

export function parseScheduleUnloadingStart(field) {
  const raw = scheduleUnloadingTaggedValue(field, "S");
  const direct = raw ? msDate(raw) : "";
  if (direct) return direct;

  // Provider D is the actual unload duration. When S is absent but E + D are
  // both present, S = E - D is source-derived timing evidence, not a guess.
  const end = parseScheduleUnloadingEnd(field);
  const durationMs = parseScheduleUnloadingDurationMs(field);
  const endMs = Date.parse(String(end || ""));
  if (!Number.isFinite(endMs) || durationMs === null) return "";
  return new Date(endMs - durationMs).toISOString();
}
`;
  output = output.slice(0, parserStart) + parserBlock + output.slice(parserEnd);

  output = replaceUnique(
    output,
    `async function syncMs(body, actor, env) {`,
    `// ${WORKER_MARKER}: Schedule S is primary. When Schedule has not reached a
// route yet, preserve the first shared Route observation of unloadingState=1.
// The observation is never synthesized from arrival time and Schedule S always
// replaces it when the authoritative source arrives later.
function normalizeUnloadingStartIso(value) {
  const at = Date.parse(String(value || ""));
  return Number.isFinite(at) ? new Date(at).toISOString() : "";
}

function resolveUnloadingStartTruth(old, unloadingState, scheduleStart, now) {
  const priorObserved = normalizeUnloadingStartIso(old?.unloadingStartedObservedAt);
  const directSchedule = normalizeUnloadingStartIso(scheduleStart);
  if (directSchedule)
    return { at: directSchedule, observedAt: priorObserved, source: "SCHEDULE" };

  const priorSchedule = normalizeUnloadingStartIso(
    old?.scheduleUnloadingStartedAt || old?.schedule_unloading_started_at,
  );
  if (priorSchedule)
    return { at: priorSchedule, observedAt: priorObserved, source: "SCHEDULE" };

  const priorEffective = normalizeUnloadingStartIso(old?.unloadingStartedAt);
  if (priorObserved)
    return {
      at: priorEffective || priorObserved,
      observedAt: priorObserved,
      source: String(old?.unloadingStartSource || "ROUTE_OBSERVED"),
    };

  // A state-1 row is itself evidence that unloading is in progress. Record only
  // the time this shared backend first observed that truth; never backdate it to arrival.
  if (Number(unloadingState) === 1) {
    const observedAt = normalizeUnloadingStartIso(now) || new Date().toISOString();
    return { at: observedAt, observedAt, source: "ROUTE_OBSERVED" };
  }

  return { at: "", observedAt: "", source: "" };
}

async function syncMs(body, actor, env) {`,
    "add shared unloading start resolver",
  );

  output = replaceUnique(
    output,
    `      completionTruth = resolveCompletionTruth(
        old,
        unloadingState,
        r.scheduleUnloadingCompletedAt,
        now,
      ),
      unloadingCompletedAt = completionTruth.at;`,
    `      unloadingStartTruth = resolveUnloadingStartTruth(
        old,
        unloadingState,
        r.scheduleUnloadingStartedAt,
        now,
      ),
      completionTruth = resolveCompletionTruth(
        old,
        unloadingState,
        r.scheduleUnloadingCompletedAt,
        now,
      ),
      unloadingCompletedAt = completionTruth.at;`,
    "resolve unload start beside completion truth",
  );

  output = replaceUnique(
    output,
    `      completionSource: completionTruth.source,
      scheduleUnloadingStartedAt: date(r.scheduleUnloadingStartedAt),
      scheduleUnloadingCompletedAt: date(r.scheduleUnloadingCompletedAt),`,
    `      completionSource: completionTruth.source,
      scheduleUnloadingStartedAt: date(r.scheduleUnloadingStartedAt),
      scheduleUnloadingCompletedAt: date(r.scheduleUnloadingCompletedAt),
      unloadingStartedAt: unloadingStartTruth.at,
      unloadingStartedObservedAt: unloadingStartTruth.observedAt,
      unloadingStartSource: unloadingStartTruth.source,`,
    "persist unload start provenance in snapshot/live cache",
  );

  output = replaceUnique(
    output,
    `    if (normalizeMsAttendance(route.attendance_type) !== "ปลายทาง")
      fail("รูปท้ายรถเปิดได้เฉพาะงานเข้าปลายทาง", "HBI_PHOTOS_DESTINATION_ONLY", 403);`,
    `    // ${HBI_DROP_PHOTO_WORKER_MARKER}: HBI remains click-only, but both inbound
    // work types may retrieve the same proofId photo after the route is found.
    // A released Drop stays eligible; release status does not create an extra read.
    const photoAttendance = normalizeMsAttendance(route.attendance_type);
    if (photoAttendance !== "ปลายทาง" && photoAttendance !== "จุดดรอป")
      fail("รูปท้ายรถเปิดได้เฉพาะงานเข้าปลายทางหรือจุดดรอป", "HBI_PHOTOS_INBOUND_ONLY", 403);`,
    "allow HBI truck photos for Drop routes",
  );

  return output;
}
