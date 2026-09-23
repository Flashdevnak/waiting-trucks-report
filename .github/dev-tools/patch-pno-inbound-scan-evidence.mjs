const MARKER = "PNO_INBOUND_SCAN_EVIDENCE_V1";

function replaceUnique(source, before, after, label) {
  const start = source.indexOf(before);
  if (start < 0 || start !== source.lastIndexOf(before))
    throw new Error(`${MARKER}: ${label} anchor missing or repeated`);
  return source.slice(0, start) + after + source.slice(start + before.length);
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
  return output;
}
