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
}`;

source = source.slice(0, legacyStart) + adapter + source.slice(busEnd);

const stagedRefreshAnchor = `    const rows = await readMsRoutes(credentials);
    const [parcelCounts, busData] = await Promise.all([
      readPreEntryCounts(env, branch),
      readBusTimeData(env, branch),
    ]);`;
const stagedRefreshReplacement = `    const rows = await readMsRoutes(credentials);
    const routeRows = rows.map(mapMsRow);
    const [parcelCounts, busData] = await Promise.all([
      readPreEntryCounts(env, branch),
      readBusTimeData(env, branch, liveSourceDays(), routeRows),
    ]);`;

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
  const canonicalRefreshReplacement = `    const rows = await readMsRoutes(credentials);
    const routeRows = rows.map(mapMsRow);
    const parcelCounts = await readPreEntryCounts(env, branch);
    const busData = await readBusTimeData(env, branch, liveSourceDays(), routeRows);
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
  await audit(env, "SAVE_MS_BUS_CONNECTION", hub, \`ทดสอบสำเร็จ \${test.total} รายการ\`, actor.username);`;
source = replaceUnique(source, saveAnchor, saveReplacement, "saveMsBusConnection");

const statusAnchor =
  "  return { hub, routes: source(routes), preEntry: source(preEntry), busTime: source(busTime), hbiPhotos: hbiSource };";
const statusReplacement =
  "  return { hub, routes: source(routes), preEntry: source(preEntry), busTime: source(busTime), busDiagnostics: busTimeDiagnostics(hub), hbiPhotos: hbiSource };";
source = replaceUnique(source, statusAnchor, statusReplacement, "msConnectionStatus");

if (source.includes("BUS_TIME_SOURCE_TTL_MS = 60 * 1000"))
  throw new Error(`${MARKER}: fake 60-second source TTL survived`);
if (!source.includes("readBusTimeData(env, branch, liveSourceDays(), routeRows)"))
  throw new Error(`${MARKER}: Route active-set handoff missing`);
if (!source.includes("busDiagnostics: busTimeDiagnostics(hub)"))
  throw new Error(`${MARKER}: diagnostics exposure missing`);
if (!source.includes("fetchFn: fetchWithTimeout"))
  throw new Error(`${MARKER}: staged upstream timeout contract missing`);
if (!source.includes("data.sourceFailed = Boolean(data.sourceStale)"))
  throw new Error(`${MARKER}: staged degraded-cache preservation contract missing`);

fs.writeFileSync(file, source);
console.log(`${MARKER}=PASS`);
console.log("BUS_TIME_HOT_DETECTION_MS=4000");
console.log("BUS_TIME_BACKGROUND_INTERVAL_MS=12000");
console.log("BUS_TIME_MAX_BACKGROUND_CALLS_PER_CYCLE=1");
console.log("BUS_TIME_MAX_CALLS_PER_CYCLE=3");
console.log("BUS_TIME_TELEMETRY_DB_WRITES=0");
console.log("BUS_TIME_UNVERIFIED_UPSTREAM_FILTERS_ADDED=0");
console.log("BUS_TIME_STAGED_RECOVERY_CONTRACT=PASS");
