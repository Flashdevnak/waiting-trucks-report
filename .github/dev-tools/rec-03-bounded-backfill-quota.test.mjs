import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { stageWorker } from "./stage-dev-runtime.mjs";
import {
  BUS_TIME_MAX_CALLS_PER_CYCLE,
  BUS_TIME_P2_MAX_CALLS_PER_CYCLE,
  BUS_TIME_P2_MAX_ROWS_PER_CYCLE,
  BUS_TIME_P3_MAX_CALLS_PER_CYCLE,
  BUS_TIME_P3_MAX_ROWS_PER_CYCLE,
  BUS_TIME_P3_NO_MATCH_COOLDOWN_MS,
  BUS_TIME_P3_RANGE_DAYS,
  MS_DATA_COMPLETENESS,
  MS_FIELD_EVIDENCE,
  createBusTimeHotLane,
  planMsP3Backfill,
} from "./bus-time-hot-lane-v14-runtime.mjs";

const DAY_MS = 86_400_000;
const NOW = Date.parse("2026-09-21T12:00:00.000Z");
const TBR = "2026-09-19T05:30:00.000Z";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function response({ total = 0, items = [], status = 200, message = "" } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    async json() {
      return status === 200
        ? message
          ? { code: 0, msg: message }
          : { code: 1, data: { dataList: items, total } }
        : { code: 0, msg: message || `HTTP ${status}` };
    },
  };
}

function providerItem(proofId, day = TBR) {
  return {
    proof_id: [{ value: proofId }],
    next_store_info: [{ value: "NE1" }, { value: "ปลายทาง" }],
    line_info: [{ value: `LINE-${proofId}` }],
    kit_arrive_time: [],
    fleet_sign_info: [{ value: day }],
    parcel_count: [],
    pack_count: [],
    fleet_unloading_time: [],
  };
}

function historicalRow(id, proofId, businessDay = "2026-09-19", overrides = {}) {
  return {
    latestRowid: Number(id.replace(/\D/g, "")) || 1,
    routeId: id,
    businessDay,
    row: {
      id,
      hub: "NE1",
      proofId,
      attendanceType: "ปลายทาง",
      unloadingState: 2,
      actualArrivalAt: `${businessDay}T03:00:00.000Z`,
      scheduleTbrArrivalAt: "",
      ...overrides,
    },
  };
}

class FakeStatement {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = String(sql);
    this.args = args;
  }
  bind(...args) { return new FakeStatement(this.db, this.sql, args); }
  first() { return this.db.first(this.sql, this.args); }
  all() { return this.db.all(this.sql, this.args); }
  run() { return this.db.run(this.sql, this.args); }
}

class FakeDb {
  constructor(history = []) {
    this.latest = [...history];
    this.claims = new Map();
    this.routes = new Map(history.map((item) => [item.routeId, { ...item.row }]));
    this.historyWrites = [];
    this.queries = [];
  }
  prepare(sql) { return new FakeStatement(this, sql); }
  async first(sql, args) {
    this.queries.push({ kind: "first", sql, args });
    if (sql.includes("FROM ms_live_cache")) return null;
    if (sql.includes("FROM ms_bus_connections"))
      return { credentials_cipher: "cipher", last_error: "" };
    if (sql.includes("ms_route_latest_meta")) return { ready: 1 };
    if (sql.includes("FROM ms_sync_claims")) return this.claims.get(args[0]) || null;
    return null;
  }
  async all(sql, args) {
    this.queries.push({ kind: "all", sql, args });
    if (!sql.includes("FROM ms_route_latest")) return { results: [] };
    const [hub, startDay, endDay, cursorDay, , , cursorRowid, limit] = args;
    const rows = this.latest
      .filter((item) => item.row.hub === hub)
      .filter((item) => item.businessDay >= startDay && item.businessDay <= endDay)
      .filter((item) => !cursorDay || item.businessDay < cursorDay ||
        (item.businessDay === cursorDay && item.latestRowid < Number(cursorRowid)))
      .sort((a, b) => b.businessDay.localeCompare(a.businessDay) || b.latestRowid - a.latestRowid)
      .slice(0, Number(limit));
    return {
      results: rows.map((item) => ({
        latest_rowid: item.latestRowid,
        route_id: item.routeId,
        business_day: item.businessDay,
        payload_json: JSON.stringify(item.row),
      })),
    };
  }
  async run(sql, args) {
    this.queries.push({ kind: "run", sql, args });
    if (sql.startsWith("INSERT INTO ms_sync_claims")) {
      const [hub, source_hash, claim_token, state, lease_until, claimed_at, finished_at] = args;
      const current = this.claims.get(hub);
      const eligible = !current ||
        (current.state !== "ACTIVE" && current.lease_until <= claimed_at) ||
        (current.state === "ACTIVE" && current.lease_until < claimed_at);
      if (!eligible) return { meta: { changes: 0 } };
      this.claims.set(hub, {
        source_hash, claim_token, state, lease_until, claimed_at, finished_at,
      });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE ms_sync_claims")) {
      const [source_hash, lease_until, finished_at, hub, token] = args;
      const current = this.claims.get(hub);
      if (!current || current.claim_token !== token) return { meta: { changes: 0 } };
      this.claims.set(hub, {
        ...current,
        source_hash,
        state: "DONE",
        lease_until,
        finished_at,
      });
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 1 } };
  }
  async batch(statements) {
    for (const statement of statements) {
      const { sql, args } = statement;
      if (sql.startsWith("INSERT OR IGNORE INTO ms_route_history")) {
        const [, routeId, hub, acceptedAt, payload, candidateId, candidateHub] = args;
        const current = this.routes.get(candidateId);
        if (current && candidateHub === hub && !current.scheduleTbrArrivalAt) {
          this.historyWrites.push({ routeId, hub, snapshotAt: acceptedAt, payload: JSON.parse(payload) });
        }
      } else if (sql.startsWith("UPDATE ms_routes")) {
        const [tbr, acceptedAt, routeId, hub] = args;
        const current = this.routes.get(routeId);
        if (current?.hub === hub && !current.scheduleTbrArrivalAt) {
          current.scheduleTbrArrivalAt = tbr;
          current.syncedAt = acceptedAt;
          current.syncedBy = "MS_P3_BACKFILL";
        }
      }
    }
    return statements.map(() => ({ meta: { changes: 1 } }));
  }
}

function laneHarness({ history = [], fetchHandler = async () => response(), p3Enabled = true } = {}) {
  let clock = NOW;
  const db = new FakeDb(history);
  const calls = [];
  const lane = createBusTimeHotLane({
    liveSourceDays: () => ["2026-09-20", "2026-09-21"],
    thaiDayOffset: (offset) => new Date(Date.parse("2026-09-21T00:00:00.000Z") + Number(offset) * DAY_MS)
      .toISOString().slice(0, 10),
    normalizeProofId: (value) => String(value || "").trim().toUpperCase(),
    normalizeAttendance: (value) => String(value || "").trim(),
    matchHub: (store, hub) => String(store).toUpperCase().includes(String(hub).toUpperCase()),
    msDate: (value) => String(value || ""),
    parseUnloadingStart: () => "",
    parseUnloadingEnd: () => "",
    decryptMs: async () => JSON.stringify({ auth: "auth" }),
    safeStatusWrite: async (promise) => promise,
    markSuccess: async () => ({ meta: { changes: 1 } }),
    markError: async () => ({ meta: { changes: 1 } }),
    classifyFailure: (message, status = 0) => {
      if (status === 429 || /limit/i.test(String(message)))
        return { code: "BUS_TIME_RATE_LIMIT", status: 429 };
      if (/login|session|auth/i.test(String(message)))
        return { code: "BUS_TIME_SESSION_EXPIRED", status: 502 };
      return { code: "BUS_TIME_SOURCE_ERROR", status: 502 };
    },
    fetchFn: async (url) => {
      const parsed = new URL(url);
      const call = {
        day: parsed.searchParams.get("startDate"),
        page: Number(parsed.searchParams.get("page")),
        fleetStatus: parsed.searchParams.get("fleetStatus"),
      };
      calls.push(call);
      return fetchHandler(call);
    },
    now: () => clock,
    random: () => 0,
    logger: { warn() {}, error() {}, log() {} },
    p3Enabled,
  });
  return {
    env: { DB: db }, lane, db, calls,
    advance(ms) { clock += ms; },
    now: () => clock,
  };
}

function buildStagedCoordinator() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rec-03-coordinator-"));
  const target = path.join(dir, "index.js");
  fs.writeFileSync(target, stageWorker(fs.readFileSync(path.join(root, "worker/src/index.js"), "utf8")));
  for (const relative of [
    "cloudflare-browser-test/scripts/patch-dev-tbr-shadow-readonly.mjs",
    "cloudflare-browser-test/scripts/patch-dev-tbr-shadow-split-v2.mjs",
    ".github/dev-tools/patch-bus-time-hot-lane-v14.mjs",
  ]) execFileSync(process.execPath, [path.join(root, relative), target], { stdio: "pipe" });
  const source = fs.readFileSync(target, "utf8");
  fs.rmSync(dir, { recursive: true, force: true });
  const start = source.indexOf("export class MsRefreshCoordinator");
  const end = source.indexOf("\n\n// MS_CRON_LIVE_REFRESH_V1", start);
  assert.ok(start >= 0 && end > start, "staged coordinator class must be extractable");
  const classSource = source.slice(start, end).replace("export class", "class");
  return { source, classSource };
}

const stagedCoordinator = buildStagedCoordinator();

async function sharedRefreshCounts(readers) {
  const counts = { route: 0, busTime: 0, preEntry: 0 };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const runMsRefresh = async () => {
    await Promise.all([
      (async () => { counts.route += 1; await gate; })(),
      (async () => { counts.busTime += 1; await gate; })(),
      (async () => { counts.preEntry += 1; await gate; })(),
    ]);
    return { rows: [], syncedAt: new Date(NOW).toISOString() };
  };
  const FixedDate = class extends Date {
    constructor(...args) {
      super(args.length ? args[0] : NOW);
    }

    static now() {
      return NOW;
    }
  };
  const Coordinator = new Function(
    "runMsRefresh",
    "Date",
    `const MS_CRON_ACTIVE_SKIP_MS=45000,MS_REALTIME_SOURCE_MIN_MS=3000,MS_SYNC_TTL=3000,
       MS_ROUTE_RATE_LIMIT_MAX_COOLDOWN_MS=3600000,MS_ROUTE_RATE_LIMIT_BASE_COOLDOWN_MS=300000,
       MS_ROUTE_QUOTA_GUARD_KEY="route-quota-guard-v12";
     ${stagedCoordinator.classSource}
     return MsRefreshCoordinator;`,
  )(runMsRefresh, FixedDate);
  const coordinator = Object.assign(Object.create(Coordinator.prototype), {
    ctx: {
      waitUntil() {},
      storage: { async put() {}, async delete() {} },
      getWebSockets: () => [],
    },
    env: {},
    active: null,
    lastResult: null,
    recentUntil: 0,
    lastSourceAt: 0,
    routeRateLimitedUntil: 0,
    routeRateLimitStrikes: 0,
    repair: { nextRetryAt: 0 },
    loadRepairState: async () => {},
    recordRepairResult: async () => {},
    repairView: () => ({}),
    publishSupervisorSnapshot: async () => {},
  });
  const pending = Array.from({ length: readers }, () => coordinator.refresh("NE1", false, false));
  await Promise.resolve();
  release();
  await Promise.all(pending);
  return counts;
}

test("REC-03 P3 planner is HUB/record/missing bounded and excludes complete/origin/non-applicable", () => {
  const rows = Array.from({ length: 30 }, (_, index) => historicalRow(
    `R${30 - index}`,
    `P${index}`,
    "2026-09-19",
    index === 0
      ? { scheduleTbrArrivalAt: TBR, dataCompleteness: MS_DATA_COMPLETENESS.COMPLETE }
      : index === 1
        ? { attendanceType: "ต้นทาง", fieldEvidence: { scheduleTbrArrivalAt: { state: MS_FIELD_EVIDENCE.NOT_APPLICABLE } } }
        : {},
  ));
  rows[2].row.hub = "EA2";
  rows[2].hub = "EA2";
  const plan = planMsP3Backfill(rows, { hub: "NE1", limit: 25 });
  assert.equal(plan.scanned, 25);
  assert.ok(plan.selected.length <= BUS_TIME_P3_MAX_ROWS_PER_CYCLE);
  assert.equal(plan.selected.some((item) => item.row.scheduleTbrArrivalAt), false);
  assert.equal(plan.selected.some((item) => item.row.attendanceType === "ต้นทาง"), false);
  assert.equal(plan.selected.every((item) => item.row.hub === "NE1"), true);
});

test("REC-03 P3 query is indexed, HUB/date/range/record bounded, and one cycle uses one leftover call", async () => {
  const h = laneHarness({
    history: [historicalRow("R9", "HIST-1")],
    fetchHandler: async () => response({ items: [providerItem("HIST-1")], total: 1 }),
  });
  await h.lane.readBusTimeData(h.env, "NE1", ["2026-09-21"], []);
  assert.deepEqual(h.calls, [{ day: "2026-09-19", page: 1, fleetStatus: "" }]);
  const query = h.db.queries.find((item) => item.kind === "all" && item.sql.includes("FROM ms_route_latest"));
  assert.ok(query);
  assert.match(query.sql, /INDEXED BY idx_ms_route_latest_hub_day/);
  assert.match(query.sql, /l\.hub=\?/);
  assert.match(query.sql, /business_day>=\? AND business_day<=\?/);
  assert.match(query.sql, /actualArrivalAt/);
  assert.match(query.sql, /scheduleTbrArrivalAt/);
  assert.doesNotMatch(query.sql, /l\.business_day>=\?/);
  assert.match(query.sql, /LIMIT \?/);
  assert.equal(query.args[0], "NE1");
  assert.equal(query.args.at(-1), BUS_TIME_P3_MAX_ROWS_PER_CYCLE);
  assert.equal(BUS_TIME_P3_RANGE_DAYS, 7);
  assert.equal(BUS_TIME_P3_MAX_CALLS_PER_CYCLE, 1);
  assert.equal(BUS_TIME_MAX_CALLS_PER_CYCLE, 3);
});

test("REC-03 P3 late evidence is persisted missing-only with observed/fetched/accepted provenance", async () => {
  const h = laneHarness({
    history: [historicalRow("R7", "LATE")],
    fetchHandler: async () => response({ items: [providerItem("LATE")], total: 1 }),
  });
  const before = new Date(NOW - DAY_MS).toISOString();
  const result = await h.lane.readBusTimeData(h.env, "NE1", ["2026-09-21"], []);
  const cached = result.get("P:LATE|A:ปลายทาง");
  const evidence = cached.fieldEvidence.scheduleTbrArrivalAt;
  assert.equal(evidence.state, MS_FIELD_EVIDENCE.OBSERVED);
  assert.equal(evidence.source, "BUS_TIME");
  assert.equal(evidence.valueTimestamp, TBR);
  assert.equal(evidence.observedAt, new Date(NOW).toISOString());
  assert.equal(evidence.fetchedAt, new Date(NOW).toISOString());
  assert.equal(evidence.acceptedAt, new Date(NOW).toISOString());
  assert.equal(evidence.boundary, "P3_BACKFILL_ACCEPTED_AT");
  assert.equal(evidence.enrichmentOrigin, "P3");
  assert.equal(evidence.backfill, true);
  assert.equal(h.db.historyWrites.length, 1);
  assert.equal(h.db.historyWrites[0].snapshotAt, new Date(NOW).toISOString());
  assert.equal(h.db.historyWrites.filter((entry) => entry.snapshotAt <= before).length, 0);
  const pointInTime = fs.readFileSync(path.join(root, "worker/src/index.js"), "utf8");
  assert.match(pointInTime, /h2\.snapshot_at<=\?/);
  assert.match(pointInTime, /historyMode:\s*"POINT_IN_TIME"/);
});

test("REC-03 provider overfetch is retained then persisted when its bounded record batch resumes", async () => {
  const history = Array.from({ length: 26 }, (_, index) =>
    historicalRow(`R${26 - index}`, `OVER-${26 - index}`));
  const h = laneHarness({
    history,
    fetchHandler: async () => response({ items: [providerItem("OVER-1")], total: 1 }),
  });
  await h.lane.readBusTimeData(h.env, "NE1", ["2026-09-21"], []);
  assert.equal(h.calls.length, 1);
  assert.equal(h.db.routes.get("R1").scheduleTbrArrivalAt, "");
  h.advance(BUS_TIME_P3_NO_MATCH_COOLDOWN_MS);
  await h.lane.readBusTimeData(h.env, "NE1", ["2026-09-21"], []);
  assert.equal(h.calls.length, 1, "cached shared-page evidence must not cause a per-record refetch");
  assert.equal(h.db.routes.get("R1").scheduleTbrArrivalAt, TBR);
  assert.equal(h.db.historyWrites.at(-1).payload.fieldEvidence.scheduleTbrArrivalAt.enrichmentOrigin, "P3");
});

test("REC-03 checkpoint advances, resumes provider pagination, and no-match cooldown prevents churn", async () => {
  const h = laneHarness({
    history: [historicalRow("R8", "MISS")],
    fetchHandler: async () => response({ total: 200, items: [] }),
  });
  await h.lane.readBusTimeData(h.env, "NE1", ["2026-09-21"], []);
  let diag = h.lane.diagnostics("NE1");
  assert.equal(diag.busP3Checkpoint.providerDay, "2026-09-19");
  assert.equal(diag.busP3Checkpoint.providerPage, 2);
  assert.equal(diag.busP3CooldownCode, "P3_NO_MATCH");
  const checkpoint = JSON.stringify(diag.busP3Checkpoint);
  h.advance(4_000);
  await Promise.all(Array.from({ length: 100 }, () =>
    h.lane.readBusTimeData(h.env, "NE1", ["2026-09-21"], [])));
  assert.equal(h.calls.length, 1);
  assert.equal(JSON.stringify(h.lane.diagnostics("NE1").busP3Checkpoint), checkpoint);
  h.advance(BUS_TIME_P3_NO_MATCH_COOLDOWN_MS - 4_000);
  await h.lane.readBusTimeData(h.env, "NE1", ["2026-09-21"], []);
  diag = h.lane.diagnostics("NE1");
  assert.deepEqual(h.calls.map((call) => call.page), [1, 2]);
  assert.equal(diag.busP3Checkpoint.providerDay, "");
  assert.equal(diag.busP3Checkpoint.cursorRouteId, "R8");
});

test("REC-03 P3 cooldown distinguishes rate limit, source unavailable, and transient failure", async () => {
  const cases = [
    {
      expected: "P3_RATE_LIMIT",
      reply: () => response({ status: 429, message: "rate limit" }),
    },
    {
      expected: "P3_SOURCE_UNAVAILABLE",
      reply: () => response({ message: "need login" }),
    },
    {
      expected: "P3_TRANSIENT_FAILURE",
      reply: () => response({ status: 500 }),
    },
  ];
  for (const [index, item] of cases.entries()) {
    const h = laneHarness({
      history: [historicalRow(`RF${index + 1}`, `FAIL-${index + 1}`)],
      fetchHandler: async () => item.reply(),
    });
    await h.lane.readBusTimeData(h.env, "NE1", ["2026-09-21"], []);
    const diag = h.lane.diagnostics("NE1");
    assert.equal(diag.busP3CooldownCode, item.expected);
    assert.ok(Date.parse(diag.busP3CooldownUntil) > NOW);
    const checkpoint = JSON.stringify(diag.busP3Checkpoint);
    h.advance(4_000);
    await h.lane.readBusTimeData(h.env, "NE1", ["2026-09-21"], []);
    assert.equal(h.calls.length, 1);
    assert.equal(JSON.stringify(h.lane.diagnostics("NE1").busP3Checkpoint), checkpoint);
  }
});

test("REC-03 strict priority reserves P2 and defers P3 when P1/P2 exhaust all three calls", async () => {
  const h = laneHarness({
    history: [historicalRow("R6", "P3-HIST")],
    fetchHandler: async () => response({ total: 300, items: [] }),
  });
  const current = [
    { id: "A", hub: "NE1", proofId: "P1", attendanceType: "ปลายทาง", unloadingState: 0 },
    { id: "C", hub: "NE1", proofId: "P2", attendanceType: "ปลายทาง", unloadingState: 2 },
  ];
  await h.lane.readBusTimeData(h.env, "NE1", ["2026-09-21"], current);
  assert.deepEqual(h.calls.map((call) => call.fleetStatus), ["1", "1", ""]);
  const diag = h.lane.diagnostics("NE1");
  assert.equal(diag.busP1Calls, 2);
  assert.equal(diag.busP2Calls, 1);
  assert.equal(diag.busP3Calls, 0);
  assert.equal(diag.busP3DeferredReason, "BUDGET_EXHAUSTED");
  assert.equal(diag.busBudgetExhausted, true);
  assert.equal(diag.busP3Checkpoint.cursorDay, "");
  assert.equal(BUS_TIME_P2_MAX_CALLS_PER_CYCLE, 1);
  assert.equal(BUS_TIME_P2_MAX_ROWS_PER_CYCLE, 25);
});

test("REC-03 P3 consumes only the third leftover slot after P1 then P2", async () => {
  const h = laneHarness({
    history: [historicalRow("R5", "P3-HIST")],
    fetchHandler: async ({ day }) => day === "2026-09-19"
      ? response({ items: [providerItem("P3-HIST")], total: 1 })
      : response({ total: 0, items: [] }),
  });
  await h.lane.readBusTimeData(h.env, "NE1", ["2026-09-21"], [
    { id: "A", hub: "NE1", proofId: "P1", attendanceType: "ปลายทาง", unloadingState: 0 },
    { id: "C", hub: "NE1", proofId: "P2", attendanceType: "ปลายทาง", unloadingState: 2 },
  ]);
  assert.deepEqual(h.calls.map((call) => [call.day, call.fleetStatus]), [
    ["2026-09-21", "1"],
    ["2026-09-21", ""],
    ["2026-09-19", ""],
  ]);
  const diag = h.lane.diagnostics("NE1");
  assert.equal(diag.busPagesLastCycle, 3);
  assert.equal(diag.busP3Calls, 1);
  assert.equal(diag.busP3Accepted, 1);
});

test("REC-03 cross-isolate P3 claim permits exactly one provider flight", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const shared = new FakeDb([historicalRow("R4", "XISO")]);
  let providerCalls = 0;
  const make = () => {
    const h = laneHarness({
      history: [],
      fetchHandler: async () => {
        providerCalls += 1;
        await gate;
        return response({ items: [providerItem("XISO")], total: 1 });
      },
    });
    h.env.DB = shared;
    return h;
  };
  const a = make();
  const b = make();
  const first = a.lane.readBusTimeData(a.env, "NE1", ["2026-09-21"], []);
  await Promise.resolve();
  const second = b.lane.readBusTimeData(b.env, "NE1", ["2026-09-21"], []);
  await Promise.resolve();
  release();
  await Promise.all([first, second]);
  assert.equal(providerCalls, 1);
  assert.equal(
    [a.lane.diagnostics("NE1"), b.lane.diagnostics("NE1")]
      .some((diag) => diag.busP3DeferredReason === "SHARED_FLIGHT"),
    true,
  );
  assert.ok(shared.claims.has("__BUS_P3__:NE1"));
  assert.equal(shared.claims.has("NE1"), false, "P3 namespace cannot collide with route sync claims");
  const claimSql = shared.queries.find((entry) =>
    entry.kind === "run" && entry.sql.startsWith("INSERT INTO ms_sync_claims"))?.sql || "";
  assert.doesNotMatch(claimSql, /source_hash<>excluded\.source_hash/);
  await b.lane.readBusTimeData(b.env, "NE1", ["2026-09-21"], []);
  assert.equal(providerCalls, 1, "a stale isolate cannot bypass the finished owner's cooldown");
});

test("REC-03 exact Route/BusTime/PreEntry same-HUB reader matrix stays 1/1/1", async () => {
  for (const readers of [1, 10, 100]) {
    assert.deepEqual(await sharedRefreshCounts(readers), {
      route: 1,
      busTime: 1,
      preEntry: 1,
    }, `${readers} readers must share one refresh flight`);
  }
  assert.match(stagedCoordinator.source, /const preEntrySourceActive = new Map\(\)/);
  assert.match(stagedCoordinator.source, /if \(preEntrySourceActive\.has\(key\)\) return preEntrySourceActive\.get\(key\)/);
  assert.match(stagedCoordinator.source, /MS_ROUTE_ACTIVE_REFRESH_JOIN_V1/);
});

test("REC-03 exact BusTime lane matrix is one provider call for 1/10/100 readers", async () => {
  for (const readers of [1, 10, 100]) {
    const h = laneHarness({
      p3Enabled: false,
      fetchHandler: async () => response({ items: [providerItem("LIVE", "2026-09-21T05:30:00.000Z")], total: 1 }),
    });
    const route = [{ proofId: "LIVE", attendanceType: "ปลายทาง", unloadingState: 0 }];
    await Promise.all(Array.from({ length: readers }, () =>
      h.lane.readBusTimeData(h.env, "NE1", ["2026-09-21"], route)));
    assert.equal(h.calls.length, 1, `${readers} BusTime readers`);
  }
});

test("REC-03 reconnect burst keeps Route/BusTime/PreEntry at one flight", async () => {
  assert.deepEqual(await sharedRefreshCounts(100), { route: 1, busTime: 1, preEntry: 1 });
});

test("REC-03 telemetry is observational and exposes deterministic P1/P2/P3 budget truth", async () => {
  const h = laneHarness({ history: [historicalRow("R3", "TEL")] });
  await h.lane.readBusTimeData(h.env, "NE1", ["2026-09-21"], []);
  const before = h.calls.length;
  const diag = h.lane.diagnostics("NE1");
  const after = h.calls.length;
  for (const key of [
    "busP1Unresolved", "busP1Rows", "busP1Calls",
    "busP2Unresolved", "busP2Rows", "busP2Calls",
    "busP3Pending", "busP3Rows", "busP3Calls", "busP3Checkpoint",
    "busP3CooldownUntil", "busP3CooldownCode", "busP3Deferred",
    "busSharedCalls", "busDeduplicatedReaders", "busBudgetExhausted",
  ]) assert.ok(Object.hasOwn(diag, key), `missing telemetry ${key}`);
  assert.equal(after, before, "diagnostics must not poll provider");
  assert.equal(diag.maxCallsPerCycle, 3);
  assert.equal(diag.maxP3CallsPerCycle, 1);
  assert.equal(diag.maxP3RowsPerCycle, 25);
});

test("REC-03 architecture uses existing additive schemas and no D1 binding", () => {
  const claimMigration = fs.readFileSync(path.join(root, "worker/migrations/0008_ms_sync_claims.sql"), "utf8");
  const latestMigration = fs.readFileSync(path.join(root, "worker/migrations/0012_ms_route_latest_pointer.sql"), "utf8");
  const config = fs.readFileSync(path.join(root, "worker/wrangler.dev.jsonc"), "utf8");
  assert.match(claimMigration, /hub TEXT PRIMARY KEY NOT NULL/);
  assert.match(latestMigration, /idx_ms_route_latest_hub_day/);
  assert.match(latestMigration, /ms_route_latest_meta/);
  assert.doesNotMatch(config, /d1_databases/);
});
