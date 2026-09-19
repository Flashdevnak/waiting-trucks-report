import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stageWorker } from "./stage-dev-runtime.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const seedRoot = path.resolve(repoRoot, ".github/bus-hot-lane-v14");
const generatedRoot = path.resolve(repoRoot, ".github/dev-tools");
const pick = (name) => fs.existsSync(path.join(generatedRoot, name))
  ? path.join(generatedRoot, name)
  : path.join(seedRoot, name);

const hotPatch = pick("patch-bus-time-hot-lane-v14.mjs");
const runtimePath = pick("bus-time-hot-lane-v14-runtime.mjs");
const readonlyPatch = path.join(
  repoRoot,
  "cloudflare-browser-test/scripts/patch-dev-tbr-shadow-readonly.mjs",
);
const splitPatch = path.join(
  repoRoot,
  "cloudflare-browser-test/scripts/patch-dev-tbr-shadow-split-v2.mjs",
);
const canonicalWorker = path.join(repoRoot, "worker/src/index.js");

const {
  createBusTimeHotLane,
  parseBusRetryAfter,
  legacyBusCallsPerMinute,
  BUS_TIME_MAX_CALLS_PER_CYCLE,
  BUS_TIME_HAR_SEED_MAX_AGE_MS,
  BUS_TIME_HOT_REUSE_MS,
  BUS_TIME_RATE_LIMIT_BASE_COOLDOWN_MS,
} = await import(`${pathToFileURL(runtimePath).href}?v=${Date.now()}`);

function stageBusReader() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bus-hot-lane-v14-"));
  const worker = path.join(dir, "index.js");
  fs.writeFileSync(worker, stageWorker(fs.readFileSync(canonicalWorker, "utf8")));
  execFileSync(process.execPath, [readonlyPatch, worker], { stdio: "pipe" });
  execFileSync(process.execPath, [splitPatch, worker], { stdio: "pipe" });
  execFileSync(process.execPath, [hotPatch, worker], { stdio: "pipe" });
  return {
    dir,
    worker,
    runtime: path.join(dir, "bus-time-hot-lane-v14.js"),
    source: fs.readFileSync(worker, "utf8"),
  };
}

function item(proofId, hub = "NE1", attendance = "ปลายทาง") {
  return {
    proof_id: [{ value: proofId }],
    next_store_info: [{ value: hub }, { value: attendance }],
    line_info: [{ value: `LINE-${proofId}` }],
    kit_arrive_time: [{ value: "2026-09-13T00:01:00.000Z" }],
    fleet_sign_info: [{ value: "2026-09-13T00:02:00.000Z" }],
    parcel_count: [{ value: "10" }],
    pack_count: [{ value: "2" }],
    fleet_unloading_time: [],
  };
}

function response({ status = 200, total = 0, items = [], message = "", retryAfter = "" } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => String(name).toLowerCase() === "retry-after" ? retryAfter : null },
    async json() {
      if (status === 200)
        return message
          ? { code: 0, msg: message }
          : { code: 1, data: { dataList: items, total } };
      return { code: 0, msg: message || `HTTP ${status}` };
    },
  };
}

function harness({
  acceptedRows = [],
  fetchHandler = async () => response(),
  start = Date.parse("2026-09-13T03:00:00+07:00"),
  rateLeaseStore = { row: null },
  connectionState = { lastError: "", lastSuccessAt: "" },
} = {}) {
  let clock = start;
  let credentialReads = 0;
  let seedReads = 0;
  let statusWrites = 0;
  let rateLeaseReads = 0;
  let rateLeaseUpserts = 0;
  let rateLeaseDeletes = 0;
  const calls = [];

  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() {
                if (String(sql).includes("FROM ms_live_cache")) {
                  seedReads += 1;
                  return acceptedRows.length
                    ? { rows_json: JSON.stringify(acceptedRows) }
                    : null;
                }
                if (String(sql).includes("FROM ms_bus_connections")) {
                  credentialReads += 1;
                  return {
                    credentials_cipher: "cipher",
                    last_error: connectionState.lastError || "",
                  };
                }
                if (String(sql).includes("FROM ms_sync_claims")) {
                  rateLeaseReads += 1;
                  return rateLeaseStore.row;
                }
                return null;
              },
              async run() {
                if (String(sql).startsWith("INSERT INTO ms_sync_claims")) {
                  rateLeaseUpserts += 1;
                  rateLeaseStore.row = {
                    source_hash: args[1],
                    claim_token: args[2],
                    state: args[3],
                    lease_until: args[4],
                  };
                } else if (String(sql).startsWith("DELETE FROM ms_sync_claims")) {
                  rateLeaseDeletes += 1;
                  if (
                    rateLeaseStore.row &&
                    rateLeaseStore.row.source_hash === args[1]
                  ) rateLeaseStore.row = null;
                }
                return { success: true };
              },
            };
          },
        };
      },
    },
  };

  const lane = createBusTimeHotLane({
    liveSourceDays: () => ["2026-09-12", "2026-09-13"],
    thaiDayOffset: (offset) => offset === -1 ? "2026-09-12" : "2026-09-13",
    normalizeProofId: (value) => String(value || "").trim().toUpperCase(),
    normalizeAttendance: (value) => String(value || "").trim(),
    matchHub: (store, hub) => String(store).toUpperCase().includes(String(hub).toUpperCase()),
    msDate: (value) => String(value || ""),
    parseUnloadingStart: () => "",
    parseUnloadingEnd: () => "",
    decryptMs: async () => JSON.stringify({
      auth: "auth",
      lang: "th",
      fbid: "fbid",
      time: "time",
      _from: "fbi",
    }),
    safeStatusWrite: async (promise) => {
      statusWrites += 1;
      await promise;
    },
    markSuccess: async () => {
      connectionState.lastError = "";
      connectionState.lastSuccessAt = new Date(clock).toISOString();
      return { success: true };
    },
    markError: async (_env, _table, _hub, message) => {
      connectionState.lastError = String(message || "");
      return { success: true };
    },
    classifyFailure: (message, httpStatus = 0) => {
      const text = String(message || "");
      if (Number(httpStatus) === 429 || /request\s+exceeds\s+the\s+limit|rate.?limit|too many requests/i.test(text))
        return { code: "BUS_TIME_RATE_LIMIT", status: 429 };
      if (/session|token|auth|login|expired|unauthor/i.test(text))
        return { code: "BUS_TIME_SESSION_EXPIRED", status: 502 };
      return { code: "BUS_TIME_SOURCE_ERROR", status: 502 };
    },
    connectionHeartbeatMs: 15 * 60 * 1000,
    fetchFn: async (url, init) => {
      const parsed = new URL(url);
      const call = {
        day: parsed.searchParams.get("startDate"),
        page: Number(parsed.searchParams.get("page")),
        pageSize: Number(parsed.searchParams.get("pageSize")),
        fleetStatus: parsed.searchParams.get("fleetStatus"),
        storeId: parsed.searchParams.get("storeId"),
        targetId: parsed.searchParams.get("targetId"),
        attendanceStatus: parsed.searchParams.get("attendanceStatus"),
        init,
      };
      calls.push(call);
      return fetchHandler(call);
    },
    now: () => clock,
    random: () => 0,
    logger: { warn() {}, error() {}, log() {} },
  });

  return {
    env,
    lane,
    calls,
    advance(ms) { clock += ms; },
    stats() {
      return {
        credentialReads,
        seedReads,
        statusWrites,
        rateLeaseReads,
        rateLeaseUpserts,
        rateLeaseDeletes,
        clock,
        connectionState,
        rateLeaseRow: rateLeaseStore.row,
      };
    },
  };
}

test("staging replaces the legacy 60s guard, adds the runtime module, and keeps canonical source untouched", () => {
  const staged = stageBusReader();
  try {
    assert.match(staged.source, /BUS_TIME_HOT_LANE_V14/);
    assert.match(staged.source, /createBusTimeHotLane/);
    assert.match(staged.source, /readBusTimeData\(env, branch, liveSourceDays\(\), routeHintRows\)/);
    const refresh = staged.source.slice(
      staged.source.indexOf("async function runMsRefresh(env, branch) {"),
      staged.source.indexOf("\nasync function readMsLiveCache(", staged.source.indexOf("async function runMsRefresh(env, branch) {")),
    );
    assert.equal(
      (refresh.match(/^\s*readBusTimeData\(env, branch, liveSourceDays\(\), routeHintRows\),$/gm) || []).length,
      1,
      "one shared refresh must execute exactly one BusTime read",
    );
    assert.match(staged.source, /busDiagnostics: busTimeDiagnostics\(hub\)/);
    assert.doesNotMatch(staged.source, /BUS_TIME_SOURCE_TTL_MS\s*=\s*60\s*\*\s*1000/);
    assert.equal(fs.existsSync(staged.runtime), true);
    const canonical = fs.readFileSync(canonicalWorker, "utf8");
    assert.doesNotMatch(canonical, /BUS_TIME_HOT_LANE_V14/);
  } finally {
    fs.rmSync(staged.dir, { recursive: true, force: true });
  }
});

test("legacy amplification is 30/90/300/600 calls per minute for 50/250/1000/2000 rows per day across two days", () => {
  assert.deepEqual(
    [50, 250, 1000, 2000].map((rows) => legacyBusCallsPerMinute(rows, 2, 4000)),
    [30, 90, 300, 600],
  );
});

test("successful HAR seed paints KIT/TBR immediately with zero upstream call, then returns to the existing 12s cadence", async () => {
  const h = harness({
    fetchHandler: async () => response({ total: 50, items: [item("P1")] }),
  });
  const seededAt = new Date(h.stats().clock).toISOString();
  h.lane.resetCredentials("NE1", {
    auth: "auth",
    lang: "th",
    fbid: "fbid",
    time: "time",
    _from: "fbi",
    seededAt,
    seedItems: [item("P1")],
  });
  const routes = [{
    proofId: "P1",
    attendanceType: "ปลายทาง",
    unloadingState: 0,
    estimatedArrivalAt: "2026-09-13T01:00:00Z",
  }];

  const first = await h.lane.readBusTimeData(h.env, "NE1", undefined, routes);
  assert.equal(h.calls.length, 0, "fresh successful HAR must not trigger an immediate duplicate provider request");
  assert.equal(first.get("P:P1|A:ปลายทาง")?.scheduleTbrArrivalAt, "2026-09-13T00:02:00.000Z");

  h.advance(BUS_TIME_HOT_REUSE_MS);
  await h.lane.readBusTimeData(h.env, "NE1", undefined, routes);
  assert.equal(h.calls.length, 1, "after the normal healthy 12s reuse window the shared source may refresh once");
});

test("HAR seed is bounded and provider-limit backoff remains much longer than healthy 12s cadence", () => {
  assert.equal(BUS_TIME_HAR_SEED_MAX_AGE_MS, 15 * 60 * 1000);
  assert.equal(BUS_TIME_HOT_REUSE_MS, 12_000);
  assert.equal(BUS_TIME_RATE_LIMIT_BASE_COOLDOWN_MS, 5 * 60 * 1000);
  assert.ok(BUS_TIME_RATE_LIMIT_BASE_COOLDOWN_MS > BUS_TIME_HOT_REUSE_MS);
});

test("canonical BusTime HAR save no longer re-hits provider just to validate the uploaded successful response", () => {
  const canonical = fs.readFileSync(canonicalWorker, "utf8");
  const start = canonical.indexOf("async function saveMsBusConnection(body, actor, env) {");
  const end = canonical.indexOf("\n\n// HBI_PHOTO_ON_DEMAND_V1", start);
  assert.ok(start >= 0 && end > start);
  const save = canonical.slice(start, end);
  assert.match(canonical, /BUS_TIME_HAR_SEED_TRUTH_V26/);
  assert.match(save, /sanitizeBusSeedItems\(body\.seedItems\)/);
  assert.match(save, /upstreamValidationCalls:\s*0/);
  assert.doesNotMatch(save, /readBusPage\(/);
});

test("idle/origin/completed-only Route state makes zero BusTime upstream calls", async () => {
  const h = harness({
    fetchHandler: async () => response({ total: 50, items: [item("P1")] }),
  });
  await h.lane.readBusTimeData(h.env, "NE1", undefined, []);
  h.advance(60_000);
  await h.lane.readBusTimeData(h.env, "NE1", undefined, [
    { proofId: "P-ORG", attendanceType: "ต้นทาง", unloadingState: 0 },
    { proofId: "P-DONE", attendanceType: "จุดดรอป", unloadingState: 2 },
  ]);
  assert.equal(h.calls.length, 0);
  assert.equal(h.stats().credentialReads, 0);
  assert.equal(h.lane.diagnostics("NE1").busActiveRows, 0);
});

test("active BusTime keeps KIT/TBR at ~12s while Route/UI can continue their ~4s cycle", async () => {
  const h = harness({
    fetchHandler: async () => response({ total: 50, items: [item("P1")] }),
  });
  const routes = [{ proofId: "P1", attendanceType: "ปลายทาง", unloadingState: 0, estimatedArrivalAt: "2026-09-13T01:00:00Z" }];
  await h.lane.readBusTimeData(h.env, "NE1", undefined, routes);
  assert.equal(h.calls.length, 1);
  h.advance(4000);
  await h.lane.readBusTimeData(h.env, "NE1", undefined, routes);
  assert.equal(h.calls.length, 1, "4-second Route/UI refresh must reuse KIT/TBR cache");
  h.advance(8000);
  await h.lane.readBusTimeData(h.env, "NE1", undefined, routes);
  assert.equal(h.calls.length, 2, "KIT/TBR page 1 refreshes at ~12 seconds");
  assert.equal(h.calls.every((call) => call.page === 1), true);
  assert.equal(h.calls.every((call) => call.fleetStatus === "1"), true);
  assert.equal(h.stats().credentialReads, 1, "credentials stay shared/cached");
});


test("cold cron recovers active Route hints from the existing accepted cache with no extra Turso read", async () => {
  const acceptedRows = [{
    proofId: "P1",
    attendanceType: "ปลายทาง",
    unloadingState: 0,
    estimatedArrivalAt: "2026-09-13T01:00:00.000Z",
  }];
  const h = harness({
    acceptedRows,
    fetchHandler: async () => response({ total: 50, items: [item("P1")] }),
  });
  await h.lane.readBusTimeData(h.env, "NE1", undefined, []);
  assert.equal(h.calls.length, 1, "cold cron must still execute one shared KIT/TBR page-1 read");
  assert.equal(h.stats().seedReads, 1, "fallback reuses the existing accepted-cache seed read");
  assert.equal(h.stats().credentialReads, 1);
  assert.equal(h.stats().rateLeaseReads, 0, "healthy HUB must not pay a persistent-lease read");
  assert.equal(h.stats().rateLeaseUpserts, 0);
  assert.equal(h.lane.diagnostics("NE1").busActiveRows, 1);
});

test("deep pagination and KIT/TBR page 1 remain bounded at ~12s", async () => {
  const h = harness({
    fetchHandler: async ({ page }) => page === 1
      ? response({ total: 300, items: [item("P1")] })
      : response({ total: 300, items: [item("P" + page)] }),
  });
  const routes = [{ proofId: "P3", attendanceType: "ปลายทาง", unloadingState: 0 }];
  await h.lane.readBusTimeData(h.env, "NE1", undefined, routes);
  assert.deepEqual(h.calls.map((call) => call.page), [1, 2]);
  h.advance(4000);
  await h.lane.readBusTimeData(h.env, "NE1", undefined, routes);
  assert.deepEqual(h.calls.map((call) => call.page), [1, 2]);
  h.advance(8000);
  const map = await h.lane.readBusTimeData(h.env, "NE1", undefined, routes);
  assert.deepEqual(h.calls.map((call) => call.page), [1, 2, 1, 3]);
  assert.ok(map.has("P:P3|A:ปลายทาง"));
  assert.equal(h.calls.every((call) => call.fleetStatus === "1"), true);
  assert.ok(h.lane.diagnostics("NE1").busPagesLastCycle <= BUS_TIME_MAX_CALLS_PER_CYCLE);
});

test("a newly active proof missing from page 1 gets background priority without a pagination burst", async () => {
  const h = harness({
    fetchHandler: async ({ page }) => page === 1
      ? response({ total: 200, items: [item("P1")] })
      : response({ total: 200, items: [item("P2")] }),
  });
  const routes = [{ proofId: "P2", attendanceType: "ปลายทาง", unloadingState: 0 }];
  const map = await h.lane.readBusTimeData(h.env, "NE1", undefined, routes);
  assert.equal(h.calls.length, 2);
  assert.ok(map.has("P:P2|A:ปลายทาง"));
  assert.equal(h.lane.diagnostics("NE1").busBackgroundCalls, 1);
});

test("100 concurrent clients on one HUB coalesce into one BusTime source reader", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const h = harness({
    fetchHandler: async () => {
      await gate;
      return response({ total: 50, items: [item("P1")] });
    },
  });
  const routes = [{ proofId: "P1", attendanceType: "ปลายทาง", unloadingState: 0 }];
  const promises = Array.from({ length: 100 }, () =>
    h.lane.readBusTimeData(h.env, "NE1", undefined, routes));
  await Promise.resolve();
  release();
  await Promise.all(promises);
  assert.equal(h.calls.length, 1);
  assert.equal(h.lane.diagnostics("NE1").busHotCalls, 1);
});

test("two HUBs keep isolated active-demand state and each gets only its own shared reader", async () => {
  const h = harness({
    fetchHandler: async () => response({ total: 50, items: [item("P1")] }),
  });
  const routes = [{ proofId: "P1", attendanceType: "ปลายทาง", unloadingState: 0 }];
  await Promise.all([
    h.lane.readBusTimeData(h.env, "NE1", undefined, routes),
    h.lane.readBusTimeData(h.env, "EA2", undefined, routes),
  ]);
  assert.equal(h.calls.length, 2);
  assert.equal(h.lane.diagnostics("NE1").busHotCalls, 1);
  assert.equal(h.lane.diagnostics("EA2").busHotCalls, 1);
});

test("origin routes never enter BusTime active scope or force yesterday hot reads", async () => {
  const h = harness({
    fetchHandler: async () => response({ total: 50, items: [item("P-DST")] }),
  });
  const routes = [
    { proofId: "P-ORG", attendanceType: "ต้นทาง", unloadingState: 0, estimatedArrivalAt: "2026-09-12T14:00:00.000Z" },
    { proofId: "P-DST", attendanceType: "ปลายทาง", unloadingState: 0, estimatedArrivalAt: "2026-09-13T01:00:00.000Z" },
    { proofId: "P-DROP-DONE", attendanceType: "จุดดรอป", unloadingState: 2, estimatedArrivalAt: "2026-09-12T15:00:00.000Z" },
  ];
  await h.lane.readBusTimeData(h.env, "NE1", undefined, routes);
  assert.deepEqual(h.calls.map((call) => call.day), ["2026-09-13"]);
  assert.equal(h.lane.diagnostics("NE1").busActiveRows, 1);
});

test("persistent deep misses stay 12s while newly active proof gets immediate background priority", async () => {
  const h = harness({
    fetchHandler: async ({ page }) => page === 1
      ? response({ total: 300, items: [item("P1")] })
      : response({ total: 300, items: [item("P" + page)] }),
  });
  await h.lane.readBusTimeData(h.env, "NE1", undefined, [{ proofId: "P2", attendanceType: "ปลายทาง", unloadingState: 0 }]);
  assert.deepEqual(h.calls.map((call) => call.page), [1, 2]);
  h.advance(4000);
  await h.lane.readBusTimeData(h.env, "NE1", undefined, [{ proofId: "P99", attendanceType: "ปลายทาง", unloadingState: 0 }]);
  assert.deepEqual(h.calls.slice(-1).map((call) => call.page), [3]);
  const callsAfterNewActive = h.calls.length;
  h.advance(4000);
  await h.lane.readBusTimeData(h.env, "NE1", undefined, [{ proofId: "P99", attendanceType: "ปลายทาง", unloadingState: 0 }]);
  assert.equal(h.calls.length, callsAfterNewActive);
  h.advance(8000);
  await h.lane.readBusTimeData(h.env, "NE1", undefined, [{ proofId: "P99", attendanceType: "ปลายทาง", unloadingState: 0 }]);
  assert.equal(h.calls.length, callsAfterNewActive + 2);
});

test("cross-midnight active route adds yesterday page 1; completed-only routes make zero BusTime calls", async () => {
  const h1 = harness({
    fetchHandler: async () => response({ total: 50, items: [item("P1")] }),
  });
  const activeYesterday = [{
    proofId: "P1",
    attendanceType: "ปลายทาง",
    unloadingState: 0,
    estimatedArrivalAt: "2026-09-12T14:00:00.000Z",
  }];
  await h1.lane.readBusTimeData(h1.env, "NE1", undefined, activeYesterday);
  assert.deepEqual(h1.calls.map((call) => call.day), ["2026-09-13", "2026-09-12"]);

  const h2 = harness({
    fetchHandler: async () => response({ total: 50, items: [item("P1")] }),
  });
  const completedYesterday = [{ ...activeYesterday[0], unloadingState: 2 }];
  await h2.lane.readBusTimeData(h2.env, "NE1", undefined, completedYesterday);
  assert.deepEqual(h2.calls, []);
  assert.equal(h2.stats().credentialReads, 0);
});

test("429 is BUS_TIME_RATE_LIMIT, honors Retry-After, preserves accepted cache and does not retry during cooldown", async () => {
  const acceptedRows = [{
    proofId: "P1",
    attendanceType: "ปลายทาง",
    routeName: "OLD",
    scheduleKitArrivalAt: "2026-09-12T20:00:00.000Z",
  }];
  const h = harness({
    acceptedRows,
    fetchHandler: async () => response({ status: 429, retryAfter: "30" }),
  });
  const routes = [{ proofId: "P1", attendanceType: "ปลายทาง", unloadingState: 0 }];
  const map = await h.lane.readBusTimeData(h.env, "NE1", undefined, routes);
  assert.equal(h.calls.length, 1);
  assert.equal(map.get("P:P1|A:ปลายทาง").routeName, "OLD");
  assert.equal(map.sourceCode, "BUS_TIME_RATE_LIMIT");
  const diag = h.lane.diagnostics("NE1");
  assert.equal(diag.busRateLimitCount, 1);
  assert.match(diag.busCooldownUntil, /T/);
  h.advance(4000);
  const duringCooldown = await h.lane.readBusTimeData(h.env, "NE1", undefined, routes);
  assert.equal(h.calls.length, 1, "must not create an immediate retry storm");
  assert.equal(duringCooldown.get("P:P1|A:ปลายทาง").routeName, "OLD");
});

test("Retry-After parser supports both seconds and HTTP dates", () => {
  const now = Date.parse("2026-09-13T00:00:00Z");
  assert.equal(parseBusRetryAfter("15", now), 15000);
  assert.equal(parseBusRetryAfter("Sun, 13 Sep 2026 00:00:30 GMT", now), 30000);
});

test("verified unfinished filter is used while unverified HUB/store filters stay empty", async () => {
  const h = harness({
    fetchHandler: async () => response({ total: 50, items: [item("P1")] }),
  });
  await h.lane.readBusTimeData(h.env, "NE1", undefined, [
    { proofId: "P1", attendanceType: "ปลายทาง", unloadingState: 0 },
  ]);
  assert.equal(h.calls[0].fleetStatus, "1");
  assert.equal(h.calls[0].storeId, "");
  assert.equal(h.calls[0].targetId, "");
  assert.equal(h.calls[0].attendanceStatus, "");
  assert.equal(h.calls[0].pageSize, 100);
});

test("diagnostics expose quota-safe required counters without a telemetry DB writer", async () => {
  const h = harness({
    fetchHandler: async () => response({ total: 50, items: [item("P1")] }),
  });
  await h.lane.readBusTimeData(h.env, "NE1", undefined, [
    { proofId: "P1", attendanceType: "ปลายทาง", unloadingState: 0 },
  ]);
  const diag = h.lane.diagnostics("NE1");
  for (const key of [
    "busHotCalls",
    "busBackgroundCalls",
    "busCallsLastMinute",
    "busPagesLastCycle",
    "busCacheHits",
    "busCacheMisses",
    "busRateLimitCount",
    "busCooldownUntil",
    "busLastSuccessAt",
    "busLastError",
    "busActiveRows",
    "busTotalKnownRows",
  ]) assert.ok(Object.hasOwn(diag, key), `missing ${key}`);
  assert.equal(diag.mode, "BUS_TIME_HOT_LANE_V14");
});

test("JSON Request exceeds the limit without Retry-After uses 5m-to-60m provider cooldown", async () => {
  const h = harness({
    fetchHandler: async () => response({ message: "Request exceeds the limit" }),
  });
  const routes = [{ proofId: "P1", attendanceType: "ปลายทาง", unloadingState: 0 }];

  const first = await h.lane.readBusTimeData(h.env, "NE1", undefined, routes);
  assert.equal(h.calls.length, 1);
  assert.equal(first.sourceCode, "BUS_TIME_RATE_LIMIT");
  let diag = h.lane.diagnostics("NE1");
  assert.equal(Date.parse(diag.busCooldownUntil) - h.stats().clock, 5 * 60 * 1000);

  h.advance(4_000);
  await h.lane.readBusTimeData(h.env, "NE1", undefined, routes);
  assert.equal(h.calls.length, 1, "4-second visible refresh must not re-hit limited BusTime");

  h.advance(5 * 60 * 1000 - 4_000 - 1);
  await h.lane.readBusTimeData(h.env, "NE1", undefined, routes);
  assert.equal(h.calls.length, 1, "provider cooldown must hold for the full first five minutes");

  h.advance(1);
  await h.lane.readBusTimeData(h.env, "NE1", undefined, routes);
  assert.equal(h.calls.length, 2, "one retry is allowed when the provider cooldown expires");
  diag = h.lane.diagnostics("NE1");
  assert.equal(Date.parse(diag.busCooldownUntil) - h.stats().clock, 10 * 60 * 1000);
});


test("provider cooldown survives a fresh hot-lane instance and recovery starts hot-only", async () => {
  const rateLeaseStore = { row: null };
  const connectionState = { lastError: "", lastSuccessAt: "" };
  const acceptedRows = [{
    proofId: "P3",
    attendanceType: "ปลายทาง",
    unloadingState: 0,
    estimatedArrivalAt: "2026-09-13T01:00:00.000Z",
  }];
  const routes = [{ ...acceptedRows[0] }];

  const first = harness({
    acceptedRows,
    rateLeaseStore,
    connectionState,
    fetchHandler: async () => response({ message: "Request exceeds the limit" }),
  });
  await first.lane.readBusTimeData(first.env, "NE1", undefined, routes);
  assert.equal(first.calls.length, 1);
  assert.equal(first.stats().rateLeaseUpserts, 1);
  assert.equal(connectionState.lastError, "Request exceeds the limit");
  const leaseUntil = Date.parse(rateLeaseStore.row?.lease_until || "");
  assert.equal(leaseUntil - first.stats().clock, 5 * 60 * 1000);

  const second = harness({
    acceptedRows,
    rateLeaseStore,
    connectionState,
    start: first.stats().clock + 4_000,
    fetchHandler: async () => { throw new Error("persistent cooldown must block upstream"); },
  });
  await second.lane.readBusTimeData(second.env, "NE1", undefined, routes);
  assert.equal(second.calls.length, 0);
  assert.equal(second.stats().rateLeaseReads, 1);
  assert.equal(second.stats().rateLeaseUpserts, 0);

  const recovered = harness({
    acceptedRows,
    rateLeaseStore,
    connectionState,
    start: leaseUntil,
    fetchHandler: async ({ page }) => page === 1
      ? response({ total: 300, items: [item("P1")] })
      : response({ total: 300, items: [item("P" + page)] }),
  });
  await recovered.lane.readBusTimeData(recovered.env, "NE1", undefined, routes);
  assert.deepEqual(recovered.calls.map((call) => call.page), [1], "first recovery cycle must be hot-only");
  assert.equal(recovered.stats().rateLeaseReads, 1);
  assert.equal(recovered.stats().rateLeaseDeletes, 1);
  assert.equal(rateLeaseStore.row, null);
  assert.equal(connectionState.lastError, "");

  recovered.advance(12_000);
  await recovered.lane.readBusTimeData(recovered.env, "NE1", undefined, routes);
  assert.deepEqual(recovered.calls.map((call) => call.page), [1, 1, 2]);
});

test("healthy steady state adds no rate-limit lease reads or writes", async () => {
  const h = harness({
    fetchHandler: async () => response({ total: 50, items: [item("P1")] }),
  });
  const routes = [{ proofId: "P1", attendanceType: "ปลายทาง", unloadingState: 0 }];
  await h.lane.readBusTimeData(h.env, "NE1", undefined, routes);
  h.advance(12_000);
  await h.lane.readBusTimeData(h.env, "NE1", undefined, routes);
  assert.equal(h.stats().rateLeaseReads, 0);
  assert.equal(h.stats().rateLeaseUpserts, 0);
  assert.equal(h.stats().rateLeaseDeletes, 0);
});
