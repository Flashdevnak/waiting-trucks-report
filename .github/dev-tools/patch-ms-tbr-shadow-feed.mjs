function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS TBR shadow feed patch failed: ${label}`);
  return output.replace(from, to);
}

const MARKER = "MS_TBR_SHADOW_FEED_V1";
const FIRST_SOURCE_MARKER = "MS_QUEUE_FIRST_SOURCE_V1";
const INDEPENDENT_MARKER = "MS_FIRST_SOURCE_INDEPENDENT_V1";

export function patchMsTbrShadowFeedWorker(source) {
  let output = String(source || "");
  if (output.includes(INDEPENDENT_MARKER)) return output;

  if (!output.includes(MARKER)) {
    output = replaceUnique(
      output,
      `    const [parcelCounts, busData] = await Promise.all([\n      readPreEntryCounts(env, branch),\n      readBusTimeData(env, branch),\n    ]);`,
      `    const [parcelCounts, busData] = await Promise.all([\n      readPreEntryCounts(env, branch),\n      readBusTimeData(env, branch),\n    ]);\n    const tbrShadowFeed = msTbrShadowFeed(busData);`,
      "derive TBR feed from the already-fetched BusTime payload",
    );

    output = replaceUnique(
      output,
      `    const result = {\n      status: "synced",\n      syncedAt: sync.syncedAt,\n      changes: sync.changes,\n      rows: sync.rows,\n      completedToday: completedRows.length,\n    };`,
      `    const result = {\n      status: "synced",\n      syncedAt: sync.syncedAt,\n      changes: sync.changes,\n      rows: msQueueFirstSourceRows(sync.rows, busData, branch),\n      completedToday: completedRows.length,\n      tbrShadowFeed,\n    };`,
      "return shadow feed and first-source queue view in the existing refresh result",
    );

    output = replaceUnique(
      output,
      `async function preEntryCredentials(env, hub) {`,
      `// ${MARKER}: expose barcode + attendance + KIT/TBR timestamps from the\n// BusTime payload already fetched for enrichment. No extra DB or upstream read.\nfunction msTbrAttendanceFromMapKey(mapKey) {\n  const raw = String(mapKey || "");\n  const index = raw.indexOf("|A:");\n  return index >= 0 ? normalizeMsAttendance(raw.slice(index + 3)) : "";\n}\n\nfunction msTbrShadowFeed(busData) {\n  if (!(busData instanceof Map) || busData.sourceFailed) return [];\n  const seen = new Set();\n  const feed = [];\n  for (const [mapKey, item] of busData.entries()) {\n    const proofId = normalizeProofId(item?.proofId);\n    const attendanceType = msTbrAttendanceFromMapKey(mapKey);\n    const tbrAt = text(item?.scheduleTbrArrivalAt, 100);\n    const uniqueKey = proofId + "|" + attendanceType;\n    if (!proofId || !attendanceType || !tbrAt || seen.has(uniqueKey)) continue;\n    seen.add(uniqueKey);\n    feed.push({\n      proofId: text(item?.proofId, 100),\n      attendanceType,\n      scheduleTbrArrivalAt: tbrAt,\n      scheduleKitArrivalAt: text(item?.scheduleKitArrivalAt, 100),\n    });\n  }\n  return feed;\n}\n\n// ${FIRST_SOURCE_MARKER}: TBR and Route are equal admission sources for inbound\n// queue membership. Whichever source arrives first admits the trip immediately.\n// Route can later enrich/replace the same proof+attendance row; it is not a gate\n// or approval step for TBR admission. Route remains authoritative for its own raw\n// actual-arrival/status fields and the existing merged logic applies once present.\n// A TBR-only row is read-only live view and adds zero ms_routes/history writes.\nfunction msQueueFirstSourceRows(routeRows, busData, branch, nowMs = Date.now()) {\n  const rows = Array.isArray(routeRows) ? [...routeRows] : [];\n  if (!(busData instanceof Map)) return rows;\n  const queueKeys = new Set();\n  for (const row of rows) {\n    const proofId = normalizeProofId(row?.proofId);\n    const attendanceType = normalizeMsAttendance(row?.attendanceType);\n    if (proofId && attendanceType) queueKeys.add(proofId + "|" + attendanceType);\n  }\n  const maxAgeMs = 12 * 60 * 60 * 1000;\n  const futureToleranceMs = 5 * 60 * 1000;\n  for (const [mapKey, item] of busData.entries()) {\n    const proofId = normalizeProofId(item?.proofId);\n    const attendanceType = msTbrAttendanceFromMapKey(mapKey);\n    if (!proofId || (attendanceType !== "ปลายทาง" && attendanceType !== "จุดดรอป")) continue;\n    const queueKey = proofId + "|" + attendanceType;\n    if (queueKeys.has(queueKey)) continue;\n    const tbrAt = date(item?.scheduleTbrArrivalAt);\n    const tbrMs = Date.parse(String(tbrAt || ""));\n    if (!Number.isFinite(tbrMs)) continue;\n    if (tbrMs > nowMs + futureToleranceMs || nowMs - tbrMs > maxAgeMs) continue;\n    if (Number.isFinite(Date.parse(String(item?.scheduleUnloadingCompletedAt || "")))) continue;\n    queueKeys.add(queueKey);\n    rows.push({\n      id: "TBR:" + String(branch || "") + ":" + proofId + ":" + attendanceType,\n      hub: String(branch || ""),\n      proofId: text(item?.proofId, 100),\n      routeName: text(item?.routeName, 300),\n      region: "",\n      routeAttribute: "",\n      routeType: "",\n      attendanceType,\n      estimatedArrivalAt: "",\n      actualArrivalAt: "",\n      estimatedDepartureAt: "",\n      actualDepartureAt: "",\n      supplier: "",\n      vehicleType: "",\n      plate: "",\n      driverName: "",\n      driverPhone: "",\n      trackingStatus: "TBR_QUEUE_ADMITTED",\n      vehicleStatus: "เข้าคิวแล้วจาก TBR",\n      loadStatus: "",\n      unloadingState: null,\n      unloadingCompletedAt: "",\n      sourceUpdatedAt: tbrAt,\n      expectedParcels: null,\n      enteredParcels: null,\n      pendingParcels: null,\n      scheduleKitArrivalAt: date(item?.scheduleKitArrivalAt),\n      scheduleTbrArrivalAt: tbrAt,\n      arrivedParcels: Number(item?.arrivedParcels) || 0,\n      arrivedBags: Number(item?.arrivedBags) || 0,\n      scheduleUnloadingStartedAt: date(item?.scheduleUnloadingStartedAt),\n      scheduleUnloadingCompletedAt: date(item?.scheduleUnloadingCompletedAt),\n      completionSource: "UNKNOWN",\n      completionObservedLive: false,\n      queueAdmissionSource: "TBR",\n      syncedAt: tbrAt,\n      syncedBy: "TBR_FIRST_SOURCE",\n    });\n  }\n  return rows;\n}\n\nasync function preEntryCredentials(env, hub) {`,
      "add DB-free BusTime shadow feed and first-source queue helper",
    );
  } else if (!output.includes(FIRST_SOURCE_MARKER)) {
    throw new Error("MS TBR shadow V1 already exists without first-source queue marker");
  }

  // ${INDEPENDENT_MARKER}: Route credential/source failure must not prevent the
  // already-configured BusTime/TBR source from admitting queue rows. Keep the
  // exact readMsRoutes call in runMsRefresh so BUS_TIME_HOT_LANE_V14 can still
  // apply its verified active-route hint patch later in DEV staging.
  const oldCredentialGate = `async function runMsRefresh(env, branch) {\n  let credentials;\n  try {\n    credentials = await msCredentials(env, branch);\n  } catch (error) {\n    const errorCode = error?.code === "MS_CREDENTIAL_ERROR"\n      ? "MS_CREDENTIAL_ERROR"\n      : "MS_CREDENTIAL_READ_ERROR";\n    const message = errorCode === "MS_CREDENTIAL_ERROR"\n      ? "ข้อมูลเชื่อมต่อ MS ใช้งานไม่ได้ กรุณาอัปเดตเซสชันใหม่"\n      : error?.message || "อ่านข้อมูลเชื่อมต่อ MS ไม่สำเร็จ";\n    await safeStatusWrite(\n      markConnectionError(env, "ms_connections", branch, message),\n      "ms_route_credential_error_write_error",\n      branch,\n    );\n    console.error(JSON.stringify({ event: "ms_route_credential_error", hub: branch, code: errorCode, message }));\n    return { status: "error", errorCode, error: message };\n  }\n  if (!credentials)\n    return {\n      status: "not_configured",\n      errorCode: "MS_NOT_CONFIGURED",\n      error: \`HUB \${branch} ยังไม่ได้อัปเดตเซสชัน MS\`,\n    };\n  try {`;
  const newCredentialGate = `// ${INDEPENDENT_MARKER}: Route and TBR are independent admission sources.\nasync function runMsRefresh(env, branch) {\n  let credentials = null;\n  let routeCredentialFailure = null;\n  try {\n    credentials = await msCredentials(env, branch);\n  } catch (error) {\n    const errorCode = error?.code === "MS_CREDENTIAL_ERROR"\n      ? "MS_CREDENTIAL_ERROR"\n      : "MS_CREDENTIAL_READ_ERROR";\n    const message = errorCode === "MS_CREDENTIAL_ERROR"\n      ? "ข้อมูลเชื่อมต่อ MS ใช้งานไม่ได้ กรุณาอัปเดตเซสชันใหม่"\n      : error?.message || "อ่านข้อมูลเชื่อมต่อ MS ไม่สำเร็จ";\n    routeCredentialFailure = { error, errorCode, message };\n    await safeStatusWrite(\n      markConnectionError(env, "ms_connections", branch, message),\n      "ms_route_credential_error_write_error",\n      branch,\n    );\n    console.error(JSON.stringify({ event: "ms_route_credential_error", hub: branch, code: errorCode, message }));\n  }\n  try {`;
  output = replaceUnique(output, oldCredentialGate, newCredentialGate, "remove Route credential gate");

  const routeStart = output.indexOf("async function readMsRoutes(credentials, wantedStart, wantedEnd) {");
  const routeEnd = output.indexOf("\nasync function msRange(", routeStart);
  if (routeStart < 0 || routeEnd <= routeStart)
    throw new Error("MS TBR shadow feed patch failed: readMsRoutes section missing");
  let routeSection = output.slice(routeStart, routeEnd);
  routeSection = routeSection.replace(
    "async function readMsRoutes(credentials, wantedStart, wantedEnd) {\n",
    `async function readMsRoutes(credentials, wantedStart, wantedEnd) {\n  const explicitRange = Number.isFinite(wantedStart) || Number.isFinite(wantedEnd);\n  if (!credentials && !explicitRange) {\n    const missing = [];\n    const error = new Error("Route ยังไม่ได้เชื่อมต่อ");\n    error.code = "MS_NOT_CONFIGURED";\n    missing.routeSourceError = error;\n    return missing;\n  }\n  try {\n`,
  );
  const routeReturn = routeSection.lastIndexOf("  return rows;\n}");
  if (routeReturn < 0)
    throw new Error("MS TBR shadow feed patch failed: readMsRoutes return anchor missing");
  routeSection =
    routeSection.slice(0, routeReturn) +
    `  return rows;\n  } catch (error) {\n    if (explicitRange) throw error;\n    const failed = [];\n    failed.routeSourceError = error;\n    return failed;\n  }\n}` +
    routeSection.slice(routeReturn + "  return rows;\n}".length);
  output = output.slice(0, routeStart) + routeSection + output.slice(routeEnd);

  const shadowAnchor = "    const tbrShadowFeed = msTbrShadowFeed(busData);";
  const independentFallback = `${shadowAnchor}\n\n    if (routeCredentialFailure && !rows.routeSourceError)\n      rows.routeSourceError = routeCredentialFailure.error || routeCredentialFailure;\n    if (rows.routeSourceError || !credentials) {\n      const routeError = rows.routeSourceError || routeCredentialFailure?.error || null;\n      const routeErrorCode =\n        routeCredentialFailure?.errorCode ||\n        routeError?.code ||\n        (credentials ? "MS_ROUTE_SOURCE_ERROR" : "MS_NOT_CONFIGURED");\n      const routeMessage =\n        routeCredentialFailure?.message ||\n        routeError?.message ||\n        (credentials ? "เชื่อมต่อ Route ไม่สำเร็จ" : \`HUB \${branch} ยังไม่ได้อัปเดตเซสชัน MS\`);\n      if (credentials && routeError)\n        await safeStatusWrite(\n          markConnectionError(env, "ms_connections", branch, routeMessage),\n          "ms_connection_error_write_error",\n          branch,\n        );\n\n      const fallback = await readMsLiveCache(env, branch);\n      const baseRows = Array.isArray(fallback?.rows) ? fallback.rows : [];\n      const liveRows = msQueueFirstSourceRows(baseRows, busData, branch);\n      const hasTbrAdmission = liveRows.length > baseRows.length;\n      const hasUsableSnapshot = baseRows.length > 0 || hasTbrAdmission || tbrShadowFeed.length > 0;\n      if (hasUsableSnapshot) {\n        const result = {\n          status: "degraded",\n          syncedAt: fallback?.syncedAt || new Date().toISOString(),\n          changes: 0,\n          rows: liveRows,\n          completedToday:\n            fallback?.completedDay === thaiDay() && Array.isArray(fallback?.completedRows)\n              ? fallback.completedRows.length\n              : 0,\n          tbrShadowFeed,\n          routeSourceStatus: credentials ? "error" : "not_configured",\n          routeSourceErrorCode: routeErrorCode,\n          error: \`Route: \${routeMessage} · TBR ยังรับคิวได้อิสระ\`,\n        };\n        recentMsSync.set(branch, { until: Date.now() + MS_SYNC_TTL, result });\n        return result;\n      }\n      const result = {\n        status: credentials ? "error" : "not_configured",\n        errorCode: routeErrorCode,\n        error: routeMessage,\n      };\n      recentMsSync.set(branch, { until: Date.now() + MS_SYNC_TTL, result });\n      return result;\n    }`;
  output = replaceUnique(output, shadowAnchor, independentFallback, "Route failure keeps TBR queue alive");

  if (!output.includes(INDEPENDENT_MARKER))
    throw new Error("MS TBR shadow feed patch failed: independent-source marker missing");
  if (!output.includes("rows.routeSourceError"))
    throw new Error("MS TBR shadow feed patch failed: Route failure marker missing");
  if (!output.includes("msQueueFirstSourceRows(baseRows, busData, branch)"))
    throw new Error("MS TBR shadow feed patch failed: TBR degraded queue fallback missing");

  return output;
}
