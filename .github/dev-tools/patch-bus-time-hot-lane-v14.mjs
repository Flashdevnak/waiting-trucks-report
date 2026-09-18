import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const file = process.argv[2] || "src/index.js";
const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeSource = path.join(here, "bus-time-hot-lane-v14-runtime.mjs");
const runtimeTarget = path.join(path.dirname(path.resolve(file)), "bus-time-hot-lane-v14.js");
fs.copyFileSync(runtimeSource, runtimeTarget);

let source = fs.readFileSync(file, "utf8");
const MARKER = "BUS_TIME_HOT_LANE_V14";
const PARALLEL_MARKER = "MS_FIRST_SOURCE_PARALLEL_V2";
const SOURCE_CADENCE_MARKER = "MS_ROUTE_SHARED_SOURCE_CADENCE_V1";
const ROUTE_FAST_MARKER = "MS_ROUTE_LIFECYCLE_FAST_PUBLISH_V1";

function replaceUnique(input, from, to, label) {
  const first = input.indexOf(from);
  const last = input.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`${MARKER}: ${label} anchor missing or non-unique`);
  return input.slice(0, first) + to + input.slice(first + from.length);
}

function patchSharedRouteSourceCadence(input) {
  let output = String(input || "");
  if (output.includes(SOURCE_CADENCE_MARKER)) return output;
  output = replaceUnique(
    output,
    "const MS_CRON_ACTIVE_SKIP_MS = 45 * 1000;",
    `const MS_CRON_ACTIVE_SKIP_MS = 45 * 1000;
// ${SOURCE_CADENCE_MARKER}: visible WebSocket snapshots stay at 4 seconds,
// while one per-HUB coordinator shares Route upstream work. A 3-second dedupe floor
// allows every existing 4-second leader cycle to observe fresh Route truth without
// turning source work into per-client polling. Explicit force refresh still bypasses it.
const MS_REALTIME_SOURCE_MIN_MS = 3 * 1000;`,
    "shared Route source cadence constant",
  );
  output = replaceUnique(
    output,
    `    if (!force && this.lastResult && this.recentUntil > nowMs)
      return this.lastResult;`,
    `    if (
      !force &&
      !cron &&
      this.lastResult &&
      nowMs - this.lastSourceAt < MS_REALTIME_SOURCE_MIN_MS
    )
      return this.lastResult;
    if (!force && this.lastResult && this.recentUntil > nowMs)
      return this.lastResult;`,
    "shared Route source cadence gate",
  );
  return output;
}

source = patchSharedRouteSourceCadence(source);
if (source.includes(MARKER)) {
  fs.writeFileSync(file, source);
  console.log(`${MARKER}=ALREADY_APPLIED`);
  console.log(`${SOURCE_CADENCE_MARKER}=PASS`);
  console.log("MS_ROUTE_SHARED_SOURCE_MIN_MS=3000");
  process.exit(0);
}

if (!source.startsWith("import "))
  throw new Error(`${MARKER}: worker import header not found`);
source =
  `import { createBusTimeHotLane } from "./bus-time-hot-lane-v14.js";\n` +
  source;

const legacyStart = source.indexOf(
  "// BUS_TIME_RATE_GUARD_V10 / OPTIONAL_SOURCE_RATE_GUARD_V12:",
);
const busEnd = source.indexOf("\nasync function preEntryTrips(", legacyStart);
if (legacyStart < 0 || busEnd <= legacyStart)
  throw new Error(`${MARKER}: staged legacy BusTime guard not found`);

const adapter = `// ${MARKER}: DEV-only ~12-second KIT/TBR lane + shared incremental cache.
// Keep PREENTRY_RATE_GUARD_V12 independent; this task does not change PreEntry.
const OPTIONAL_RATE_LIMIT_BASE_COOLDOWN_MS = 5 * 60 * 1000;
const OPTIONAL_RATE_LIMIT_MAX_COOLDOWN_MS = 60 * 60 * 1000;
function optionalRateCooldownMs(strikes) {
  return Math.min(
    OPTIONAL_RATE_LIMIT_MAX_COOLDOWN_MS,
    OPTIONAL_RATE_LIMIT_BASE_COOLDOWN_MS * (2 ** Math.max(0, Number(strikes || 1) - 1)),
  );
}
const busTimeHotLane = createBusTimeHotLane({
  liveSourceDays,
  thaiDayOffset,
  normalizeProofId,
  normalizeAttendance: normalizeMsAttendance,
  matchHub: scheduleStoreMatchesHub,
  msDate,
  parseUnloadingStart: parseScheduleUnloadingStart,
  parseUnloadingEnd: parseScheduleUnloadingEnd,
  decryptMs,
  safeStatusWrite,
  markSuccess: markConnectionSuccess,
  markError: markConnectionError,
  classifyFailure: classifyBusTimeFailure,
  connectionHeartbeatMs: CONNECTION_HEARTBEAT_MS,
  fetchFn: fetchWithTimeout,
});
// BUS_TIME_LIVE_ACCEPTANCE_V1: connector-authenticated probe lane for DEV acceptance only.
// It executes the same hot-lane algorithm but intentionally suppresses status writes,
// so acceptance cannot burn Turso writes or mutate source-health timestamps.
const busTimeProbeLane = createBusTimeHotLane({
  liveSourceDays,
  thaiDayOffset,
  normalizeProofId,
  normalizeAttendance: normalizeMsAttendance,
  matchHub: scheduleStoreMatchesHub,
  msDate,
  parseUnloadingStart: parseScheduleUnloadingStart,
  parseUnloadingEnd: parseScheduleUnloadingEnd,
  decryptMs,
  safeStatusWrite: async () => null,
  markSuccess: () => null,
  markError: () => null,
  classifyFailure: classifyBusTimeFailure,
  connectionHeartbeatMs: CONNECTION_HEARTBEAT_MS,
  fetchFn: fetchWithTimeout,
});
// ${PARALLEL_MARKER}: last successful Route rows are hints only. They let the
// existing BusTime reader start at the same time as the current Route request,
// without adding a second BusTime read or waiting for Route completion.
const busTimeRouteHints = new Map();
// ${ROUTE_FAST_MARKER}: waiting -> unloading belongs to Route. Keep the
// existing Route/PreEntry/BusTime source work shared, but when a previously
// admitted inbound row changes to Route unloadingState=1, publish that Route
// truth without waiting for optional enrichment. The previous accepted
// enrichment is reused for that one snapshot and the already-started optional
// work is kept alive by the Durable Object waitUntil hook.
const routeLifecycleBaselineRows = new Map();

function routeLifecycleQueueKey(row) {
  const proofId = normalizeProofId(row?.proofId);
  const attendance = normalizeMsAttendance(row?.attendanceType);
  return proofId && attendance ? "P:" + proofId + "|A:" + attendance : "";
}

function routeLifecycleFastTransition(previousRows, routeRows) {
  const previous = new Map(
    (Array.isArray(previousRows) ? previousRows : [])
      .map((row) => [routeLifecycleQueueKey(row), row])
      .filter(([key]) => Boolean(key)),
  );
  return (Array.isArray(routeRows) ? routeRows : []).some((row) => {
    if (Number(row?.unloadingState) !== 1) return false;
    const attendance = normalizeMsAttendance(row?.attendanceType);
    if (attendance !== "ปลายทาง" && attendance !== "จุดดรอป") return false;
    const prior = previous.get(routeLifecycleQueueKey(row));
    if (!prior) return false;
    const priorState = Number(prior?.unloadingState);
    return priorState !== 1 && priorState !== 2;
  });
}

function routeLifecycleOptionalMaps(previousRows) {
  const parcelCounts = new Map();
  const busData = new Map();
  for (const row of Array.isArray(previousRows) ? previousRows : []) {
    const proofId = normalizeProofId(row?.proofId);
    const attendance = normalizeMsAttendance(row?.attendanceType);
    if (!proofId) continue;
    parcelCounts.set("P:" + proofId, {
      proofId: String(row?.proofId || "").slice(0, 100),
      routeName: String(row?.routeName || "").slice(0, 300),
      expectedParcels: row?.expectedParcels ?? null,
      enteredParcels: row?.enteredParcels ?? null,
      pendingParcels: row?.pendingParcels ?? null,
    });
    if (!attendance) continue;
    busData.set("P:" + proofId + "|A:" + attendance, {
      proofId: String(row?.proofId || "").slice(0, 100),
      routeName: String(row?.routeName || "").slice(0, 300),
      scheduleKitArrivalAt: String(row?.scheduleKitArrivalAt || ""),
      scheduleTbrArrivalAt: String(row?.scheduleTbrArrivalAt || ""),
      arrivedParcels: Number(row?.arrivedParcels) || 0,
      arrivedBags: Number(row?.arrivedBags) || 0,
      scheduleUnloadingStartedAt: String(row?.scheduleUnloadingStartedAt || ""),
      scheduleUnloadingCompletedAt: String(row?.scheduleUnloadingCompletedAt || ""),
      scheduleCompletionAmbiguous: Boolean(row?.scheduleCompletionAmbiguous),
    });
  }
  return { parcelCounts, busData };
}

async function readBusTimeData(
  env,
  hub,
  wantedDays = liveSourceDays(),
  routeRows = [],
) {
  const data = await busTimeHotLane.readBusTimeData(env, hub, wantedDays, routeRows);
  // Reuse the existing DEV realtime-recovery contract so degraded BusTime
  // preserves the accepted live-cache enrichment instead of clearing it.
  data.sourceFailed = Boolean(data.sourceStale);
  return data;
}
function busTimeDiagnostics(hub) {
  return busTimeHotLane.diagnostics(hub);
}
async function probeBusTimeDiagnostics(env, hub) {
  const row = await env.DB.prepare(
    "SELECT rows_json FROM ms_live_cache WHERE hub=?",
  ).bind(hub).first();
  let routeRows = [];
  try {
    const parsed = JSON.parse(row?.rows_json || "[]");
    routeRows = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.rows)
        ? parsed.rows
        : [];
  } catch {}
  await busTimeProbeLane.readBusTimeData(env, hub, liveSourceDays(), routeRows);
  return {
    hub,
    busDiagnostics: busTimeProbeLane.diagnostics(hub),
    acceptanceQuota: {
      routeUpstreamCalls: 0,
      preEntryUpstreamCalls: 0,
      busUpstreamCallsMaxPerProbe: 3,
      tursoWrites: 0,
      telemetryWrites: 0,
    },
  };
}`;

source = source.slice(0, legacyStart) + adapter + source.slice(busEnd);

const stagedRefreshAnchor = `    const rows = await readMsRoutes(credentials);
    const [parcelCounts, busData] = await Promise.all([
      readPreEntryCounts(env, branch),
      readBusTimeData(env, branch),
    ]);`;
const stagedRefreshReplacement = `    // ${PARALLEL_MARKER}: normal cycles keep Route, PreEntry and BusTime parallel.
    // ${ROUTE_FAST_MARKER}: if an already-admitted inbound row changes to
    // Route unloadingState=1, Route publishes immediately with the last accepted
    // optional enrichment while the already-started optional work finishes in
    // Durable Object waitUntil. No extra upstream call is created.
    const routeHintRows = busTimeRouteHints.get(branch) || [];
    const lifecycleBaselineRows = routeLifecycleBaselineRows.get(branch) || [];
    const routePromise = readMsRoutes(credentials);
    let optionalReady = false;
    let optionalValues = null;
    const optionalPromise = Promise.all([
      readPreEntryCounts(env, branch),
      readBusTimeData(env, branch, liveSourceDays(), routeHintRows),
    ]).then((value) => {
      optionalValues = value;
      optionalReady = true;
      return value;
    });
    const rows = await routePromise;
    const routeRows = rows.map(mapMsRow);
    if (!rows.routeSourceError) busTimeRouteHints.set(branch, routeRows);
    const routeLifecycleFastPublish =
      routeLifecycleFastTransition(lifecycleBaselineRows, routeRows);
    let parcelCounts;
    let busData;
    if (
      routeLifecycleFastPublish &&
      !optionalReady &&
      typeof waitUntil === "function"
    ) {
      ({ parcelCounts, busData } = routeLifecycleOptionalMaps(lifecycleBaselineRows));
      waitUntil(optionalPromise.then(() => undefined, () => undefined));
    } else {
      [parcelCounts, busData] = optionalReady
        ? optionalValues
        : await optionalPromise;
    }`;

if (source.includes(stagedRefreshAnchor)) {
  source = replaceUnique(
    source,
    stagedRefreshAnchor,
    stagedRefreshReplacement,
    "runMsRefresh staged optional-enrichment block",
  );
  source = replaceUnique(
    source,
    `    const mappedRows = rows.map((row) => {
      const mapped = enrichMsRow(mapMsRow(row), parcelCounts, busData);`,
    `    const mappedRows = routeRows.map((row) => {
      const mapped = enrichMsRow(row, parcelCounts, busData);`,
    "runMsRefresh staged route mapping",
  );
} else {
  const canonicalRefreshAnchor = `    const rows = await readMsRoutes(credentials);
    const parcelCounts = await readPreEntryCounts(env, branch);
    const busData = await readBusTimeData(env, branch);
    const mappedRows = rows.map((row) =>
      enrichMsRow(mapMsRow(row), parcelCounts, busData),
    );`;
  const canonicalRefreshReplacement = `    // ${PARALLEL_MARKER}: normal cycles keep Route, PreEntry and BusTime parallel.
    // ${ROUTE_FAST_MARKER}: Route 0/null -> 1 may publish without waiting for
    // optional enrichment when a Durable Object waitUntil hook is available.
    const routeHintRows = busTimeRouteHints.get(branch) || [];
    const lifecycleBaselineRows = routeLifecycleBaselineRows.get(branch) || [];
    const routePromise = readMsRoutes(credentials);
    let optionalReady = false;
    let optionalValues = null;
    const optionalPromise = Promise.all([
      readPreEntryCounts(env, branch),
      readBusTimeData(env, branch, liveSourceDays(), routeHintRows),
    ]).then((value) => {
      optionalValues = value;
      optionalReady = true;
      return value;
    });
    const rows = await routePromise;
    const routeRows = rows.map(mapMsRow);
    if (!rows.routeSourceError) busTimeRouteHints.set(branch, routeRows);
    const routeLifecycleFastPublish =
      routeLifecycleFastTransition(lifecycleBaselineRows, routeRows);
    let parcelCounts;
    let busData;
    if (
      routeLifecycleFastPublish &&
      !optionalReady &&
      typeof waitUntil === "function"
    ) {
      ({ parcelCounts, busData } = routeLifecycleOptionalMaps(lifecycleBaselineRows));
      waitUntil(optionalPromise.then(() => undefined, () => undefined));
    } else {
      [parcelCounts, busData] = optionalReady
        ? optionalValues
        : await optionalPromise;
    }
    const mappedRows = routeRows.map((row) =>
      enrichMsRow(row, parcelCounts, busData),
    );`;
  source = replaceUnique(
    source,
    canonicalRefreshAnchor,
    canonicalRefreshReplacement,
    "runMsRefresh canonical block",
  );
}

// ${ROUTE_FAST_MARKER}: only the per-HUB Durable Object supplies waitUntil.
source = replaceUnique(
  source,
  "async function runMsRefresh(env, branch) {",
  "async function runMsRefresh(env, branch, waitUntil = null) {",
  "Route lifecycle fast-publish waitUntil signature",
);
source = replaceUnique(
  source,
  `    const task = runMsRefresh(this.env, branch)
      .then((result) => {`,
  `    const task = runMsRefresh(
      this.env,
      branch,
      (promise) => this.ctx.waitUntil(promise),
    )
      .then((result) => {`,
  "Route lifecycle fast-publish Durable Object hook",
);

const liveResultAnchor = `    const result = {
      status: "synced",
      syncedAt: sync.syncedAt,
      changes: sync.changes,
      rows: msQueueFirstSourceRows(sync.rows, busData, branch),
      completedToday: completedRows.length,
      tbrShadowFeed,
    };`;
const liveResultReplacement = `    const liveRows = msQueueFirstSourceRows(sync.rows, busData, branch);
    routeLifecycleBaselineRows.set(branch, liveRows);
    const result = {
      status: "synced",
      syncedAt: sync.syncedAt,
      changes: sync.changes,
      rows: liveRows,
      completedToday: completedRows.length,
      tbrShadowFeed,
    };`;
source = replaceUnique(
  source,
  liveResultAnchor,
  liveResultReplacement,
  "Route lifecycle accepted baseline",
);

const saveAnchor =
  '  await audit(env, "SAVE_MS_BUS_CONNECTION", hub, `ทดสอบสำเร็จ ${test.total} รายการ`, actor.username);';
const saveReplacement = `  busTimeHotLane.resetCredentials(hub, credentials);
  busTimeProbeLane.resetCredentials(hub, credentials);
  await audit(env, "SAVE_MS_BUS_CONNECTION", hub, \`ทดสอบสำเร็จ \${test.total} รายการ\`, actor.username);`;
source = replaceUnique(source, saveAnchor, saveReplacement, "saveMsBusConnection");

const statusAnchor =
  "  return { hub, routes: source(routes), preEntry: source(preEntry), busTime: source(busTime), hbiPhotos: hbiSource };";
const statusReplacement =
  "  return { hub, routes: source(routes), preEntry: source(preEntry), busTime: source(busTime), busDiagnostics: busTimeDiagnostics(hub), hbiPhotos: hbiSource };";
source = replaceUnique(source, statusAnchor, statusReplacement, "msConnectionStatus");

const connectorActionAnchor =
  '  if (action === "connectorSync") return ok(await connectorSync(body, env));';
const connectorActionReplacement = `${connectorActionAnchor}
  if (action === "connectorBusDiagnostics") return ok(await connectorBusDiagnostics(body, env));`;
source = replaceUnique(
  source,
  connectorActionAnchor,
  connectorActionReplacement,
  "connectorBusDiagnostics action",
);

const connectorFunctionAnchor = `function randomToken(size) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));`;
const connectorFunctionReplacement = `// BUS_TIME_LIVE_ACCEPTANCE_V1: connector-authenticated, DEV-staged diagnostics probe.
// No Route/PreEntry upstream reads and no Turso writes are performed by the probe lane.
async function connectorBusDiagnostics(body, env) {
  const hub = text(body.hub, 80).toUpperCase();
  const tokenHash = await sha256(text(body.connectorToken, 500));
  const row = await env.DB.prepare(
    "SELECT hub FROM ms_connector_tokens WHERE hub=? AND token_hash=? AND active=1",
  ).bind(hub, tokenHash).first();
  if (!row) fail("ตัวเชื่อมต่อไม่ถูกต้อง", "INVALID_CONNECTOR", 401);
  return probeBusTimeDiagnostics(env, hub);
}

${connectorFunctionAnchor}`;
source = replaceUnique(
  source,
  connectorFunctionAnchor,
  connectorFunctionReplacement,
  "connectorBusDiagnostics function",
);

const refreshStart = source.indexOf("async function runMsRefresh(env, branch, waitUntil = null) {");
const refreshEnd = source.indexOf("\nasync function readMsLiveCache(", refreshStart);
const refreshSection = refreshStart >= 0 && refreshEnd > refreshStart
  ? source.slice(refreshStart, refreshEnd)
  : "";

if (source.includes("BUS_TIME_SOURCE_TTL_MS = 60 * 1000"))
  throw new Error(`${MARKER}: fake 60-second source TTL survived`);
if (!source.includes("readBusTimeData(env, branch, liveSourceDays(), routeHintRows)"))
  throw new Error(`${MARKER}: parallel Route-hint handoff missing`);
if (!source.includes(PARALLEL_MARKER))
  throw new Error(`${MARKER}: first-source parallel marker missing`);
if (!source.includes(SOURCE_CADENCE_MARKER) || !source.includes("MS_REALTIME_SOURCE_MIN_MS = 3 * 1000"))
  throw new Error(`${MARKER}: shared Route source cadence marker missing`);
if (!source.includes("nowMs - this.lastSourceAt < MS_REALTIME_SOURCE_MIN_MS"))
  throw new Error(`${MARKER}: 4-second UI is still coupled to Route upstream refresh`);
if (!refreshSection.includes("const routePromise = readMsRoutes(credentials);") ||
    !refreshSection.includes("const optionalPromise = Promise.all([") ||
    !refreshSection.includes("readBusTimeData(env, branch, liveSourceDays(), routeHintRows)") ||
    !refreshSection.includes("const rows = await routePromise;"))
  throw new Error(`${MARKER}: Route/optional parallel start or Route-first observation missing`);
if (!refreshSection.includes(ROUTE_FAST_MARKER) ||
    !refreshSection.includes("routeLifecycleFastTransition(lifecycleBaselineRows, routeRows)") ||
    !refreshSection.includes('typeof waitUntil === "function"') ||
    !refreshSection.includes("routeLifecycleOptionalMaps(lifecycleBaselineRows)") ||
    !refreshSection.includes("waitUntil(optionalPromise.then(() => undefined, () => undefined))"))
  throw new Error(`${MARKER}: Route waiting-to-unloading fast publish contract missing`);
const liveBusCalls = (
  refreshSection.match(/^\s*readBusTimeData\(env, branch, liveSourceDays\(\), routeHintRows\),$/gm) || []
).length;
if (liveBusCalls !== 1)
  throw new Error(`${MARKER}: expected exactly one executable shared BusTime call; got ${liveBusCalls}`);
if (!source.includes("busDiagnostics: busTimeDiagnostics(hub)"))
  throw new Error(`${MARKER}: diagnostics exposure missing`);
if (!source.includes('action === "connectorBusDiagnostics"'))
  throw new Error(`${MARKER}: connector diagnostics action missing`);
if (!source.includes("tursoWrites: 0") || !source.includes("routeUpstreamCalls: 0") || !source.includes("preEntryUpstreamCalls: 0"))
  throw new Error(`${MARKER}: zero-write diagnostics quota contract missing`);
if (!source.includes("fetchFn: fetchWithTimeout"))
  throw new Error(`${MARKER}: staged upstream timeout contract missing`);
if (!source.includes("data.sourceFailed = Boolean(data.sourceStale)"))
  throw new Error(`${MARKER}: staged degraded-cache preservation contract missing`);

fs.writeFileSync(file, source);
console.log(`${MARKER}=PASS`);
console.log(`${PARALLEL_MARKER}=PASS`);
console.log(`${SOURCE_CADENCE_MARKER}=PASS`);
console.log(`${ROUTE_FAST_MARKER}=PASS`);
console.log("ROUTE_WAIT_TO_UNLOAD_OPTIONAL_GATE=0");
console.log("ROUTE_WAIT_TO_UNLOAD_EXTRA_UPSTREAM_CALLS=0");
console.log("FIRST_SOURCE_ROUTE_LATENCY_GATE=0");
console.log("FIRST_SOURCE_BUS_READS_PER_REFRESH=1");
console.log("MS_VISIBLE_REALTIME_MS=4000");
console.log("MS_ROUTE_SHARED_SOURCE_MIN_MS=3000");
console.log("BUS_TIME_HOT_DETECTION_MS=12000");
console.log("BUS_TIME_BACKGROUND_INTERVAL_MS=12000");
console.log("BUS_TIME_MAX_BACKGROUND_CALLS_PER_CYCLE=1");
console.log("BUS_TIME_MAX_CALLS_PER_CYCLE=3");
console.log("BUS_TIME_TELEMETRY_DB_WRITES=0");
console.log("BUS_TIME_LIVE_ACCEPTANCE_ROUTE_CALLS=0");
console.log("BUS_TIME_LIVE_ACCEPTANCE_PREENTRY_CALLS=0");
console.log("BUS_TIME_LIVE_ACCEPTANCE_TURSO_WRITES=0");
console.log("BUS_TIME_UNVERIFIED_UPSTREAM_FILTERS_ADDED=0");
console.log("BUS_TIME_STAGED_RECOVERY_CONTRACT=PASS");
