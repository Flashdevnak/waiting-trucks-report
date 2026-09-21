export const BUS_TIME_HOT_LANE_MARKER = "BUS_TIME_HOT_LANE_V14";
// BUS_TIME_CADENCE_RESTORE_V20: keep KIT/TBR on its original ~12s source cadence; Route/UI realtime remains independent at ~4s.
export const BUS_TIME_HOT_REUSE_MS = 12_000;
// BUS_TIME_ACTIVE_FILTER_V18: verified MS filterCriteria says fleetStatus=1 means unfinished.
export const BUS_TIME_ACTIVE_FLEET_STATUS = "1";
export const BUS_TIME_BACKGROUND_INTERVAL_MS = 12_000;
export const BUS_TIME_MAX_BACKGROUND_CALLS_PER_CYCLE = 1;
export const BUS_TIME_MAX_CALLS_PER_CYCLE = 3;
export const BUS_TIME_P2_MAX_ROWS_PER_CYCLE = 25;
export const BUS_TIME_P2_MAX_CALLS_PER_CYCLE = 1;
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
  acceptedAt = "",
  sourceCode = "",
  boundary = "CURRENT_SHARED_CYCLE",
} = {}) {
  const allowed = new Set(Object.values(MS_FIELD_EVIDENCE));
  const evidenceState = allowed.has(state) ? state : MS_FIELD_EVIDENCE.UNKNOWN;
  return {
    field: String(field || ""),
    state: evidenceState,
    source: String(source || ""),
    valueTimestamp: validIso(valueTimestamp),
    observedAt: validIso(observedAt),
    acceptedAt: validIso(acceptedAt),
    sourceCode: String(sourceCode || ""),
    boundary: String(boundary || "CURRENT_SHARED_CYCLE"),
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

export function deriveMsTbrProjection(row, {
  sourceEvaluated = false,
  sourceUnavailable = false,
  sourceCode = "",
  observedAt = "",
  acceptedAt = "",
  nowMs = Date.now(),
} = {}) {
  const attendance = inboundAttendance(row?.attendanceType);
  let state;
  if (attendance === "OTHER") state = MS_FIELD_EVIDENCE.NOT_APPLICABLE;
  else if (validIso(row?.scheduleTbrArrivalAt)) state = MS_FIELD_EVIDENCE.OBSERVED;
  else if (sourceUnavailable) state = MS_FIELD_EVIDENCE.SOURCE_UNAVAILABLE;
  else if (sourceEvaluated) state = MS_FIELD_EVIDENCE.MISSING_UNCONFIRMED;
  else state = MS_FIELD_EVIDENCE.UNKNOWN;
  const evidence = createMsFieldEvidence({
    field: "scheduleTbrArrivalAt",
    state,
    source: "BUS_TIME",
    valueTimestamp: row?.scheduleTbrArrivalAt,
    observedAt,
    acceptedAt,
    sourceCode,
  });
  const dataCompleteness = deriveMsDataCompleteness([evidence]);
  const lifecycle = msLifecycleClass(row, nowMs);
  const pending =
    attendance !== "OTHER" && dataCompleteness !== MS_DATA_COMPLETENESS.COMPLETE;
  return {
    fieldEvidence: { scheduleTbrArrivalAt: evidence },
    dataCompleteness,
    enrichmentState: pending ? MS_ENRICHMENT_PENDING : "",
    enrichmentPriority: pending
      ? lifecycle === "ACTIVE" ? "P1" : "P2"
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
  const unique = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const attendance = inboundAttendance(row?.attendanceType);
    const proofId = String(row?.proofId || "").trim().toUpperCase();
    if (attendance === "OTHER" || !proofId) continue;
    const attendanceValue = attendance === "DESTINATION" ? "ปลายทาง" : "จุดดรอป";
    const key = `P:${proofId}|A:${attendanceValue}`;
    const cached = cache instanceof Map ? cache.get(key) : null;
    const tbr = validIso(row?.scheduleTbrArrivalAt || cached?.scheduleTbrArrivalAt);
    if (tbr || unique.has(key)) continue;
    const normalized = { ...row, attendanceType: attendanceValue };
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
        busLastError: "",
        busActiveRows: 0,
        busP1Rows: 0,
        busP2Rows: 0,
        busP2Calls: 0,
        previousActiveKeys: new Set(),
        acceptedRouteHints: [],
        rateLeaseLoaded: false,
        rateLeasePresent: false,
      });
    }
    return states.get(key);
  }

  function recordCall(state, kind) {
    const at = now();
    state.callTimes.push(at);
    state.callTimes = state.callTimes.filter((value) => at - value < 60_000);
    if (kind === "hot") state.busHotCalls += 1;
    else state.busBackgroundCalls += 1;
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
      const cycle = state.cycleSchedule.get(key) || { start: "", end: "", ambiguous: false };
      const kit = msDate(nestedValue(item.kit_arrive_time, 0));
      const tbr = extractBusTbrAtV28(item.fleet_sign_info, msDate);
      const start = parseUnloadingStart(item.fleet_unloading_time);
      const end = parseUnloadingEnd(item.fleet_unloading_time);
      const conflictStart = Boolean(cycle.start) && Boolean(start) && cycle.start !== start;
      const conflictEnd = Boolean(cycle.end) && Boolean(end) && cycle.end !== end;
      const ambiguous = Boolean(cycle.ambiguous) || conflictStart || conflictEnd;
      const cycleStart = start || cycle.start || "";
      const cycleEnd = end || cycle.end || "";
      state.cycleSchedule.set(key, { start: cycleStart, end: cycleEnd, ambiguous });
      state.cache.set(key, {
        ...current,
        proofId: String(proofId || "").slice(0, 100),
        routeName: String(nestedValue(item.line_info, 0) || current.routeName || "").slice(0, 300),
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
      });
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
        acceptedAt,
        nowMs: now(),
      });
      state.cache.set(key, { ...current, ...projection, proofId: merged.proofId,
        scheduleTbrArrivalAt: merged.scheduleTbrArrivalAt });
      state.seen.set(key, now());
    }
  }

  function result(state, stale = false, sourceCode = "") {
    state.cache.sourceStale = Boolean(stale);
    state.cache.sourceCode = sourceCode || "";
    state.cache.retryAt = state.cooldownUntil > now()
      ? new Date(state.cooldownUntil).toISOString()
      : "";
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
  }

  function applySessionExpiry(state) {
    state.cooldownUntil = now() + BUS_TIME_SESSION_COOLDOWN_MS;
    state.cooldownCode = "BUS_TIME_SESSION_EXPIRED";
    state.busLastError = "BUS_TIME_SESSION_EXPIRED";
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

  async function readBusTimeData(env, hub, wantedDays = liveSourceDays(), routeRows = []) {
    const key = String(hub || "").trim().toUpperCase();
    const state = stateFor(key);
    const routeHintsProvided = Array.isArray(routeRows) && routeRows.length > 0;
    state.busPagesLastCycle = 0;

    if (active.has(key)) {
      state.busCacheHits += 1;
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
      state.p2Offset = plan.nextP2Offset;
      const p1Rows = plan.p1.map((item) => item.row);
      const p2Rows = plan.p2.map((item) => item.row);
      state.busActiveRows = p1Rows.length;
      state.busP1Rows = p1Rows.length;
      state.busP2Rows = p2Rows.length;
      prune(state, candidates);
      state.cycleSchedule = new Map();
      applyEvidence(state, candidates);

      const activeKeys = new Set(plan.p1.map((item) => item.key));
      const newlyActive = [...activeKeys].some(
        (activeKey) => !state.previousActiveKeys.has(activeKey),
      );
      let missingKeys = [...activeKeys].filter(
        (activeKey) => !validIso(state.cache.get(activeKey)?.scheduleTbrArrivalAt),
      );
      state.previousActiveKeys = activeKeys;

      if (!plan.selected.length) {
        state.busCacheHits += 1;
        return result(state);
      }

      const at = now();
      if (state.cooldownUntil > at) {
        applyEvidence(state, plan.selected, {
          sourceUnavailable: true,
          sourceCode: state.cooldownCode || "BUS_TIME_RATE_LIMIT",
        });
        state.busCacheHits += 1;
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

      if (!hotDue && !backgroundDueBefore && !p2Due) {
        if (missingKeys.length > 0) state.busCacheMisses += missingKeys.length;
        else state.busCacheHits += 1;
        return result(state);
      }

      const credential = await credentials(env, key, state);
      if (!credential) {
        state.busLastError = "BUS_TIME_NOT_CONFIGURED";
        applyEvidence(state, plan.selected, {
          sourceUnavailable: true,
          sourceCode: "BUS_TIME_NOT_CONFIGURED",
        });
        return result(state, state.cache.size > 0, "BUS_TIME_NOT_CONFIGURED");
      }

      const afterCredentialAt = now();
      if (state.cooldownUntil > afterCredentialAt) {
        applyEvidence(state, plan.selected, {
          sourceUnavailable: true,
          sourceCode: state.cooldownCode || "BUS_TIME_RATE_LIMIT",
        });
        state.busCacheHits += 1;
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

      missingKeys = [...activeKeys].filter(
        (activeKey) => !validIso(state.cache.get(activeKey)?.scheduleTbrArrivalAt),
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
        busLastError: "",
        busActiveRows: 0,
        busP1Rows: 0,
        busP2Rows: 0,
        busP2Calls: 0,
        busTotalKnownRows: 0,
        maxCallsPerCycle: BUS_TIME_MAX_CALLS_PER_CYCLE,
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
      busLastError: state.busLastError,
      busActiveRows: state.busActiveRows,
      busP1Rows: state.busP1Rows,
      busP2Rows: state.busP2Rows,
      busP2Calls: state.busP2Calls,
      busTotalKnownRows: state.cache.size,
      maxCallsPerCycle: BUS_TIME_MAX_CALLS_PER_CYCLE,
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
