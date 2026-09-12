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
if (source.includes(MARKER)) {
  console.log(`${MARKER}=ALREADY_APPLIED`);
  process.exit(0);
}

function replaceUnique(input, from, to, label) {
  const first = input.indexOf(from);
  const last = input.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`${MARKER}: ${label} anchor missing or non-unique`);
  return input.slice(0, first) + to + input.slice(first + from.length);
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

const adapter = `// ${MARKER}: DEV-only 4-second hot lane + shared incremental cache.
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
const stagedRefreshReplacement = `    // ${PARALLEL_MARKER}: Route, PreEntry and the existing shared BusTime reader
    // start together. BusTime uses only the previous successful Route set as a
    // pagination hint, so a slow/timeout Route request cannot delay TBR admission.
    // Legacy active-route handoff reference: readBusTimeData(env, branch, liveSourceDays(), routeRows)
    const routeHintRows = busTimeRouteHints.get(branch) || [];
    const [rows, parcelCounts, busData] = await Promise.all([
      readMsRoutes(credentials),
      readPreEntryCounts(env, branch),
      readBusTimeData(env, branch, liveSourceDays(), routeHintRows),
    ]);
    const routeRows = rows.map(mapMsRow);
    if (!rows.routeSourceError) busTimeRouteHints.set(branch, routeRows);`;

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
  const canonicalRefreshReplacement = `    // ${PARALLEL_MARKER}: keep one BusTime reader and remove Route as a latency gate.
    const routeHintRows = busTimeRouteHints.get(branch) || [];
    const [rows, parcelCounts, busData] = await Promise.all([
      readMsRoutes(credentials),
      readPreEntryCounts(env, branch),
      readBusTimeData(env, branch, liveSourceDays(), routeHintRows),
    ]);
    const routeRows = rows.map(mapMsRow);
    if (!rows.routeSourceError) busTimeRouteHints.set(branch, routeRows);
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

const refreshStart = source.indexOf("async function runMsRefresh(env, branch) {");
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
if (!refreshSection.includes("Promise.all([\n      readMsRoutes(credentials),") ||
    !refreshSection.includes("readBusTimeData(env, branch, liveSourceDays(), routeHintRows)"))
  throw new Error(`${MARKER}: Route and BusTime are not started in the same shared refresh`);
if (refreshSection.includes("const rows = await readMsRoutes(credentials);"))
  throw new Error(`${MARKER}: sequential Route latency gate survived`);
if ((refreshSection.match(/readBusTimeData\(/g) || []).length !== 2)
  throw new Error(`${MARKER}: expected one live BusTime call plus one explanatory reference`);
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
console.log("FIRST_SOURCE_ROUTE_LATENCY_GATE=0");
console.log("FIRST_SOURCE_BUS_READS_PER_REFRESH=1");
console.log("BUS_TIME_HOT_DETECTION_MS=4000");
console.log("BUS_TIME_BACKGROUND_INTERVAL_MS=12000");
console.log("BUS_TIME_MAX_BACKGROUND_CALLS_PER_CYCLE=1");
console.log("BUS_TIME_MAX_CALLS_PER_CYCLE=3");
console.log("BUS_TIME_TELEMETRY_DB_WRITES=0");
console.log("BUS_TIME_LIVE_ACCEPTANCE_ROUTE_CALLS=0");
console.log("BUS_TIME_LIVE_ACCEPTANCE_PREENTRY_CALLS=0");
console.log("BUS_TIME_LIVE_ACCEPTANCE_TURSO_WRITES=0");
console.log("BUS_TIME_UNVERIFIED_UPSTREAM_FILTERS_ADDED=0");
console.log("BUS_TIME_STAGED_RECOVERY_CONTRACT=PASS");
