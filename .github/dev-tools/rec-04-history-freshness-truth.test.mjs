import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  MS_CANONICAL_BUSINESS_DAY_SQL,
  MS_SOURCE_FRESHNESS,
  MS_SOURCE_STALE_AFTER_MS,
  canonicalMsBusinessDay,
  canonicalMsFieldEvaluation,
  canonicalMsSourceFreshness,
  msEvidenceVisibleAt,
} from "../../worker/src/ms-operational-truth-v1.js";
import { queryMsDailyArchivePointer } from "../../worker/src/ms-history-pointer-v1.js";
import { createMsFieldEvidence } from "./bus-time-hot-lane-v14-runtime.mjs";
import { stageWorker } from "./stage-dev-runtime.mjs";
import { deriveSourceView } from "../../supervisor-view.js";

const NOW = Date.parse("2026-09-21T12:00:00.000Z");
const root = new URL("../../", import.meta.url);

function sqliteEnv() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE ms_route_registry(hub TEXT NOT NULL,route_id TEXT NOT NULL,first_seen_at TEXT NOT NULL DEFAULT '',PRIMARY KEY(hub,route_id));
    CREATE TABLE ms_route_history(history_id TEXT PRIMARY KEY,route_id TEXT NOT NULL,hub TEXT NOT NULL,event_type TEXT NOT NULL,snapshot_at TEXT NOT NULL,payload_json TEXT NOT NULL,synced_by TEXT NOT NULL);
    CREATE INDEX idx_ms_route_history_hub_route_snapshot ON ms_route_history(hub,route_id,snapshot_at DESC);
    CREATE TABLE ms_route_cancellations(route_id TEXT NOT NULL,hub TEXT NOT NULL,cancelled_at TEXT NOT NULL,cancelled_by TEXT NOT NULL,reason TEXT NOT NULL,active INTEGER NOT NULL);
  `);
  const env = {
    DB: {
      prepare(sql) {
        const statement = sqlite.prepare(sql);
        return {
          bind(...args) {
            return {
              async all() { return { results: statement.all(...args) }; },
              async first() { return statement.get(...args) || null; },
            };
          },
        };
      },
    },
  };
  const insert = (routeId, snapshotAt, payload, eventType = "UPDATED", syncedBy = "MS_AUTO") => {
    sqlite.prepare("INSERT OR IGNORE INTO ms_route_registry(hub,route_id,first_seen_at) VALUES('EA2',?,?)").run(routeId, snapshotAt);
    sqlite.prepare("INSERT INTO ms_route_history(history_id,route_id,hub,event_type,snapshot_at,payload_json,synced_by) VALUES(?,?,'EA2',?,?,?,?)")
      .run(`${routeId}:${snapshotAt}:${sqlite.prepare("SELECT COUNT(*) AS n FROM ms_route_history").get().n}`, routeId, eventType, snapshotAt, JSON.stringify({ id: routeId, hub: "EA2", ...payload }), syncedBy);
  };
  return { sqlite, env, insert };
}

test("REC-04 Destination/Drop business day uses earliest KIT/TBR with KIT tie", () => {
  const cases = [
    [{ attendanceType: "ปลายทาง", actualArrivalAt: "2026-09-20T17:30:00Z" }, "2026-09-21", "KIT"],
    [{ attendanceType: "ปลายทาง", scheduleTbrArrivalAt: "2026-09-19T18:30:00Z" }, "2026-09-20", "TBR"],
    [{ attendanceType: "ปลายทาง", actualArrivalAt: "2026-09-20T19:00:00Z", scheduleTbrArrivalAt: "2026-09-20T16:00:00Z" }, "2026-09-20", "TBR"],
    [{ attendanceType: "ปลายทาง", actualArrivalAt: "2026-09-20T19:00:00Z", scheduleTbrArrivalAt: "2026-09-20T19:00:00Z" }, "2026-09-21", "KIT"],
    [{ attendanceType: "จุดดรอป", actualArrivalAt: "2026-09-20T18:00:00Z", scheduleTbrArrivalAt: "2026-09-20T16:00:00Z" }, "2026-09-20", "TBR"],
  ];
  for (const [row, businessDay, authority] of cases) {
    const result = canonicalMsBusinessDay(row);
    assert.equal(result.businessDay, businessDay);
    assert.equal(result.authority, authority);
  }
});

test("REC-04 Origin business day is Route actual departure only", () => {
  const result = canonicalMsBusinessDay({
    attendanceType: "ต้นทาง",
    actualDepartureAt: "2026-09-20T18:00:00Z",
    estimatedDepartureAt: "2026-09-18T18:00:00Z",
  });
  assert.deepEqual(result, {
    businessDay: "2026-09-21",
    authority: "ROUTE_ACTUAL_DEPARTURE",
    valueTimestamp: "2026-09-20T18:00:00.000Z",
  });
});

test("REC-04 ETA, estimates, and Schedule KIT cannot define business day", () => {
  for (const forbidden of ["estimatedArrivalAt", "estimatedDepartureAt", "scheduleKitArrivalAt"])
    assert.equal(canonicalMsBusinessDay({ attendanceType: "ปลายทาง", [forbidden]: "2026-09-20T18:00:00Z" }).businessDay, "");
  assert.equal(canonicalMsBusinessDay({ attendanceType: "ต้นทาง", estimatedDepartureAt: "2026-09-20T18:00:00Z" }).businessDay, "");
  assert.doesNotMatch(MS_CANONICAL_BUSINESS_DAY_SQL, /estimatedArrivalAt|estimatedDepartureAt|scheduleKitArrivalAt/);
});

test("REC-04 indexed asOf query selects the deterministic latest snapshot at or before cutoff", async () => {
  const { sqlite, env, insert } = sqliteEnv();
  insert("R1", "2026-09-20T10:00:00.000Z", {
    attendanceType: "ปลายทาง",
    actualArrivalAt: "2026-09-20T02:00:00.000Z",
    scheduleTbrArrivalAt: "",
    dataCompleteness: "DATA_INCOMPLETE",
    fieldEvidence: { scheduleTbrArrivalAt: { state: "MISSING_UNCONFIRMED", acceptedDataAt: "2026-09-20T10:00:00.000Z" } },
    unloadingState: 1,
  });
  insert("R1", "2026-09-20T15:00:00.000Z", {
    attendanceType: "ปลายทาง",
    actualArrivalAt: "2026-09-20T02:00:00.000Z",
    scheduleTbrArrivalAt: "2026-09-20T01:00:00.000Z",
    dataCompleteness: "DATA_COMPLETE",
    fieldEvidence: { scheduleTbrArrivalAt: { state: "OBSERVED", sourceValueTimestamp: "2026-09-20T01:00:00.000Z", dataObservedAt: "2026-09-20T15:00:00.000Z", acceptedDataAt: "2026-09-20T15:00:00.000Z", enrichmentOrigin: "P3", backfill: true } },
    unloadingState: 2,
    unloadingCompletedAt: "2026-09-20T14:30:00.000Z",
  }, "P3_ENRICHED", "MS_P3_BACKFILL");
  sqlite.prepare("INSERT INTO ms_route_cancellations VALUES('R1','EA2','2026-09-20T14:00:00.000Z','OPS','future',1)").run();

  const early = await queryMsDailyArchivePointer(env, "EA2", "2026-09-20", "2026-09-20", "2026-09-20T12:00:00.000Z");
  assert.equal(early.rows.length, 1);
  assert.equal(early.rows[0].scheduleTbrArrivalAt, "");
  assert.equal(early.rows[0].dataCompleteness, "DATA_INCOMPLETE");
  assert.equal(early.rows[0].unloadingState, 1);
  assert.equal(early.rows[0].queueCancelledAt, undefined);
  assert.equal(early.asOf, "2026-09-20T12:00:00.000Z");

  const late = await queryMsDailyArchivePointer(env, "EA2", "2026-09-20", "2026-09-20", "2026-09-20T16:00:00.000Z");
  assert.equal(late.rows[0].scheduleTbrArrivalAt, "2026-09-20T01:00:00.000Z");
  assert.equal(late.rows[0].dataCompleteness, "DATA_COMPLETE");
  assert.equal(late.rows[0].unloadingState, 2);
  assert.equal(late.rows[0].queueCancelledBy, "OPS");
});

test("REC-04 equal snapshot timestamps resolve by rowid without future leakage", async () => {
  const { env, insert } = sqliteEnv();
  const base = { attendanceType: "ปลายทาง", actualArrivalAt: "2026-09-20T02:00:00Z" };
  insert("R2", "2026-09-20T11:00:00.000Z", { ...base, trackingStatus: "FIRST" });
  insert("R2", "2026-09-20T11:00:00.000Z", { ...base, trackingStatus: "SECOND" });
  insert("R2", "2026-09-20T13:00:00.000Z", { ...base, trackingStatus: "FUTURE" });
  const result = await queryMsDailyArchivePointer(env, "EA2", "2026-09-20", "2026-09-20", "2026-09-20T12:00:00.000Z");
  assert.equal(result.rows[0].trackingStatus, "SECOND");
});

test("REC-04 late P3 value is governed by knowledge time, never old source time", () => {
  const evidence = {
    state: "OBSERVED",
    sourceValueTimestamp: "2026-09-20T01:00:00.000Z",
    dataObservedAt: "2026-09-20T15:00:00.000Z",
    acceptedDataAt: "2026-09-20T15:00:00.000Z",
    enrichmentOrigin: "P3",
    backfill: true,
  };
  assert.equal(msEvidenceVisibleAt(evidence, "2026-09-20T12:00:00.000Z"), false);
  assert.equal(msEvidenceVisibleAt(evidence, "2026-09-20T16:00:00.000Z"), true);
  assert.equal(evidence.enrichmentOrigin, "P3");
  assert.equal(evidence.backfill, true);
});

test("REC-04 old evidence without knowledge provenance remains unknown", () => {
  assert.equal(msEvidenceVisibleAt({ state: "OBSERVED", valueTimestamp: "2026-09-01T00:00:00Z" }, "2026-09-21T00:00:00Z"), false);
  assert.deepEqual(canonicalMsFieldEvaluation(), { evidenceState: "UNKNOWN", reason: "NOT_EVALUATED" });
});

test("REC-04 freshness boundary is fresh through exactly 20 minutes", () => {
  const at = (age) => new Date(NOW - age).toISOString();
  assert.equal(canonicalMsSourceFreshness({ lastSuccessAt: at(MS_SOURCE_STALE_AFTER_MS - 1) }, NOW).freshness, MS_SOURCE_FRESHNESS.FRESH);
  assert.equal(canonicalMsSourceFreshness({ lastSuccessAt: at(MS_SOURCE_STALE_AFTER_MS) }, NOW).freshness, MS_SOURCE_FRESHNESS.FRESH);
  assert.equal(canonicalMsSourceFreshness({ lastSuccessAt: at(MS_SOURCE_STALE_AFTER_MS + 1) }, NOW).freshness, MS_SOURCE_FRESHNESS.STALE);
});

test("REC-04 successful no-match is fresh while field evidence remains missing", () => {
  const source = canonicalMsSourceFreshness({ lastAttemptAt: new Date(NOW).toISOString(), lastSuccessAt: new Date(NOW).toISOString() }, NOW);
  const field = canonicalMsFieldEvaluation({ succeeded: true, matched: false });
  assert.equal(source.freshness, "FRESH");
  assert.equal(field.evidenceState, "MISSING_UNCONFIRMED");
});

test("REC-04 unavailable auth maps freshness/evidence to SOURCE_UNAVAILABLE and AUTH_REQUIRED", () => {
  const source = canonicalMsSourceFreshness({ lastError: "HTTP 401", lastErrorAt: new Date(NOW).toISOString() }, NOW);
  const field = canonicalMsFieldEvaluation({ unavailable: true, errorCode: "SESSION_EXPIRED" });
  assert.equal(source.freshness, "SOURCE_UNAVAILABLE");
  assert.equal(source.action, "AUTH_REQUIRED");
  assert.equal(field.evidenceState, "SOURCE_UNAVAILABLE");
  assert.equal(field.reason, "AUTH_REQUIRED");
});

test("REC-04 never-attempted/cache-only is UNKNOWN while HBI and PNO are ON_DEMAND", () => {
  assert.equal(canonicalMsSourceFreshness({ acceptedDataAt: "2026-09-21T11:59:00Z" }, NOW).freshness, "UNKNOWN");
  assert.equal(canonicalMsSourceFreshness({ mode: "CLICK_ONLY" }, NOW).freshness, "ON_DEMAND");
  assert.equal(canonicalMsSourceFreshness({ mode: "ON_DEMAND", source: "PNO" }, NOW).freshness, "ON_DEMAND");
});

test("REC-04 all seven freshness timestamps remain semantically distinct", () => {
  const values = {
    lastAttemptAt: "2026-09-21T01:00:00Z",
    lastSuccessAt: "2026-09-21T02:00:00Z",
    lastMeaningfulObservationAt: "2026-09-21T03:00:00Z",
    lastErrorAt: "2026-09-21T04:00:00Z",
    dataObservedAt: "2026-09-21T05:00:00Z",
    sourceValueTimestamp: "2026-09-21T06:00:00Z",
    acceptedDataAt: "2026-09-21T07:00:00Z",
  };
  const result = canonicalMsSourceFreshness(values, NOW);
  for (const [key, value] of Object.entries(values))
    assert.equal(result[key], new Date(value).toISOString());
  assert.equal(new Set(Object.values(values)).size, 7);

  const evidence = createMsFieldEvidence({
    field: "scheduleTbrArrivalAt",
    state: "OBSERVED",
    valueTimestamp: values.sourceValueTimestamp,
    observedAt: values.dataObservedAt,
    acceptedAt: values.acceptedDataAt,
  });
  assert.equal(evidence.sourceValueTimestamp, new Date(values.sourceValueTimestamp).toISOString());
  assert.equal(evidence.dataObservedAt, new Date(values.dataObservedAt).toISOString());
  assert.equal(evidence.acceptedDataAt, new Date(values.acceptedDataAt).toISOString());
});

test("REC-04 source failures stay isolated per HUB", () => {
  const states = new Map([
    ["EA2", canonicalMsSourceFreshness({ lastError: "HTTP 401", lastErrorAt: new Date(NOW).toISOString() }, NOW)],
    ["NE1", canonicalMsSourceFreshness({ lastSuccessAt: new Date(NOW).toISOString() }, NOW)],
  ]);
  assert.equal(states.get("EA2").freshness, "SOURCE_UNAVAILABLE");
  assert.equal(states.get("NE1").freshness, "FRESH");
});

test("REC-04 Supervisor projection consumes canonical boundary and unavailable semantics", () => {
  assert.equal(deriveSourceView({ state: "HEALTHY", lastSuccessAt: new Date(NOW - MS_SOURCE_STALE_AFTER_MS).toISOString() }, NOW).freshness, "FRESH");
  assert.equal(deriveSourceView({ state: "HEALTHY", lastSuccessAt: new Date(NOW - MS_SOURCE_STALE_AFTER_MS - 1).toISOString() }, NOW).freshness, "STALE");
  const unavailable = deriveSourceView({ state: "AUTH_REQUIRED", errorCode: "MS_SESSION_HTTP_401" }, NOW);
  assert.equal(unavailable.state, "AUTH_REQUIRED");
  assert.equal(unavailable.freshness, "SOURCE_UNAVAILABLE");
  assert.equal(deriveSourceView({ mode: "CLICK_ONLY" }, NOW).freshness, "ON_DEMAND");
});

test("REC-04 runtime remains bounded, indexed, Turso-only, and provider-neutral", async () => {
  const [worker, frontend, runtime, devConfig] = await Promise.all([
    readFile(new URL("worker/src/index.js", root), "utf8"),
    readFile(new URL("ms.js", root), "utf8"),
    readFile(new URL(".github/dev-tools/bus-time-hot-lane-v14-runtime.mjs", root), "utf8"),
    readFile(new URL("worker/wrangler.dev.jsonc", root), "utf8"),
  ]);
  const staged = stageWorker(worker);
  const daily = worker.slice(worker.indexOf("async function msDailyArchive"), worker.indexOf("async function msArchiveTotal"));
  assert.match(daily, /idx_ms_route_history_hub_route_snapshot/);
  assert.match(daily, /h2\.snapshot_at<=\?/);
  assert.match(daily, /LIMIT 5000/);
  assert.doesNotMatch(daily, /estimatedArrivalAt|estimatedDepartureAt|scheduleKitArrivalAt/);
  const frontendTruth = frontend.slice(frontend.indexOf("function rowBusinessDayTruth"), frontend.indexOf("function metricSourceRows"));
  assert.doesNotMatch(frontendTruth, /estimatedArrivalAt|estimatedDepartureAt|scheduleKitArrivalAt/);
  assert.match(staged, /MS_REC04_HISTORY_FRESHNESS_TRUTH_V1/);
  assert.match(staged, /parcelCounts\.sourceEvaluated === true/);
  assert.match(staged, /lastMeaningfulObservationAt/);
  assert.match(runtime, /BUS_TIME_MAX_CALLS_PER_CYCLE = 3/);
  assert.match(runtime, /BUS_TIME_P3_MAX_CALLS_PER_CYCLE = 1/);
  assert.match(runtime, /BUS_TIME_P3_MAX_ROWS_PER_CYCLE = 25/);
  assert.doesNotMatch(devConfig, /d1_databases/);
});
