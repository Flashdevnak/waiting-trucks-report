import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import test from "node:test";
import { stageWorker } from "./stage-dev-runtime.mjs";
import { patchMsRoutePersistenceV1 } from "./patch-ms-route-persistence-v1.mjs";
import { workerHelpers } from "./patch-ms-resilience-v1.mjs";
import {
  planMsChanges, resolveCompletionTruth, sameMsRouteCore,
} from "../../worker/src/sync-policy.js";

const canonical = readFileSync(new URL("../../worker/src/index.js", import.meta.url), "utf8");
const staged = patchMsRoutePersistenceV1(stageWorker(canonical));
const start = staged.indexOf("async function syncMs(body, actor, env) {");
const end = staged.indexOf("\nasync function ", start + 20);
assert.ok(start > 0 && end > start);
const syncSource = staged.slice(start, end);

function fixture() {
  const route = new Map();
  const history = [];
  const registry = new Set();
  let batches = 0, failBatch = 0;
  const columns = ["id", "hub", "proofId", "routeName", "region",
    "routeAttribute", "routeType", "attendanceType", "estimatedArrivalAt",
    "actualArrivalAt", "estimatedDepartureAt", "actualDepartureAt", "supplier",
    "vehicleType", "plate", "driverName", "driverPhone", "trackingStatus",
    "vehicleStatus", "loadStatus", "unloadingState", "unloadingCompletedAt",
    "sourceUpdatedAt", "expectedParcels", "enteredParcels", "pendingParcels",
    "scheduleKitArrivalAt", "scheduleTbrArrivalAt", "arrivedParcels", "arrivedBags",
    "syncedAt", "syncedBy"];
  const enrichment = columns.slice(23, 30);
  const db = {
    prepare(sql) {
      return { bind(...args) {
        return { sql, args,
          all: async () => ({ results: sql.includes("FROM ms_routes r")
            ? [...route.values()].filter((row) => row.hub === args[0]).map((row) => ({
              ...row, route_history_payload: [...history].reverse()
                .find((item) => item.hub === row.hub && item.id === row.id)?.payload || null,
            })) : [] }),
        };
      } };
    },
    async batch(statements) {
      batches++;
      assert.ok(statements.length <= 96);
      if (batches === failBatch) { failBatch = 0; throw new Error("transaction failed"); }
      for (const { sql, args } of statements) {
        if (sql.includes("INTO ms_route_registry")) registry.add(args[0] + ":" + args[1]);
        else if (sql.includes("INTO ms_route_history")) history.push({
          id: args[1], hub: args[2], event: args[3], payload: args[5],
        });
        else if (sql.includes("INTO ms_routes")) route.set(args[0],
          Object.fromEntries(columns.map((key, index) => [key, args[index]])));
        else if (sql.startsWith("UPDATE ms_routes")) {
          const row = route.get(args[8]);
          for (let i = 0; i < enrichment.length; i++) row[enrichment[i]] = args[i];
        } else if (sql.startsWith("DELETE FROM ms_routes")) route.delete(args[1]);
        else assert.fail(sql);
      }
    },
  };
  const context = {
    Map, Set, Promise, Number, String, Date, JSON, Boolean,
    crypto: { randomUUID: () => "h" + (history.length + 1) },
    planMsChanges, sameMsRouteCore, resolveCompletionTruth,
    ensureMsCompletionRepair: async () => {},
    text: (value) => String(value ?? ""), phone: (value) => String(value ?? ""),
    date: (value) => String(value || ""),
    numberOrNull: (value) => value == null ? null : Number(value),
    normalizeProofId: (value) => String(value || ""),
    resolveUnloadingStartTruth: (prior) => ({ at: prior?.unloadingStartedAt || "", observedAt: "", source: "UNKNOWN" }),
    sha: async (value) => value,
    access: () => true, fail: (message) => { throw new Error(message); },
    output: (row) => row, audit: async () => {},
    console: { error() {} },
  };
  createContext(context);
  runInContext(syncSource + "\nglobalThis.syncMs = syncMs;", context);
  const actor = { role: "admin", username: "MS_AUTO", branches: ["*"] };
  return { route, history, registry,
    setFailBatch: (value) => { failBatch = value; },
    get batches() { return batches; },
    sync: (hub, rows) => context.syncMs({ branch: hub, rows }, actor, { DB: db }),
  };
}

function rows(count, extra = {}) {
  return Array.from({ length: count }, (_, i) => ({
    proofId: "P" + i, attendanceType: "ต้นทาง", routeName: "R" + i,
    estimatedArrivalAt: "2026-10-03T01:00:00.000Z",
    estimatedDepartureAt: "2026-10-03T02:00:00.000Z",
    sourceUpdatedAt: "2026-10-03T01:01:00.000Z",
    unloadingState: 1, ...extra,
  }));
}

test("optional PreEntry, BusTime and combined changes do not create Route history", async () => {
  const h = fixture(), initial = rows(1);
  await h.sync("FUTURE_A", initial);
  const key = "FUTURE_A|P0|ต้นทาง|2026-10-03T01:00:00.000Z";
  const first = h.route.get(key).syncedAt;
  for (const extra of [{ pendingParcels: 3 },
    { scheduleTbrArrivalAt: "2026-10-03T01:05:00.000Z" },
    { pendingParcels: 4, scheduleTbrArrivalAt: "2026-10-03T01:06:00.000Z" }]) {
    const result = await h.sync("FUTURE_A", rows(1, extra));
    assert.equal(result.changes, 0);
    assert.equal(h.history.length, 1);
    assert.equal(h.route.get(key).syncedAt, first);
  }
  assert.equal(h.route.get(key).pendingParcels, 4);
});

test("partial batch retry preserves committed history, provenance and timestamps", async () => {
  const h = fixture(), schedule = "2026-10-03T01:20:00.000Z";
  const incoming = rows(102, { unloadingState: 2, scheduleUnloadingCompletedAt: schedule });
  h.setFailBatch(2);
  await assert.rejects(h.sync("FUTURE_B", incoming), /transaction failed/);
  assert.equal(h.route.size, 32);
  assert.equal(h.history.length, 32);
  const key = "FUTURE_B|P0|ต้นทาง|2026-10-03T01:00:00.000Z";
  const first = h.route.get(key).syncedAt;
  const retried = await h.sync("FUTURE_B", rows(102, { unloadingState: 2 }));
  assert.equal(retried.changes, 70);
  assert.equal(h.route.size, 102);
  assert.equal(h.history.length, 102);
  assert.equal(h.registry.size, 102);
  assert.equal(h.route.get(key).syncedAt, first);
  assert.equal(retried.rows[0].completionSource, "SCHEDULE");
  assert.equal(retried.rows[0].unloadingCompletedAt, schedule);
  const repeat = await h.sync("FUTURE_B", rows(102, { unloadingState: 2 }));
  assert.equal(repeat.changes, 0);
  assert.equal(h.history.length, 102);
});

test("all real Route changes persist through 2,000 rows without split groups", async () => {
  for (const count of [1, 10, 100, 300, 700, 1000, 2000]) {
    const h = fixture(), initial = rows(count);
    await h.sync("FUTURE_A", initial);
    assert.equal(h.history.length, count);
    const changed = initial.map((row) => ({ ...row, trackingStatus: "DEPARTED" }));
    const result = await h.sync("FUTURE_A", changed);
    assert.equal(result.changes, count);
    assert.equal(h.history.filter((item) => item.event === "UPDATED").length, count);
    assert.equal(h.route.size, count);
  }
});

test("future HUBs remain isolated across completion, removal and retry", async () => {
  const h = fixture();
  const common = rows(2);
  await h.sync("FUTURE_A", common);
  await h.sync("FUTURE_B", common);
  const firstB = [...h.route.values()].filter((row) => row.hub === "FUTURE_B");
  await h.sync("FUTURE_A", [{ ...common[0], actualDepartureAt: "2026-10-03T02:30:00.000Z" }]);
  assert.equal(h.history.filter((item) => item.hub === "FUTURE_A" && item.event === "REMOVED").length, 1);
  assert.equal(h.route.size, 3);
  assert.deepEqual([...h.route.values()].filter((row) => row.hub === "FUTURE_B"), firstB);
  assert.equal(h.history.filter((item) => item.hub === "FUTURE_B").length, 2);
  const again = await h.sync("FUTURE_B", common);
  assert.equal(again.changes, 0);
  assert.equal(h.history.filter((item) => item.hub === "FUTURE_B").length, 2);
});

test("final staging keeps generic HUB identity and the source cadence", () => {
  assert.match(staged, /MS_ROUTE_PERSISTENCE_V1/);
  assert.match(staged, /msCoordinatorIdentity\(branch\)/);
  assert.doesNotMatch(syncSource, /\b(?:NE1|EA2|FUTURE_A|FUTURE_B)\b/);
  assert.match(staged, /MS_CRON_ACTIVE_SKIP_MS = 45 \* 1000/);
  assert.match(staged, /MS_SYNC_CLAIM_LEASE_MS = 75000/);
  assert.match(staged, /ms_route_latest l ON l\.hub=r\.hub AND l\.route_id=r\.id/);
  assert.match(syncSource, /const businessChanges = coreChangedIds\.size \+ removedIds\.size/);
  assert.match(staged, /cacheWrite = publishSource\s*\? await writeMsLiveCache/);
});

function deadlineHarness(elapsedPerPipeline = 300) {
  let clock = 0;
  const trace = [];
  const database = {
    async _pipeline(requests) {
      clock += elapsedPerPipeline;
      trace.push(requests);
      return { results: [] };
    },
  };
  const context = { Map, Promise, Proxy, Object, Number, String,
    Date: class extends Date { static now() { return clock; } },
    setTimeout: () => 1, clearTimeout() {},
    console: { warn() {} },
  };
  createContext(context);
  runInContext(workerHelpers + "\nglobalThis.msLiveDatabaseEnv = msLiveDatabaseEnv;", context);
  const env = context.msLiveDatabaseEnv({ DB: database });
  return { env, trace, context,
    pipeline: (sql) => env.DB._pipeline([{ type: "execute", stmt: { sql } }]),
  };
}

test("NE1 and EA2 shaped Route pipelines pass their former cumulative deadline", async () => {
  for (const [pipelines, statements, elapsed] of [[11, 306, 300], [13, 405, 250]]) {
    const h = deadlineHarness(elapsed);
    await h.pipeline("SELECT * FROM ms_routes WHERE hub=?");
    for (let i = 1; i < pipelines; i++) {
      const count = i === pipelines - 1 ? statements - (pipelines - 2) * 30 : 30;
      const requests = Array.from({ length: count }, () => ({ type: "execute",
        stmt: { sql: "INSERT INTO ms_route_history VALUES(?)" } }));
      await h.env.DB._pipeline(requests);
    }
    assert.equal(h.trace.length, pipelines);
  }
});

test("critical reads retain 2800ms cumulative protection", async () => {
  const h = deadlineHarness(200);
  for (let i = 0; i < 14; i++) await h.pipeline("SELECT * FROM ms_routes WHERE hub=?");
  await assert.rejects(h.pipeline("SELECT * FROM ms_routes WHERE hub=?"),
    (error) => error.code === "TURSO_LIVE_TIMEOUT" &&
      error.dbTrace.failureStage === "route_state_read");
});

test("an individually stalled Route transaction times out and rolls back late response", async () => {
  let expire, resolvePending, rollback = 0;
  const database = {
    _pipeline: () => new Promise((resolve) => { resolvePending = resolve; }),
    _finishTransaction: async (_payload, command) => {
      assert.equal(command, "ROLLBACK"); rollback++;
    },
  };
  const context = { Map, Promise, Proxy, Object, Number, String, Date,
    setTimeout: (callback) => { expire = callback; return 1; },
    clearTimeout() {}, console: { warn() {} },
  };
  createContext(context);
  runInContext(workerHelpers + "\nglobalThis.msLiveDatabaseEnv = msLiveDatabaseEnv;", context);
  const env = context.msLiveDatabaseEnv({ DB: database });
  const task = env.DB._pipeline([
    { type: "execute", stmt: { sql: "BEGIN IMMEDIATE" } },
    { type: "execute", stmt: { sql: "INSERT INTO ms_route_history VALUES(?)" } },
  ]);
  expire();
  await assert.rejects(task, (error) => error.code === "TURSO_LIVE_TIMEOUT" &&
    error.dbTrace.failureStage === "route_batch_write");
  resolvePending({ baton: "opaque", results: [] });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(rollback, 1);
});
