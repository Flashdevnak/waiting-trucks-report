const MARKER = "PNO_EXPLICIT_EXACT_HISTORY_V1";

function replaceUnique(source, before, after, label) {
  const at = source.indexOf(before);
  if (at < 0 || source.indexOf(before, at + before.length) >= 0)
    throw new Error(`${MARKER}: ${label} anchor missing or repeated`);
  return source.slice(0, at) + after + source.slice(at + before.length);
}

export function patchPnoExactHistoryWorker(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;
  if (!output.includes("PNO_INBOUND_SCAN_EVIDENCE_V1"))
    throw new Error(`${MARKER}: scan evidence prerequisite missing`);
  output = replaceUnique(output,
    'import { observePnoEvidencePage, PNO_SCAN_CLASSES } from "./pno-inbound-scan-evidence.js";',
    `import { observePnoEvidencePage, ingestPnoExactHistory, PNO_SCAN_CLASSES } from "./pno-inbound-scan-evidence.js";
// ${MARKER}: exact history is read only on an explicit, occurrence-bound click.`, "import");
  output = replaceUnique(output,
    `    if (url.pathname === "/pno") {`,
    `    if (url.pathname === "/pno/history") {
      try {
        const locator = normalizePnoLocator({
          hub: branch, day: url.searchParams.get("day"), proofId: url.searchParams.get("proofId"),
          type: "total", page: url.searchParams.get("page"), count: url.searchParams.get("count"),
          canReport: url.searchParams.get("canReport"), lineId: url.searchParams.get("lineId"),
          vanLineId: url.searchParams.get("vanLineId"), storeId: url.searchParams.get("storeId"),
          nextStoreId: url.searchParams.get("nextStoreId"),
        }, branch);
        return Response.json(await readSharedPnoExactHistory(this, this.env, locator,
          url.searchParams.get("pno"), url.searchParams.get("arrivalAnchorAt")));
      } catch (error) {
        return Response.json({ ok: false, code: error?.code || "PNO_HISTORY_ERROR",
          message: "ตรวจประวัติพัสดุไม่สำเร็จ" }, { status: Number(error?.status) || 502 });
      }
    }
    if (url.pathname === "/pno") {`, "coordinator action");
  output = replaceUnique(output,
    `  if (action === "pendingParcels") {`,
    `  if (action === "pendingPnoHistory") {
    const hub = pickBranch(actor, url.searchParams.get("branch"));
    return ok(await pendingPnoHistory(env, actor, hub, url.searchParams));
  }
  if (action === "pendingParcels") {`, "authenticated action");
  output = replaceUnique(output,
    `function pnoOwnerState(owner) {`,
    `async function pendingPnoHistory(env, actor, hub, params) {
  if (!access(hub, actor)) fail("ไม่มีสิทธิ์ดูข้อมูล HUB นี้", "FORBIDDEN", 403);
  const locator = validatePnoLocator(normalizePnoLocator({
    day: params.get("day"), proofId: params.get("proofId"), type: "total",
    page: params.get("page"), count: params.get("count"), canReport: params.get("canReport"),
    lineId: params.get("lineId"), vanLineId: params.get("vanLineId"),
    storeId: params.get("storeId"), nextStoreId: params.get("nextStoreId"),
  }, hub));
  const pno = text(params.get("pno"), 100).trim().toUpperCase();
  const arrivalAnchorAt = text(params.get("arrivalAnchorAt"), 100);
  if (!pno || !pnoProviderTime(arrivalAnchorAt))
    fail("ข้อมูลอ้างอิงพัสดุไม่ครบ", "PNO_HISTORY_LOCATOR_INCOMPLETE", 409);
  if (!env.MS_REFRESH_COORDINATOR)
    fail("ตัวประสาน PNO ไม่พร้อม", "PNO_COORDINATOR_UNAVAILABLE", 503);
  const stub = env.MS_REFRESH_COORDINATOR.get(env.MS_REFRESH_COORDINATOR.idFromName(hub));
  const target = new URL("https://ms-refresh.internal/pno/history");
  for (const [key, value] of Object.entries({ branch: hub, day: locator.day,
    proofId: locator.proofId, page: locator.page, count: locator.count,
    canReport: locator.canReport, lineId: locator.lineId, vanLineId: locator.vanLineId,
    storeId: locator.storeId, nextStoreId: locator.nextStoreId, pno, arrivalAnchorAt }))
    if (value !== null && value !== undefined && value !== "")
      target.searchParams.set(key, String(value));
  const response = await stub.fetch(new Request(target));
  const payload = await response.json().catch(() => null);
  if (!response.ok) fail("ตรวจประวัติพัสดุไม่สำเร็จ",
    payload?.code || "PNO_HISTORY_ERROR", response.status || 502);
  return payload;
}

function pnoOwnerState(owner) {`, "public action bridge");
  output = replaceUnique(output,
    `    state.pnoPageCache.set(key, {
      value,
      count: locator.count,`,
    `    state.pnoPageCache.set(key, {
      value,
      // Minimum raw occurrence facts stay coordinator-side, never in the UI response.
      historyRows: detail?.sourceValid === true ? sourceRows.map((row) => ({
        pno: text(row.pno, 100), store_id: text(row.store_id, 160),
        real_arrive_time: text(row.real_arrive_time, 100),
        LastAction: text(row.LastAction, 100), LastActionTime: text(row.LastActionTime, 100),
      })) : [],
      count: locator.count,`, "bounded source rows");
  output = replaceUnique(output,
    `export function pnoDiagnostics(owner) {`,
    `export async function readSharedPnoExactHistory(owner, env, rawLocator, rawPno, rawAnchor, deps = {}) {
  const state = pnoOwnerState(owner || {});
  const locator = validatePnoLocator(normalizePnoLocator(rawLocator, rawLocator?.hub));
  if (locator.type !== "total") fail("ประเภท PNO ไม่ถูกต้อง", "PNO_HISTORY_TYPE_INVALID", 400);
  const pno = text(rawPno, 100).trim().toUpperCase();
  const anchor = pnoProviderTime(rawAnchor);
  if (!pno || !anchor) fail("ข้อมูลอ้างอิงพัสดุไม่ครบ", "PNO_HISTORY_LOCATOR_INCOMPLETE", 409);
  const now = typeof deps.now === "function" ? deps.now : () => Date.now();
  const cache = state.pnoPageCache.get(pnoCacheKey(locator));
  if (!cache || cache.until <= now() || cache.value?.sourceValid !== true)
    fail("ข้อมูลหน้าปัจจุบันหมดอายุ กรุณาเปิดรายการอีกครั้ง", "PNO_HISTORY_PAGE_UNAVAILABLE", 409);
  const raw = (cache.historyRows || []).filter((row) =>
    String(row.pno || "").trim().toUpperCase() === pno &&
    pnoProviderTime(row.real_arrive_time) === anchor);
  const visible = (cache.value.parcels || []).filter((row) =>
    String(row.pno || "").trim().toUpperCase() === pno &&
    pnoProviderTime(row.arrivalAnchorAt) === anchor);
  if (raw.length !== 1 || visible.length !== 1 ||
      raw[0].store_id !== locator.nextStoreId ||
      !raw[0].LastAction || !pnoProviderTime(raw[0].LastActionTime))
    fail("ไม่ยืนยันตัวตนเที่ยวพัสดุ", "PNO_HISTORY_OCCURRENCE_UNVERIFIED", 409);
  if (visible[0].scanEvidence?.classification === PNO_SCAN_CLASSES.CONFIRMED)
    return visible[0].scanEvidence;
  if (visible[0].scanEvidence?.classification !== PNO_SCAN_CLASSES.INSUFFICIENT)
    fail("รายการนี้ไม่ต้องตรวจประวัติ", "PNO_HISTORY_NOT_ELIGIBLE", 409);

  if (!state.pnoHistoryActive) state.pnoHistoryActive = new Map();
  const activeKey = pnoCacheKey(locator) + "|" + pno + "|" + anchor;
  if (state.pnoHistoryActive.has(activeKey)) return state.pnoHistoryActive.get(activeKey);
  const task = (async () => {
    const credentials = await (deps.readCredential || ((hub) => preEntryCredentials(env, hub)))(locator.hub);
    if (!credentials) fail("HUB ยังไม่ได้เชื่อมข้อมูลพัสดุ", "PREENTRY_NOT_CONFIGURED", 409);
    const response = await (deps.fetchHistory || readExactPnoHistory)(credentials, pno);
    const view = await ingestPnoExactHistory(state.ctx?.storage, locator, raw[0], response,
      new Date(now()).toISOString());
    if (view.classification === PNO_SCAN_CLASSES.CONFIRMED) {
      for (const entry of state.pnoPageCache.values()) {
        const value = entry?.value;
        if (value?.hub !== locator.hub || value?.day !== locator.day ||
            value?.proofId !== locator.proofId ||
            value?.lineId !== (locator.lineId || locator.vanLineId) ||
            value?.sourceStoreId !== locator.storeId ||
            value?.targetStoreId !== locator.nextStoreId) continue;
        for (const row of value.parcels || [])
          if (row.pno === pno && pnoProviderTime(row.arrivalAnchorAt) === anchor)
            row.scanEvidence = view;
      }
    }
    return view;
  })().finally(() => state.pnoHistoryActive.delete(activeKey));
  state.pnoHistoryActive.set(activeKey, task);
  return task;
}

async function readExactPnoHistory(credentials, pno) {
  const url = new URL("https://fbi.flashexpress.com/api/route/curl_pno");
  for (const key of ["lang", "auth", "fbid", "time", "_from", "nonce", "referer", "iv"])
    if (credentials[key]) url.searchParams.set(key, credentials[key]);
  // Saved provider WaybillDetail frontend: GET with { type, pno, f }.
  for (const [key, value] of Object.entries({ type: "waybillDetail", pno, f: "pnodetail" }))
    url.searchParams.set(key, value);
  const response = await fetch(url, { headers: {
    Accept: "application/json, text/plain, */*",
    Referer: "https://fbi.flashexpress.com/fbi-ui/",
    "User-Agent": "Mozilla/5.0", "BI-PLATFORM": "pc",
  }});
  if (!response.ok) fail("ตรวจประวัติพัสดุไม่สำเร็จ", "PNO_HISTORY_HTTP_ERROR", 502);
  const json = await response.json();
  if (Number(json?.code) !== 1 || !json?.data?.result?.parcel_info ||
      !Array.isArray(json.data.result.parcel_routes))
    fail("ประวัติพัสดุไม่สมบูรณ์", "PNO_HISTORY_SOURCE_INVALID", 502);
  return json;
}

export function pnoDiagnostics(owner) {`, "single exact reader");
  output = replaceUnique(output,
    'import { observePnoEvidencePage, ingestPnoExactHistory, PNO_SCAN_CLASSES } from "./pno-inbound-scan-evidence.js";',
    'import { observePnoEvidencePage, ingestPnoExactHistory, pnoProviderTime, PNO_SCAN_CLASSES } from "./pno-inbound-scan-evidence.js";', "time validator import");
  return output;
}

export function patchPnoExactHistoryFrontend(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;
  if (!output.includes("PNO_INBOUND_SCAN_EVIDENCE_V1"))
    throw new Error(`${MARKER}: scan-gap frontend prerequisite missing`);
  const start = output.indexOf("function pnoInboundRender(rows) {");
  const end = output.indexOf("async function pnoInboundLoad(page) {", start);
  if (start < 0 || end < 0) throw new Error(`${MARKER}: scan-gap renderer missing`);
  let renderer = output.slice(start, end);
  renderer = replaceUnique(renderer,
    '  const list = el("pending-parcels-list");',
    `  const list = el("pending-parcels-list");
  list.onclick = (event) => {
    const button = event.target.closest?.("button[data-pno-history]");
    if (button && list.contains(button))
      void pnoExactHistoryCheck(button.dataset.pno, button.dataset.anchor);
  };`, "explicit click listener");
  renderer = replaceUnique(renderer,
    `    list.innerHTML = '<div class="empty-state">หน้านี้ไม่มีรายการสงสัยหลุดสแกนเข้าหรือประวัติไม่เพียงพอ</div>';`,
    `    list.innerHTML = pnoExactHistoryNoticeHtml() +
      '<div class="empty-state">หน้านี้ไม่มีรายการสงสัยหลุดสแกนเข้าหรือประวัติไม่เพียงพอ</div>';`,
    "empty state notice");
  renderer = replaceUnique(renderer,
    `    const values = [row.pno, row.backingNo, row.lastAction, row.lastActionAt,
      label(evidence.classification), evidence.scanInEventAt || "-", evidence.reason];`,
    `    const values = [row.pno, row.backingNo, row.lastAction, row.lastActionAt,
      label(evidence.classification), evidence.scanInEventAt || "-", evidence.reason];
    const sourceRow = pnoV18SourceRow();
    const key = pnoExactHistoryKey(sourceRow, row.pno, row.arrivalAnchorAt);
    const pending = pnoExactHistoryActive.has(key);
    const checked = pnoExactHistoryChecked.has(key);
    const ready = evidence.classification === "INSUFFICIENT_HISTORY" &&
      pnoExactHistoryLocatorReady(sourceRow) && row.pno && row.arrivalAnchorAt &&
      pnoExactHistoryMatches(row.pno, row.arrivalAnchorAt).length === 1;
    const historyButton = evidence.classification === "INSUFFICIENT_HISTORY"
      ? '<button type="button" class="btn btn-secondary" data-pno-history="1" data-pno="' +
        esc(row.pno) + '" data-anchor="' + esc(row.arrivalAnchorAt || "") + '"' +
        (!ready || pending || checked ? ' disabled' : '') + '>' +
        (pending ? 'กำลังตรวจประวัติ…' : checked ? 'ตรวจประวัติแล้ว' : 'ตรวจประวัติ') + '</button>'
      : '';`, "insufficient-only button");
  renderer = replaceUnique(renderer,
    `        '</small><b>' + cell(value) + '</b></div>').join("") + '</div></article>';`,
    `        '</small><b>' + cell(value) + '</b></div>').join("") + '</div>' +
      historyButton + '</article>';`, "mobile action");
  renderer = replaceUnique(renderer,
    `    return '<tr>' + values.map((value) => '<td>' + cell(value) + '</td>').join("") + '</tr>';`,
    `    return '<tr>' + values.map((value) => '<td>' + cell(value) + '</td>').join("") +
      '<td>' + historyButton + '</td></tr>';`, "desktop action");
  renderer = replaceUnique(renderer,
    `    "สถานะหลักฐานสแกนเข้า", "เวลาหลักฐานสแกนเข้า", "เหตุผล"]
      .map((value) => '<th>'`,
    `    "สถานะหลักฐานสแกนเข้า", "เวลาหลักฐานสแกนเข้า", "เหตุผล", "ตรวจประวัติ"]
      .map((value) => '<th>'`,
    "desktop heading");
  renderer = replaceUnique(renderer,
    `  list.innerHTML = '<div class="pno-v18-desktop">`,
    `  list.innerHTML = pnoExactHistoryNoticeHtml() + '<div class="pno-v18-desktop">`,
    "result notice");

  const helpers = `// ${MARKER}: the handler below is reachable only from a row button click.
const pnoExactHistoryActive = new Set();
const pnoExactHistoryChecked = new Set();
let pnoExactHistoryNotice = null;
function pnoExactHistoryOccurrenceKey(row) {
  if (!row) return "";
  return JSON.stringify([state.branch, row.proofId, row.pnoSourceDay,
    row.pnoLineId || row.pnoVanLineId, row.pnoStoreId, row.pnoNextStoreId]);
}
function pnoExactHistoryNoticeHtml() {
  const key = pnoExactHistoryOccurrenceKey(pnoV18SourceRow());
  return key && key === pnoExactHistoryNotice?.occurrenceKey
    ? '<div role="status" class="pno-v18-note">' +
      esc(pnoExactHistoryNotice.message) + '</div>' : '';
}
function pnoExactHistorySetNotice(occurrenceKey, message) {
  pnoExactHistoryNotice = { occurrenceKey, message };
}
function pnoExactHistoryLocatorReady(row) {
  return Boolean(row && pnoReadOnlyDetailEligibility(row).available && state.branch &&
    row.proofId && row.pnoSourceDay && (row.pnoLineId || row.pnoVanLineId) &&
    row.pnoStoreId && row.pnoNextStoreId);
}
function pnoExactHistoryKey(sourceRow, pno, anchor) {
  return pnoV18LocatorKey(sourceRow) + "|" + String(pno || "").trim().toUpperCase() +
    "|" + String(anchor || "").trim();
}
function pnoExactHistoryMatches(pno, anchor) {
  return (pnoV18State.rows || []).filter((row) => row.pno === pno &&
    row.arrivalAnchorAt === anchor &&
    row.scanEvidence?.classification === "INSUFFICIENT_HISTORY");
}
async function pnoExactHistoryCheck(pno, anchor) {
  const sourceRow = pnoV18SourceRow();
  const occurrenceKey = pnoExactHistoryOccurrenceKey(sourceRow);
  const key = pnoExactHistoryKey(sourceRow, pno, anchor);
  const rows = pnoExactHistoryMatches(pno, anchor);
  if (!pnoExactHistoryLocatorReady(sourceRow) || !pno || !anchor ||
      rows.length !== 1 || pnoExactHistoryActive.has(key) || pnoExactHistoryChecked.has(key)) return;
  pnoExactHistoryActive.add(key);
  pnoExactHistoryNotice = null;
  pnoInboundRender(pnoV18State.rows);
  try {
    const view = await apiGetOnce("pendingPnoHistory", {
      branch: state.branch, proofId: sourceRow.proofId, day: sourceRow.pnoSourceDay,
      page: pnoV18State.page, count: pnoCountForType(sourceRow, "total"),
      canReport: sourceRow.pnoCanReport === true,
      lineId: sourceRow.pnoLineId, vanLineId: sourceRow.pnoVanLineId,
      storeId: sourceRow.pnoStoreId, nextStoreId: sourceRow.pnoNextStoreId,
      pno, arrivalAnchorAt: anchor,
    });
    pnoExactHistoryChecked.add(key);
    if (pnoExactHistoryChecked.size > 200) pnoExactHistoryChecked.clear();
    if (view?.classification === "CONFIRMED_SCAN_IN") {
      pnoPendingPropagatePositive(sourceRow, { parcels: [{ ...rows[0], scanEvidence: view }] });
      if (pnoV18LocatorKey(pnoV18State.sourceRow) === pnoV18LocatorKey(sourceRow))
        rows[0].scanEvidence = view;
      pnoExactHistorySetNotice(occurrenceKey, "ยืนยันสแกนเข้าคลังแล้ว");
    } else {
      pnoExactHistorySetNotice(occurrenceKey, "ตรวจประวัติแล้ว แต่หลักฐานที่มีไม่เพียงพอยืนยันสแกนเข้าในเที่ยวนี้");
    }
  } catch {
    pnoExactHistorySetNotice(occurrenceKey, "ตรวจประวัติไม่สำเร็จ กรุณาลองภายหลัง");
  } finally {
    pnoExactHistoryActive.delete(key);
    if (pnoV18State.type === "scan_gap") pnoInboundRender(pnoV18State.rows);
  }
}

`;
  output = output.slice(0, start) + helpers + renderer + output.slice(end);
  return output;
}
