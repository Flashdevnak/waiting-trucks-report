export const BUS_TIME_HOT_LANE_MARKER = "BUS_TIME_HOT_LANE_V14";
export const BUS_TIME_HOT_REUSE_MS = 3000;
export const BUS_TIME_BACKGROUND_INTERVAL_MS = 12_000;
export const BUS_TIME_MAX_BACKGROUND_CALLS_PER_CYCLE = 1;
export const BUS_TIME_MAX_CALLS_PER_CYCLE = 3;
export const BUS_TIME_CACHE_RETENTION_MS = 36 * 60 * 60 * 1000;
export const BUS_TIME_CREDENTIAL_CACHE_MS = 10 * 60 * 1000;
export const BUS_TIME_RATE_LIMIT_BASE_COOLDOWN_MS = 8_000;
export const BUS_TIME_RATE_LIMIT_MAX_COOLDOWN_MS = 5 * 60 * 1000;

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
        cycleSchedule: new Map(),
        credentials: null,
        credentialsUntil: 0,
        seeded: false,
        lastHotAt: 0,
        lastBackgroundAt: 0,
        lastHeartbeatAt: 0,
        lastErrorWriteAt: 0,
        lastPersistedError: "",
        cooldownUntil: 0,
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
        previousActiveKeys: new Set(),
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
      if (!normalizeProofId(row?.proofId) || Number(row?.unloadingState) === 2)
        return false;
      const attendance = String(normalizeAttendance(row?.attendanceType) || "")
        .trim()
        .toLowerCase();
      return (
        attendance === "ปลายทาง" ||
        attendance === "จุดดรอป" ||
        attendance === "destination" ||
        attendance === "drop" ||
        attendance === "drop point"
      );
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
    if (state.seeded) return;
    state.seeded = true;
    try {
      const row = await env.DB.prepare(
        "SELECT rows_json FROM ms_live_cache WHERE hub=?",
      ).bind(hub).first();
      if (!row?.rows_json) return;
      const parsed = JSON.parse(row.rows_json);
      const rows = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.rows)
          ? parsed.rows
          : [];
      const at = now();
      for (const item of rows) {
        const seeded = seedCandidate(item);
        if (!seeded) continue;
        state.cache.set(seeded.key, seeded.value);
        state.seen.set(seeded.key, at);
      }
    } catch (error) {
      logger.warn?.(JSON.stringify({
        event: "bus_time_seed_cache_error",
        hub,
        message: error?.message || String(error),
      }));
    }
  }

  async function credentials(env, hub, state) {
    const at = now();
    if (state.credentialsUntil > at) return state.credentials;
    const row = await env.DB.prepare(
      "SELECT credentials_cipher FROM ms_bus_connections WHERE hub=?",
    ).bind(hub).first();
    if (!row?.credentials_cipher) {
      state.credentials = null;
      state.credentialsUntil = at + BUS_TIME_CREDENTIAL_CACHE_MS;
      return null;
    }
    state.credentials = JSON.parse(await decryptMs(row.credentials_cipher, env));
    state.credentialsUntil = at + BUS_TIME_CREDENTIAL_CACHE_MS;
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
      const tbr = msDate(nestedValue(item.fleet_sign_info, 0));
      const start = parseUnloadingStart(item.fleet_unloading_time);
      const end = parseUnloadingEnd(item.fleet_unloading_time);
      const conflictStart = Boolean(cycle.start) && Boolean(start) && cycle.start !== start;
      const conflictEnd = Boolean(cycle.end) && Boolean(end) && cycle.end !== end;
      const ambiguous = Boolean(cycle.ambiguous) || conflictStart || conflictEnd;
      const cycleStart = start || cycle.start || "";
      const cycleEnd = end || cycle.end || "";
      state.cycleSchedule.set(key, { start: cycleStart, end: cycleEnd, ambiguous });
      state.cache.set(key, {
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
    state.busRateLimitCount += 1;
    state.busLastError = "BUS_TIME_RATE_LIMIT";
  }

  async function persistSuccess(env, hub, state) {
    const at = now();
    if (at - state.lastHeartbeatAt < connectionHeartbeatMs) return;
    state.lastHeartbeatAt = at;
    await safeStatusWrite(
      markSuccess(env, "ms_bus_connections", hub),
      "ms_bus_success_write_error",
      hub,
    );
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

  async function readPage(credential, page, day) {
    const url = new URL("https://fbi-common.flashexpress.com/api/fleet_time/getList");
    for (const key of ["auth", "lang", "fbid", "time", "_from"])
      if (credential?.[key]) url.searchParams.set(key, credential[key]);
    const filters = {
      startDate: day, endDate: day, lineMode: "", lineArea: "", lineType: "",
      proofId: "", fleetStatus: "", transportModeCategory: "",
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
    const at = now();
    const routes = activeRows(routeRows);
    state.busActiveRows = routes.length;
    state.busPagesLastCycle = 0;

    if (state.cooldownUntil > at) {
      state.busCacheHits += 1;
      return result(state, true, "BUS_TIME_RATE_LIMIT");
    }
    if (state.lastHotAt && at - state.lastHotAt < BUS_TIME_HOT_REUSE_MS) {
      state.busCacheHits += 1;
      return result(state);
    }
    if (active.has(key)) {
      state.busCacheHits += 1;
      return active.get(key);
    }

    const task = (async () => {
      await seedAccepted(env, key, state);
      prune(state, routes);
      state.cycleSchedule = new Map();
      const credential = await credentials(env, key, state);
      if (!credential) {
        state.busLastError = "BUS_TIME_NOT_CONFIGURED";
        return result(state, state.cache.size > 0, "BUS_TIME_NOT_CONFIGURED");
      }

      const days = hotDays(wantedDays, routes);
      let cycleCalls = 0;
      let hotSucceeded = false;

      for (const day of days) {
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
          hotSucceeded = true;
        } catch (error) {
          state.busLastError = error?.code || "BUS_TIME_SOURCE_ERROR";
          if (error?.code === "BUS_TIME_RATE_LIMIT") applyRateLimit(state, error);
          await persistError(env, key, state, error);
          logger.warn?.(JSON.stringify({
            event: "bus_time_hot_lane_error",
            hub: key,
            code: error?.code || "BUS_TIME_SOURCE_ERROR",
            message: error?.message || String(error),
          }));
          return result(state, true, error?.code || "BUS_TIME_SOURCE_ERROR");
        }
      }

      state.lastHotAt = now();
      if (hotSucceeded) {
        state.busLastSuccessAt = isoNow();
        state.busLastError = "";
        state.rateLimitStrikes = 0;
        state.cooldownUntil = 0;
        await persistSuccess(env, key, state);
      }

      const activeKeys = new Set(routes.map(cacheKey).filter(Boolean));
      const missingKeys = [...activeKeys].filter((key) => !state.cache.has(key));
      const newlyMissing = missingKeys.some(
        (key) => !state.previousActiveKeys.has(key),
      );
      state.previousActiveKeys = activeKeys;
      const missing = missingKeys.length;
      if (missing > 0) state.busCacheMisses += missing;
      else state.busCacheHits += 1;

      const backgroundDue =
        newlyMissing ||
        now() - state.lastBackgroundAt >= BUS_TIME_BACKGROUND_INTERVAL_MS;
      let backgroundCalls = 0;
      if (
        backgroundDue &&
        cycleCalls < BUS_TIME_MAX_CALLS_PER_CYCLE &&
        backgroundCalls < BUS_TIME_MAX_BACKGROUND_CALLS_PER_CYCLE
      ) {
        const background = nextBackground(
          state,
          [...days, ...(Array.isArray(wantedDays) ? wantedDays : liveSourceDays())],
        );
        if (background) {
          try {
            recordCall(state, "background");
            cycleCalls += 1;
            backgroundCalls += 1;
            const page = await readPage(credential, background.page, background.day);
            mergeItems(state, page.items, key);
            state.lastBackgroundAt = now();
          } catch (error) {
            state.busLastError = error?.code || "BUS_TIME_SOURCE_ERROR";
            if (error?.code === "BUS_TIME_RATE_LIMIT") applyRateLimit(state, error);
            await persistError(env, key, state, error);
            logger.warn?.(JSON.stringify({
              event: "bus_time_background_error",
              hub: key,
              code: error?.code || "BUS_TIME_SOURCE_ERROR",
              message: error?.message || String(error),
            }));
            return result(state, true, error?.code || "BUS_TIME_SOURCE_ERROR");
          }
        }
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
        busLastSuccessAt: "",
        busLastError: "",
        busActiveRows: 0,
        busTotalKnownRows: 0,
        maxCallsPerCycle: BUS_TIME_MAX_CALLS_PER_CYCLE,
        backgroundIntervalMs: BUS_TIME_BACKGROUND_INTERVAL_MS,
      };
    }
    state.callTimes = state.callTimes.filter((value) => at - value < 60_000);
    return {
      mode: BUS_TIME_HOT_LANE_MARKER,
      busHotCalls: state.busHotCalls,
      busBackgroundCalls: state.busBackgroundCalls,
      busCallsLastMinute: state.callTimes.length,
      busPagesLastCycle: state.busPagesLastCycle,
      busCacheHits: state.busCacheHits,
      busCacheMisses: state.busCacheMisses,
      busRateLimitCount: state.busRateLimitCount,
      busCooldownUntil: state.cooldownUntil > at
        ? new Date(state.cooldownUntil).toISOString()
        : "",
      busLastSuccessAt: state.busLastSuccessAt,
      busLastError: state.busLastError,
      busActiveRows: state.busActiveRows,
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
    state.rateLimitStrikes = 0;
    state.busLastError = "";
  }

  return {
    readBusTimeData,
    diagnostics,
    resetCredentials,
  };
}
