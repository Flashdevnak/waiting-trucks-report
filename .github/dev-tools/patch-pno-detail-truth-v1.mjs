const WORKER_MARKER = "PNO_DETAIL_TYPE_TRUTH_V1";
const FRONTEND_MARKER = "PNO_DETAIL_TYPE_TRUTH_FRONTEND_V1";

function replaceUnique(source, from, to, label) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`${WORKER_MARKER}: ${label} anchor missing or non-unique`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

export function patchPnoDetailTruthWorker(source) {
  let output = String(source || "");
  if (output.includes(WORKER_MARKER)) return output;
  if (!output.includes("PNO_ROUND2_BARCODE_BACKING_V2")) return output;

  output = replaceUnique(
    output,
    `const PNO_VIEW_FIELDS = [
  "pnoState", "pnoEnabled", "pnoPercent", "pnoSourceDay",
  "pnoLineId", "pnoVanLineId", "pnoStoreId", "pnoNextStoreId",
];`,
    `// ${WORKER_MARKER}: preserve FBI can_report from the already-loaded summary so
// detail type=no_entry/already is evaluated with the same warehouse context.
const PNO_VIEW_FIELDS = [
  "pnoState", "pnoEnabled", "pnoPercent", "pnoSourceDay",
  "pnoLineId", "pnoVanLineId", "pnoStoreId", "pnoNextStoreId", "pnoCanReport",
];`,
    "PNO view metadata fields",
  );

  output = replaceUnique(
    output,
    `    pnoNextStoreId: text(row.next_store_id, 160),
    pnoSourceDay: String(sourceDay || ""),`,
    `    pnoNextStoreId: text(row.next_store_id, 160),
    pnoCanReport: Number(row?.can_report) || 0,
    pnoSourceDay: String(sourceDay || ""),`,
    "summary can_report mapping",
  );

  output = replaceUnique(
    output,
    `      count: url.searchParams.get("count"),
      lineId: url.searchParams.get("lineId"),`,
    `      count: url.searchParams.get("count"),
      canReport: url.searchParams.get("canReport"),
      lineId: url.searchParams.get("lineId"),`,
    "public pendingParcels canReport input",
  );

  output = replaceUnique(
    output,
    `  const rawCount = input.count;
  const count = rawCount === "" || rawCount === null || rawCount === undefined
    ? null
    : Number(rawCount);
  return {`,
    `  const rawCount = input.count;
  const count = rawCount === "" || rawCount === null || rawCount === undefined
    ? null
    : Number(rawCount);
  const rawCanReport = input.canReport;
  const canReport = rawCanReport === "" || rawCanReport === null || rawCanReport === undefined
    ? null
    : Number(rawCanReport);
  return {`,
    "locator canReport normalization",
  );

  output = replaceUnique(
    output,
    `    count: Number.isFinite(count) && count >= 0 ? count : null,
    lineId: text(input.lineId, 160),`,
    `    count: Number.isFinite(count) && count >= 0 ? count : null,
    canReport: Number.isFinite(canReport) && canReport >= 0 ? canReport : null,
    lineId: text(input.lineId, 160),`,
    "locator canReport field",
  );

  output = replaceUnique(
    output,
    `    String(locator.type || ""),
    Number(locator.page) || 1,`,
    `    String(locator.type || ""),
    locator.canReport === null || locator.canReport === undefined ? "NA" : Number(locator.canReport),
    Number(locator.page) || 1,`,
    "shared PNO cache canReport key",
  );

  output = replaceUnique(
    output,
    `    count: locator.count,
    lineId: locator.lineId,`,
    `    count: locator.count,
    canReport: locator.canReport,
    lineId: locator.lineId,`,
    "Durable Object target canReport",
  );

  output = replaceUnique(
    output,
    `          count: url.searchParams.get("count"),
          lineId: url.searchParams.get("lineId"),`,
    `          count: url.searchParams.get("count"),
          canReport: url.searchParams.get("canReport"),
          lineId: url.searchParams.get("lineId"),`,
    "Durable Object route canReport",
  );

  output = replaceUnique(
    output,
    `    title: locator.type === "total" ? "arriving_monitoring.expect_num" : locator.type === "already" ? "arriving_monitoring.already_num" : "arriving_monitoring.no_entry_num",
    page: String(locator.page || 1),`,
    `    title: locator.type === "total" ? "arriving_monitoring.expect_num" : locator.type === "already" ? "arriving_monitoring.already_num" : "arriving_monitoring.no_entry_num",
    canReport: String(locator.canReport ?? 0),
    page: String(locator.page || 1),`,
    "FBI detail canReport query",
  );

  return output;
}

export function patchPnoDetailTruthFrontend(source) {
  let output = String(source || "");
  if (output.includes(FRONTEND_MARKER)) return output;
  if (!output.includes("PNO_ROUND2_UI_V2")) return output;

  output = replaceUnique(
    output,
    `function pnoBrowserBaseKey(row, type) {
  return [
    String(state.branch || row?.hub || "").toUpperCase(),
    String(row?.pnoSourceDay || ""),
    String(row?.proofId || "").trim().toUpperCase(),
    String(type || ""),
  ].join("|");
}`,
    `// ${FRONTEND_MARKER}: can_report rides the existing click-only detail request.
function pnoBrowserBaseKey(row, type) {
  return [
    String(state.branch || row?.hub || "").toUpperCase(),
    String(row?.pnoSourceDay || ""),
    String(row?.proofId || "").trim().toUpperCase(),
    String(type || ""),
    String(row?.pnoCanReport ?? 0),
  ].join("|");
}`,
    "browser PNO base key",
  );

  output = replaceUnique(
    output,
    `    count,
    lineId: row.pnoLineId,`,
    `    count,
    canReport: row.pnoCanReport ?? 0,
    lineId: row.pnoLineId,`,
    "browser PNO canReport request",
  );

  return output;
}
