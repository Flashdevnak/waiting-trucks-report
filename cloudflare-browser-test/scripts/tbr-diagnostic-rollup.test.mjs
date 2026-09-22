import assert from "node:assert/strict";
import test from "node:test";

import {
  TBR_DIAGNOSTIC_DEDUPE_LIMIT,
  TBR_DIAGNOSTIC_HORIZON_DAYS,
  TBR_DIAGNOSTIC_MAX_FIXTURE_BYTES,
  aggregateTbrDiagnosticRollup,
  projectTbrDiagnosticRollup,
  tbrDiagnosticBangkokDay,
  updateTbrDiagnosticRollup,
} from "../src/tbr-diagnostic-rollup.js";
import {
  observeTbrShadow,
  readTbrShadowReport,
} from "../src/tbr-shadow.js";
import { readTbrIntelligenceReport } from "../src/tbr-intelligence.js";

const DAY = 86400000;
const MINUTE = 60000;
const NOW = Date.parse("2026-09-21T12:00:00.000Z");

function hashedId(index) {
  return index.toString(16).padStart(24, "0");
}

function record(index, ageDays, status = "confirmed", leadMinutes = 10, now = NOW) {
  const tbrAt = new Date(now - ageDays * DAY).toISOString();
  return {
    id: hashedId(index),
    tbrAt,
    status,
    confirmedAt: status === "confirmed" ? new Date(Date.parse(tbrAt) + leadMinutes * MINUTE).toISOString() : "",
    expiredAt: status === "expired" ? new Date(Date.parse(tbrAt) + 12 * 60 * MINUTE).toISOString() : "",
    leadMinutes: status === "confirmed" ? leadMinutes : null,
  };
}

function recordsObject(items) {
  return Object.fromEntries(items.map((item) => [item.id, { ...item, id: undefined }]));
}

function update(input, records, now, sourceAvailable = true, routeFallback = false, previous = {}) {
  return updateTbrDiagnosticRollup(input, records, {
    now,
    sourceAvailable,
    routeFallback,
    previousSourceAvailable: previous.sourceAvailable,
    previousRouteFallback: previous.routeFallback,
  });
}

function continuousLiveRollup(start, end, finalRecords = {}) {
  let rollup = update(null, {}, start, true, false);
  for (let cursor = start + 30 * MINUTE; cursor < end; cursor += 30 * MINUTE)
    rollup = update(rollup, {}, cursor, true, false, { sourceAvailable: true, routeFallback: false });
  return update(rollup, finalRecords, end, true, false, { sourceAvailable: true, routeFallback: false });
}

class KV {
  constructor(entries = []) {
    this.map = new Map(entries);
    this.puts = 0;
    this.gets = 0;
  }
  async get(key) { this.gets += 1; return this.map.get(key) ?? null; }
  async put(key, value) { this.puts += 1; this.map.set(key, value); }
}

function legacyState(hub = "NE1", overrides = {}) {
  return {
    version: 2,
    hub,
    startedAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T11:55:00.000Z",
    healthUpdatedAt: "2026-09-21T11:55:00.000Z",
    lastAttemptAt: "2026-09-21T11:55:00.000Z",
    lastObservedAt: "2026-09-21T11:55:00.000Z",
    sourceAvailable: true,
    feedCount: 0,
    rowCount: 0,
    lastSkip: "",
    shadowQuota: null,
    routeFallback: false,
    routeFallbackAt: "",
    routeSourceError: null,
    records: {},
    ...overrides,
  };
}

test("rolling candidates retain day 1/3/4/7/13 exactly and exclude older than 14 days", () => {
  const items = [
    record(1, 1, "confirmed", 10),
    record(2, 3, "expired"),
    record(3, 4, "confirmed", 20),
    record(4, 7, "confirmed", 30),
    record(5, 13, "confirmed", 40),
    record(6, 15, "confirmed", 50),
  ];
  let rollup = update(null, recordsObject(items), NOW);
  let projection = projectTbrDiagnosticRollup(rollup, NOW);
  let metrics = aggregateTbrDiagnosticRollup(projection, 14, NOW);
  assert.equal(metrics.candidates, 5);
  assert.equal(metrics.confirmed, 4);
  assert.equal(metrics.expired, 1);
  assert.equal(metrics.resolved, 5);
  assert.equal(metrics.p50LeadMinutes, 20);
  assert.equal(metrics.p90LeadMinutes, 40);
  assert.equal(metrics.p95LeadMinutes, 40);

  rollup = update(rollup, recordsObject(items), NOW + MINUTE, true, false, { sourceAvailable: true, routeFallback: false });
  projection = projectTbrDiagnosticRollup(rollup, NOW + MINUTE);
  metrics = aggregateTbrDiagnosticRollup(projection, 14, NOW + MINUTE);
  assert.equal(metrics.candidates, 5, "repeated cycles must not count candidates twice");
  assert.equal(metrics.confirmed, 4, "confirmed terminal state must not replay");
  assert.equal(metrics.expired, 1, "expired terminal state must not replay");

  const withoutDay4Raw = recordsObject(items.filter((item) => item.id !== hashedId(3)));
  rollup = update(rollup, withoutDay4Raw, NOW + 2 * MINUTE, true, false, { sourceAvailable: true, routeFallback: false });
  metrics = aggregateTbrDiagnosticRollup(projectTbrDiagnosticRollup(rollup, NOW + 2 * MINUTE), 14, NOW + 2 * MINUTE);
  assert.equal(metrics.candidates, 5, "raw pruning must not erase an aggregate contribution");
  assert.equal(metrics.confirmed, 4);
});

test("candidate buckets and health intervals use Bangkok midnight", () => {
  const beforeMidnight = Date.parse("2026-09-20T16:30:00.000Z");
  const afterMidnight = Date.parse("2026-09-20T17:30:00.000Z");
  const records = recordsObject([
    { ...record(1, 0, "confirmed", 5, beforeMidnight), tbrAt: new Date(beforeMidnight).toISOString() },
    { ...record(2, 0, "confirmed", 6, afterMidnight), tbrAt: new Date(afterMidnight).toISOString() },
  ]);
  const candidateRollup = update(null, records, afterMidnight);
  const candidateProjection = projectTbrDiagnosticRollup(candidateRollup, afterMidnight);
  assert.equal(candidateProjection.buckets["2026-09-20"][0], 1);
  assert.equal(candidateProjection.buckets["2026-09-21"][0], 1);

  const start = Date.parse("2026-09-20T16:50:00.000Z");
  let healthRollup = update(null, {}, start);
  healthRollup = update(healthRollup, {}, start + 20 * MINUTE, true, false, { sourceAvailable: true, routeFallback: false });
  const healthProjection = projectTbrDiagnosticRollup(healthRollup, start + 20 * MINUTE);
  assert.equal(healthProjection.buckets["2026-09-20"][7], 10 * MINUTE);
  assert.equal(healthProjection.buckets["2026-09-21"][7], 10 * MINUTE);
});

test("health rollup preserves live/fallback/waiting/stale and transition truth", () => {
  const start = Date.parse("2026-09-21T00:00:00.000Z");
  let rollup = update(null, {}, start, true, false);
  rollup = update(rollup, {}, start + 10 * MINUTE, true, true, { sourceAvailable: true, routeFallback: false });
  rollup = update(rollup, {}, start + 20 * MINUTE, false, false, { sourceAvailable: true, routeFallback: true });
  rollup = update(rollup, {}, start + 30 * MINUTE, false, false, { sourceAvailable: false, routeFallback: false });
  rollup = update(rollup, {}, start + 40 * MINUTE, true, false, { sourceAvailable: false, routeFallback: false });
  rollup = update(rollup, {}, start + 100 * MINUTE, true, false, { sourceAvailable: true, routeFallback: false });
  const metrics = aggregateTbrDiagnosticRollup(projectTbrDiagnosticRollup(rollup, start + 100 * MINUTE), 14, start + 100 * MINUTE);
  assert.deepEqual(metrics.health, { live: 40, fallback: 10, waiting: 20, stale: 30 });
  assert.equal(metrics.routeFallbackEvents, 1);
  assert.equal(metrics.sourceOutages, 1);
  assert.equal(metrics.recoveries, 1);
  assert.ok(metrics.cleanLiveRate < 100, "long gap cannot be credited entirely as LIVE");
});

test("read-only projection fills a long missing health tail through its requested end", () => {
  const persistedEnd = NOW - 2 * 60 * MINUTE;
  const raw = continuousLiveRollup(NOW - 15 * DAY, persistedEnd);
  const original = structuredClone(raw);
  const before = aggregateTbrDiagnosticRollup(projectTbrDiagnosticRollup(raw, persistedEnd), 14, persistedEnd);
  const projection = projectTbrDiagnosticRollup(raw, NOW);
  const after = aggregateTbrDiagnosticRollup(projection, 14, NOW);

  assert.equal(projection.coverageEndAt, new Date(NOW).toISOString());
  assert.equal(projection.coverageComplete14d, true);
  assert.equal(after.health.live, before.health.live + 30, "long-gap prior-mode allowance must remain capped at 30 minutes");
  assert.equal(after.health.stale, before.health.stale + 90, "the remainder of a two-hour missing tail must be STALE");
  assert.deepEqual(raw, original, "projection must not mutate persisted rollup input");
});

test("projection-only stale tail splits at Bangkok midnight without persistence", () => {
  const persistedEnd = Date.parse("2026-09-20T16:40:00.000Z"); // 23:40 Bangkok
  const projectionNow = Date.parse("2026-09-20T18:10:00.000Z"); // 01:10 Bangkok
  const raw = update(null, {}, persistedEnd, true, false);
  const original = structuredClone(raw);
  const projection = projectTbrDiagnosticRollup(raw, projectionNow);

  assert.equal(projection.buckets["2026-09-20"][7], 20 * MINUTE);
  assert.equal(projection.buckets["2026-09-21"][7], 10 * MINUTE);
  assert.equal(projection.buckets["2026-09-21"][10], 60 * MINUTE);
  assert.equal(projection.coverageEndAt, new Date(projectionNow).toISOString());
  assert.deepEqual(raw, original);
});

test("readiness metrics include a projected stale tail instead of optimistic uptime", async () => {
  const persistedEnd = NOW - 2 * DAY;
  const candidates = recordsObject(Array.from({ length: 100 }, (_, index) => record(index, 1, "confirmed", 10, persistedEnd)));
  const raw = continuousLiveRollup(NOW - 16 * DAY, persistedEnd, candidates);
  const persistedProjection = projectTbrDiagnosticRollup(raw, persistedEnd);
  const correctedProjection = projectTbrDiagnosticRollup(raw, NOW);
  const before = await readTbrIntelligenceReport(null, "NE1", {
    hub: "NE1", observerStatus: "LIVE", sourceAvailable: true, routeFallback: false,
    diagnosticRollup: persistedProjection, records: [],
  }, persistedEnd);
  const after = await readTbrIntelligenceReport(null, "NE1", {
    hub: "NE1", observerStatus: "STALE", sourceAvailable: true, routeFallback: false,
    diagnosticRollup: correctedProjection, records: [],
  }, NOW);

  assert.equal(before.rolling14.sourceAvailableRate, 100);
  assert.ok(after.rolling14.sourceAvailableRate < before.rolling14.sourceAvailableRate);
  assert.ok(after.rolling14.health.stale >= 47 * 60);
  assert.equal(after.coverage.coverageEndAt, new Date(NOW).toISOString());
  assert.equal(after.coverage.coverageComplete14d, true, "truthfully projected STALE time still completes historical coverage");
  assert.equal(after.readiness.coverageReady, true);
  assert.equal(after.readiness.advisoryAllowedNow, false);
  assert.notEqual(after.readiness.status, "ADVISORY_READY", "stopped observation cannot retain artificially perfect uptime readiness");
  assert.notEqual(after.readiness.status, "PRODUCTION_CANDIDATE");
});

test("14 day buckets and coverage are bounded, complete only after a truthful horizon", () => {
  let rollup = update(null, {}, NOW - 15 * DAY, true, false);
  for (let offset = 14; offset >= 0; offset -= 1) {
    const at = NOW - offset * DAY;
    rollup = update(rollup, {}, at, true, false, { sourceAvailable: true, routeFallback: false });
  }
  const projection = projectTbrDiagnosticRollup(rollup, NOW);
  assert.equal(projection.coverageState, "COMPLETE");
  assert.equal(projection.coverageComplete14d, true);
  assert.ok(projection.dayBuckets <= TBR_DIAGNOSTIC_HORIZON_DAYS);
  for (const age of [4, 7, 13]) {
    const bucket = projection.buckets[tbrDiagnosticBangkokDay(NOW - age * DAY)];
    assert.ok(bucket, `health bucket for day ${age} must remain`);
    assert.ok(bucket[7] > 0, `LIVE health duration for day ${age} must remain`);
  }
  assert.equal(projection.buckets[tbrDiagnosticBangkokDay(NOW - 14 * DAY)], undefined);

  const initial = projectTbrDiagnosticRollup(update(null, {}, NOW, true, false), NOW);
  assert.equal(initial.coverageState, "INCOMPLETE");
  assert.equal(initial.coverageComplete14d, false);
  assert.equal(initial.coverageReason, "ROLLING_14_COVERAGE_INCOMPLETE");
});

test("readiness is coverage-gated and exact overflow becomes an integrity failure", async () => {
  const hundred = recordsObject(Array.from({ length: 100 }, (_, index) => record(index, index % 10, "confirmed", 10)));
  let complete = update(null, {}, NOW - 15 * DAY, true, false);
  for (let cursor = NOW - 15 * DAY + 30 * MINUTE; cursor <= NOW; cursor += 30 * MINUTE)
    complete = update(complete, cursor === NOW ? hundred : {}, cursor, true, false, { sourceAvailable: true, routeFallback: false });
  const completeShadow = {
    hub: "NE1", observerStatus: "LIVE", sourceAvailable: true, routeFallback: false,
    diagnosticRollup: projectTbrDiagnosticRollup(complete, NOW), records: [],
  };
  const ready = await readTbrIntelligenceReport(null, "NE1", completeShadow, NOW);
  assert.equal(ready.readiness.status, "ADVISORY_READY");
  assert.equal(ready.readiness.coverageReady, true);

  const partial = update(null, hundred, NOW, true, false);
  const partialReport = await readTbrIntelligenceReport(null, "NE1", {
    ...completeShadow, diagnosticRollup: projectTbrDiagnosticRollup(partial, NOW),
  }, NOW);
  assert.equal(partialReport.readiness.status, "SHADOW_COVERAGE_INCOMPLETE");
  assert.equal(partialReport.readiness.advisoryAllowedNow, false);

  const overflowRecords = recordsObject(Array.from({ length: TBR_DIAGNOSTIC_DEDUPE_LIMIT + 1 }, (_, index) => record(index, 1, "confirmed", 10)));
  const overflow = update(null, overflowRecords, NOW, true, false);
  const overflowProjection = projectTbrDiagnosticRollup(overflow, NOW);
  assert.equal(overflowProjection.integrityState, "FAILED");
  assert.equal(overflowProjection.integrityReason, "DEDUPE_CAPACITY_EXCEEDED");
  assert.equal(overflowProjection.dedupeEntries, TBR_DIAGNOSTIC_DEDUPE_LIMIT);
  const overflowReport = await readTbrIntelligenceReport(null, "NE1", {
    ...completeShadow, diagnosticRollup: overflowProjection,
  }, NOW);
  assert.equal(overflowReport.readiness.status, "SHADOW_INTEGRITY_FAILURE");
  assert.equal(overflowReport.readiness.advisoryAllowedNow, false);
});

test("legacy v2 lazily initializes without erasing records and adds no Shadow put cadence", async () => {
  const env = { STATE: new KV() };
  env.STATE.map.set("shadow:tbr:v1:NE1", JSON.stringify(legacyState()));
  const liveEmpty = { rows: [], tbrShadowFeed: [] };
  const route = { proofId: "P1", attendanceType: "ปลายทาง", actualArrivalAt: "" };
  const feed = { proofId: "P1", scheduleTbrArrivalAt: "2026-09-21T11:50:00.000Z" };
  const deltas = [];
  for (const [at, live] of [
    [NOW, liveEmpty],
    [NOW + MINUTE, liveEmpty],
    [NOW + 2 * MINUTE, { rows: [route], tbrShadowFeed: [feed] }],
    [NOW + 3 * MINUTE, { rows: [{ ...route, actualArrivalAt: "2026-09-21T11:55:00.000Z" }], tbrShadowFeed: [feed] }],
    [NOW + 4 * MINUTE, { rows: [{ ...route, actualArrivalAt: "2026-09-21T11:55:00.000Z" }], tbrShadowFeed: [feed] }],
    [NOW + 8 * MINUTE, { rows: [{ ...route, actualArrivalAt: "2026-09-21T11:55:00.000Z" }], tbrShadowFeed: [feed] }],
  ]) {
    const before = env.STATE.puts;
    await observeTbrShadow(env, "NE1", live, at);
    deltas.push(env.STATE.puts - before);
  }
  assert.deepEqual(deltas, [1, 0, 1, 1, 0, 1]);
  assert.ok(deltas.every((value) => value <= 1), "rollup cannot emit a second put for an event");
  const stored = JSON.parse(env.STATE.map.get("shadow:tbr:v1:NE1"));
  assert.equal(stored.version, 2);
  assert.equal(Object.keys(stored.records).length, 1);
  assert.equal(stored.diagnosticRollup.v, 1);
  assert.equal(projectTbrDiagnosticRollup(stored.diagnosticRollup, NOW + 8 * MINUTE).coverageState, "INCOMPLETE");
});

test("raw 3-day pruning preserves aggregate truth in the same existing write", async () => {
  const old = record(1, 4, "confirmed", 12);
  const state = legacyState("NE1", {
    records: recordsObject([old]),
    healthUpdatedAt: new Date(NOW - MINUTE).toISOString(),
    updatedAt: new Date(NOW - MINUTE).toISOString(),
    lastAttemptAt: new Date(NOW - MINUTE).toISOString(),
    lastObservedAt: new Date(NOW - MINUTE).toISOString(),
  });
  const env = { STATE: new KV([["shadow:tbr:v1:NE1", JSON.stringify(state)]]) };
  await observeTbrShadow(env, "NE1", { rows: [], tbrShadowFeed: [] }, NOW);
  assert.equal(env.STATE.puts, 1);
  const stored = JSON.parse(env.STATE.map.get("shadow:tbr:v1:NE1"));
  assert.equal(Object.keys(stored.records).length, 0, "raw terminal record still obeys 3-day retention");
  const report = await readTbrShadowReport(env, "NE1", NOW);
  const metrics = aggregateTbrDiagnosticRollup(report.diagnosticRollup, 14, NOW);
  assert.equal(metrics.candidates, 1);
  assert.equal(metrics.confirmed, 1);
});

test("per-HUB state is isolated and 1/10/100 viewers never mutate rollup", async () => {
  const ne1Rollup = update(null, recordsObject([record(1, 1, "confirmed", 10)]), NOW, true, false);
  const ea2Rollup = update(null, recordsObject([record(2, 1, "expired")]), NOW, false, false);
  const ne1 = { hub: "NE1", observerStatus: "LIVE", sourceAvailable: true, routeFallback: false, records: [], diagnosticRollup: projectTbrDiagnosticRollup(ne1Rollup, NOW) };
  const ea2 = { hub: "EA2", observerStatus: "WAITING_SOURCE", sourceAvailable: false, routeFallback: false, records: [], diagnosticRollup: projectTbrDiagnosticRollup(ea2Rollup, NOW) };
  const originals = [structuredClone(ne1), structuredClone(ea2)];
  for (const viewers of [1, 10, 100]) {
    for (let index = 0; index < viewers; index += 1) {
      const ne1Report = await readTbrIntelligenceReport(null, "NE1", ne1, NOW);
      const ea2Report = await readTbrIntelligenceReport(null, "EA2", ea2, NOW);
      assert.equal(ne1Report.rolling14.confirmed, 1);
      assert.equal(ne1Report.rolling14.expired, 0);
      assert.equal(ea2Report.rolling14.confirmed, 0);
      assert.equal(ea2Report.rolling14.expired, 1);
      assert.equal(ne1Report.providerUpstreamCalls + ea2Report.providerUpstreamCalls, 0);
      assert.equal(ne1Report.otherPersistentWrites + ea2Report.otherPersistentWrites, 0);
      assert.equal(ne1Report.tursoReads + ea2Report.tursoReads, 0);
    }
  }
  assert.deepEqual(ne1, originals[0]);
  assert.deepEqual(ea2, originals[1]);
});

test("4096-entry exact bound has deterministic serialized payload evidence", () => {
  const baseRecords = recordsObject(Array.from({ length: 256 }, (_, index) => record(index, index % 3, "confirmed", (index % 120) + 1)));
  const baselineState = legacyState("NE1", { records: baseRecords });
  const typicalRollup = update(null, baseRecords, NOW, true, false);
  const typicalState = { ...baselineState, diagnosticRollup: typicalRollup };

  const highRecords = recordsObject(Array.from({ length: 2048 }, (_, index) => record(index, index % 14, index % 5 ? "confirmed" : "expired", (index % 120) + 1)));
  const highState = legacyState("NE1", { records: highRecords, diagnosticRollup: update(null, highRecords, NOW, true, false) });
  const maxRecords = recordsObject(Array.from({ length: TBR_DIAGNOSTIC_DEDUPE_LIMIT }, (_, index) => {
    const item = record(index, index % 14, index % 7 ? "confirmed" : "expired", (index % 120) + 1);
    return {
      ...item,
      kitAt: new Date(Date.parse(item.tbrAt) - 20 * MINUTE).toISOString(),
      firstSeenAt: new Date(Date.parse(item.tbrAt) + MINUTE).toISOString(),
      routeActualArrivalAt: item.confirmedAt,
      routeSeen: true,
      attendanceType: index % 2 ? "ปลายทาง" : "จุดดรอป",
    };
  }));
  const maxState = legacyState("NE1", { records: maxRecords, diagnosticRollup: update(null, maxRecords, NOW, true, false) });
  const maxRawOnlyBytes = Buffer.byteLength(JSON.stringify(legacyState("NE1", { records: maxRecords })));
  const sizes = {
    baseline: Buffer.byteLength(JSON.stringify(baselineState)),
    typical: Buffer.byteLength(JSON.stringify(typicalState)),
    high: Buffer.byteLength(JSON.stringify(highState)),
    max: Buffer.byteLength(JSON.stringify(maxState)),
  };
  const typicalProjection = projectTbrDiagnosticRollup(typicalRollup, NOW);
  const highProjection = projectTbrDiagnosticRollup(highState.diagnosticRollup, NOW);
  const maxProjection = projectTbrDiagnosticRollup(maxState.diagnosticRollup, NOW);
  assert.equal(aggregateTbrDiagnosticRollup(typicalProjection, 14, NOW).candidates, 256);
  assert.equal(aggregateTbrDiagnosticRollup(highProjection, 14, NOW).candidates, 2048);
  assert.equal(aggregateTbrDiagnosticRollup(maxProjection, 14, NOW).candidates, TBR_DIAGNOSTIC_DEDUPE_LIMIT);
  assert.equal(maxProjection.dedupeEntries, TBR_DIAGNOSTIC_DEDUPE_LIMIT);
  assert.ok(Object.keys(maxState.diagnosticRollup.seen).every((key) => /^[0-9a-f]{24}\|/.test(key)), "dedupe keys must contain only the hashed Shadow id plus TBR timestamp");
  assert.ok(Object.values(maxProjection.buckets).every((bucket) => bucket.length === 14));
  assert.ok(Object.values(maxProjection.buckets).every((bucket) => bucket[6].length === 122));
  assert.ok(sizes.max < TBR_DIAGNOSTIC_MAX_FIXTURE_BYTES, `max fixture ${sizes.max} exceeds ${TBR_DIAGNOSTIC_MAX_FIXTURE_BYTES}`);
  assert.ok(Object.keys(maxState.diagnosticRollup.days).length <= TBR_DIAGNOSTIC_HORIZON_DAYS);
  console.log(`TBR_ROLLUP_PAYLOAD_BYTES=${JSON.stringify(sizes)}`);
  console.log(`TBR_ROLLUP_PAYLOAD_COUNTS=${JSON.stringify({
    typical: { candidates: 256, dedupeEntries: typicalProjection.dedupeEntries, dayBuckets: typicalProjection.dayBuckets },
    high: { candidates: 2048, dedupeEntries: highProjection.dedupeEntries, dayBuckets: highProjection.dayBuckets },
    max: { candidates: TBR_DIAGNOSTIC_DEDUPE_LIMIT, dedupeEntries: maxProjection.dedupeEntries, dayBuckets: maxProjection.dayBuckets },
  })}`);
  console.log(`TBR_ROLLUP_TYPICAL_GROWTH_BYTES=${sizes.typical - sizes.baseline}`);
  console.log(`TBR_ROLLUP_TYPICAL_GROWTH_PERCENT=${(((sizes.typical - sizes.baseline) * 100) / sizes.baseline).toFixed(1)}`);
  console.log(`TBR_ROLLUP_MAX_GROWTH_BYTES=${sizes.max - sizes.baseline}`);
  console.log(`TBR_ROLLUP_MAX_GROWTH_PERCENT=${(((sizes.max - sizes.baseline) * 100) / sizes.baseline).toFixed(1)}`);
  console.log(`TBR_ROLLUP_MAX_RAW_ONLY_BYTES=${maxRawOnlyBytes}`);
  console.log(`TBR_ROLLUP_MAX_OVERHEAD_BYTES=${sizes.max - maxRawOnlyBytes}`);
  console.log(`TBR_ROLLUP_MAX_OVERHEAD_PERCENT=${(((sizes.max - maxRawOnlyBytes) * 100) / maxRawOnlyBytes).toFixed(1)}`);
});
