// TBR_SHADOW_DIAGNOSTIC_ROLLUP_V1
// Pure helpers for the bounded diagnostic metadata owned and persisted by the
// existing TBR Shadow observer. This module performs no storage or provider I/O.
export const TBR_DIAGNOSTIC_ROLLUP_VERSION = 1;
export const TBR_DIAGNOSTIC_HORIZON_DAYS = 14;
export const TBR_DIAGNOSTIC_DEDUPE_LIMIT = 4096;
export const TBR_DIAGNOSTIC_LEAD_BIN_MAX = 120;
export const TBR_DIAGNOSTIC_MAX_FIXTURE_BYTES = 2 * 1024 * 1024;

const DAY_MS = 24 * 60 * 60 * 1000;
const HEALTH_GAP_STALE_MS = 45 * 60 * 1000;
const HEALTH_PRIOR_MAX_MS = 30 * 60 * 1000;
const LEAD_BIN_COUNT = TBR_DIAGNOSTIC_LEAD_BIN_MAX + 2;

const CANDIDATES = 0;
const CONFIRMED = 1;
const EXPIRED = 2;
const LEAD_COUNT = 3;
const LEAD_SUM = 4;
const LEAD_MAX = 5;
const LEAD_BINS = 6;
const HEALTH_LIVE_MS = 7;
const HEALTH_FALLBACK_MS = 8;
const HEALTH_WAITING_MS = 9;
const HEALTH_STALE_MS = 10;
const SOURCE_OUTAGES = 11;
const RECOVERIES = 12;
const FALLBACK_EVENTS = 13;

function validTime(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : null;
}

function iso(value) {
  return Number.isFinite(Number(value)) ? new Date(Number(value)).toISOString() : "";
}

export function tbrDiagnosticBangkokDay(value) {
  return new Date(Number(value) + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function bangkokDayStart(value) {
  const day = tbrDiagnosticBangkokDay(value);
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date) - 7 * 60 * 60 * 1000;
}

function nextBangkokMidnight(value) {
  return bangkokDayStart(value) + DAY_MS;
}

function emptyBins() {
  return Array.from({ length: LEAD_BIN_COUNT }, () => 0);
}

function emptyDay() {
  return [0, 0, 0, 0, 0, null, emptyBins(), 0, 0, 0, 0, 0, 0, 0];
}

function nonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function normalizeDay(value) {
  const source = Array.isArray(value) ? value : [];
  const day = emptyDay();
  for (const index of [CANDIDATES, CONFIRMED, EXPIRED, LEAD_COUNT, LEAD_SUM,
    HEALTH_LIVE_MS, HEALTH_FALLBACK_MS, HEALTH_WAITING_MS, HEALTH_STALE_MS,
    SOURCE_OUTAGES, RECOVERIES, FALLBACK_EVENTS]) day[index] = nonNegative(source[index]);
  day[LEAD_MAX] = source[LEAD_MAX] == null || !Number.isFinite(Number(source[LEAD_MAX]))
    ? null : Math.max(0, Number(source[LEAD_MAX]));
  if (Array.isArray(source[LEAD_BINS])) {
    for (let index = 0; index < LEAD_BIN_COUNT; index += 1)
      day[LEAD_BINS][index] = nonNegative(source[LEAD_BINS][index]);
  }
  return day;
}

function freshRollup(now, mode) {
  const at = iso(now);
  return {
    v: TBR_DIAGNOSTIC_ROLLUP_VERSION,
    coverageStartAt: at,
    coverageEndAt: at,
    lastHealthAt: at,
    healthMode: mode,
    integrityState: "OK",
    integrityReason: "",
    days: {},
    seen: {},
  };
}

function normalizeMode(value) {
  return ["live", "fallback", "waiting", "stale"].includes(value) ? value : "waiting";
}

function normalizeSeen(value) {
  if (!Array.isArray(value) || !/^\d{4}-\d{2}-\d{2}$/.test(String(value[0] || ""))) return null;
  const status = [0, 1, 2].includes(Number(value[1])) ? Number(value[1]) : 0;
  return [String(value[0]), status];
}

function normalizeRollup(input, now, mode) {
  if (!input || input.v !== TBR_DIAGNOSTIC_ROLLUP_VERSION) return freshRollup(now, mode);
  const result = freshRollup(now, normalizeMode(input.healthMode));
  result.coverageStartAt = validTime(input.coverageStartAt) === null ? iso(now) : iso(validTime(input.coverageStartAt));
  result.coverageEndAt = validTime(input.coverageEndAt) === null ? result.coverageStartAt : iso(validTime(input.coverageEndAt));
  result.lastHealthAt = validTime(input.lastHealthAt) === null ? result.coverageEndAt : iso(validTime(input.lastHealthAt));
  result.healthMode = normalizeMode(input.healthMode);
  result.integrityState = input.integrityState === "FAILED" ? "FAILED" : "OK";
  result.integrityReason = result.integrityState === "FAILED" ? String(input.integrityReason || "UNKNOWN").slice(0, 80) : "";
  result.days = {};
  for (const [day, value] of Object.entries(input.days || {})) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) result.days[day] = normalizeDay(value);
  }
  result.seen = {};
  const entries = Object.entries(input.seen || {});
  for (const [key, value] of entries.slice(0, TBR_DIAGNOSTIC_DEDUPE_LIMIT)) {
    const normalized = normalizeSeen(value);
    if (normalized) result.seen[String(key).slice(0, 80)] = normalized;
  }
  if (entries.length > TBR_DIAGNOSTIC_DEDUPE_LIMIT) {
    result.integrityState = "FAILED";
    result.integrityReason = "DEDUPE_CAPACITY_EXCEEDED";
  }
  return result;
}

function horizonDays(now) {
  const values = [];
  for (let offset = TBR_DIAGNOSTIC_HORIZON_DAYS - 1; offset >= 0; offset -= 1)
    values.push(tbrDiagnosticBangkokDay(now - offset * DAY_MS));
  return values;
}

function pruneHorizon(rollup, now) {
  const keep = new Set(horizonDays(now));
  for (const key of Object.keys(rollup.days)) if (!keep.has(key)) delete rollup.days[key];
  for (const [key, value] of Object.entries(rollup.seen)) if (!keep.has(value[0])) delete rollup.seen[key];
}

function dayFor(rollup, key) {
  if (!rollup.days[key]) rollup.days[key] = emptyDay();
  else rollup.days[key] = normalizeDay(rollup.days[key]);
  return rollup.days[key];
}

function markIntegrityFailure(rollup, reason) {
  rollup.integrityState = "FAILED";
  if (!rollup.integrityReason) rollup.integrityReason = String(reason || "UNKNOWN").slice(0, 80);
}

function healthIndex(mode) {
  if (mode === "live") return HEALTH_LIVE_MS;
  if (mode === "fallback") return HEALTH_FALLBACK_MS;
  if (mode === "stale") return HEALTH_STALE_MS;
  return HEALTH_WAITING_MS;
}

function allocateHealth(rollup, start, end, mode) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
  let cursor = start;
  const index = healthIndex(normalizeMode(mode));
  while (cursor < end) {
    const boundary = Math.min(end, nextBangkokMidnight(cursor));
    dayFor(rollup, tbrDiagnosticBangkokDay(cursor))[index] += boundary - cursor;
    cursor = boundary;
  }
}

function rollHealth(rollup, now, nextMode) {
  const previousAt = validTime(rollup.lastHealthAt);
  if (previousAt !== null && now > previousAt) {
    const elapsed = now - previousAt;
    if (elapsed <= HEALTH_GAP_STALE_MS) allocateHealth(rollup, previousAt, now, rollup.healthMode);
    else {
      const priorEnd = Math.min(now, previousAt + HEALTH_PRIOR_MAX_MS);
      allocateHealth(rollup, previousAt, priorEnd, rollup.healthMode);
      allocateHealth(rollup, priorEnd, now, "stale");
    }
  }
  rollup.lastHealthAt = iso(now);
  rollup.coverageEndAt = iso(now);
  rollup.healthMode = normalizeMode(nextMode);
}

function recordLead(day, value) {
  if (!Number.isFinite(Number(value))) return;
  const lead = Math.max(0, Math.round(Number(value)));
  day[LEAD_COUNT] += 1;
  day[LEAD_SUM] += lead;
  day[LEAD_MAX] = day[LEAD_MAX] == null ? lead : Math.max(day[LEAD_MAX], lead);
  day[LEAD_BINS][Math.min(LEAD_BIN_COUNT - 1, lead)] += 1;
}

function scanRecords(rollup, records, now) {
  const keep = new Set(horizonDays(now));
  let seenCount = Object.keys(rollup.seen).length;
  for (const [id, record] of Object.entries(records || {})) {
    const tbrAt = String(record?.tbrAt || "");
    const tbrMs = validTime(tbrAt);
    if (tbrMs === null) continue;
    const dayKey = tbrDiagnosticBangkokDay(tbrMs);
    if (!keep.has(dayKey)) continue;
    const fingerprint = `${String(id).slice(0, 24)}|${tbrAt}`;
    let seen = rollup.seen[fingerprint];
    const day = dayFor(rollup, dayKey);
    if (!seen) {
      if (seenCount >= TBR_DIAGNOSTIC_DEDUPE_LIMIT) {
        markIntegrityFailure(rollup, "DEDUPE_CAPACITY_EXCEEDED");
        continue;
      }
      seen = [dayKey, 0];
      rollup.seen[fingerprint] = seen;
      seenCount += 1;
      day[CANDIDATES] += 1;
    }
    const status = String(record?.status || "");
    const terminal = status === "confirmed" ? 1 : status === "expired" ? 2 : 0;
    if (!terminal || seen[1] === terminal) continue;
    if (seen[1] !== 0) {
      markIntegrityFailure(rollup, "TERMINAL_STATUS_CONFLICT");
      continue;
    }
    if (terminal === 1) {
      day[CONFIRMED] += 1;
      recordLead(day, record?.leadMinutes);
    } else day[EXPIRED] += 1;
    seen[1] = terminal;
  }
}

function recordTransitions(rollup, now, previous, current) {
  const day = dayFor(rollup, tbrDiagnosticBangkokDay(now));
  if (typeof previous.sourceAvailable === "boolean" && previous.sourceAvailable !== current.sourceAvailable) {
    if (current.sourceAvailable) day[RECOVERIES] += 1;
    else day[SOURCE_OUTAGES] += 1;
  }
  if (previous.routeFallback === false && current.routeFallback === true) day[FALLBACK_EVENTS] += 1;
}

export function tbrDiagnosticHealthMode(sourceAvailable, routeFallback) {
  if (sourceAvailable !== true) return "waiting";
  return routeFallback === true ? "fallback" : "live";
}

export function updateTbrDiagnosticRollup(input, records, options = {}) {
  const now = Number(options.now);
  if (!Number.isFinite(now)) throw new Error("TBR diagnostic rollup requires a finite clock");
  const current = {
    sourceAvailable: options.sourceAvailable === true,
    routeFallback: options.routeFallback === true,
  };
  const previous = {
    sourceAvailable: typeof options.previousSourceAvailable === "boolean" ? options.previousSourceAvailable : null,
    routeFallback: options.previousRouteFallback === true,
  };
  const mode = tbrDiagnosticHealthMode(current.sourceAvailable, current.routeFallback);
  const rollup = normalizeRollup(input, now, mode);
  pruneHorizon(rollup, now);
  rollHealth(rollup, now, mode);
  recordTransitions(rollup, now, previous, current);
  scanRecords(rollup, records, now);
  pruneHorizon(rollup, now);
  return rollup;
}

function percentile(bins, value) {
  const total = bins.reduce((sum, count) => sum + count, 0);
  if (!total) return null;
  const target = Math.max(1, Math.ceil((total * value) / 100));
  let cumulative = 0;
  for (let index = 0; index < bins.length; index += 1) {
    cumulative += bins[index];
    if (cumulative >= target) return index;
  }
  return null;
}

export function projectTbrDiagnosticRollup(input, nowValue = Date.now()) {
  const now = Number(nowValue);
  const rollup = input && input.v === TBR_DIAGNOSTIC_ROLLUP_VERSION
    ? normalizeRollup(input, now, input.healthMode)
    : null;
  const days = horizonDays(now);
  const buckets = {};
  if (rollup) {
    pruneHorizon(rollup, now);
    const lastHealthAt = validTime(rollup.lastHealthAt);
    // Projection owns no persistence or transition authority. Advance only the
    // normalized clone's health duration so the read covers its requested end.
    if (lastHealthAt !== null && now > lastHealthAt)
      rollHealth(rollup, now, rollup.healthMode);
    pruneHorizon(rollup, now);
    for (const key of days) if (rollup.days[key]) buckets[key] = normalizeDay(rollup.days[key]);
  }
  const horizonStartAt = iso(bangkokDayStart(now) - (TBR_DIAGNOSTIC_HORIZON_DAYS - 1) * DAY_MS);
  const coverageStart = validTime(rollup?.coverageStartAt);
  const coverageEnd = validTime(rollup?.coverageEndAt);
  const integrityState = rollup?.integrityState === "FAILED" ? "FAILED" : "OK";
  const coverageComplete14d = Boolean(
    rollup &&
    integrityState === "OK" &&
    coverageStart !== null &&
    coverageStart <= validTime(horizonStartAt) &&
    coverageEnd !== null &&
    coverageEnd >= now
  );
  const coverageState = integrityState === "FAILED" ? "INTEGRITY_FAILURE" : coverageComplete14d ? "COMPLETE" : "INCOMPLETE";
  const coverageReason = integrityState === "FAILED"
    ? String(rollup?.integrityReason || "ROLLUP_INTEGRITY_FAILURE")
    : coverageComplete14d
      ? "ROLLING_14_COVERAGE_COMPLETE"
      : rollup
        ? "ROLLING_14_COVERAGE_INCOMPLETE"
        : "ROLLUP_NOT_INITIALIZED";
  return {
    owner: "TBR_SHADOW_OBSERVER",
    version: TBR_DIAGNOSTIC_ROLLUP_VERSION,
    horizonDays: TBR_DIAGNOSTIC_HORIZON_DAYS,
    dayBucketLimit: TBR_DIAGNOSTIC_HORIZON_DAYS,
    dedupeEntryLimit: TBR_DIAGNOSTIC_DEDUPE_LIMIT,
    coverageStartAt: rollup?.coverageStartAt || "",
    coverageEndAt: rollup?.coverageEndAt || "",
    horizonStartAt,
    coverageComplete14d,
    coverageState,
    coverageReason,
    integrityState,
    integrityReason: rollup?.integrityReason || "",
    dayBuckets: Object.keys(buckets).length,
    dedupeEntries: rollup ? Object.keys(rollup.seen).length : 0,
    buckets,
  };
}

export function aggregateTbrDiagnosticRollup(projection, daysBack, nowValue = Date.now()) {
  const now = Number(nowValue);
  const days = [];
  for (let offset = daysBack - 1; offset >= 0; offset -= 1)
    days.push(tbrDiagnosticBangkokDay(now - offset * DAY_MS));
  const total = {
    days,
    observationDays: 0,
    candidates: 0,
    confirmed: 0,
    expired: 0,
    resolved: 0,
    leadCount: 0,
    leadSum: 0,
    leadMax: null,
    leadBins: emptyBins(),
    healthMs: { live: 0, fallback: 0, waiting: 0, stale: 0 },
    sourceOutages: 0,
    recoveries: 0,
    routeFallbackEvents: 0,
    repairEvents: 0,
    sourceErrors: {},
  };
  for (const key of days) {
    const day = normalizeDay(projection?.buckets?.[key]);
    const healthMs = day[HEALTH_LIVE_MS] + day[HEALTH_FALLBACK_MS] + day[HEALTH_WAITING_MS] + day[HEALTH_STALE_MS];
    if (day[CANDIDATES] > 0 || healthMs > 0) total.observationDays += 1;
    total.candidates += day[CANDIDATES];
    total.confirmed += day[CONFIRMED];
    total.expired += day[EXPIRED];
    total.leadCount += day[LEAD_COUNT];
    total.leadSum += day[LEAD_SUM];
    total.leadMax = day[LEAD_MAX] == null ? total.leadMax : total.leadMax == null ? day[LEAD_MAX] : Math.max(total.leadMax, day[LEAD_MAX]);
    for (let index = 0; index < LEAD_BIN_COUNT; index += 1) total.leadBins[index] += day[LEAD_BINS][index];
    total.healthMs.live += day[HEALTH_LIVE_MS];
    total.healthMs.fallback += day[HEALTH_FALLBACK_MS];
    total.healthMs.waiting += day[HEALTH_WAITING_MS];
    total.healthMs.stale += day[HEALTH_STALE_MS];
    total.sourceOutages += day[SOURCE_OUTAGES];
    total.recoveries += day[RECOVERIES];
    total.routeFallbackEvents += day[FALLBACK_EVENTS];
  }
  total.resolved = total.confirmed + total.expired;
  total.confirmationRate = total.resolved ? Number(((100 * total.confirmed) / total.resolved).toFixed(1)) : null;
  total.expiredRate = total.resolved ? Number(((100 * total.expired) / total.resolved).toFixed(1)) : null;
  total.averageLeadMinutes = total.leadCount ? Math.round(total.leadSum / total.leadCount) : null;
  total.p50LeadMinutes = percentile(total.leadBins, 50);
  total.p90LeadMinutes = percentile(total.leadBins, 90);
  total.p95LeadMinutes = percentile(total.leadBins, 95);
  const healthTotalMs = Object.values(total.healthMs).reduce((sum, value) => sum + value, 0);
  total.healthMinutes = Math.round(healthTotalMs / 60000);
  total.sourceAvailableRate = healthTotalMs ? Number((((total.healthMs.live + total.healthMs.fallback) * 100) / healthTotalMs).toFixed(1)) : null;
  total.cleanLiveRate = healthTotalMs ? Number(((total.healthMs.live * 100) / healthTotalMs).toFixed(1)) : null;
  total.fallbackRate = healthTotalMs ? Number(((total.healthMs.fallback * 100) / healthTotalMs).toFixed(1)) : null;
  total.health = Object.fromEntries(Object.entries(total.healthMs).map(([key, value]) => [key, Math.round(value / 60000)]));
  total.coverageComplete14d = projection?.coverageComplete14d === true;
  total.coverageState = String(projection?.coverageState || "INCOMPLETE");
  total.asOf = String(projection?.coverageEndAt || "");
  delete total.healthMs;
  delete total.leadBins;
  delete total.leadSum;
  return total;
}
