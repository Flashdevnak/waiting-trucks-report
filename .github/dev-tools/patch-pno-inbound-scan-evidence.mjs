const MARKER = "PNO_INBOUND_SCAN_EVIDENCE_V1";

function replaceUnique(source, before, after, label) {
  const start = source.indexOf(before);
  if (start < 0 || start !== source.lastIndexOf(before))
    throw new Error(`${MARKER}: ${label} anchor missing or repeated`);
  return source.slice(0, start) + after + source.slice(start + before.length);
}

function replaceCount(source, before, after, expected, label) {
  const actual = source.split(before).length - 1;
  if (actual !== expected) throw new Error(`${MARKER}: ${label} expected ${expected} anchors, found ${actual}`);
  return source.split(before).join(after);
}

export function patchPnoInboundScanEvidenceWorker(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;
  if (!output.includes("PNO_DETAIL_LOCATOR_RECOVERY_V30"))
    throw new Error(`${MARKER}: requires exact PNO locator staging`);
  output = replaceUnique(output,
    "const SESSION_MS = 180 * 86400000;",
    `import { observePnoEvidencePage, PNO_SCAN_CLASSES } from "./pno-inbound-scan-evidence.js";
// ${MARKER}: accepted facts are stored in the per-HUB coordinator on explicit detail reads.
const SESSION_MS = 180 * 86400000;`, "module import");
  output = replaceUnique(output,
    `    String(locator.type || ""),
    locator.canReport === true ? "1" : "0",
    Number(locator.page) || 1,`,
    `    String(locator.type || ""),
    locator.canReport === true ? "1" : "0",
    String(locator.lineId || locator.vanLineId || ""),
    String(locator.storeId || ""),
    String(locator.nextStoreId || ""),
    Number(locator.page) || 1,`, "shared page key includes segment");
  output = replaceUnique(output,
    `    const rawRows = Array.isArray(detail?.items) ? detail.items : Array.isArray(detail?.rows) ? detail.rows : [];
    const rows = rawRows.slice(0, PNO_PAGE_SIZE).map((row) => ({`,
    `    const rawRows = Array.isArray(detail?.items) ? detail.items : Array.isArray(detail?.rows) ? detail.rows : [];
    const sourceRows = rawRows.slice(0, PNO_PAGE_SIZE);
    const evidence = detail?.sourceValid === true
      ? await observePnoEvidencePage(state.ctx?.storage, locator, sourceRows, new Date(now()).toISOString())
          .catch(() => sourceRows.map(() => ({ classification: PNO_SCAN_CLASSES.INSUFFICIENT, reason: "EVIDENCE_STORAGE_UNAVAILABLE" })))
      : sourceRows.map(() => ({ classification: PNO_SCAN_CLASSES.INSUFFICIENT, reason: "SOURCE_RESPONSE_INVALID" }));
    const rows = sourceRows.map((row, index) => ({`, "valid shared observation");
  output = replaceUnique(output,
    `      lastActionAt: text(row.LastActionTime || row.lastActionAt, 100),
      targetHub:`,
    `      lastActionAt: text(row.LastActionTime || row.lastActionAt, 100),
      lastActionCode: text(row.LastAction, 100),
      arrivalAnchorAt: text(row.real_arrive_time, 100),
      scanEvidence: evidence[index],
      targetHub:`, "read-only evidence projection");
  output = replaceUnique(output,
    `    const total = Number(detail?.total) || rows.length;
    const pages = Math.max(1, Math.ceil(total / PNO_PAGE_SIZE));`,
    `    // A later accepted positive fact must update an older cached view of
    // the same parcel occurrence, even when another tab loaded it first.
    for (const row of rows) {
      if (row.scanEvidence?.classification !== PNO_SCAN_CLASSES.CONFIRMED) continue;
      for (const entry of state.pnoPageCache.values()) {
        const value = entry?.value;
        if (value?.hub !== locator.hub || value?.day !== locator.day ||
            value?.proofId !== locator.proofId ||
            value?.lineId !== (locator.lineId || locator.vanLineId) ||
            value?.sourceStoreId !== locator.storeId ||
            value?.targetStoreId !== locator.nextStoreId) continue;
        for (const cachedRow of value.parcels || []) {
          if (cachedRow.pno === row.pno && cachedRow.arrivalAnchorAt === row.arrivalAnchorAt)
            cachedRow.scanEvidence = row.scanEvidence;
        }
      }
    }
    const total = Number(detail?.total) || rows.length;
    const pages = Math.max(1, Math.ceil(total / PNO_PAGE_SIZE));`,
    "sticky positive view across cached tabs");
  output = replaceUnique(output,
    `      proofId: locator.proofId,
      type: locator.type,`,
    `      proofId: locator.proofId,
      lineId: locator.lineId || locator.vanLineId,
      sourceStoreId: locator.storeId,
      targetStoreId: locator.nextStoreId,
      type: locator.type,`,
    "cache projection segment identity");
  output = replaceUnique(output,
    `      source: "FBI_DETAIL_DIRECT",
      sourceCountMismatch,`,
    `      source: "FBI_DETAIL_DIRECT",
      sourceValid: detail?.sourceValid === true,
      sourceCountMismatch,`, "expose detail validity without rewriting totals");
  output = replaceUnique(output,
    `    total: Number(json.data?.Total) || 0,
    canReport: pnoCanReport,`,
    `    total: Number(json.data?.Total) || 0,
    canReport: pnoCanReport,
    sourceValid: Array.isArray(json.data?.DataList) &&
      Number.isInteger(Number(json.data?.Total)) && Number(json.data?.Total) >= 0 &&
      json.data.DataList.length <= PNO_PAGE_SIZE &&
      json.data.DataList.length <= Number(json.data.Total),`,
    "malformed response guard");
  return output;
}

export function patchPnoInboundScanEvidenceFrontend(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;
  if (!output.includes("PNO_READONLY_DETAIL_ELIGIBILITY_V30"))
    throw new Error(`${MARKER}: requires V30 PNO frontend`);
  output = replaceUnique(output,
    `        '<button type="button" data-pno-v18-type="bag">แบ็กกิ้ง</button>' +`,
    `        '<button type="button" data-pno-v18-type="bag">แบ็กกิ้ง</button>' +
        '<button type="button" data-pno-v18-type="scan_gap">หลุดสแกนเข้า</button>' +`,
    "tab after bagging");
  output = replaceUnique(output,
    `      if (type === "bag") void pnoV18LoadBags();
      else void pnoV18Load(type, 1);`,
    `      if (type === "bag") void pnoV18LoadBags();
      else if (type === "scan_gap") void pnoInboundLoad(1);
      else void pnoV18Load(type, 1);`, "tab click");
  // Include the exact segment in the browser cache beneath the modal cache.
  output = replaceUnique(output,
    `    String(type || ""),
    row?.pnoCanReport === true ? "1" : "0",
  ].join("|");`,
    `    String(type || ""),
    row?.pnoCanReport === true ? "1" : "0",
    String(row?.pnoLineId || row?.pnoVanLineId || ""),
    String(row?.pnoStoreId || ""),
    String(row?.pnoNextStoreId || ""),
  ].join("|");`, "browser page cache segment");
  output = replaceUnique(output,
    `  for (const pool of pools) {
    const row = pool.find((item) =>
      (sourceId && String(item?.id || "").trim() === sourceId) ||
      String(item?.proofId || "").trim().toUpperCase() === proof
    );
    if (row) return row;
  }
  return pnoV18State.sourceRow || null;`,
    `  if (!sourceId) return pnoV18State.sourceRow || null;
  for (const pool of pools) {
    const row = pool.find((item) => String(item?.id || "").trim() === sourceId);
    if (!row) continue;
    const prior = pnoV18State.sourceRow;
    if (prior && ["pnoSourceDay", "pnoLineId", "pnoVanLineId", "pnoStoreId", "pnoNextStoreId"]
      .some((field) => String(row?.[field] || "") !== String(prior?.[field] || ""))) return null;
    return row;
  }
  return pnoV18State.sourceRow || null;`, "source row exact segment or fail closed");
  output = replaceUnique(output,
    `  const truth = pnoOperationalSummaryForRow(row);
  const expected = truth.expected;`,
    `  const truth = pnoOperationalRawSummary(row);
  const expected = truth.expected;`, "PreEntry card authority");
  output = replaceUnique(output,
    `  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

// PNO_ROUND2_UI_V2`,
    `  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

// PNO_ROUND2_UI_V2`, "unknown PreEntry count remains unknown");
  output = replaceUnique(output,
    `function pnoV18Number(value) {
  const number = Number(value);`,
    `function pnoV18Number(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);`, "unknown modal count remains unknown");
  output = replaceCount(output,
    `  const truth = typeof pnoOperationalSummaryForRow === "function"
    ? pnoOperationalSummaryForRow(row)
    : null;`,
    `  const truth = pnoOperationalRawSummary(row);`, 2, "PreEntry modal and LINE authority");
  output = replaceUnique(output,
    `    '<div id="pno-v18-filterbar" class="pno-v18-filterbar hidden"></div>' +`,
    `    '<div id="pno-pending-reconciliation" class="hidden" role="status" style="padding:10px 16px;background:#fff7dd;border-bottom:1px solid #d9c870;font-size:12px;line-height:1.5"></div>' +
    '<div id="pno-v18-filterbar" class="pno-v18-filterbar hidden"></div>' +`,
    "page scoped note");

  const helpers = `// ${MARKER}: shows only persisted/current evidence already acquired by
// an explicit shared route_followstart_list detail read. No curl_pno calls.
function pnoInboundToggleActions(hidden) {
  const actions = el("pending-parcels-dialog")?.querySelector(".pno-v18-actions");
  if (actions) actions.style.display = hidden ? "none" : "";
}

function pnoInboundRender(rows) {
  const list = el("pending-parcels-list");
  const cases = (rows || []).filter((row) => ["SUSPECTED_SCAN_IN_GAP", "INSUFFICIENT_HISTORY"]
    .includes(row?.scanEvidence?.classification));
  if (!cases.length) {
    list.innerHTML = '<div class="empty-state">หน้านี้ไม่มีรายการสงสัยหลุดสแกนเข้าหรือประวัติไม่เพียงพอ</div>';
    return;
  }
  const label = (value) => value === "SUSPECTED_SCAN_IN_GAP"
    ? "สงสัยหลุดสแกนเข้า" : "ประวัติไม่เพียงพอ";
  const cell = (value) => esc(String(value || "-").trim() || "-");
  const content = (row, mobile = false) => {
    const evidence = row.scanEvidence || {};
    const values = [row.pno, row.backingNo, row.lastAction, row.lastActionAt,
      label(evidence.classification), evidence.scanInEventAt || "-", evidence.reason];
    if (mobile) return '<article class="pno-v18-mobile-card pno-v18-parcel-card">' +
      '<strong class="pno-v18-pno">' + cell(values[0]) + '</strong>' +
      '<div class="pno-v18-mobile-meta">' + values.slice(1).map((value, index) =>
        '<div><small>' + ["เลขแบ็กกิ้ง", "การดำเนินการล่าสุด", "เวลาการดำเนินการล่าสุด",
        "สถานะหลักฐานสแกนเข้า", "เวลาหลักฐานสแกนเข้า", "เหตุผล"][index] +
        '</small><b>' + cell(value) + '</b></div>').join("") + '</div></article>';
    return '<tr>' + values.map((value) => '<td>' + cell(value) + '</td>').join("") + '</tr>';
  };
  list.innerHTML = '<div class="pno-v18-desktop"><table class="pno-v18-table"><thead><tr>' +
    ["PNO", "เลขแบ็กกิ้ง", "การดำเนินการล่าสุด", "เวลาการดำเนินการล่าสุด",
    "สถานะหลักฐานสแกนเข้า", "เวลาหลักฐานสแกนเข้า", "เหตุผล"]
      .map((value) => '<th>' + value + '</th>').join("") + '</tr></thead><tbody>' +
    cases.map((row) => content(row)).join("") + '</tbody></table></div>' +
    '<div class="pno-v18-mobile pno-v18-mobile-stack">' +
    cases.map((row) => content(row, true)).join("") + '</div>';
}

async function pnoInboundLoad(page) {
  if (pnoV18State.busy) return;
  pnoV18State.type = "scan_gap";
  pnoV18State.page = Math.max(1, Number(page) || 1);
  pnoV18SetActive("scan_gap");
  pnoInboundToggleActions(true);
  el("pno-v18-filterbar").classList.add("hidden");
  el("pno-v18-bag-summary").classList.add("hidden");
  pnoV18State.busy = true;
  el("pending-parcels-loading").textContent = "กำลังโหลดหลักฐาน…";
  el("pending-parcels-loading").classList.remove("hidden");
  el("pending-parcels-list").classList.add("hidden");
  el("pno-v18-pager").classList.add("hidden");
  try {
    const result = await pnoV18Fetch("total", pnoV18State.page);
    pnoV18State.rows = Array.isArray(result.parcels) ? result.parcels : [];
    pnoV18State.total = Number(result.total) || pnoV18State.rows.length;
    pnoInboundRender(pnoV18State.rows);
    const pages = Math.max(1, Math.ceil(pnoV18State.total / 200));
    el("pno-v18-page").textContent = "หน้า " + nf.format(pnoV18State.page) + " / " + nf.format(pages);
    el("pno-v18-prev").disabled = pnoV18State.page <= 1;
    el("pno-v18-next").disabled = pnoV18State.page >= pages;
    el("pending-parcels-loading").classList.add("hidden");
    el("pending-parcels-list").classList.remove("hidden");
    el("pno-v18-pager").classList.remove("hidden");
  } catch (error) {
    el("pending-parcels-loading").textContent = "โหลดหลักฐานไม่สำเร็จ กรุณาลองใหม่";
  } finally {
    pnoV18State.busy = false;
  }
}

`;
  output = replaceUnique(output, "function pnoV18SetActive(type) {",
    helpers + "function pnoV18SetActive(type) {", "read-only tab renderer");
  output = replaceUnique(output,
    `function pnoV18Navigate(delta) {
  if (pnoV18State.type !== "bag"`,
    `function pnoV18Navigate(delta) {
  if (pnoV18State.type === "scan_gap") {
    void pnoInboundLoad(Math.max(1, pnoV18State.page + delta));
    return;
  }
  if (pnoV18State.type !== "bag"`, "gap navigation");
  output = replaceUnique(output,
    `async function pnoV18Load(type, page) {
  if (pnoV18State.busy) return;`,
    `async function pnoV18Load(type, page) {
  if (pnoV18State.busy) return;
  pnoInboundToggleActions(false);`, "normal tab actions");
  output = replaceUnique(output,
    `async function pnoV18LoadBags() {
  if (pnoV18State.busy) return;`,
    `async function pnoV18LoadBags() {
  if (pnoV18State.busy) return;
  pnoInboundToggleActions(false);`, "bag tab actions");
  const pendingHelpers = `// PNO_PENDING_OCCURRENCE_RECONCILIATION_V1: no_entry is a provider
// accounting candidate set, not proof of the latest parcel scan state.
function pnoPendingEvidenceLabel(row) {
  const classification = row?.scanEvidence?.classification;
  if (classification === "CONFIRMED_SCAN_IN") return "ยืนยันสแกนเข้าคลังแล้วในเที่ยวนี้";
  if (classification === "SUSPECTED_SCAN_IN_GAP") return "สงสัยหลุดสแกนเข้า";
  if (classification === "NOT_YET_SCAN_IN_STAGE") return "พบหลักฐานขั้นก่อนสแกนเข้า";
  return "หลักฐานการสแกนเข้ายังไม่เพียงพอ";
}

function pnoPendingPageReconciliation(rows, providerTotal, sourceValid) {
  const items = Array.isArray(rows) ? rows : [];
  const total = Number(providerTotal);
  const confirmed = items.filter((row) => row?.scanEvidence?.classification === "CONFIRMED_SCAN_IN").length;
  return {
    providerCandidates: sourceValid === true && Number.isSafeInteger(total) && total >= items.length ? total : null,
    pageCandidates: items.length,
    confirmedOnPage: confirmed,
    unresolvedOnPage: items.length - confirmed,
  };
}

function pnoPendingRenderNote() {
  const node = el("pno-pending-reconciliation");
  if (!node) return;
  node.classList.toggle("hidden", pnoV18State.type !== "no_entry");
  if (pnoV18State.type !== "no_entry") return;
  const page = pnoPendingPageReconciliation(pnoV18State.rows, pnoV18State.total, pnoV18State.sourceValid);
  const aggregate = pnoCountForType(pnoV18SourceRow(), "no_entry");
  node.textContent = "ยอดคงเหลือ PreEntry " + (aggregate === null ? "ไม่ทราบ" : nf.format(aggregate)) +
    " · รายการที่ผู้ให้บริการจัดใน no_entry " +
    (page.providerCandidates === null ? "ไม่ทราบ" : nf.format(page.providerCandidates)) +
    " · เฉพาะหน้าที่ " + nf.format(pnoV18State.page) + ": " +
    nf.format(page.pageCandidates) + " รายการ, ยืนยันสแกนเข้าแล้ว " +
    nf.format(page.confirmedOnPage) + ", ยังต้องตรวจสอบ " +
    nf.format(page.unresolvedOnPage) +
    " · ผลตรวจสอบหน้านี้ไม่ใช่ยอดคงเหลือใหม่";
}

// A positive accepted on another explicitly opened detail tab refreshes local
// cached views of the same exact segment and arrival anchor.
function pnoPendingPropagatePositive(sourceRow, result) {
  const accepted = (result?.parcels || []).filter((row) =>
    row?.scanEvidence?.classification === "CONFIRMED_SCAN_IN" && row?.pno && row?.arrivalAnchorAt);
  if (!accepted.length) return;
  const positive = new Map(accepted.map((row) =>
    [JSON.stringify([row.pno, row.arrivalAnchorAt]), row.scanEvidence]));
  const propagate = (value) => {
    for (const row of value?.parcels || []) {
      const match = positive.get(JSON.stringify([row.pno, row.arrivalAnchorAt]));
      if (match) row.scanEvidence = match;
    }
  };
  const modalPrefix = pnoV18LocatorKey(sourceRow) + "|";
  for (const [key, entry] of pnoV18ViewCache)
    if (key.startsWith(modalPrefix)) propagate(entry.value);
  const browserKeys = new Set(["total", "already", "no_entry"]
    .map((type) => pnoBrowserBaseKey(sourceRow, type)));
  for (const entry of pnoBrowserCache.values())
    if (browserKeys.has(entry.baseKey)) propagate(entry.value);
}

`;
  output = replaceUnique(output, "function pnoV18ParcelStatus(item, type = pnoV18State.type) {",
    pendingHelpers + "function pnoV18ParcelStatus(item, type = pnoV18State.type) {",
    "pending evidence helpers");
  output = replaceUnique(output,
    `function pnoV18ParcelStatus(item, type = pnoV18State.type) {
  return pnoV18TextValue(item?.status || pnoV18TypeLabel(type));`,
    `function pnoV18ParcelStatus(item, type = pnoV18State.type) {
  if (type === "no_entry") return pnoPendingEvidenceLabel(item);
  return pnoV18TextValue(item?.status || pnoV18TypeLabel(type));`,
    "confirmed candidate status");
  output = replaceUnique(output,
    `  const result = await browserPnoPage(sourceRow, type, page, force);
  return pnoV18CacheSet(pnoV18ViewCache, cacheKey, result, 120);`,
    `  const result = await browserPnoPage(sourceRow, type, page, force);
  pnoPendingPropagatePositive(sourceRow, result);
  return pnoV18CacheSet(pnoV18ViewCache, cacheKey, result, 120);`,
    "sticky browser cache projection");
  output = replaceUnique(output,
    `  pnoV18State.rows = Array.isArray(result.parcels) ? result.parcels : [];
  pnoV18State.total = Number(result.total || pnoV18State.rows.length) || 0;`,
    `  pnoV18State.rows = Array.isArray(result.parcels) ? result.parcels : [];
  pnoV18State.sourceValid = result.sourceValid === true;
  pnoV18State.total = Number(result.total || pnoV18State.rows.length) || 0;`,
    "detail source health");
  output = replaceUnique(output,
    `  pnoV18RenderSummary();
  pnoV18RenderBagSummary([]);`,
    `  pnoV18RenderSummary();
  pnoPendingRenderNote();
  pnoV18RenderBagSummary([]);`, "pending page note");
  output = replaceUnique(output,
    `  pnoV18State.type = "scan_gap";
  pnoV18State.page =`,
    `  pnoV18State.type = "scan_gap";
  pnoPendingRenderNote();
  pnoV18State.page =`, "audit note isolation");
  output = replaceUnique(output,
    `  pnoV18State.type = "bag";
  pnoV18State.expandedBag =`,
    `  pnoV18State.type = "bag";
  pnoPendingRenderNote();
  pnoV18State.expandedBag =`, "bag note isolation");
  output = replaceUnique(output,
    `    lines.push(["#", "PNO", "ล่าสุด", "HUB ปลายทาง", "สาขาปลายทาง", "เวลา"].join("\\t"));`,
    `    lines.push(["#", "PNO", "สถานะหลักฐาน", "ล่าสุด", "HUB ปลายทาง", "สาขาปลายทาง", "เวลา"].join("\\t"));`,
    "copy evidence heading");
  output = replaceUnique(output,
    `        row.pno || "",
        row.lastAction || "",`,
    `        row.pno || "",
        pnoV18ParcelStatus(row),
        row.lastAction || "",`, "copy evidence status");
  output = replaceUnique(output,
    `    lines.push("หมวด: " + pnoV18TypeLabel(pnoV18State.type) + " | หน้า " + nf.format(pnoV18State.page));`,
    `    lines.push("หมวด: " + pnoV18TypeLabel(pnoV18State.type) + " | หน้า " + nf.format(pnoV18State.page));
    if (pnoV18State.type === "no_entry")
      lines.push("รายการผู้ให้บริการประเภท no_entry; สถานะสแกนเข้าตรวจสอบตามเที่ยวนี้");`,
    "LINE provider candidate scope");
  output = replaceUnique(output,
    `      ((pnoV18State.page - 1) * 200 + sourceIndex + 1) + ". " + pnoV18LineCell(row.pno) +
      " | " + pnoV18LineCell(row.lastAction) +`,
    `      ((pnoV18State.page - 1) * 200 + sourceIndex + 1) + ". " + pnoV18LineCell(row.pno) +
      " | " + pnoV18LineCell(pnoV18ParcelStatus(row)) +
      " | " + pnoV18LineCell(row.lastAction) +`, "LINE evidence status");
  output = replaceUnique(output,
    `    "สถานะ": row.status || pnoV18TypeLabel(type),`,
    `    "สถานะ": pnoV18ParcelStatus(row, type),`, "export evidence status");
  return output;
}
