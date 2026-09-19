const WORKER_MARKER = "PNO_FBI_SOURCE_CONTRACT_V23";
const FRONTEND_MARKER = "PNO_PENDING_TOTAL_INTERSECTION_V23";

function replaceUnique(source, from, to, label) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`${label}: anchor missing or non-unique`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

export function patchPnoSourceContractWorkerV23(source) {
  let output = String(source || "");
  if (output.includes(WORKER_MARKER)) return output;
  if (!output.includes("PNO_DETAIL_TYPE_TRUTH_V1"))
    throw new Error(WORKER_MARKER + ": detail-truth prerequisite missing");

  output = replaceUnique(
    output,
    `  return {
    items: Array.isArray(json.data?.DataList) ? json.data.DataList : [],
    total: Number(json.data?.Total) || 0,
  };`,
    `  // ${WORKER_MARKER}: MS/FBI uses response-level can_report and converts it
  // to a boolean before opening route_followstart_list. Preserve that exact
  // context on each summary row; provider rows themselves do not expose it.
  const pnoCanReport = Number(json.data?.can_report) === 1;
  return {
    items: (Array.isArray(json.data?.DataList) ? json.data.DataList : [])
      .map((item) => ({ ...item, __pnoCanReport: pnoCanReport })),
    total: Number(json.data?.Total) || 0,
    canReport: pnoCanReport,
  };`,
    "PreEntry response can_report contract",
  );

  output = replaceUnique(
    output,
    `    pnoCanReport: Number(row?.can_report) || 0,`,
    `    pnoCanReport: row?.__pnoCanReport === true || Number(row?.can_report) === 1,`,
    "PNO view canReport boolean",
  );

  output = replaceUnique(
    output,
    `  const rawCanReport = input.canReport;
  const canReport = rawCanReport === "" || rawCanReport === null || rawCanReport === undefined
    ? null
    : Number(rawCanReport);`,
    `  const rawCanReport = input.canReport;
  const canReport = rawCanReport === true || rawCanReport === 1 ||
    String(rawCanReport ?? "").toLowerCase() === "true" || String(rawCanReport ?? "") === "1";`,
    "locator boolean canReport",
  );

  output = replaceUnique(
    output,
    `    canReport: Number.isFinite(canReport) && canReport >= 0 ? canReport : null,`,
    `    canReport,`,
    "locator canReport field",
  );

  output = replaceUnique(
    output,
    `    locator.canReport === null || locator.canReport === undefined ? "NA" : Number(locator.canReport),`,
    `    locator.canReport === true ? "1" : "0",`,
    "shared PNO cache canReport key",
  );

  output = replaceUnique(
    output,
    `    canReport: String(locator.canReport ?? 0),`,
    `    canReport: locator.canReport === true ? "true" : "false",`,
    "FBI canReport query boolean",
  );

  return output;
}

export function patchPnoSourceContractFrontendV23(source) {
  let output = String(source || "");
  if (output.includes(FRONTEND_MARKER) || output.includes("PNO_OWN_HUB_BACKING_SINGLE_TRUTH_V24")) return output;
  if (!output.includes("PNO_INBOUND_SCOPE_AND_EAGER_TRUTH_V22"))
    throw new Error(FRONTEND_MARKER + ": V22 prerequisite missing");

  output = replaceUnique(
    output,
    `// PNO_INBOUND_SCOPE_AND_EAGER_TRUTH_V22: inbound PNO is destination/drop only, and explicit modal open resolves corrected truth before rendering any tab.`,
    `// PNO_INBOUND_SCOPE_AND_EAGER_TRUTH_V22: inbound PNO is destination/drop only, and explicit modal open resolves corrected truth before rendering any tab.
// ${FRONTEND_MARKER}: pending PNO membership is authoritative; when no_entry omits Backing metadata, enrich only those pending PNOs from total before correction.`,
    "V23 marker",
  );

  output = replaceUnique(
    output,
    `    String(row?.pnoCanReport ?? 0),`,
    `    row?.pnoCanReport === true ? "1" : "0",`,
    "browser cache boolean canReport key",
  );

  output = replaceUnique(
    output,
    `    canReport: row.pnoCanReport ?? 0,`,
    `    canReport: row.pnoCanReport === true,`,
    "browser request boolean canReport",
  );

  const helperAnchor = `async function pnoOperationalResolve(row) {`;
  const helpers = `function pnoOperationalNeedsTotalMetadata(item, row) {
  const pno = pnoOperationalNormalizePno(item?.pno);
  if (!pno || String(item?.backingNo || "").trim()) return false;
  const action = String(item?.lastAction || "").trim();
  const target = String(item?.targetHub || "").trim();
  if (!action || !target) return true;
  return action === "สแกนเข้าคลัง" &&
    pnoOperationalHubMatches(target, state.branch || row?.hub);
}

async function pnoOperationalEnrichPendingFromTotal(row, noEntryRows) {
  const unique = [];
  const byPno = new Map();
  for (const item of Array.isArray(noEntryRows) ? noEntryRows : []) {
    const pno = pnoOperationalNormalizePno(item?.pno);
    if (!pno || byPno.has(pno)) continue;
    const copy = { ...item, category: "no_entry" };
    byPno.set(pno, copy);
    unique.push(copy);
  }

  const unresolved = new Set(
    unique.filter((item) => pnoOperationalNeedsTotalMetadata(item, row))
      .map((item) => pnoOperationalNormalizePno(item?.pno)),
  );
  if (!unresolved.size)
    return { rows: unique, usedTotalFallback: false, totalPagesRead: 0 };

  let page = 1;
  let pages = 1;
  let pagesRead = 0;
  do {
    const result = await browserPnoPage(row, "total", page, false);
    pagesRead += 1;
    const list = Array.isArray(result?.parcels) ? result.parcels : [];
    for (const totalItem of list) {
      const pno = pnoOperationalNormalizePno(totalItem?.pno);
      if (!pno || !unresolved.has(pno)) continue;
      const pendingItem = byPno.get(pno);
      if (pendingItem) byPno.set(pno, { ...pendingItem, ...totalItem, category: "no_entry" });
      unresolved.delete(pno);
    }
    pages = Math.max(
      1,
      Number(result?.pages) || Math.ceil((Number(result?.total) || list.length) /
        Math.max(1, Number(result?.pageSize) || 200)) || 1,
    );
    page += 1;
  } while (unresolved.size && page <= pages);

  return {
    rows: unique.map((item) => byPno.get(pnoOperationalNormalizePno(item?.pno)) || item),
    usedTotalFallback: true,
    totalPagesRead: pagesRead,
    unresolvedMetadata: unresolved.size,
  };
}

`;
  if (!output.includes(helperAnchor)) throw new Error(FRONTEND_MARKER + ": resolver anchor missing");
  output = output.replace(helperAnchor, helpers + helperAnchor);

  output = replaceUnique(
    output,
    `    const loaded = await pnoOperationalLoadAllRaw(row, "no_entry");
    const truth = pnoOperationalBuildTruth(row, loaded.rows);
    if (pnoOperationalTruthCache.size >= 120) pnoOperationalTruthCache.clear();`,
    `    const loaded = await pnoOperationalLoadAllRaw(row, "no_entry");
    const enriched = await pnoOperationalEnrichPendingFromTotal(row, loaded.rows);
    const truth = pnoOperationalBuildTruth(row, enriched.rows);
    truth.usedTotalFallback = enriched.usedTotalFallback;
    truth.totalPagesRead = enriched.totalPagesRead;
    truth.unresolvedMetadata = enriched.unresolvedMetadata || 0;
    if (pnoOperationalTruthCache.size >= 120) pnoOperationalTruthCache.clear();`,
    "pending-total intersection resolver",
  );

  return output;
}
