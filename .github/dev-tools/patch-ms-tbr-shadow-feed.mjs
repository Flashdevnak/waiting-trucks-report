function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS TBR shadow feed patch failed: ${label}`);
  return output.replace(from, to);
}

const MARKER = "MS_TBR_SHADOW_FEED_V1";

export function patchMsTbrShadowFeedWorker(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;

  output = replaceUnique(
    output,
    `    const [parcelCounts, busData] = await Promise.all([\n      readPreEntryCounts(env, branch),\n      readBusTimeData(env, branch),\n    ]);`,
    `    const [parcelCounts, busData] = await Promise.all([\n      readPreEntryCounts(env, branch),\n      readBusTimeData(env, branch),\n    ]);\n    const tbrShadowFeed = msTbrShadowFeed(busData);`,
    "derive TBR feed from the already-fetched BusTime payload",
  );

  output = replaceUnique(
    output,
    `    const result = {\n      status: "synced",\n      syncedAt: sync.syncedAt,\n      changes: sync.changes,\n      rows: sync.rows,\n      completedToday: completedRows.length,\n    };`,
    `    const result = {\n      status: "synced",\n      syncedAt: sync.syncedAt,\n      changes: sync.changes,\n      rows: sync.rows,\n      completedToday: completedRows.length,\n      tbrShadowFeed,\n    };`,
    "return shadow feed only in the existing refresh result",
  );

  output = replaceUnique(
    output,
    `async function preEntryCredentials(env, hub) {`,
    `// ${MARKER}: expose only barcode + KIT/TBR timestamps from the BusTime\n// payload already fetched for enrichment. This helper never reads or writes DB.\nfunction msTbrShadowFeed(busData) {\n  if (!(busData instanceof Map) || busData.sourceFailed) return [];\n  const seen = new Set();\n  const feed = [];\n  for (const item of busData.values()) {\n    const proofId = normalizeProofId(item?.proofId);\n    const tbrAt = text(item?.scheduleTbrArrivalAt, 100);\n    if (!proofId || !tbrAt || seen.has(proofId)) continue;\n    seen.add(proofId);\n    feed.push({\n      proofId: text(item?.proofId, 100),\n      scheduleTbrArrivalAt: tbrAt,\n      scheduleKitArrivalAt: text(item?.scheduleKitArrivalAt, 100),\n    });\n  }\n  return feed;\n}\n\nasync function preEntryCredentials(env, hub) {`,
    "add DB-free BusTime shadow feed helper",
  );

  return output;
}
