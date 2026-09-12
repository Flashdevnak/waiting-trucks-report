import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

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
} = await import(`${pathToFileURL(runtimePath).href}?v=${Date.now()}`);

function stageBusReader() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bus-hot-lane-v14-"));
  const worker = path.join(dir, "index.js");
  fs.copyFileSync(canonicalWorker, worker);
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
} = {}) {
  let clock = start;
  let credentialReads = 0;
  let seedReads = 0;
  let statusWrites = 0;
  const calls = [];

  const env = {
    DB: {
      prepare(sql) {
        return {
          bind() {
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
                  return { credentials_cipher: "cipher" };
                }
                return null;
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
    markSuccess: async () => ({ success: true }),
    markError: async () => ({ success: true }),
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
    stats() { return { credentialReads, seedReads, statusWrites, clock }; },
  };
}

test("staging replaces the legacy 60s guard, adds the runtime module, and keeps canonical source untouched", () => {
  const staged = stageBusReader();
  try {
    assert.match(staged.source, /BUS_TIME_HOT_LANE_V14/);
    assert.match(staged.source, /createBusTimeHotLane/);
    assert.match(staged.source, /readBusTimeData\(env, branch, liveSourceDays\(\), routeRows\)/);
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

test("steady state detects current-day BusTime every ~4s with one hot request when one page is enough", async () => {
  const h = harness({
    fetchHandler: async () => response({ total: 50, items: [item("P1")] }),
  });
  const routes = [{ proofId: "P1", attendanceType: "ปลายทาง", unloadingState: 0, estimatedArrivalAt: "2026-09-13T01:00:00Z" }];
  await h.lane.readBusTimeData(h.env, "NE1", undefined, routes);
  assert.equal(h.calls.length, 1);
  h.advance(4000);
  await h.lane.readBusTimeData(h.env, "NE1", undefined, routes);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls.every((call) => call.page === 1), true);
  assert.equal(h.stats().credentialReads, 1, "credentials must be cached, not read every 4 seconds");
});

test("deep pagination is incremental and bounded to one background page per cycle", async () => {
  const h = harness({
    fetchHandler: async ({ page }) => page === 1
      ? response({ total: 250, items: [item("P1")] })
      : response({ total: 250, items: [item(`P${page}`)] }),
  });
  const routes = [{ proofId: "P1", attendanceType: "ปลายทาง", unloadingState: 0 }];
  await h.lane.readBusTimeData(h.env, "NE1", undefined, routes);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls.map((call) => call.page), [1, 2]);
  h.advance(4000);
  await h.lane.readBusTimeData(h.env, "NE1", undefined, routes);
  assert.equal(h.calls.length, 3);
  assert.equal(h.calls.at(-1).page, 1);
  h.advance(8000);
  await h.lane.readBusTimeData(h.env, "NE1", undefined, routes);
  assert.deepEqual(h.calls.slice(-2).map((call) => call.page), [1, 3]);
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

test("two HUBs keep isolated state and each gets only its own shared reader", async () => {
  const h = harness({
    fetchHandler: async ({ day }) => response({ total: 50, items: [item(`P-${day}`)] }),
  });
  await Promise.all([
    h.lane.readBusTimeData(h.env, "NE1", undefined, []),
    h.lane.readBusTimeData(h.env, "EA2", undefined, []),
  ]);
  assert.equal(h.calls.length, 2);
  assert.equal(h.lane.diagnostics("NE1").busHotCalls, 1);
  assert.equal(h.lane.diagnostics("EA2").busHotCalls, 1);
});

test("cross-midnight active route adds at most yesterday page 1; completed route does not", async () => {
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
  assert.deepEqual(h2.calls.map((call) => call.day), ["2026-09-13"]);
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

test("unverified upstream filters remain empty instead of inventing HUB/store IDs", async () => {
  const h = harness({
    fetchHandler: async () => response({ total: 50, items: [item("P1")] }),
  });
  await h.lane.readBusTimeData(h.env, "NE1", undefined, []);
  assert.equal(h.calls[0].storeId, "");
  assert.equal(h.calls[0].targetId, "");
  assert.equal(h.calls[0].attendanceStatus, "");
  assert.equal(h.calls[0].pageSize, 100);
});

test("diagnostics expose quota-safe required counters without a telemetry DB writer", async () => {
  const h = harness({
    fetchHandler: async () => response({ total: 50, items: [item("P1")] }),
  });
  await h.lane.readBusTimeData(h.env, "NE1", undefined, []);
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
