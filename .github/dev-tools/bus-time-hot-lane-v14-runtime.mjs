export const BUS_TIME_HOT_LANE_MARKER = "BUS_TIME_HOT_LANE_V14";
export const MS_P3_BACKFILL_MARKER = "MS_BOUNDED_P3_BACKFILL_V1";
// BUS_TIME_CADENCE_RESTORE_V20: keep KIT/TBR on its original ~12s source cadence; Route/UI realtime remains independent at ~4s.
export const BUS_TIME_HOT_REUSE_MS = 12_000;
// BUS_TIME_ACTIVE_FILTER_V18: verified MS filterCriteria says fleetStatus=1 means unfinished.
export const BUS_TIME_ACTIVE_FLEET_STATUS = "1";
export const BUS_TIME_BACKGROUND_INTERVAL_MS = 12_000;
export const BUS_TIME_MAX_BACKGROUND_CALLS_PER_CYCLE = 1;
export const BUS_TIME_MAX_CALLS_PER_CYCLE = 3;
export const BUS_TIME_P2_MAX_ROWS_PER_CYCLE = 25;
export const BUS_TIME_P2_MAX_CALLS_PER_CYCLE = 1;
export const BUS_TIME_P3_MAX_ROWS_PER_CYCLE = 25;
export const BUS_TIME_P3_MAX_CALLS_PER_CYCLE = 1;
export const BUS_TIME_P3_RANGE_DAYS = 7;
export const BUS_TIME_P3_END_OFFSET_DAYS = -2;
export const BUS_TIME_P3_CLAIM_LEASE_MS = 30 * 1000;
export const BUS_TIME_P3_PROGRESS_COOLDOWN_MS = BUS_TIME_BACKGROUND_INTERVAL_MS;
export const BUS_TIME_P3_NO_MATCH_COOLDOWN_MS = 5 * 60 * 1000;
export const BUS_TIME_P3_TRANSIENT_COOLDOWN_MS = 60 * 1000;
export const BUS_TIME_CACHE_RETENTION_MS = 36 * 60 * 60 * 1000;
export const BUS_TIME_CREDENTIAL_CACHE_MS = 10 * 60 * 1000;
// BUS_TIME_HAR_SEED_TRUTH_V26: a successful uploaded HAR may seed the shared
// cache briefly, but it is never treated as a permanent substitute for live BusTime.
export const BUS_TIME_HAR_SEED_MAX_AGE_MS = 15 * 60 * 1000;
// BUS_TIME_PROVIDER_COOLDOWN_V15: provider-limit recovery must not re-hit the source every few seconds.
// Preserve the ~12s KIT/TBR lane when healthy, but back off optional BusTime for 5m -> 60m on provider limits.
export const BUS_TIME_RATE_LIMIT_BASE_COOLDOWN_MS = 5 * 60 * 1000;
export const BUS_TIME_RATE_LIMIT_MAX_COOLDOWN_MS = 60 * 60 * 1000;
export const BUS_TIME_SESSION_COOLDOWN_MS = 60 * 60 * 1000;

// The pointer's legacy business_day column was estimate-derived. REC-04 keeps
// the indexed per-HUB latest pointer but derives the authoritative day from the
// accepted snapshot: actual departure for Origin, earliest KIT/TBR otherwise.
const BUS_TIME_P3_BUSINESS_DAY_SQL = `CASE
  WHEN COALESCE(json_extract(h.payload_json,'$.attendanceType'),'') LIKE '%ต้นทาง%' THEN
    date(datetime(NULLIF(json_extract(h.payload_json,'$.actualDepartureAt'),'')), '+7 hours')
  WHEN COALESCE(json_extract(h.payload_json,'$.attendanceType'),'') LIKE '%ปลายทาง%'
    OR COALESCE(json_extract(h.payload_json,'$.attendanceType'),'') LIKE '%จุดดรอป%' THEN
    date(datetime(CASE
      WHEN datetime(NULLIF(json_extract(h.payload_json,'$.actualArrivalAt'),'')) IS NOT NULL
       AND datetime(NULLIF(json_extract(h.payload_json,'$.scheduleTbrArrivalAt'),'')) IS NOT NULL
        THEN CASE
          WHEN julianday(json_extract(h.payload_json,'$.actualArrivalAt'))
            <= julianday(json_extract(h.payload_json,'$.scheduleTbrArrivalAt'))
            THEN json_extract(h.payload_json,'$.actualArrivalAt')
          ELSE json_extract(h.payload_json,'$.scheduleTbrArrivalAt')
        END
      WHEN datetime(NULLIF(json_extract(h.payload_json,'$.actualArrivalAt'),'')) IS NOT NULL
        THEN json_extract(h.payload_json,'$.actualArrivalAt')
      WHEN datetime(NULLIF(json_extract(h.payload_json,'$.scheduleTbrArrivalAt'),'')) IS NOT NULL
        THEN json_extract(h.payload_json,'$.scheduleTbrArrivalAt')
      ELSE NULL
    END), '+7 hours')
  ELSE NULL
END`;

export const MS_FIELD_EVIDENCE = Object.freeze({
  OBSERVED: "OBSERVED",
  MISSING_UNCONFIRMED: "MISSING_UNCONFIRMED",
  UNKNOWN: "UNKNOWN",
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
  NOT_APPLICABLE: "NOT_APPLICABLE",
});
export const MS_DATA_COMPLETENESS = Object.freeze({
  COMPLETE: "DATA_COMPLETE",
  INCOMPLETE: "DATA_INCOMPLETE",
  UNKNOWN: "DATA_UNKNOWN",
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
});
export const MS_ENRICHMENT_PENDING = "ENRICHMENT_PENDING";

function validIso(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function inboundAttendance(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "ปลายทาง" || text === "destination") return "DESTINATION";
  if (text === "จุดดรอป" || text === "drop" || text === "drop point") return "DROP";
  return "OTHER";
}

export function createMsFieldEvidence({
  field,
  state,
  source = "BUS_TIME",
  valueTimestamp = "",
  observedAt = "",
  fetchedAt = "",
  acceptedAt = "",
  dataObservedAt = "",
  sourceValueTimestamp = "",
  acceptedDataAt = "",
  sourceCode = "",
  boundary = "CURRENT_SHARED_CYCLE",
  enrichmentOrigin = "",
  backfill = false,
} = {}) {
  const allowed = new Set(Object.values(MS_FIELD_EVIDENCE));
  const evidenceState = allowed.has(state) ? state : MS_FIELD_EVIDENCE.UNKNOWN;
  return {
    field: String(field || ""),
    state: evidenceState,
    source: String(source || ""),
    valueTimestamp: validIso(valueTimestamp || sourceValueTimestamp),
    sourceValueTimestamp: validIso(sourceValueTimestamp || valueTimestamp),
    observedAt: validIso(observedAt || dataObservedAt),
    dataObservedAt: validIso(dataObservedAt || observedAt),
    fetchedAt: validIso(fetchedAt || observedAt),
    acceptedAt: validIso(acceptedAt || acceptedDataAt),
    acceptedDataAt: validIso(acceptedDataAt || acceptedAt),
    sourceCode: String(sourceCode || ""),
    boundary: String(boundary || "CURRENT_SHARED_CYCLE"),
    enrichmentOrigin: String(enrichmentOrigin || ""),
    backfill: Boolean(backfill),
  };
}

export function deriveMsDataCompleteness(requiredEvidence = []) {
  const states = (Array.isArray(requiredEvidence) ? requiredEvidence : [])
    .map((item) => String(item?.state || item || ""))
    .filter((state) => state && state !== MS_FIELD_EVIDENCE.NOT_APPLICABLE);
  if (!states.length) return MS_DATA_COMPLETENESS.COMPLETE;
  if (states.includes(MS_FIELD_EVIDENCE.SOURCE_UNAVAILABLE))
    return MS_DATA_COMPLETENESS.SOURCE_UNAVAILABLE;
  if (states.includes(MS_FIELD_EVIDENCE.UNKNOWN))
    return MS_DATA_COMPLETENESS.UNKNOWN;
  if (states.includes(MS_FIELD_EVIDENCE.MISSING_UNCONFIRMED))
    return MS_DATA_COMPLETENESS.INCOMPLETE;
  return states.every((state) => state === MS_FIELD_EVIDENCE.OBSERVED)
    ? MS_DATA_COMPLETENESS.COMPLETE
    : MS_DATA_COMPLETENESS.UNKNOWN;
}

export function msLifecycleClass(row, nowMs = Date.now()) {
  const attendance = inboundAttendance(row?.attendanceType);
  if (attendance === "OTHER") return "NOT_APPLICABLE";
  const released = attendance === "DROP" && Boolean(validIso(row?.actualDepartureAt));
  const completed = attendance === "DESTINATION" && Number(row?.unloadingState) === 2;
  if (released) return "RELEASED";
  if (completed) return "COMPLETED";
  const arrivalValues = [row?.actualArrivalAt, row?.scheduleTbrArrivalAt]
    .map(validIso)
    .filter(Boolean)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  const provenStart = validIso(
    row?.scheduleUnloadingStartedAt ||
      row?.unloadingStartedAt ||
      row?.unloadingStartedObservedAt,
  );
  const anchor = arrivalValues[0] || provenStart;
  if (anchor && Number(nowMs) - Date.parse(anchor) >= 12 * 60 * 60 * 1000)
    return "EXPIRED";
  return "ACTIVE";
}

export function msBusRequiredFields(row) {
  const attendance = inboundAttendance(row?.attendanceType);
  if (attendance === "OTHER") return [];
  const state = Number(row?.unloadingState);
  const released = attendance === "DROP" && Boolean(validIso(row?.actualDepartureAt));
  const required = ["scheduleTbrArrivalAt"];
  if (state === 1 || state === 2 || released)
    required.push("scheduleUnloadingStartedAt");
  if (state === 2 || released)
    required.push("scheduleUnloadingCompletedAt");
  return required;
}

export function isMsBusEvidenceComplete(row) {
  const required = msBusRequiredFields(row);
  return required.length === 0 || required.every((field) => Boolean(validIso(row?.[field])));
}

function msBusOccurrenceIdentity(row) {
  const direct = String(row?.id || row?.routeId || "").trim();
  if (direct) return direct;
  const dayAnchor = [row?.actualArrivalAt, row?.scheduleTbrArrivalAt, row?.actualDepartureAt]
    .map(validIso)
    .filter(Boolean)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] || "";
  return [
    String(row?.routeName || "").trim().toUpperCase(),
    dayAnchor ? dayAnchor.slice(0, 10) : String(row?.businessDay || "").slice(0, 10),
  ].join("|");
}

function ambiguousMsBusKeys(rows) {
  const identities = new Map();
  for (const entry of Array.isArray(rows) ? rows : []) {
    const row = entry?.row || entry;
    const attendance = inboundAttendance(row?.attendanceType);
    const proofId = String(row?.proofId || "").trim().toUpperCase();
    if (attendance === "OTHER" || !proofId) continue;
    const attendanceValue = attendance === "DESTINATION" ? "ปลายทาง" : "จุดดรอป";
    const key = `P:${proofId}|A:${attendanceValue}`;
    if (!identities.has(key)) identities.set(key, new Set());
    identities.get(key).add(msBusOccurrenceIdentity(row));
  }
  return new Set(
    [...identities.entries()]
      .filter(([, values]) => values.size > 1)
      .map(([key]) => key),
  );
}

export function deriveMsTbrProjection(row, {
  sourceEvaluated = false,
  sourceUnavailable = false,
  sourceCode = "",
  observedAt = "",
  fetchedAt = "",
  acceptedAt = "",
  nowMs = Date.now(),
  boundary = "CURRENT_SHARED_CYCLE",
  enrichmentOrigin = "",
  backfill = false,
  priority = "",
} = {}) {
  const attendance = inboundAttendance(row?.attendanceType);
  const required = new Set(msBusRequiredFields(row));
  const fieldEvidence = {};
  for (const field of [
    "scheduleTbrArrivalAt",
    "scheduleUnloadingStartedAt",
    "scheduleUnloadingCompletedAt",
  ]) {
    let state;
    if (attendance === "OTHER" || !required.has(field))
      state = MS_FIELD_EVIDENCE.NOT_APPLICABLE;
    else if (validIso(row?.[field])) state = MS_FIELD_EVIDENCE.OBSERVED;
    else if (sourceUnavailable) state = MS_FIELD_EVIDENCE.SOURCE_UNAVAILABLE;
    else if (sourceEvaluated) state = MS_FIELD_EVIDENCE.MISSING_UNCONFIRMED;
    else state = MS_FIELD_EVIDENCE.UNKNOWN;
    fieldEvidence[field] = createMsFieldEvidence({
      field,
      state,
      source: "BUS_TIME",
      valueTimestamp: row?.[field],
      observedAt,
      fetchedAt,
      acceptedAt,
      sourceCode,
      boundary,
      enrichmentOrigin,
      backfill,
    });
  }
  const dataCompleteness = deriveMsDataCompleteness(
    [...required].map((field) => fieldEvidence[field]),
  );
  const lifecycle = msLifecycleClass(row, nowMs);
  const pending =
    attendance !== "OTHER" && dataCompleteness !== MS_DATA_COMPLETENESS.COMPLETE;
  return {
    fieldEvidence,
    dataCompleteness,
    enrichmentState: pending ? MS_ENRICHMENT_PENDING : "",
    enrichmentPriority: pending
      ? priority || (lifecycle === "ACTIVE" ? "P1" : "P2")
      : "",
    lifecycle,
  };
}

export function planMsTbrEnrichment(rows, {
  nowMs = Date.now(),
  cache = new Map(),
  limit = 100,
  p2Limit = BUS_TIME_P2_MAX_ROWS_PER_CYCLE,
  p2Offset = 0,
} = {}) {
  const ambiguousKeys = ambiguousMsBusKeys(rows);
  const unique = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const attendance = inboundAttendance(row?.attendanceType);
    const proofId = String(row?.proofId || "").trim().toUpperCase();
    if (attendance === "OTHER" || !proofId) continue;
    const attendanceValue = attendance === "DESTINATION" ? "ปลายทาง" : "จุดดรอป";
    const key = `P:${proofId}|A:${attendanceValue}`;
    if (ambiguousKeys.has(key)) continue;
    const cached = cache instanceof Map ? cache.get(key) : null;
    const normalized = { ...row, ...cached, attendanceType: attendanceValue };
    if (isMsBusEvidenceComplete(normalized) || unique.has(key)) continue;
    unique.set(key, {
      key,
      row: normalized,
      priority: msLifecycleClass(normalized, nowMs) === "ACTIVE" ? "P1" : "P2",
    });
  }
  const p1 = [...unique.values()].filter((item) => item.priority === "P1");
  const allP2 = [...unique.values()].filter((item) => item.priority === "P2");
  const boundedLimit = Math.max(1, Number(limit) || 100);
  const boundedP2 = Math.min(
    allP2.length,
    Math.max(0, Math.min(Number(p2Limit) || 0, boundedLimit)),
  );
  const start = allP2.length ? Math.max(0, Number(p2Offset) || 0) % allP2.length : 0;
  const p2 = [];
  for (let index = 0; index < boundedP2; index += 1)
    p2.push(allP2[(start + index) % allP2.length]);
  const p1Limit = Math.max(0, boundedLimit - p2.length);
  return {
    p1: p1.slice(0, p1Limit),
    p2,
    selected: [...p1.slice(0, p1Limit), ...p2],
    nextP2Offset: allP2.length ? (start + p2.length) % allP2.length : 0,
    unresolved: unique.size,
    p1Unresolved: p1.length,
    p2Unresolved: allP2.length,
    ambiguousKeys,
  };
}

export function planMsP3Backfill(rows, {
  hub = "",
  cache = new Map(),
  excludedKeys = new Set(),
  limit = BUS_TIME_P3_MAX_ROWS_PER_CYCLE,
} = {}) {
  const ambiguousKeys = ambiguousMsBusKeys(rows);
  const wantedHub = String(hub || "").trim().toUpperCase();
  const boundedLimit = Math.max(
    0,
    Math.min(BUS_TIME_P3_MAX_ROWS_PER_CYCLE, Number(limit) || 0),
  );
  const scanned = [];
  const selected = [];
  const unique = new Set();
  let selectedDay = "";
  for (const entry of Array.isArray(rows) ? rows.slice(0, boundedLimit) : []) {
    const row = entry?.row || entry;
    const rowHub = String(entry?.hub || row?.hub || wantedHub).trim().toUpperCase();
    const businessDay = String(entry?.businessDay || row?.businessDay || "").slice(0, 10);
    const routeId = String(entry?.routeId || row?.id || "");
    const cursorRowid = Math.max(0, Number(entry?.cursorRowid) || 0);
    scanned.push({ row, routeId, businessDay, hub: rowHub, cursorRowid });
    if (rowHub !== wantedHub) continue;
    const attendance = inboundAttendance(row?.attendanceType);
    const proofId = String(row?.proofId || "").trim().toUpperCase();
    if (attendance === "OTHER" || !proofId) continue;
    const attendanceValue = attendance === "DESTINATION" ? "ปลายทาง" : "จุดดรอป";
    const key = `P:${proofId}|A:${attendanceValue}`;
    if (ambiguousKeys.has(key)) continue;
    const evidence = row?.fieldEvidence?.scheduleTbrArrivalAt;
    if (
      validIso(row?.scheduleTbrArrivalAt) ||
      String(row?.dataCompleteness || "") === MS_DATA_COMPLETENESS.COMPLETE ||
      String(evidence?.state || "") === MS_FIELD_EVIDENCE.OBSERVED ||
      String(evidence?.state || "") === MS_FIELD_EVIDENCE.NOT_APPLICABLE ||
      excludedKeys.has(key) ||
      unique.has(key)
    ) continue;
    if (selectedDay && businessDay !== selectedDay) continue;
    selectedDay ||= businessDay;
    unique.add(key);
    selected.push({
      key,
      row: { ...row, attendanceType: attendanceValue },
      routeId,
      businessDay,
      cursorRowid,
      priority: "P3",
    });
  }
  const selectedDayScanned = selectedDay
    ? scanned.filter((item) => item.businessDay === selectedDay)
    : scanned;
  const batchEnd = selectedDayScanned.at(-1) || scanned.at(-1) || null;
  return {
    selected,
    pending: selected.length,
    scanned: scanned.length,
    selectedDay,
    batchEnd: batchEnd
      ? {
          businessDay: batchEnd.businessDay,
          cursorRowid: batchEnd.cursorRowid,
          routeId: batchEnd.routeId,
        }
      : null,
    ambiguousKeys,
  };
}

export function parseBusRetryAfter(value, nowMs = Date.now()) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  if (/^\d+(?:\.\d+)?$/.test(raw))
    return Math.max(0, Math.round(Number(raw) * 1000));
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Number(nowMs || Date.now())) : 0;
}

export function legacyBusCallsPerMinute(rowsPerDay, days = 2, pollMs = 4000) {
  const pages = Math.min(20, Math.max(1, Math.ceil(Math.max(0, Number(rowsPerDay) || 0) / 100)));
  return pages * Math.max(1, Number(days) || 1) * Math.ceil(60_000 / Math.max(1000, Number(pollMs) || 4000));
}

function nestedValue(field, index) {
  return Array.isArray(field) ? field[index]?.value ?? "" : "";
}

function earliestDate(...values) {
  const valid = values
    .map((value) => String(value || ""))
    .filter((value) => Number.isFinite(Date.parse(value)));
  if (!valid.length) return "";
  return valid.sort((a, b) => Date.parse(a) - Date.parse(b))[0];
}

// BUS_TIME_TBR_FIELD_TRUTH_V28: scan bounded fleet_sign_info candidates without
// reinterpreting unrelated labels such as KIT:. Preserve the historical bare-date
// shape and support an explicit TBR: label or numeric epoch when providers vary serialization.
export function extractBusTbrAtV28(field, msDateFn) {
  if (!Array.isArray(field) || typeof msDateFn !== "function") return "";
  const parsed = [];
  for (const entry of field) {
    const raw = String(entry?.value ?? "").trim();
    if (!raw || raw === "-") continue;
    const candidates = [];
    const directDate = /^\d{4}-\d{1,2}-\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(raw);
    if (directDate || /^\d{10}(?:\d{3})?$/.test(raw)) candidates.push(raw);
    const labelled = raw.match(/^\s*TBR\s*[:：=\-]?\s*(.+)$/i);
    if (labelled?.[1]) candidates.push(labelled[1].trim());
    for (const candidate of candidates) {
      let value = candidate;
      if (/^\d{10}$/.test(value)) value = new Date(Number(value) * 1000).toISOString();
      else if (/^\d{13}$/.test(value)) value = new Date(Number(value)).toISOString();
      const iso = msDateFn(value);
      if (!iso) continue;
      const text = String(iso).trim();
      const localWallClock = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text);
      const normalized = localWallClock
        ? new Date(text.replace(" ", "T") + "+07:00").toISOString()
        : Number.isFinite(Date.parse(text))
          ? new Date(text).toISOString()
          : "";
      if (normalized) parsed.push(normalized);
    }
  }
  if (!parsed.length) return "";
  return parsed.sort((a, b) => Date.parse(a) - Date.parse(b))[0];
}

function sourceError(message, code, status, retryAfterMs = 0) {
  const error = new Error(String(message || "BusTime source error"));
  error.code = code || "BUS_TIME_SOURCE_ERROR";
  error.status = Number(status) || 502;
  error.retryAfterMs = Math.max(0, Number(retryAfterMs) || 0);
  return error;
}

export function createBusTimeHotLane(deps) {
  const {
    liveSourceDays,
    thaiDayOffset,
    normalizeProofId,
    normalizeAttendance,
    matchHub,
    msDate,
    parseUnloadingStart,
    parseUnloadingEnd,
    decryptMs,
    safeStatusWrite,
    markSuccess,
    markError,
    classifyFailure,
    connectionHeartbeatMs = 15 * 60 * 1000,
    fetchFn = (...args) => fetch(...args),
    now = () => Date.now(),
    random = () => Math.random(),
    logger = console,
    p3Enabled = false,
  } = deps || {};

  for (const [name, value] of Object.entries({
    liveSourceDays,
    thaiDayOffset,
    normalizeProofId,
    normalizeAttendance,
    matchHub,
    msDate,
    parseUnloadingStart,
    parseUnloadingEnd,
    decryptMs,
    safeStatusWrite,
    markSuccess,
    markError,
    classifyFailure,
  })) {
    if (typeof value !== "function")
      throw new Error(`${BUS_TIME_HOT_LANE_MARKER}: missing dependency ${name}`);
  }

  const states = new Map();
  const active = new Map();

  const isoNow = () => new Date(now()).toISOString();

  function stateFor(hub) {
    const key = String(hub || "").trim().toUpperCase();
    if (!states.has(key)) {
      states.set(key, {
        cache: new Map(),
        seen: new Map(),
        pageCounts: new Map(),
        pageCursor: new Map(),
        p2PageCounts: new Map(),
        p2PageCursor: new Map(),
        p2Offset: 0,
        p3Loaded: false,
        p3Checkpoint: null,
        cycleSchedule: new Map(),
        credentials: null,
        credentialsUntil: 0,
        seeded: false,
        lastHotAt: 0,
        lastBackgroundAt: 0,
        lastP2At: 0,
        lastHeartbeatAt: 0,
        lastErrorWriteAt: 0,
        lastPersistedError: "",
        cooldownUntil: 0,
        cooldownCode: "",
        rateLimitStrikes: 0,
        callTimes: [],
        busHotCalls: 0,
        busBackgroundCalls: 0,
        busPagesLastCycle: 0,
        busCacheHits: 0,
        busCacheMisses: 0,
        busRateLimitCount: 0,
        busLastSuccessAt: "",
        busLastAttemptAt: "",
        busLastMeaningfulObservationAt: "",
        busLastErrorAt: "",
        busLastError: "",
        busActiveRows: 0,
        busP1Rows: 0,
        busP1Unresolved: 0,
        busP1Calls: 0,
        busP2Rows: 0,
        busP2Unresolved: 0,
        busP2Calls: 0,
        busP3Pending: null,
        busP3Rows: 0,
        busP3Calls: 0,
        busP3Accepted: 0,
        busP3Deferred: false,
        busP3DeferredReason: "",
        busP3CooldownUntil: "",
        busP3CooldownCode: "",
        busSharedCalls: 0,
        busDeduplicatedReaders: 0,
        busBudgetExhausted: false,
        previousActiveKeys: new Set(),
        ambiguousKeys: new Set(),
        acceptedRouteHints: [],
        rateLeaseLoaded: false,
        rateLeasePresent: false,
      });
    }
    return states.get(key);
  }

  function recordCall(state, kind) {
    const at = now();
    state.busLastAttemptAt = new Date(at).toISOString();
    state.callTimes.push(at);
    state.callTimes = state.callTimes.filter((value) => at - value < 60_000);
    if (kind === "hot") state.busHotCalls += 1;
    else state.busBackgroundCalls += 1;
    state.busSharedCalls += 1;
    state.busPagesLastCycle += 1;
  }

  function activeRows(routeRows) {
    return (Array.isArray(routeRows) ? routeRows : []).filter((row) => {
      if (!normalizeProofId(row?.proofId)) return false;
      const attendance = String(normalizeAttendance(row?.attendanceType) || "")
        .trim()
        .toLowerCase();
      const destination =
        attendance === "ปลายทาง" ||
        attendance === "destination";
      const drop =
        attendance === "จุดดรอป" ||
        attendance === "drop" ||
        attendance === "drop point";
      if (!destination && !drop) return false;
      // BUS_TIME_DROP_AWAIT_RELEASE_TBR_V1:
      // Route unloadingState=2 completes unloading, but a Drop remains lifecycle-active
      // until Route supplies actualDepartureAt. Keep only that state-2 subcase in the
      // existing shared ~12s BusTime lane; released Drops and completed destinations
      // stay excluded so this does not create completed-row polling.
      if (Number(row?.unloadingState) === 2) {
        const released = Boolean(String(row?.actualDepartureAt || "").trim());
        if (!drop || released) return false;
      }
      return true;
    });
  }

  function bangkokDay(value) {
    const at = Date.parse(String(value || ""));
    if (!Number.isFinite(at)) return "";
    return new Date(at + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  function routeTouchesDay(row, day) {
    return [
      row?.estimatedArrivalAt,
      row?.actualArrivalAt,
      row?.unloadingStartedAt,
      row?.estimatedDepartureAt,
      row?.actualDepartureAt,
    ].some((value) => bangkokDay(value) === day);
  }

  function hotDays(wantedDays, rows) {
    const days = [...new Set((Array.isArray(wantedDays) ? wantedDays : liveSourceDays())
      .map((value) => String(value || ""))
      .filter(Boolean))];
    const today = thaiDayOffset(0);
    const yesterday = thaiDayOffset(-1);
    const primary = days.includes(today) ? today : (days.at(-1) || today);
    const output = [primary];
    if (
      yesterday !== primary &&
      days.includes(yesterday) &&
      rows.some((row) => routeTouchesDay(row, yesterday))
    ) output.push(yesterday);
    return output;
  }

  function cacheKey(row) {
    const proofId = normalizeProofId(row?.proofId);
    const attendance = normalizeAttendance(row?.attendanceType);
    return proofId && attendance ? `P:${proofId}|A:${attendance}` : "";
  }

  function seedCandidate(row) {
    const key = cacheKey(row);
    if (!key) return null;
    const value = {
      proofId: String(row?.proofId || "").slice(0, 100),
      routeName: String(row?.routeName || "").slice(0, 300),
      scheduleKitArrivalAt: String(row?.scheduleKitArrivalAt || ""),
      scheduleTbrArrivalAt: String(row?.scheduleTbrArrivalAt || ""),
      arrivedParcels: Number(row?.arrivedParcels) || 0,
      arrivedBags: Number(row?.arrivedBags) || 0,
      scheduleUnloadingStartedAt: String(row?.scheduleUnloadingStartedAt || ""),
      scheduleUnloadingCompletedAt: String(row?.scheduleUnloadingCompletedAt || ""),
      scheduleCompletionAmbiguous: Boolean(row?.scheduleCompletionAmbiguous),
      fieldEvidence: row?.fieldEvidence || null,
      dataCompleteness: String(row?.dataCompleteness || ""),
      enrichmentState: String(row?.enrichmentState || ""),
      enrichmentPriority: String(row?.enrichmentPriority || ""),
      lifecycle: String(row?.lifecycle || ""),
    };
    const hasData =
      value.scheduleKitArrivalAt ||
      value.scheduleTbrArrivalAt ||
      value.arrivedParcels ||
      value.arrivedBags ||
      value.scheduleUnloadingStartedAt ||
      value.scheduleUnloadingCompletedAt ||
      value.scheduleCompletionAmbiguous;
    return hasData ? { key, value } : null;
  }

  async function seedAccepted(env, hub, state) {
    if (state.seeded) return state.acceptedRouteHints;
    state.seeded = true;
    try {
      const row = await env.DB.prepare(
        "SELECT rows_json FROM ms_live_cache WHERE hub=?",
      ).bind(hub).first();
      if (!row?.rows_json) return state.acceptedRouteHints;
      const parsed = JSON.parse(row.rows_json);
      const rows = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.rows)
          ? parsed.rows
          : [];
      // BUS_TIME_COLD_HINT_V21: reuse the same accepted-cache point read to
      // recover the previous Route snapshot after Durable Object hibernation.
      state.acceptedRouteHints = rows;
      const at = now();
      for (const item of rows) {
        const seeded = seedCandidate(item);
        if (!seeded) continue;
        state.cache.set(seeded.key, seeded.value);
        state.seen.set(seeded.key, at);
      }
      return state.acceptedRouteHints;
    } catch (error) {
      logger.warn?.(JSON.stringify({
        event: "bus_time_seed_cache_error",
        hub,
        message: error?.message || String(error),
      }));
      return state.acceptedRouteHints;
    }
  }

  const RATE_LEASE_SOURCE = "BUS_TIME_RATE_LIMIT";
  const rateLeaseHub = (hub) => `__BUS_RATE_LIMIT__:${String(hub || "").trim().toUpperCase()}`;
  const isRateLimitMessage = (value) =>
    /request\s+exceeds\s+the\s+limit|rate.?limit|too many requests/i.test(String(value || ""));

  async function loadRateLimitLease(env, hub, state) {
    if (state.rateLeaseLoaded) return;
    state.rateLeaseLoaded = true;
    try {
      const row = await env.DB.prepare(
        "SELECT source_hash,claim_token,state,lease_until FROM ms_sync_claims WHERE hub=? LIMIT 1",
      ).bind(rateLeaseHub(hub)).first();
      if (!row || String(row.source_hash || "") !== RATE_LEASE_SOURCE) return;
      state.rateLeasePresent = true;
      const strikes = Number(String(row.claim_token || "").split(":").at(-1));
      if (Number.isFinite(strikes) && strikes > 0)
        state.rateLimitStrikes = Math.min(8, strikes);
      const until = Date.parse(String(row.lease_until || ""));
      if (String(row.state || "") === "ACTIVE" && Number.isFinite(until)) {
        state.cooldownUntil = Math.max(state.cooldownUntil, until);
        state.cooldownCode = "BUS_TIME_RATE_LIMIT";
      }
    } catch (error) {
      logger.warn?.(JSON.stringify({
        event: "bus_time_rate_lease_read_error",
        hub,
        message: error?.message || String(error),
      }));
    }
  }

  async function persistRateLimitLease(env, hub, state) {
    const leaseUntil = new Date(state.cooldownUntil).toISOString();
    const claimedAt = isoNow();
    const token = `BUS_TIME_RATE_LIMIT:${Math.max(1, Number(state.rateLimitStrikes) || 1)}`;
    const result = await safeStatusWrite(
      env.DB.prepare(
        "INSERT INTO ms_sync_claims(hub,source_hash,claim_token,state,lease_until,claimed_at,finished_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(hub) DO UPDATE SET source_hash=excluded.source_hash,claim_token=excluded.claim_token,state=excluded.state,lease_until=excluded.lease_until,claimed_at=excluded.claimed_at,finished_at=excluded.finished_at",
      ).bind(rateLeaseHub(hub), RATE_LEASE_SOURCE, token, "ACTIVE", leaseUntil, claimedAt, "").run(),
      "ms_bus_rate_lease_write_error",
      hub,
    );
    if (result !== null) {
      state.rateLeaseLoaded = true;
      state.rateLeasePresent = true;
    }
    return result;
  }

  async function clearRateLimitLease(env, hub, state) {
    if (!state.rateLeasePresent) return true;
    const result = await safeStatusWrite(
      env.DB.prepare(
        "DELETE FROM ms_sync_claims WHERE hub=? AND source_hash=?",
      ).bind(rateLeaseHub(hub), RATE_LEASE_SOURCE).run(),
      "ms_bus_rate_lease_clear_error",
      hub,
    );
    if (result !== null) state.rateLeasePresent = false;
    return result !== null;
  }

  const P3_CHECKPOINT_SOURCE = "BUS_TIME_P3_CHECKPOINT_V1";
  const p3ClaimHub = (hub) => `__BUS_P3__:${String(hub || "").trim().toUpperCase()}`;

  function p3Range() {
    return {
      startDay: String(thaiDayOffset(-(BUS_TIME_P3_RANGE_DAYS + 1)) || "").slice(0, 10),
      endDay: String(thaiDayOffset(BUS_TIME_P3_END_OFFSET_DAYS) || "").slice(0, 10),
    };
  }

  function defaultP3Checkpoint(hub) {
    const range = p3Range();
    return {
      version: 1,
      source: P3_CHECKPOINT_SOURCE,
      hub: String(hub || "").trim().toUpperCase(),
      ...range,
      cursorDay: "",
      cursorRowid: 0,
      cursorRouteId: "",
      providerDay: "",
      providerPage: 1,
      providerPages: 1,
      attempted: 0,
      accepted: 0,
      pending: null,
      exhausted: false,
      nextEligibleAt: "",
      cooldownCode: "",
    };
  }

  function normalizeP3Checkpoint(value, hub) {
    const fallback = defaultP3Checkpoint(hub);
    let parsed = value;
    if (typeof parsed === "string") {
      try { parsed = JSON.parse(parsed); } catch { parsed = null; }
    }
    if (
      !parsed ||
      parsed.source !== P3_CHECKPOINT_SOURCE ||
      String(parsed.hub || "").toUpperCase() !== fallback.hub ||
      parsed.startDay !== fallback.startDay ||
      parsed.endDay !== fallback.endDay
    ) return fallback;
    return {
      ...fallback,
      cursorDay: String(parsed.cursorDay || "").slice(0, 10),
      cursorRowid: Math.max(0, Number(parsed.cursorRowid) || 0),
      cursorRouteId: String(parsed.cursorRouteId || "").slice(0, 200),
      providerDay: String(parsed.providerDay || "").slice(0, 10),
      providerPage: Math.max(1, Math.min(20, Number(parsed.providerPage) || 1)),
      providerPages: Math.max(1, Math.min(20, Number(parsed.providerPages) || 1)),
      attempted: Math.max(0, Number(parsed.attempted) || 0),
      accepted: Math.max(0, Number(parsed.accepted) || 0),
      pending: Number.isInteger(parsed.pending) && parsed.pending >= 0
        ? parsed.pending
        : null,
      exhausted: Boolean(parsed.exhausted),
      nextEligibleAt: validIso(parsed.nextEligibleAt),
      cooldownCode: String(parsed.cooldownCode || ""),
    };
  }

  async function loadP3Checkpoint(env, hub, state) {
    if (!p3Enabled) return defaultP3Checkpoint(hub);
    const cachedUntil = Date.parse(String(state.p3Checkpoint?.nextEligibleAt || ""));
    if (state.p3Checkpoint && Number.isFinite(cachedUntil) && cachedUntil > now())
      return state.p3Checkpoint;
    try {
      const row = await env.DB.prepare(
        "SELECT source_hash,claim_token,state,lease_until FROM ms_sync_claims WHERE hub=? LIMIT 1",
      ).bind(p3ClaimHub(hub)).first();
      state.p3Checkpoint = normalizeP3Checkpoint(row?.source_hash, hub);
    } catch (error) {
      state.p3Checkpoint ||= defaultP3Checkpoint(hub);
      logger.warn?.(JSON.stringify({
        event: "bus_time_p3_checkpoint_read_error",
        hub,
        message: error?.message || String(error),
      }));
    }
    return state.p3Checkpoint;
  }

  function p3Eligible(checkpoint) {
    const next = Date.parse(String(checkpoint?.nextEligibleAt || ""));
    return !Number.isFinite(next) || next <= now();
  }

  async function acquireP3Claim(env, hub, checkpoint) {
    const claimedAt = isoNow();
    const leaseUntil = new Date(now() + BUS_TIME_P3_CLAIM_LEASE_MS).toISOString();
    const unique = globalThis.crypto?.randomUUID?.()
      || `${now()}:${Math.floor(random() * 1_000_000_000)}`;
    const token = `P3:${hub}:${unique}`;
    const sourceHash = JSON.stringify(checkpoint);
    const result = await env.DB.prepare(
      "INSERT INTO ms_sync_claims(hub,source_hash,claim_token,state,lease_until,claimed_at,finished_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(hub) DO UPDATE SET source_hash=excluded.source_hash,claim_token=excluded.claim_token,state=excluded.state,lease_until=excluded.lease_until,claimed_at=excluded.claimed_at,finished_at=excluded.finished_at WHERE (ms_sync_claims.state<>'ACTIVE' AND ms_sync_claims.lease_until<=?) OR (ms_sync_claims.state='ACTIVE' AND ms_sync_claims.lease_until<?)",
    ).bind(
      p3ClaimHub(hub), sourceHash, token, "ACTIVE", leaseUntil, claimedAt, "",
      claimedAt, claimedAt,
    ).run();
    return { acquired: Number(result?.meta?.changes || 0) > 0, token };
  }

  async function finishP3Claim(env, hub, claim, checkpoint) {
    if (!claim?.token) return false;
    const finishedAt = isoNow();
    const result = await safeStatusWrite(
      env.DB.prepare(
        "UPDATE ms_sync_claims SET source_hash=?,state='DONE',lease_until=?,finished_at=? WHERE hub=? AND claim_token=?",
      ).bind(
        JSON.stringify(checkpoint),
        checkpoint.nextEligibleAt || finishedAt,
        finishedAt,
        p3ClaimHub(hub),
        claim.token,
      ).run(),
      "ms_bus_p3_checkpoint_write_error",
      hub,
    );
    return result !== null;
  }

  async function readP3Candidates(env, hub, checkpoint) {
    const meta = await env.DB.prepare(
      "SELECT ready FROM ms_route_latest_meta WHERE id=1 LIMIT 1",
    ).first();
    if (Number(meta?.ready) !== 1) {
      const error = new Error("MS historical latest pointer is not ready");
      error.code = "P3_POINTER_NOT_READY";
      throw error;
    }
    const result = await env.DB.prepare(
      `WITH canonical AS (
        SELECT l.rowid AS latest_rowid,l.route_id,h.payload_json,
          ${BUS_TIME_P3_BUSINESS_DAY_SQL} AS business_day
        FROM ms_route_latest l INDEXED BY idx_ms_route_latest_hub_day
        JOIN ms_route_history h ON h.rowid=l.history_rowid AND h.hub=l.hub
        WHERE l.hub=? AND json_valid(h.payload_json)=1
      )
      SELECT latest_rowid,route_id,business_day,payload_json
      FROM canonical
      WHERE business_day>=? AND business_day<=?
        AND (?='' OR business_day<? OR (business_day=? AND latest_rowid<?))
      ORDER BY business_day DESC,latest_rowid DESC
      LIMIT ?`,
    ).bind(
      hub,
      checkpoint.startDay,
      checkpoint.endDay,
      checkpoint.cursorDay,
      checkpoint.cursorDay,
      checkpoint.cursorDay,
      checkpoint.cursorRowid,
      BUS_TIME_P3_MAX_ROWS_PER_CYCLE,
    ).all();
    return (result?.results || []).map((entry) => {
      let row = null;
      try { row = JSON.parse(entry.payload_json || "{}"); } catch {}
      return {
        row,
        hub,
        cursorRowid: Math.max(0, Number(entry.latest_rowid) || 0),
        routeId: String(entry.route_id || row?.id || ""),
        businessDay: String(entry.business_day || "").slice(0, 10),
      };
    }).filter((entry) => entry.row && entry.routeId && entry.businessDay);
  }

  async function persistP3Evidence(env, hub, accepted, acceptedAt) {
    const statements = [];
    let index = 0;
    for (const planned of accepted) {
      const cached = planned?.cached || {};
      const routeId = String(planned?.routeId || planned?.row?.id || "");
      const tbr = validIso(cached.scheduleTbrArrivalAt);
      if (!routeId || !tbr) continue;
      const snapshot = {
        ...planned.row,
        scheduleTbrArrivalAt: tbr,
        fieldEvidence: cached.fieldEvidence || {},
        dataCompleteness: cached.dataCompleteness || MS_DATA_COMPLETENESS.COMPLETE,
        enrichmentState: cached.enrichmentState || "",
        enrichmentPriority: cached.enrichmentPriority || "",
        enrichmentOrigin: "P3",
        backfilledAt: acceptedAt,
      };
      const historyId = `P3:${hub}:${routeId}:${acceptedAt}:${index++}`;
      statements.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO ms_route_history(history_id,route_id,hub,event_type,snapshot_at,payload_json,synced_by) SELECT ?,?,?,'P3_ENRICHED',?,?, 'MS_P3_BACKFILL' FROM ms_routes WHERE id=? AND hub=? AND COALESCE(schedule_tbr_arrival_at,'')=''",
        ).bind(historyId, routeId, hub, acceptedAt, JSON.stringify(snapshot), routeId, hub),
        env.DB.prepare(
          "UPDATE ms_routes SET schedule_tbr_arrival_at=?,synced_at=?,synced_by='MS_P3_BACKFILL' WHERE id=? AND hub=? AND COALESCE(schedule_tbr_arrival_at,'')=''",
        ).bind(tbr, acceptedAt, routeId, hub),
      );
    }
    if (statements.length) await env.DB.batch(statements);
    return statements.length / 2;
  }

  async function credentials(env, hub, state) {
    const at = now();
    if (state.credentialsUntil > at) return state.credentials;
    const row = await env.DB.prepare(
      "SELECT credentials_cipher,last_error FROM ms_bus_connections WHERE hub=?",
    ).bind(hub).first();
    if (!row?.credentials_cipher) {
      state.credentials = null;
      state.credentialsUntil = at + BUS_TIME_CREDENTIAL_CACHE_MS;
      return null;
    }
    const storedError = String(row.last_error || "");
    if (storedError) {
      state.lastPersistedError = storedError;
      state.lastErrorWriteAt = at;
    }
    // BUS_TIME_PERSISTENT_RATE_LEASE_V21: healthy HUBs pay no lease read.
    // Only a persisted provider-limit error causes one namespaced point read.
    if (isRateLimitMessage(storedError))
      await loadRateLimitLease(env, hub, state);
    state.credentials = JSON.parse(await decryptMs(row.credentials_cipher, env));
    state.credentialsUntil = at + BUS_TIME_CREDENTIAL_CACHE_MS;
    seedHarItems(state, hub, state.credentials);
    return state.credentials;
  }

  function mergeItems(state, items, hub) {
    const at = now();
    for (const item of Array.isArray(items) ? items : []) {
      const targetStore = String(nestedValue(item.next_store_info, 0) || "");
      if (!matchHub(targetStore, hub)) continue;
      const proofId = nestedValue(item.proof_id, 0);
      const proofKey = normalizeProofId(proofId);
      if (!proofKey) continue;
      const attendance = normalizeAttendance(nestedValue(item.next_store_info, 1));
      if (!attendance) continue;
      const key = `P:${proofKey}|A:${attendance}`;
      const current = state.cache.get(key) || {};
      const cycle = state.cycleSchedule.get(key) || { start: "", end: "", routeName: "", ambiguous: false };
      const routeName = String(nestedValue(item.line_info, 0) || "").slice(0, 300);
      const kit = msDate(nestedValue(item.kit_arrive_time, 0));
      const tbr = extractBusTbrAtV28(item.fleet_sign_info, msDate);
      const start = parseUnloadingStart(item.fleet_unloading_time);
      const end = parseUnloadingEnd(item.fleet_unloading_time);
      const conflictStart = Boolean(cycle.start) && Boolean(start) && cycle.start !== start;
      const conflictEnd = Boolean(cycle.end) && Boolean(end) && cycle.end !== end;
      const conflictRoute = Boolean(cycle.routeName) && Boolean(routeName) && cycle.routeName !== routeName;
      const ambiguous = Boolean(cycle.ambiguous) || conflictStart || conflictEnd || conflictRoute;
      if (ambiguous) state.ambiguousKeys.add(key);
      const cycleStart = start || cycle.start || "";
      const cycleEnd = end || cycle.end || "";
      state.cycleSchedule.set(key, {
        start: cycleStart,
        end: cycleEnd,
        routeName: routeName || cycle.routeName || "",
        ambiguous,
      });
      const next = {
        ...current,
        proofId: String(proofId || "").slice(0, 100),
        routeName: routeName || current.routeName || "",
        scheduleKitArrivalAt: earliestDate(current.scheduleKitArrivalAt, kit),
        scheduleTbrArrivalAt: earliestDate(current.scheduleTbrArrivalAt, tbr),
        arrivedParcels: Math.max(
          Number(current.arrivedParcels) || 0,
          Number(nestedValue(item.parcel_count, 0)) || 0,
        ),
        arrivedBags: Math.max(
          Number(current.arrivedBags) || 0,
          Number(nestedValue(item.pack_count, 0)) || 0,
        ),
        scheduleUnloadingStartedAt: ambiguous
          ? ""
          : cycleStart || current.scheduleUnloadingStartedAt || "",
        scheduleUnloadingCompletedAt: ambiguous
          ? ""
          : cycleEnd || current.scheduleUnloadingCompletedAt || "",
        scheduleCompletionAmbiguous: ambiguous,
      };
      const meaningfulKeys = [
        "scheduleKitArrivalAt",
        "scheduleTbrArrivalAt",
        "arrivedParcels",
        "arrivedBags",
        "scheduleUnloadingStartedAt",
        "scheduleUnloadingCompletedAt",
        "scheduleCompletionAmbiguous",
      ];
      if (meaningfulKeys.some((field) => String(current[field] ?? "") !== String(next[field] ?? "")))
        state.busLastMeaningfulObservationAt = new Date(at).toISOString();
      state.cache.set(key, next);
      state.seen.set(key, at);
    }
  }

  function seedHarItems(state, hub, credentialsValue) {
    const seededAt = Date.parse(String(credentialsValue?.seededAt || ""));
    const age = Number.isFinite(seededAt) ? Math.max(0, now() - seededAt) : Number.POSITIVE_INFINITY;
    const items = Array.isArray(credentialsValue?.seedItems) ? credentialsValue.seedItems : [];
    if (!items.length || age > BUS_TIME_HAR_SEED_MAX_AGE_MS) return 0;
    state.cycleSchedule = new Map();
    const before = state.cache.size;
    mergeItems(state, items, hub);
    const added = Math.max(0, state.cache.size - before);
    // Fresh upload should paint its confirmed HAR data immediately and wait one
    // normal healthy 12-second cycle before touching the provider again.
    if (age <= BUS_TIME_HOT_REUSE_MS) state.lastHotAt = now();
    if (added || items.length) state.busLastSuccessAt = new Date(seededAt).toISOString();
    return added;
  }

  function prune(state, rows) {
    const at = now();
    const activeKeys = new Set(rows.map(cacheKey).filter(Boolean));
    for (const [key, seenAt] of state.seen.entries()) {
      if (activeKeys.has(key)) continue;
      if (at - Number(seenAt || 0) <= BUS_TIME_CACHE_RETENTION_MS) continue;
      state.seen.delete(key);
      state.cache.delete(key);
    }
  }

  function applyEvidence(state, items, context = {}) {
    const acceptedAt =
      context.acceptedAt ||
      (context.sourceEvaluated || context.sourceUnavailable ? isoNow() : "");
    for (const planned of Array.isArray(items) ? items : []) {
      const row = planned?.row || planned;
      const key = planned?.key || cacheKey(row);
      if (!key) continue;
      const current = state.cache.get(key) || {};
      const merged = {
        ...row,
        ...current,
        proofId: String(current.proofId || row?.proofId || "").slice(0, 100),
        scheduleTbrArrivalAt: String(
          current.scheduleTbrArrivalAt || row?.scheduleTbrArrivalAt || "",
        ),
      };
      const projection = deriveMsTbrProjection(merged, {
        sourceEvaluated: Boolean(context.sourceEvaluated),
        sourceUnavailable: Boolean(context.sourceUnavailable),
        sourceCode: context.sourceCode || "",
        observedAt: context.observedAt || state.busLastSuccessAt || "",
        fetchedAt: context.fetchedAt || context.observedAt || state.busLastSuccessAt || "",
        acceptedAt,
        nowMs: now(),
        boundary: context.boundary || "CURRENT_SHARED_CYCLE",
        enrichmentOrigin: context.enrichmentOrigin || "",
        backfill: Boolean(context.backfill),
        priority: context.priority || "",
      });
      state.cache.set(key, { ...current, ...projection, proofId: merged.proofId,
        scheduleTbrArrivalAt: merged.scheduleTbrArrivalAt,
        scheduleUnloadingStartedAt: String(
          current.scheduleUnloadingStartedAt || row?.scheduleUnloadingStartedAt || "",
        ),
        scheduleUnloadingCompletedAt: String(
          current.scheduleUnloadingCompletedAt || row?.scheduleUnloadingCompletedAt || "",
        ) });
      state.seen.set(key, now());
    }
  }

  function result(state, stale = false, sourceCode = "") {
    state.cache.sourceStale = Boolean(stale);
    state.cache.sourceCode = sourceCode || "";
    state.cache.retryAt = state.cooldownUntil > now()
      ? new Date(state.cooldownUntil).toISOString()
      : "";
    state.cache.ambiguousKeys = new Set(state.ambiguousKeys);
    return state.cache;
  }

  function missingActive(state, rows) {
    let count = 0;
    for (const row of rows) {
      const key = cacheKey(row);
      if (key && !state.cache.has(key)) count += 1;
    }
    return count;
  }

  function nextBackground(state, days) {
    for (const day of [...new Set(days)]) {
      const pages = Math.min(20, Math.max(1, Number(state.pageCounts.get(day) || 1)));
      if (pages <= 1) continue;
      let page = Math.max(2, Number(state.pageCursor.get(day) || 2));
      if (page > pages) page = 2;
      state.pageCursor.set(day, page >= pages ? 2 : page + 1);
      return { day, page };
    }
    return null;
  }

  function nextP2Page(state, days) {
    const day = [...new Set(days)].find(Boolean);
    if (!day) return null;
    const pages = Math.min(20, Math.max(1, Number(state.p2PageCounts.get(day) || 1)));
    let page = Math.max(1, Number(state.p2PageCursor.get(day) || 1));
    if (page > pages) page = 1;
    state.p2PageCursor.set(day, page >= pages ? 1 : page + 1);
    return { day, page };
  }

  function rateCooldown(strikes) {
    const base = Math.min(
      BUS_TIME_RATE_LIMIT_MAX_COOLDOWN_MS,
      BUS_TIME_RATE_LIMIT_BASE_COOLDOWN_MS * (2 ** Math.max(0, Number(strikes || 1) - 1)),
    );
    return Math.min(
      BUS_TIME_RATE_LIMIT_MAX_COOLDOWN_MS,
      base + Math.floor(base * 0.2 * random()),
    );
  }

  function applyRateLimit(state, error) {
    state.rateLimitStrikes = Math.min(8, Number(state.rateLimitStrikes || 0) + 1);
    const wait = Number(error?.retryAfterMs) > 0
      ? Number(error.retryAfterMs)
      : rateCooldown(state.rateLimitStrikes);
    state.cooldownUntil = now() + Math.max(BUS_TIME_RATE_LIMIT_BASE_COOLDOWN_MS, wait);
    state.cooldownCode = "BUS_TIME_RATE_LIMIT";
    state.busRateLimitCount += 1;
    state.busLastError = "BUS_TIME_RATE_LIMIT";
    state.busLastErrorAt = isoNow();
  }

  function applySessionExpiry(state) {
    state.cooldownUntil = now() + BUS_TIME_SESSION_COOLDOWN_MS;
    state.cooldownCode = "BUS_TIME_SESSION_EXPIRED";
    state.busLastError = "BUS_TIME_SESSION_EXPIRED";
    state.busLastErrorAt = isoNow();
  }

  async function persistSuccess(env, hub, state) {
    const at = now();
    const recovering = Boolean(
      state.lastPersistedError ||
      state.rateLeasePresent ||
      state.cooldownCode,
    );
    if (!recovering && at - state.lastHeartbeatAt < connectionHeartbeatMs)
      return true;
    state.lastHeartbeatAt = at;
    const result = await safeStatusWrite(
      markSuccess(env, "ms_bus_connections", hub),
      "ms_bus_success_write_error",
      hub,
    );
    if (result !== null) state.lastPersistedError = "";
    return result !== null;
  }

  async function persistError(env, hub, state, error) {
    const at = now();
    const message = String(error?.message || "BusTime source error");
    if (
      message === state.lastPersistedError &&
      at - state.lastErrorWriteAt < connectionHeartbeatMs
    ) return;
    state.lastPersistedError = message;
    state.lastErrorWriteAt = at;
    await safeStatusWrite(
      markError(env, "ms_bus_connections", hub, message),
      "ms_bus_error_write_error",
      hub,
    );
  }

  async function readPage(credential, page, day, { fleetStatus = BUS_TIME_ACTIVE_FLEET_STATUS } = {}) {
    const url = new URL("https://fbi-common.flashexpress.com/api/fleet_time/getList");
    for (const key of ["auth", "lang", "fbid", "time", "_from"])
      if (credential?.[key]) url.searchParams.set(key, credential[key]);
    const filters = {
      startDate: day, endDate: day, lineMode: "", lineArea: "", lineType: "",
      proofId: "", fleetStatus, transportModeCategory: "",
      transportDetailCategory: "", driverType: "", attendanceType: "",
      attendanceStatus: "", storeId: "", originId: "", targetId: "",
      plateNum: "", belongCcd: "", lineSort: "", lineName: "",
      page: String(page), pageSize: "100",
    };
    for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);
    const response = await fetchFn(url, { headers: {
      Accept: "application/json, text/plain, */*",
      Referer: "https://fbi.flashexpress.com/fbi-ui/",
      "User-Agent": "Mozilla/5.0",
      "BI-PLATFORM": "pc",
    }});
    if (!response.ok) {
      const message = `ข้อมูลตารางเวลาตอบกลับ ${response.status}`;
      const failure = classifyFailure(message, response.status);
      throw sourceError(
        message,
        failure.code === "BUS_TIME_RATE_LIMIT" ? failure.code : "BUS_TIME_HTTP_ERROR",
        failure.code === "BUS_TIME_RATE_LIMIT" ? failure.status : 502,
        failure.code === "BUS_TIME_RATE_LIMIT"
          ? parseBusRetryAfter(response.headers?.get?.("Retry-After"), now())
          : 0,
      );
    }
    const json = await response.json();
    if (Number(json.code) !== 1) {
      const message = json.msg || json.message || "การจัดการตารางเวลาตอบกลับผิดพลาด";
      const failure = classifyFailure(message);
      throw sourceError(message, failure.code, failure.status);
    }
    return {
      items: Array.isArray(json.data?.dataList) ? json.data.dataList : [],
      total: Number(json.data?.total) || 0,
    };
  }

  async function runP3Cycle(
    env,
    hub,
    state,
    credential,
    cycleCalls,
    excludedKeys,
  ) {
    if (!p3Enabled || cycleCalls >= BUS_TIME_MAX_CALLS_PER_CYCLE)
      return { cycleCalls, sourceSucceeded: false, accepted: 0, attempted: [] };
    let checkpoint = await loadP3Checkpoint(env, hub, state);
    state.busP3CooldownUntil = checkpoint.nextEligibleAt || "";
    state.busP3CooldownCode = checkpoint.cooldownCode || "";
    if (!p3Eligible(checkpoint)) {
      state.busP3Deferred = true;
      state.busP3DeferredReason = "COOLDOWN";
      return { cycleCalls, sourceSucceeded: false, accepted: 0, attempted: [] };
    }
    if (checkpoint.exhausted) {
      checkpoint = {
        ...checkpoint,
        cursorDay: "",
        cursorRowid: 0,
        cursorRouteId: "",
        providerDay: "",
        providerPage: 1,
        providerPages: 1,
        exhausted: false,
      };
    }

    let claim;
    try {
      claim = await acquireP3Claim(env, hub, checkpoint);
    } catch (error) {
      state.busP3Deferred = true;
      state.busP3DeferredReason = "CLAIM_ERROR";
      state.busP3CooldownCode = "P3_TRANSIENT_FAILURE";
      state.busP3CooldownUntil = new Date(
        now() + BUS_TIME_P3_TRANSIENT_COOLDOWN_MS,
      ).toISOString();
      logger.warn?.(JSON.stringify({
        event: "bus_time_p3_claim_error",
        hub,
        message: error?.message || String(error),
      }));
      return { cycleCalls, sourceSucceeded: false, accepted: 0, attempted: [] };
    }
    if (!claim.acquired) {
      state.busP3Deferred = true;
      state.busP3DeferredReason = "SHARED_FLIGHT";
      return { cycleCalls, sourceSucceeded: false, accepted: 0, attempted: [] };
    }

    let rows;
    try {
      rows = await readP3Candidates(env, hub, checkpoint);
    } catch (error) {
      const next = {
        ...checkpoint,
        nextEligibleAt: new Date(now() + BUS_TIME_P3_TRANSIENT_COOLDOWN_MS).toISOString(),
        cooldownCode: "P3_TRANSIENT_FAILURE",
      };
      state.p3Checkpoint = next;
      state.busP3Deferred = true;
      state.busP3DeferredReason = "QUERY_ERROR";
      state.busP3CooldownUntil = next.nextEligibleAt;
      state.busP3CooldownCode = next.cooldownCode;
      await finishP3Claim(env, hub, claim, next);
      logger.warn?.(JSON.stringify({
        event: "bus_time_p3_query_error",
        hub,
        message: error?.message || String(error),
      }));
      return { cycleCalls, sourceSucceeded: false, accepted: 0, attempted: [] };
    }

    const plan = planMsP3Backfill(rows, {
      hub,
      cache: state.cache,
      excludedKeys,
      limit: BUS_TIME_P3_MAX_ROWS_PER_CYCLE,
    });
    state.busP3Pending = plan.pending;
    state.busP3Rows = plan.selected.length;
    if (!rows.length || !plan.selected.length) {
      const next = {
        ...checkpoint,
        pending: plan.pending,
        cursorDay: plan.batchEnd?.businessDay || checkpoint.cursorDay,
        cursorRowid: plan.batchEnd?.cursorRowid || checkpoint.cursorRowid,
        cursorRouteId: plan.batchEnd?.routeId || checkpoint.cursorRouteId,
        providerDay: "",
        providerPage: 1,
        providerPages: 1,
        exhausted: !rows.length,
        nextEligibleAt: new Date(now() + BUS_TIME_P3_NO_MATCH_COOLDOWN_MS).toISOString(),
        cooldownCode: "P3_NO_MATCH",
      };
      state.p3Checkpoint = next;
      state.busP3CooldownUntil = next.nextEligibleAt;
      state.busP3CooldownCode = next.cooldownCode;
      await finishP3Claim(env, hub, claim, next);
      return { cycleCalls, sourceSucceeded: false, accepted: 0, attempted: [] };
    }

    const providerDay = checkpoint.providerDay || plan.selectedDay;
    const providerPage = checkpoint.providerDay === providerDay
      ? checkpoint.providerPage
      : 1;
    const attempted = plan.selected.filter((item) => item.businessDay === providerDay);
    try {
      const acceptedAt = isoNow();
      const cachedAttempted = attempted.filter((item) =>
        validIso(state.cache.get(item.key)?.scheduleTbrArrivalAt));
      let cachedPersisted = 0;
      if (cachedAttempted.length) {
        const fetchedAt = state.busLastSuccessAt || acceptedAt;
        applyEvidence(state, cachedAttempted, {
          sourceEvaluated: true,
          observedAt: fetchedAt,
          fetchedAt,
          acceptedAt,
          boundary: "P3_BACKFILL_ACCEPTED_AT",
          enrichmentOrigin: "P3",
          backfill: true,
          priority: "P3",
        });
        cachedPersisted = await persistP3Evidence(
          env,
          hub,
          cachedAttempted.map((item) => ({
            ...item,
            cached: state.cache.get(item.key) || {},
          })),
          acceptedAt,
        );
        state.busP3Accepted += cachedPersisted;
      }
      const providerAttempted = attempted.filter((item) =>
        !validIso(state.cache.get(item.key)?.scheduleTbrArrivalAt));
      if (!providerAttempted.length) {
        const next = {
          ...checkpoint,
          pending: plan.pending,
          cursorDay: plan.batchEnd?.businessDay || checkpoint.cursorDay,
          cursorRowid: plan.batchEnd?.cursorRowid || checkpoint.cursorRowid,
          cursorRouteId: plan.batchEnd?.routeId || checkpoint.cursorRouteId,
          providerDay: "",
          providerPage: 1,
          providerPages: 1,
          attempted: checkpoint.attempted + attempted.length,
          accepted: checkpoint.accepted + cachedPersisted,
          exhausted: false,
          nextEligibleAt: new Date(
            now() + BUS_TIME_P3_PROGRESS_COOLDOWN_MS,
          ).toISOString(),
          cooldownCode: "P3_PROGRESS",
        };
        state.p3Checkpoint = next;
        state.busP3CooldownUntil = next.nextEligibleAt;
        state.busP3CooldownCode = next.cooldownCode;
        await finishP3Claim(env, hub, claim, next);
        return {
          cycleCalls,
          sourceSucceeded: false,
          accepted: cachedPersisted,
          attempted,
        };
      }
      recordCall(state, "background");
      state.busP3Calls += 1;
      cycleCalls += 1;
      const page = await readPage(credential, providerPage, providerDay, {
        fleetStatus: "",
      });
      mergeItems(state, page.items, hub);
      const fetchedAt = isoNow();
      applyEvidence(state, providerAttempted, {
        sourceEvaluated: true,
        observedAt: fetchedAt,
        fetchedAt,
        acceptedAt: fetchedAt,
        boundary: "P3_BACKFILL_ACCEPTED_AT",
        enrichmentOrigin: "P3",
        backfill: true,
        priority: "P3",
      });
      const accepted = providerAttempted
        .map((item) => ({ ...item, cached: state.cache.get(item.key) || {} }))
        .filter((item) => validIso(item.cached.scheduleTbrArrivalAt));
      const providerPersisted = await persistP3Evidence(env, hub, accepted, fetchedAt);
      const persisted = cachedPersisted + providerPersisted;
      state.busP3Accepted += providerPersisted;
      const providerPages = Math.min(
        20,
        Math.max(1, Math.ceil((page.total || page.items.length) / 100)),
      );
      const hasMorePages = providerPage < providerPages;
      const cooldownMs = persisted > 0
        ? BUS_TIME_P3_PROGRESS_COOLDOWN_MS
        : BUS_TIME_P3_NO_MATCH_COOLDOWN_MS;
      const next = {
        ...checkpoint,
        pending: plan.pending,
        cursorDay: hasMorePages
          ? checkpoint.cursorDay
          : plan.batchEnd?.businessDay || checkpoint.cursorDay,
        cursorRowid: hasMorePages
          ? checkpoint.cursorRowid
          : plan.batchEnd?.cursorRowid || checkpoint.cursorRowid,
        cursorRouteId: hasMorePages
          ? checkpoint.cursorRouteId
          : plan.batchEnd?.routeId || checkpoint.cursorRouteId,
        providerDay: hasMorePages ? providerDay : "",
        providerPage: hasMorePages ? providerPage + 1 : 1,
        providerPages,
        attempted: checkpoint.attempted + attempted.length,
        accepted: checkpoint.accepted + persisted,
        exhausted: false,
        nextEligibleAt: new Date(now() + cooldownMs).toISOString(),
        cooldownCode: persisted > 0 ? "P3_PROGRESS" : "P3_NO_MATCH",
      };
      state.p3Checkpoint = next;
      state.busP3CooldownUntil = next.nextEligibleAt;
      state.busP3CooldownCode = next.cooldownCode;
      await finishP3Claim(env, hub, claim, next);
      return {
        cycleCalls,
        sourceSucceeded: true,
        accepted: persisted,
        attempted,
      };
    } catch (error) {
      const isRateLimit = error?.code === "BUS_TIME_RATE_LIMIT";
      const isUnavailable = error?.code === "BUS_TIME_SESSION_EXPIRED";
      const cooldownMs = isRateLimit
        ? Math.max(BUS_TIME_RATE_LIMIT_BASE_COOLDOWN_MS, Number(error?.retryAfterMs) || 0)
        : isUnavailable
          ? BUS_TIME_SESSION_COOLDOWN_MS
          : BUS_TIME_P3_TRANSIENT_COOLDOWN_MS;
      const next = {
        ...checkpoint,
        nextEligibleAt: new Date(now() + cooldownMs).toISOString(),
        cooldownCode: isRateLimit
          ? "P3_RATE_LIMIT"
          : isUnavailable
            ? "P3_SOURCE_UNAVAILABLE"
            : "P3_TRANSIENT_FAILURE",
      };
      state.p3Checkpoint = next;
      state.busP3CooldownUntil = next.nextEligibleAt;
      state.busP3CooldownCode = next.cooldownCode;
      await finishP3Claim(env, hub, claim, next);
      error.p3Attempted = attempted;
      error.p3CycleCalls = cycleCalls;
      throw error;
    }
  }

  async function readBusTimeData(env, hub, wantedDays = liveSourceDays(), routeRows = []) {
    const key = String(hub || "").trim().toUpperCase();
    const state = stateFor(key);
    const routeHintsProvided = Array.isArray(routeRows) && routeRows.length > 0;
    state.busPagesLastCycle = 0;
    state.busP3Pending = state.p3Checkpoint?.pending ?? null;
    state.busP3Rows = 0;
    state.busP3Deferred = false;
    state.busP3DeferredReason = "";
    state.busBudgetExhausted = false;

    if (active.has(key)) {
      state.busCacheHits += 1;
      state.busDeduplicatedReaders += 1;
      return active.get(key);
    }

    const task = (async () => {
      const acceptedRows = await seedAccepted(env, key, state);
      const candidates = routeHintsProvided
        ? routeRows
        : acceptedRows;
      const plan = planMsTbrEnrichment(candidates, {
        nowMs: now(),
        cache: state.cache,
        limit: 100,
        p2Limit: BUS_TIME_P2_MAX_ROWS_PER_CYCLE,
        p2Offset: state.p2Offset,
      });
      state.ambiguousKeys = new Set(plan.ambiguousKeys);
      state.p2Offset = plan.nextP2Offset;
      const p1Rows = plan.p1.map((item) => item.row);
      const p2Rows = plan.p2.map((item) => item.row);
      state.busActiveRows = p1Rows.length;
      state.busP1Rows = p1Rows.length;
      state.busP1Unresolved = plan.p1Unresolved;
      state.busP2Rows = p2Rows.length;
      state.busP2Unresolved = plan.p2Unresolved;
      prune(state, candidates);
      state.cycleSchedule = new Map();
      applyEvidence(state, candidates);

      const activeKeys = new Set(plan.p1.map((item) => item.key));
      const newlyActive = [...activeKeys].some(
        (activeKey) => !state.previousActiveKeys.has(activeKey),
      );
      const activeByKey = new Map(plan.p1.map((item) => [item.key, item.row]));
      let missingKeys = [...activeKeys].filter((activeKey) =>
        !isMsBusEvidenceComplete({
          ...(activeByKey.get(activeKey) || {}),
          ...(state.cache.get(activeKey) || {}),
        }),
      );
      state.previousActiveKeys = activeKeys;

      const at = now();
      const p3Checkpoint = await loadP3Checkpoint(env, key, state);
      state.busP3CooldownUntil = p3Checkpoint.nextEligibleAt || "";
      state.busP3CooldownCode = p3Checkpoint.cooldownCode || "";
      state.busP3Pending = p3Checkpoint.pending ?? null;
      const p3Due = p3Enabled && p3Eligible(p3Checkpoint);
      if (state.cooldownUntil > at) {
        applyEvidence(state, plan.selected, {
          sourceUnavailable: true,
          sourceCode: state.cooldownCode || "BUS_TIME_RATE_LIMIT",
        });
        state.busCacheHits += 1;
        state.busP3Deferred = p3Due;
        state.busP3DeferredReason = p3Due ? "PROVIDER_COOLDOWN" : "";
        return result(state, true, state.cooldownCode || "BUS_TIME_RATE_LIMIT");
      }

      const hotDue =
        p1Rows.length > 0 &&
        (!state.lastHotAt || at - state.lastHotAt >= BUS_TIME_HOT_REUSE_MS);
      const backgroundDueBefore =
        missingKeys.length > 0 &&
        (newlyActive || at - state.lastBackgroundAt >= BUS_TIME_BACKGROUND_INTERVAL_MS);
      const p2Due =
        p2Rows.length > 0 &&
        (!state.lastP2At || at - state.lastP2At >= BUS_TIME_BACKGROUND_INTERVAL_MS);

      if (!hotDue && !backgroundDueBefore && !p2Due && !p3Due) {
        if (missingKeys.length > 0) state.busCacheMisses += missingKeys.length;
        else state.busCacheHits += 1;
        return result(state);
      }

      const credential = await credentials(env, key, state);
      if (!credential) {
        state.busLastError = "BUS_TIME_NOT_CONFIGURED";
        state.busLastErrorAt = isoNow();
        applyEvidence(state, plan.selected, {
          sourceUnavailable: true,
          sourceCode: "BUS_TIME_NOT_CONFIGURED",
        });
        state.busP3Deferred = p3Due;
        state.busP3DeferredReason = p3Due ? "SOURCE_UNAVAILABLE" : "";
        return result(state, state.cache.size > 0, "BUS_TIME_NOT_CONFIGURED");
      }

      const afterCredentialAt = now();
      if (state.cooldownUntil > afterCredentialAt) {
        applyEvidence(state, plan.selected, {
          sourceUnavailable: true,
          sourceCode: state.cooldownCode || "BUS_TIME_RATE_LIMIT",
        });
        state.busCacheHits += 1;
        state.busP3Deferred = p3Due;
        state.busP3DeferredReason = p3Due ? "PROVIDER_COOLDOWN" : "";
        return result(state, true, state.cooldownCode || "BUS_TIME_RATE_LIMIT");
      }
      const recoveringFromRateLimit =
        state.cooldownCode === "BUS_TIME_RATE_LIMIT" &&
        state.cooldownUntil > 0 &&
        state.cooldownUntil <= afterCredentialAt;
      const p1Days = hotDays(wantedDays, p1Rows);
      const p2Days = hotDays(wantedDays, p2Rows);
      let cycleCalls = 0;
      let sourceSucceeded = false;
      let p1Succeeded = false;
      let p2Succeeded = false;

      const failCycle = async (error, event, affected) => {
        state.busLastError = error?.code || "BUS_TIME_SOURCE_ERROR";
        state.busLastErrorAt = isoNow();
        if (error?.code === "BUS_TIME_RATE_LIMIT") {
          applyRateLimit(state, error);
          await persistRateLimitLease(env, key, state);
        } else if (error?.code === "BUS_TIME_SESSION_EXPIRED") applySessionExpiry(state);
        await persistError(env, key, state, error);
        applyEvidence(state, affected, {
          sourceUnavailable: true,
          sourceCode: error?.code || "BUS_TIME_SOURCE_ERROR",
        });
        logger.warn?.(JSON.stringify({
          event,
          hub: key,
          code: error?.code || "BUS_TIME_SOURCE_ERROR",
          message: error?.message || String(error),
        }));
      };

      if (hotDue) {
        for (const day of p1Days) {
          if (cycleCalls >= BUS_TIME_MAX_CALLS_PER_CYCLE) break;
          try {
            recordCall(state, "hot");
            state.busP1Calls += 1;
            cycleCalls += 1;
            const first = await readPage(credential, 1, day);
            state.pageCounts.set(
              day,
              Math.min(20, Math.max(1, Math.ceil((first.total || first.items.length) / 100))),
            );
            mergeItems(state, first.items, key);
            sourceSucceeded = true;
            p1Succeeded = true;
          } catch (error) {
            await failCycle(error, "bus_time_hot_lane_error", plan.p1);
            return result(state, true, error?.code || "BUS_TIME_SOURCE_ERROR");
          }
        }
        state.lastHotAt = now();
      }

      missingKeys = [...activeKeys].filter((activeKey) =>
        !isMsBusEvidenceComplete({
          ...(activeByKey.get(activeKey) || {}),
          ...(state.cache.get(activeKey) || {}),
        }),
      );
      const missing = missingKeys.length;
      if (missing > 0) state.busCacheMisses += missing;
      else state.busCacheHits += 1;

      const backgroundDue =
        !recoveringFromRateLimit &&
        missing > 0 &&
        (newlyActive || now() - state.lastBackgroundAt >= BUS_TIME_BACKGROUND_INTERVAL_MS);
      let backgroundCalls = 0;
      if (
        backgroundDue &&
        cycleCalls <
          BUS_TIME_MAX_CALLS_PER_CYCLE -
            (p2Due ? BUS_TIME_P2_MAX_CALLS_PER_CYCLE : 0) &&
        backgroundCalls < BUS_TIME_MAX_BACKGROUND_CALLS_PER_CYCLE
      ) {
        const background = nextBackground(
          state,
          [...p1Days, ...(Array.isArray(wantedDays) ? wantedDays : liveSourceDays())],
        );
        if (background) {
          try {
            recordCall(state, "background");
            state.busP1Calls += 1;
            cycleCalls += 1;
            backgroundCalls += 1;
            const page = await readPage(credential, background.page, background.day);
            mergeItems(state, page.items, key);
            state.lastBackgroundAt = now();
            sourceSucceeded = true;
            p1Succeeded = true;
          } catch (error) {
            await failCycle(error, "bus_time_background_error", plan.p1);
            return result(state, true, error?.code || "BUS_TIME_SOURCE_ERROR");
          }
        }
      }

      if (
        p2Due &&
        !recoveringFromRateLimit &&
        cycleCalls < BUS_TIME_MAX_CALLS_PER_CYCLE
      ) {
        const p2Page = nextP2Page(
          state,
          [...p2Days, ...(Array.isArray(wantedDays) ? wantedDays : liveSourceDays())],
        );
        if (p2Page) {
          try {
            recordCall(state, "background");
            state.busP2Calls += 1;
            cycleCalls += 1;
            const page = await readPage(credential, p2Page.page, p2Page.day, {
              fleetStatus: "",
            });
            state.p2PageCounts.set(
              p2Page.day,
              Math.min(20, Math.max(1, Math.ceil((page.total || page.items.length) / 100))),
            );
            mergeItems(state, page.items, key);
            state.lastP2At = now();
            sourceSucceeded = true;
            p2Succeeded = true;
          } catch (error) {
            await failCycle(error, "bus_time_p2_enrichment_error", plan.p2);
            return result(state, true, error?.code || "BUS_TIME_SOURCE_ERROR");
          }
        }
      }

      if (p3Due) {
        if (cycleCalls >= BUS_TIME_MAX_CALLS_PER_CYCLE) {
          state.busP3Deferred = true;
          state.busP3DeferredReason = "BUDGET_EXHAUSTED";
          state.busBudgetExhausted = true;
        } else {
          const excludedKeys = new Set(plan.selected.map((item) => item.key));
          try {
            const p3 = await runP3Cycle(
              env,
              key,
              state,
              credential,
              cycleCalls,
              excludedKeys,
            );
            cycleCalls = p3.cycleCalls;
            if (p3.sourceSucceeded) sourceSucceeded = true;
          } catch (error) {
            cycleCalls = Math.max(cycleCalls, Number(error?.p3CycleCalls) || cycleCalls);
            await failCycle(
              error,
              "bus_time_p3_enrichment_error",
              error?.p3Attempted || [],
            );
            return result(state, true, error?.code || "BUS_TIME_SOURCE_ERROR");
          }
        }
      }

      const observedAt = sourceSucceeded ? isoNow() : "";
      if (p1Succeeded)
        applyEvidence(state, plan.p1, { sourceEvaluated: true, observedAt });
      if (p2Succeeded)
        applyEvidence(state, plan.p2, { sourceEvaluated: true, observedAt });

      if (sourceSucceeded) {
        state.busLastSuccessAt = observedAt;
        state.busLastError = "";
        const persisted = await persistSuccess(env, key, state);
        if (persisted) await clearRateLimitLease(env, key, state);
        state.rateLimitStrikes = 0;
        state.cooldownUntil = 0;
        state.cooldownCode = "";
      }
      return result(state);
    })().finally(() => active.delete(key));

    active.set(key, task);
    return task;
  }

  function diagnostics(hub) {
    const state = states.get(String(hub || "").trim().toUpperCase());
    const at = now();
    if (!state) {
      return {
        mode: BUS_TIME_HOT_LANE_MARKER,
        busHotCalls: 0,
        busBackgroundCalls: 0,
        busCallsLastMinute: 0,
        busPagesLastCycle: 0,
        busCacheHits: 0,
        busCacheMisses: 0,
        busRateLimitCount: 0,
        busCooldownUntil: "",
        busCooldownCode: "",
        busNeedsLogin: false,
        busLastSuccessAt: "",
        busLastAttemptAt: "",
        busLastMeaningfulObservationAt: "",
        busLastErrorAt: "",
        busLastError: "",
        busActiveRows: 0,
        busP1Rows: 0,
        busP1Unresolved: 0,
        busP1Calls: 0,
        busP2Rows: 0,
        busP2Unresolved: 0,
        busP2Calls: 0,
        busP3Pending: null,
        busP3Rows: 0,
        busP3Calls: 0,
        busP3Accepted: 0,
        busP3Checkpoint: null,
        busP3CooldownUntil: "",
        busP3CooldownCode: "",
        busP3Deferred: false,
        busP3DeferredReason: "",
        busSharedCalls: 0,
        busDeduplicatedReaders: 0,
        busBudgetExhausted: false,
        busTotalKnownRows: 0,
        maxCallsPerCycle: BUS_TIME_MAX_CALLS_PER_CYCLE,
        maxP2CallsPerCycle: BUS_TIME_P2_MAX_CALLS_PER_CYCLE,
        maxP2RowsPerCycle: BUS_TIME_P2_MAX_ROWS_PER_CYCLE,
        maxP3CallsPerCycle: BUS_TIME_P3_MAX_CALLS_PER_CYCLE,
        maxP3RowsPerCycle: BUS_TIME_P3_MAX_ROWS_PER_CYCLE,
        p3RangeDays: BUS_TIME_P3_RANGE_DAYS,
        backgroundIntervalMs: BUS_TIME_BACKGROUND_INTERVAL_MS,
      };
    }
    state.callTimes = state.callTimes.filter((value) => at - value < 60_000);
    const cooldownActive = state.cooldownUntil > at;
    return {
      mode: BUS_TIME_HOT_LANE_MARKER,
      busHotCalls: state.busHotCalls,
      busBackgroundCalls: state.busBackgroundCalls,
      busCallsLastMinute: state.callTimes.length,
      busPagesLastCycle: state.busPagesLastCycle,
      busCacheHits: state.busCacheHits,
      busCacheMisses: state.busCacheMisses,
      busRateLimitCount: state.busRateLimitCount,
      busCooldownUntil: cooldownActive
        ? new Date(state.cooldownUntil).toISOString()
        : "",
      busCooldownCode: cooldownActive ? state.cooldownCode : "",
      busNeedsLogin: cooldownActive && state.cooldownCode === "BUS_TIME_SESSION_EXPIRED",
      busLastSuccessAt: state.busLastSuccessAt,
      busLastAttemptAt: state.busLastAttemptAt,
      busLastMeaningfulObservationAt: state.busLastMeaningfulObservationAt,
      busLastErrorAt: state.busLastErrorAt,
      busLastError: state.busLastError,
      busActiveRows: state.busActiveRows,
      busP1Rows: state.busP1Rows,
      busP1Unresolved: state.busP1Unresolved,
      busP1Calls: state.busP1Calls,
      busP2Rows: state.busP2Rows,
      busP2Unresolved: state.busP2Unresolved,
      busP2Calls: state.busP2Calls,
      busP3Pending: state.busP3Pending,
      busP3Rows: state.busP3Rows,
      busP3Calls: state.busP3Calls,
      busP3Accepted: state.busP3Accepted,
      busP3Checkpoint: state.p3Checkpoint ? { ...state.p3Checkpoint } : null,
      busP3CooldownUntil: state.busP3CooldownUntil,
      busP3CooldownCode: state.busP3CooldownCode,
      busP3Deferred: state.busP3Deferred,
      busP3DeferredReason: state.busP3DeferredReason,
      busSharedCalls: state.busSharedCalls,
      busDeduplicatedReaders: state.busDeduplicatedReaders,
      busBudgetExhausted: state.busBudgetExhausted,
      busTotalKnownRows: state.cache.size,
      maxCallsPerCycle: BUS_TIME_MAX_CALLS_PER_CYCLE,
      maxP2CallsPerCycle: BUS_TIME_P2_MAX_CALLS_PER_CYCLE,
      maxP2RowsPerCycle: BUS_TIME_P2_MAX_ROWS_PER_CYCLE,
      maxP3CallsPerCycle: BUS_TIME_P3_MAX_CALLS_PER_CYCLE,
      maxP3RowsPerCycle: BUS_TIME_P3_MAX_ROWS_PER_CYCLE,
      p3RangeDays: BUS_TIME_P3_RANGE_DAYS,
      backgroundIntervalMs: BUS_TIME_BACKGROUND_INTERVAL_MS,
    };
  }

  function resetCredentials(hub, value = null) {
    const state = stateFor(hub);
    state.credentials = value;
    state.credentialsUntil = value ? now() + BUS_TIME_CREDENTIAL_CACHE_MS : 0;
    state.cooldownUntil = 0;
    state.cooldownCode = "";
    state.rateLimitStrikes = 0;
    state.busLastError = "";
    if (value) seedHarItems(state, hub, value);
  }

  return {
    readBusTimeData,
    diagnostics,
    resetCredentials,
  };
}
