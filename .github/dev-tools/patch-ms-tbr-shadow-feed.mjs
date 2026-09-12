function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS TBR shadow feed patch failed: ${label}`);
  return output.replace(from, to);
}

const MARKER = "MS_TBR_SHADOW_FEED_V1";
const FIRST_SOURCE_MARKER = "MS_QUEUE_FIRST_SOURCE_V1";

export function patchMsTbrShadowFeedWorker(source) {
  let output = String(source || "");
  if (output.includes(FIRST_SOURCE_MARKER)) return output;

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
      `// ${MARKER}: expose barcode + attendance + KIT/TBR timestamps from the\n// BusTime payload already fetched for enrichment. No extra DB or upstream read.\nfunction msTbrAttendanceFromMapKey(mapKey) {\n  const raw = String(mapKey || "");\n  const index = raw.indexOf("|A:");\n  return index >= 0 ? normalizeMsAttendance(raw.slice(index + 3)) : "";\n}\n\nfunction msTbrShadowFeed(busData) {\n  if (!(busData instanceof Map) || busData.sourceFailed) return [];\n  const seen = new Set();\n  const feed = [];\n  for (const [mapKey, item] of busData.entries()) {\n    const proofId = normalizeProofId(item?.proofId);\n    const attendanceType = msTbrAttendanceFromMapKey(mapKey);\n    const tbrAt = text(item?.scheduleTbrArrivalAt, 100);\n    const uniqueKey = proofId + "|" + attendanceType;\n    if (!proofId || !attendanceType || !tbrAt || seen.has(uniqueKey)) continue;\n    seen.add(uniqueKey);\n    feed.push({\n      proofId: text(item?.proofId, 100),\n      attendanceType,\n      scheduleTbrArrivalAt: tbrAt,\n      scheduleKitArrivalAt: text(item?.scheduleKitArrivalAt, 100),\n    });\n  }\n  return feed;\n}\n\n// ${FIRST_SOURCE_MARKER}: TBR and Route are peer admission sources for inbound\n// queue membership. Route remains authoritative for actual arrival, unloading\n// state, completion and departure. A TBR-only row is a read-only live-view row:\n// it is not inserted into ms_routes/history and therefore adds zero business writes.\nfunction msQueueFirstSourceRows(routeRows, busData, branch, nowMs = Date.now()) {\n  const rows = Array.isArray(routeRows) ? [...routeRows] : [];\n  if (!(busData instanceof Map)) return rows;\n  const queueKeys = new Set();\n  for (const row of rows) {\n    const proofId = normalizeProofId(row?.proofId);\n    const attendanceType = normalizeMsAttendance(row?.attendanceType);\n    if (proofId && attendanceType) queueKeys.add(proofId + "|" + attendanceType);\n  }\n  const maxAgeMs = 12 * 60 * 60 * 1000;\n  const futureToleranceMs = 5 * 60 * 1000;\n  for (const [mapKey, item] of busData.entries()) {\n    const proofId = normalizeProofId(item?.proofId);\n    const attendanceType = msTbrAttendanceFromMapKey(mapKey);\n    if (!proofId || (attendanceType !== "ปลายทาง" && attendanceType !== "จุดดรอป")) continue;\n    const queueKey = proofId + "|" + attendanceType;\n    if (queueKeys.has(queueKey)) continue;\n    const tbrAt = date(item?.scheduleTbrArrivalAt);\n    const tbrMs = Date.parse(String(tbrAt || ""));\n    if (!Number.isFinite(tbrMs)) continue;\n    if (tbrMs > nowMs + futureToleranceMs || nowMs - tbrMs > maxAgeMs) continue;\n    if (Number.isFinite(Date.parse(String(item?.scheduleUnloadingCompletedAt || "")))) continue;\n    queueKeys.add(queueKey);\n    rows.push({\n      id: "TBR:" + String(branch || "") + ":" + proofId + ":" + attendanceType,\n      hub: String(branch || ""),\n      proofId: text(item?.proofId, 100),\n      routeName: text(item?.routeName, 300),\n      region: "",\n      routeAttribute: "",\n      routeType: "",\n      attendanceType,\n      estimatedArrivalAt: "",\n      actualArrivalAt: "",\n      estimatedDepartureAt: "",\n      actualDepartureAt: "",\n      supplier: "",\n      vehicleType: "",\n      plate: "",\n      driverName: "",\n      driverPhone: "",\n      trackingStatus: "TBR_QUEUE_PENDING",\n      vehicleStatus: "TBR เข้าคิว · รอ Route ยืนยัน",\n      loadStatus: "",\n      unloadingState: null,\n      unloadingCompletedAt: "",\n      sourceUpdatedAt: tbrAt,\n      expectedParcels: null,\n      enteredParcels: null,\n      pendingParcels: null,\n      scheduleKitArrivalAt: date(item?.scheduleKitArrivalAt),\n      scheduleTbrArrivalAt: tbrAt,\n      arrivedParcels: Number(item?.arrivedParcels) || 0,\n      arrivedBags: Number(item?.arrivedBags) || 0,\n      scheduleUnloadingStartedAt: date(item?.scheduleUnloadingStartedAt),\n      scheduleUnloadingCompletedAt: date(item?.scheduleUnloadingCompletedAt),\n      completionSource: "UNKNOWN",\n      completionObservedLive: false,\n      queueProvisional: true,\n      syncedAt: tbrAt,\n      syncedBy: "TBR_FIRST_SOURCE",\n    });\n  }\n  return rows;\n}\n\nasync function preEntryCredentials(env, hub) {`,
      "add DB-free BusTime shadow feed and first-source queue helper",
    );
  } else {
    throw new Error("MS TBR shadow V1 already exists without first-source queue marker");
  }

  return output;
}
