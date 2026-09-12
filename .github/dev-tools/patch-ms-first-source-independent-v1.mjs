import fs from "node:fs";

const file = process.argv[2] || "src/index.js";
const MARKER = "MS_FIRST_SOURCE_INDEPENDENT_V1";
let source = fs.readFileSync(file, "utf8");

if (source.includes(MARKER)) {
  console.log(`${MARKER}=ALREADY_APPLIED`);
  process.exit(0);
}
if (!source.includes("BUS_TIME_HOT_LANE_V14"))
  throw new Error(`${MARKER}: BusTime hot lane must be staged first`);
if (!source.includes("MS_QUEUE_FIRST_SOURCE_V1"))
  throw new Error(`${MARKER}: first-source queue helper missing`);

function replaceUnique(input, from, to, label) {
  const first = input.indexOf(from);
  const last = input.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`${MARKER}: ${label} anchor missing or non-unique`);
  return input.slice(0, first) + to + input.slice(first + from.length);
}

const oldPrefix = `async function runMsRefresh(env, branch) {
  let credentials;
  try {
    credentials = await msCredentials(env, branch);
  } catch (error) {
    const errorCode = error?.code === "MS_CREDENTIAL_ERROR"
      ? "MS_CREDENTIAL_ERROR"
      : "MS_CREDENTIAL_READ_ERROR";
    const message = errorCode === "MS_CREDENTIAL_ERROR"
      ? "ข้อมูลเชื่อมต่อ MS ใช้งานไม่ได้ กรุณาอัปเดตเซสชันใหม่"
      : error?.message || "อ่านข้อมูลเชื่อมต่อ MS ไม่สำเร็จ";
    await safeStatusWrite(
      markConnectionError(env, "ms_connections", branch, message),
      "ms_route_credential_error_write_error",
      branch,
    );
    console.error(JSON.stringify({ event: "ms_route_credential_error", hub: branch, code: errorCode, message }));
    return { status: "error", errorCode, error: message };
  }
  if (!credentials)
    return {
      status: "not_configured",
      errorCode: "MS_NOT_CONFIGURED",
      error: \`HUB \${branch} ยังไม่ได้อัปเดตเซสชัน MS\`,
    };
  try {`;

const newPrefix = `// ${MARKER}: Route and TBR are independent queue-admission sources.
// A Route credential/source failure never gates a healthy TBR queue read. TBR-only
// rows stay read-only live view; they are not persisted to ms_routes/history.
const busRouteHints = new Map();

async function runMsRefresh(env, branch) {
  let credentials = null;
  let routeCredentialFailure = null;
  try {
    credentials = await msCredentials(env, branch);
  } catch (error) {
    const errorCode = error?.code === "MS_CREDENTIAL_ERROR"
      ? "MS_CREDENTIAL_ERROR"
      : "MS_CREDENTIAL_READ_ERROR";
    const message = errorCode === "MS_CREDENTIAL_ERROR"
      ? "ข้อมูลเชื่อมต่อ MS ใช้งานไม่ได้ กรุณาอัปเดตเซสชันใหม่"
      : error?.message || "อ่านข้อมูลเชื่อมต่อ MS ไม่สำเร็จ";
    routeCredentialFailure = { error, errorCode, message };
    await safeStatusWrite(
      markConnectionError(env, "ms_connections", branch, message),
      "ms_route_credential_error_write_error",
      branch,
    );
    console.error(JSON.stringify({ event: "ms_route_credential_error", hub: branch, code: errorCode, message }));
  }
  try {`;
source = replaceUnique(source, oldPrefix, newPrefix, "remove Route credential gate");

const oldStart = `    const rows = await readMsRoutes(credentials);
    const routeRows = rows.map(mapMsRow);
    const [parcelCounts, busData] = await Promise.all([
      readPreEntryCounts(env, branch),
      readBusTimeData(env, branch, liveSourceDays(), routeRows),
    ]);
    const tbrShadowFeed = msTbrShadowFeed(busData);`;

const newStart = `    // Start Route and the existing shared BusTime hot lane independently.
    // BusTime uses the last successful Route set only as a pagination hint; this
    // does not add another BusTime read and does not depend on current Route success.
    const routeTask = credentials
      ? readMsRoutes(credentials).then(
          (rows) => ({ ok: true, rows }),
          (error) => ({
            ok: false,
            error,
            errorCode: error?.code || "MS_ROUTE_SOURCE_ERROR",
            message: error?.message || "เชื่อมต่อ Route ไม่สำเร็จ",
          }),
        )
      : Promise.resolve({
          ok: false,
          error: routeCredentialFailure?.error || null,
          errorCode: routeCredentialFailure?.errorCode || "MS_NOT_CONFIGURED",
          message:
            routeCredentialFailure?.message ||
            \`HUB \${branch} ยังไม่ได้อัปเดตเซสชัน MS\`,
        });
    const busTask = readBusTimeData(
      env,
      branch,
      liveSourceDays(),
      busRouteHints.get(branch) || [],
    );
    const [routeResult, busData] = await Promise.all([routeTask, busTask]);
    const tbrShadowFeed = msTbrShadowFeed(busData);

    if (!routeResult.ok) {
      const routeErrorCode = routeResult.errorCode || "MS_ROUTE_SOURCE_ERROR";
      const routeMessage = routeResult.message || "เชื่อมต่อ Route ไม่สำเร็จ";
      if (credentials && routeResult.error)
        await safeStatusWrite(
          markConnectionError(env, "ms_connections", branch, routeMessage),
          "ms_connection_error_write_error",
          branch,
        );

      // Reuse the accepted Route snapshot only as baseline display truth. Current
      // TBR data can still admit a new inbound/drop trip immediately on top of it.
      const fallback = await readMsLiveCache(env, branch);
      const baseRows = Array.isArray(fallback?.rows) ? fallback.rows : [];
      const liveRows = msQueueFirstSourceRows(baseRows, busData, branch);
      const busDiag = busTimeDiagnostics(branch);
      const hasTbrAdmission = liveRows.length > baseRows.length;
      const hasUsableSnapshot = baseRows.length > 0 || hasTbrAdmission || tbrShadowFeed.length > 0;

      if (hasUsableSnapshot) {
        const result = {
          status: "degraded",
          syncedAt:
            busDiag?.busLastSuccessAt ||
            fallback?.syncedAt ||
            new Date().toISOString(),
          changes: 0,
          rows: liveRows,
          completedToday:
            fallback?.completedDay === thaiDay() && Array.isArray(fallback?.completedRows)
              ? fallback.completedRows.length
              : 0,
          tbrShadowFeed,
          routeSourceStatus: credentials ? "error" : "not_configured",
          routeSourceErrorCode: routeErrorCode,
          error: \`Route: \${routeMessage} · TBR ยังรับคิวได้อิสระ\`,
        };
        recentMsSync.set(branch, { until: Date.now() + MS_SYNC_TTL, result });
        return result;
      }

      const result = {
        status: credentials ? "error" : "not_configured",
        errorCode: routeErrorCode,
        error: routeMessage,
      };
      recentMsSync.set(branch, { until: Date.now() + MS_SYNC_TTL, result });
      return result;
    }

    const rows = routeResult.rows;
    const routeRows = rows.map(mapMsRow);
    busRouteHints.set(branch, routeRows);
    const parcelCounts = await readPreEntryCounts(env, branch);`;
source = replaceUnique(source, oldStart, newStart, "independent Route/TBR refresh start");

const refreshStart = source.indexOf("async function runMsRefresh(env, branch) {");
const refreshEnd = source.indexOf("\nasync function readMsLiveCache(", refreshStart);
if (refreshStart < 0 || refreshEnd <= refreshStart)
  throw new Error(`${MARKER}: staged runMsRefresh section missing`);
const refresh = source.slice(refreshStart, refreshEnd);
if ((refresh.match(/readBusTimeData\(/g) || []).length !== 1)
  throw new Error(`${MARKER}: runMsRefresh must keep exactly one BusTime read`);
if (!refresh.includes("busRouteHints.get(branch) || []"))
  throw new Error(`${MARKER}: previous Route hints are not reused`);
if (!refresh.includes("msQueueFirstSourceRows(baseRows, busData, branch)"))
  throw new Error(`${MARKER}: Route failure does not preserve TBR admission`);
if (!refresh.includes('status: "degraded"'))
  throw new Error(`${MARKER}: independent degraded result missing`);
if (refresh.includes("const rows = await readMsRoutes(credentials);"))
  throw new Error(`${MARKER}: sequential Route gate survived`);

fs.writeFileSync(file, source);
console.log(`${MARKER}=PASS`);
console.log("FIRST_SOURCE_ROUTE_GATE=0");
console.log("FIRST_SOURCE_BUS_READS_PER_REFRESH=1");
console.log("FIRST_SOURCE_TBR_BUSINESS_WRITES=0");
console.log("FIRST_SOURCE_ROUTE_FAILURE_TBR_QUEUE=PASS");
