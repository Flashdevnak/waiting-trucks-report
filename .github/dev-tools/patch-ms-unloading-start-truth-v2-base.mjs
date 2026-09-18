const FRONTEND_MARKER = "MS_UNLOADING_OPERATIONAL_TRUTH_V2";
const WORKER_MARKER = "MS_UNLOADING_START_TRUTH_V2";
const PARSER_MARKER = "MS_SCHEDULE_UNLOAD_TIMING_PARSE_V2";
const UPPER_METRIC_MARKER = "MS_UNLOADING_METRIC_TRUTH_V3";
const HBI_DROP_PHOTO_FRONTEND_MARKER = "HBI_TRUCK_PHOTO_DESTINATION_DROP_V2";
const HBI_DROP_PHOTO_WORKER_MARKER = "HBI_DROP_PHOTO_WORKER_V2";
const EXPIRY_MARKER = "MS_OPERATIONAL_12H_EXPIRY_V1";
const DROP_RELEASE_PRECEDENCE_MARKER = "MS_DROP_RELEASE_PRECEDENCE_V1";

function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS unloading start truth V2 patch failed: ${label}`);
  return output.slice(0, first) + to + output.slice(first + from.length);
}

function replaceBlock(output, startMarker, endMarker, transform, label) {
  const start = output.indexOf(startMarker);
  const end = output.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end <= start)
    throw new Error(`MS unloading start truth V2 patch failed: ${label}`);
  const before = output.slice(0, start);
  const block = output.slice(start, end);
  const after = output.slice(end);
  const next = transform(block);
  if (!next || next === block)
    throw new Error(`MS unloading start truth V2 patch failed: ${label} made no change`);
  return before + next + after;
}

function patchOperationalExpiry12hFrontend(source) {
  let output = String(source || "");
  if (output.includes(EXPIRY_MARKER)) return output;

  // The 12-hour rule is an operational cutoff only. It never mutates raw MS
  // unloading/departure truth and it starts from queueAdmissionArrival(), i.e.
  // the earliest trusted KIT(Route actualArrivalAt) / TBR arrival.
  output = replaceBlock(
    output,
    "function queueInfo(row, now = new Date()) {",
    "\nfunction dropOperation(row)",
    (block) => {
      const next = block
        .replace(/ageHours <= 12/g, "ageHours < 12")
        .replace(/ageHours > 12/g, "ageHours >= 12");
      if (!next.includes("ageHours < 12") || !next.includes("ageHours >= 12"))
        throw new Error("MS operational 12h expiry could not enforce exact cutoff");
      return `${next}\n\n// ${EXPIRY_MARKER}: after 12h from earliest trusted arrival, remove the trip\n// from active operations without fabricating completion or departure truth.\nfunction operationalExpiry12h(row, now = new Date()) {\n  if (!isDestination(row) && !isDrop(row)) return null;\n  const queue = queueInfo(row, now);\n  if (!queue.expired || queue.cancelled || queue.done) return null;\n  const arrival = queueAdmissionArrival(row);\n  if (!arrival) return null;\n  const expiredAt = new Date(arrival.getTime() + 12 * 36e5);\n  const drop = isDrop(row);\n  return {\n    group: drop ? \"drop\" : \"unload-overtime\",\n    label: drop\n      ? \"จุดดรอป · หมดอายุ 12 ชม.\"\n      : \"ลงรถเกินเวลา · หมดอายุ 12 ชม.\",\n    detail: drop\n      ? \"MS ยังไม่ยืนยันออกจากจุดดรอป\"\n      : \"MS ยังไม่ยืนยันจบงาน\",\n    arrival,\n    expiredAt,\n  };\n}\n\nfunction expired12hCurrentRows(group = \"\") {\n  return state.currentRows.filter((row) => {\n    const expiry = operationalExpiry12h(row);\n    return Boolean(expiry && (!group || expiry.group === group));\n  });\n}\n\nfunction operationalExpiry12hRowKey(row) {\n  const arrival = queueAdmissionArrival(row);\n  const arrivalKey = arrival ? arrival.toISOString() : String(row.actualArrivalAt || row.scheduleTbrArrivalAt || \"\");\n  return String(row.id || row.proofId || \"\") + \"|\" + arrivalKey;\n}\n\nfunction completedTodayWithExpired12hRows() {\n  const completed = completedTodayDatasetRows();\n  const seen = new Set(completed.map(operationalExpiry12hRowKey));\n  const expired = expired12hCurrentRows().filter((row) => !seen.has(operationalExpiry12hRowKey(row)));\n  return completed.concat(expired);\n}\n`;
    },
    "queueInfo exact 12h cutoff and derived expiry helpers",
  );

  output = replaceBlock(
    output,
    "function inboundOperationalStage(row, now = new Date()) {",
    "\nfunction renderFilterSummary(rows) {",
    (block) => {
      let next = block.replace(
        `  const queue = queueInfo(row);\n  if (queue.cancelled) return "none";`,
        `  const queue = queueInfo(row, now);\n  if (queue.cancelled || queue.expired) return "none";`,
      );
      next = next.replace(/if \(ageHours > 12\) return "none";/g, 'if (ageHours >= 12) return "none";');
      if (!next.includes("queue.cancelled || queue.expired"))
        throw new Error("MS operational 12h expiry did not gate active unloading/waiting");
      return next;
    },
    "active operational stage honours 12h cutoff",
  );

  output = replaceBlock(
    output,
    "function routeState(row, now = new Date()) {",
    "\nfunction normalizeAttendance(value)",
    (block) => {
      const anchor = block.includes("  // MS_DROP_QUEUE_FLOW_V3")
        ? "  // MS_DROP_QUEUE_FLOW_V3"
        : "  if (Number(row.unloadingState) === 2)";
      const at = block.indexOf(anchor);
      if (at < 0)
        throw new Error("MS operational 12h expiry could not locate routeState status branches");
      const expiryBranch = `  const expiry12h = operationalExpiry12h(row, now);\n  if (expiry12h)\n    return {\n      key: expiry12h.group,\n      label: expiry12h.label,\n      color: isDrop(row) ? \"#1978ba\" : \"#b3261e\",\n      arrivalLate,\n      departureLate: false,\n      expired12h: true,\n    };\n\n`;
      return block.slice(0, at) + expiryBranch + block.slice(at);
    },
    "routeState labels expired Destination and Drop truthfully",
  );

  output = replaceBlock(
    output,
    "function filteredRows(ignoreSummary = false, queueMode = state.queue) {",
    "\nasync function loadRange() {",
    (block) => {
      let next = block;
      const sourceAnchor = `  const source = useCompletedTodayDataset\n    ? completedTodayDatasetRows()\n    : useArchive\n      ? state.archiveRows\n      : state.currentRows;`;
      const sourceReplacement = `  const includeExpired12h =\n    state.status === \"unload-overtime\" ||\n    (!ignoreSummary &&\n      (state.summary === \"unload-overtime\" || state.summary === \"drop\"));\n  const source = useCompletedTodayDataset\n    ? includeExpired12h\n      ? completedTodayWithExpired12hRows()\n      : completedTodayDatasetRows()\n    : useArchive\n      ? state.archiveRows\n      : state.currentRows;`;
      if (!next.includes(sourceAnchor))
        throw new Error("MS operational 12h expiry could not locate completed source selection");
      next = next.replace(sourceAnchor, sourceReplacement);

      next = next.replace(
        `(state.summary === "unload-overtime" && isCompletedTodayOvertime(row)) ||`,
        `(state.summary === "unload-overtime" &&\n          (isCompletedTodayOvertime(row) ||\n            operationalExpiry12h(row)?.group === "unload-overtime")) ||`,
      );

      const dropReleased = `        (state.summary === "drop" &&\n          isDrop(row) &&\n          queue.done &&\n          queue.released &&\n          !queue.cancelled) ||`;
      const dropExpired = `        (state.summary === "drop" &&\n          isDrop(row) &&\n          !queue.cancelled &&\n          ((queue.done && queue.released) ||\n            operationalExpiry12h(row)?.group === "drop")) ||`;
      if (!next.includes(dropReleased))
        throw new Error("MS operational 12h expiry could not locate released Drop summary match");
      next = next.replace(dropReleased, dropExpired);

      if (!next.includes('operationalExpiry12h(row)?.group === "unload-overtime"') ||
          !next.includes('operationalExpiry12h(row)?.group === "drop"'))
        throw new Error("MS operational 12h expiry summary routing missing");
      return next;
    },
    "expired rows route into existing Overtime/Drop cards",
  );

  output = replaceBlock(
    output,
    "function renderFilterSummary(rows) {",
    "\nasync function applyMetricFilter(metric) {",
    (block) => {
      let next = block;
      const displayAnchor = `  const completedDisplay = nf.format(counts.completed);\n  const overtimeDisplay = nf.format(completedTodayOvertimeRows().length);`;
      const displayReplacement = `  const expiredDestination12h = expired12hCurrentRows(\"unload-overtime\")\n    .filter(matchesOvertimeContext);\n  const expiredDrop12h = expired12hCurrentRows(\"drop\")\n    .filter(matchesOvertimeContext);\n  counts.drop += expiredDrop12h.length;\n  const completedDisplay = nf.format(counts.completed);\n  const overtimeDisplay = nf.format(\n    completedTodayOvertimeRows().length + expiredDestination12h.length,\n  );`;
      if (!next.includes(displayAnchor))
        throw new Error("MS operational 12h expiry could not locate lower card displays");
      next = next.replace(displayAnchor, displayReplacement);
      return next;
    },
    "lower Overtime/Drop cards include 12h-expired current rows",
  );

  for (const expected of [
    EXPIRY_MARKER,
    '"จุดดรอป · หมดอายุ 12 ชม."',
    '"ลงรถเกินเวลา · หมดอายุ 12 ชม."',
    'queue.cancelled || queue.expired',
    'completedTodayWithExpired12hRows()',
    'completedTodayOvertimeRows().length + expiredDestination12h.length',
    'counts.drop += expiredDrop12h.length',
  ]) {
    if (!output.includes(expected))
      throw new Error(`MS operational 12h expiry invariant missing: ${expected}`);
  }
  return output;
}

export function patchMsUnloadingStartTruthFrontend(source) {
  let output = String(source || "");
  if (
    output.includes(FRONTEND_MARKER) &&
    output.includes(UPPER_METRIC_MARKER) &&
    output.includes(HBI_DROP_PHOTO_FRONTEND_MARKER) &&
    output.includes(EXPIRY_MARKER) &&
    output.includes(DROP_RELEASE_PRECEDENCE_MARKER)
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
  // MS_ROUTE_UNLOAD_LIFECYCLE_TRUTH_V20: Route owns completion. Schedule E
  // remains timing/display evidence only and must never change lifecycle.
  const released = Boolean(parseDate(row.actualDepartureAt));

  // ${DROP_RELEASE_PRECEDENCE_MARKER}: actual Route departure is final for a
  // Drop even when the upstream unloadingState remains stale at state 1.
  if (isDrop(row) && released) return "none";

  // Original contract: Route state 1 means the truck is unloading now. Do not
  // hide it merely because admission/arrival enrichment is delayed.
  if (unloadingState === 1) return "unloading";

  if (isDrop(row)) {
    if (unloadingState === 2 || scheduleStart) return "unloading";
  } else {
    if (unloadingState === 2) return "none";
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

  if (!output.includes(DROP_RELEASE_PRECEDENCE_MARKER)) {
    output = replaceUnique(
      output,
      `  const released = Boolean(parseDate(row.actualDepartureAt));

  // Original contract: Route state 1 means the truck is unloading now. Do not
  // hide it merely because admission/arrival enrichment is delayed.
  if (unloadingState === 1) return "unloading";

  if (isDrop(row)) {
    if (released) return "none";`,
      `  const released = Boolean(parseDate(row.actualDepartureAt));

  // ${DROP_RELEASE_PRECEDENCE_MARKER}: actual Route departure is final for a
  // Drop even when the upstream unloadingState remains stale at state 1.
  if (isDrop(row) && released) return "none";

  // Original contract: Route state 1 means the truck is unloading now. Do not
  // hide it merely because admission/arrival enrichment is delayed.
  if (unloadingState === 1) return "unloading";

  if (isDrop(row)) {`,
      "Drop Route departure precedes stale unloading state",
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
    // Fallback only when this helper is applied outside normal stageFrontend.
    // Normal DEV staging reuses patch-ms-live-resilience as the single owner of
    // Destination/Drop photo eligibility and therefore skips this block.
    const photoFunction = "function truckPhotoButton(row) {";
    const photoStart = output.indexOf(photoFunction);
    const photoLast = output.lastIndexOf(photoFunction);
    const photoEnd = output.indexOf("\nfunction ensureTruckPhotoDialog()", photoStart);
    if (photoStart < 0 || photoStart !== photoLast || photoEnd <= photoStart)
      throw new Error("MS unloading start truth V2 patch failed: allow click-only truck photos on Drop rows");
    const lazyComment = output.lastIndexOf("// HBI_TRUCK_PHOTO_LAZY_V1", photoStart);
    const replaceStart = lazyComment >= 0 && photoStart - lazyComment < 300 ? lazyComment : photoStart;
    const photoBlock = `// HBI_TRUCK_PHOTO_LAZY_V1 / ${HBI_DROP_PHOTO_FRONTEND_MARKER}: Destination and Drop
// can open the same on-demand HBI photo viewer. No HBI/OSS URL or <img> exists
// before a user click, so expanding eligibility adds zero background polling.
function truckPhotoButton(row) {
  const photoEligible = isDestination(row) || isDrop(row);
  if (!photoEligible || !String(row?.proofId || "").trim()) return "";
  return \`<button type="button" class="truck-photo-toggle" data-truck-photo="\${esc(encodeURIComponent(String(row.proofId).trim()))}">ดูรูปท้ายรถ</button>\`;
}
`;
    output = output.slice(0, replaceStart) + photoBlock + output.slice(photoEnd);
  }

  output = patchOperationalExpiry12hFrontend(output);
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
