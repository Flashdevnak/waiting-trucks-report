import { one, replaceFunction } from "./patch-pno-segment-destination-truth.mjs";
const MARKER = "PNO_SEGMENT_DESTINATION_FRONTEND_V1";

function pnoV18DisplayBranch(value) {
  return String(value || "").trim().replace(/^\(TH[^)]*\)\s*/i, "").trim() || "-";
}

function pnoV18ExactSegments(row) {
  const segments = row?.pnoSegments;
  if (!Number.isSafeInteger(row?.pnoSegmentCount) || row.pnoSegmentCount < 2 ||
      !Array.isArray(segments) || segments.length !== row.pnoSegmentCount ||
      !row?.pnoDetailAvailable || !row?.pnoEnabled || !row?.proofId) return null;
  const seen = new Set();
  let expected = 0, entered = 0, pending = 0;
  for (const segment of segments) {
    if (!segment || segment.proofId !== row.proofId ||
        !/^\d{4}-\d{2}-\d{2}$/.test(String(segment.pnoSourceDay || "")) ||
        !(segment.pnoLineId || segment.pnoVanLineId) || !segment.pnoStoreId || !segment.pnoNextStoreId ||
        ![segment.expectedParcels, segment.enteredParcels, segment.pendingParcels]
          .every((count) => Number.isSafeInteger(count) && count >= 0) ||
        segment.enteredParcels + segment.pendingParcels !== segment.expectedParcels) return null;
    const key = JSON.stringify([segment.pnoSourceDay, segment.proofId,
      segment.pnoLineId || segment.pnoVanLineId, segment.pnoStoreId, segment.pnoNextStoreId]);
    if (seen.has(key)) return null;
    seen.add(key);
    expected += segment.expectedParcels;
    entered += segment.enteredParcels;
    pending += segment.pendingParcels;
  }
  return expected === row.expectedParcels && entered === row.enteredParcels &&
    pending === row.pendingParcels ? segments : null;
}

function pnoReadOnlyDetailEligibility(row) {
  if (!pnoOperationalInboundEligible(row)) return { available: false, reason: "NOT_INBOUND" };
  const truth = pnoOperationalRawSummary(row);
  if (!truth.valid) return { available: false, reason: "COUNT_MISMATCH" };
  if (!Number.isSafeInteger(row?.pnoSegmentCount) || row.pnoSegmentCount < 1)
    return { available: false, reason: "SEGMENT_UNKNOWN" };
  if (row.pnoSegmentCount > 1) return pnoV18ExactSegments(row)
    ? { available: true, reason: "EXACT_SEGMENTS" }
    : { available: false, reason: "SEGMENTS_INCOMPLETE" };
  if (!String(row?.proofId || "").trim() || !String(row?.pnoSourceDay || "").trim() ||
      !String(row?.pnoLineId || row?.pnoVanLineId || "").trim() ||
      !String(row?.pnoStoreId || "").trim() || !String(row?.pnoNextStoreId || "").trim())
    return { available: false, reason: "LOCATOR_INCOMPLETE" };
  return row?.pnoDetailAvailable === true
    ? { available: true, reason: "OK" }
    : { available: false, reason: "DETAIL_DISABLED" };
}

function pnoReadOnlyUnavailableMessage(detail) {
  if (detail.reason === "SEGMENTS_INCOMPLETE")
    return "หลายจุดส่ง: ข้อมูลอ้างอิงเที่ยวไม่ครบ จึงยังเปิดรายละเอียดไม่ได้";
  if (["SEGMENT_UNKNOWN", "LOCATOR_INCOMPLETE", "DETAIL_DISABLED", "SEGMENTS_INCOMPLETE"].includes(detail.reason))
    return "รายละเอียดพัสดุยังไม่พร้อม: ข้อมูลอ้างอิงเที่ยวไม่ครบ";
  return "";
}

function pnoV18ParcelFilterActive() {
  const { status, action, hub, branch } = pnoV18State.filters;
  return Boolean(status || action || (pnoV18State.type !== "bag" && hub) || branch);
}

function pnoV18FilteredParcelEntries(rows = pnoV18ParcelFilterDataset()) {
  const { status, action, hub, branch } = pnoV18State.filters;
  return rows
    .map((item, sourceIndex) => ({ item, sourceIndex }))
    .filter(({ item }) => pnoV18State.type !== "scan_gap" ||
      ["SUSPECTED_SCAN_IN_GAP", "INSUFFICIENT_HISTORY"].includes(item?.scanEvidence?.classification))
    .filter(({ item }) =>
      (!status || pnoV18ParcelStatus(item) === status) &&
      (!action || pnoV18ParcelAction(item) === action) &&
      (!hub || String(item?.targetHub || "").trim() === hub) &&
      (!branch || String(item?.targetBranch || "").trim() === branch));
}

function pnoV18FilterSummaryText() {
  const { status, action, hub, branch } = pnoV18State.filters;
  return [status && "สถานะ=" + status, action && "ล่าสุด=" + action,
    pnoV18State.type !== "bag" && hub && "HUB ปลายทาง=" + hub,
    branch && (pnoV18State.type === "bag" ? "ชื่อสาขาต่อไป=" + branch : "สาขาปลายทาง=" + pnoV18DisplayBranch(branch))]
    .filter(Boolean).join(" · ");
}

function pnoV18RenderFilters() {
  const bar = el("pno-v18-filterbar");
  if (!bar) return;
  const type = pnoV18State.type;
  const complete = type === "bag" || (Array.isArray(pnoV18State.filterRows) &&
    pnoV18State.filterKey === pnoV18LocatorKey(pnoV18SourceRow()) + "|" + type &&
    !pnoV18State.filterForce);
  const rows = type === "bag" ? (pnoV18State.bagRows || []) : (complete ? pnoV18State.filterRows : []);
  const source = type === "bag" ? pnoV18BagGroups(rows).map(([, items]) => pnoV18BagSummary(items))
    : type === "scan_gap" ? rows.filter((row) =>
      ["SUSPECTED_SCAN_IN_GAP", "INSUFFICIENT_HISTORY"].includes(row?.scanEvidence?.classification)) : rows;
  const statuses = pnoV18UniqueValues(source.map((row) => type === "bag" ? row.status : pnoV18ParcelStatus(row)));
  const actions = pnoV18UniqueValues(source.map((row) => type === "bag" ? row.latest : pnoV18ParcelAction(row)));
  const hubs = type === "bag" ? [] : pnoV18UniqueValues(source.map((row) => row.targetHub));
  const filters = pnoV18State.filters;
  if (complete) {
    filters.status = pnoV18ValidateFilter(filters.status, statuses);
    filters.action = pnoV18ValidateFilter(filters.action, actions);
    if (type !== "bag") filters.hub = pnoV18ValidateFilter(filters.hub, hubs);
  }
  const branchRows = type === "bag" ? source : source.filter((row) =>
    !filters.hub || String(row.targetHub || "").trim() === filters.hub);
  // Values keep raw R-field identity; the optional (TH...) prefix is display-only.
  const branches = pnoV18UniqueValues(branchRows.map((row) => type === "bag" ? row.branch : row.targetBranch));
  if (complete) filters.branch = pnoV18ValidateFilter(filters.branch, branches);
  const fields = [["status", "สถานะ", statuses], ["action", "การดำเนินการล่าสุด", actions],
    ...(type === "bag" ? [] : [["hub", "HUB ปลายทาง", hubs]]),
    ["branch", type === "bag" ? "ชื่อสาขาต่อไป" : "สาขาปลายทาง", branches]];
  bar.innerHTML = fields.map(([key, label, values]) =>
    '<label class="pno-v18-filter-field"><span>' + esc(label) + '</span><select id="pno-v18-filter-' + key +
    '" data-pno-v18-filter="' + key + '"' + (complete ? '' : ' disabled') + '>' + (complete
      ? '<option value="">ทั้งหมด</option>' + values.map((value) => key === "branch" && type !== "bag"
        ? '<option value="' + esc(value) + '"' + (value === filters.branch ? ' selected' : '') + '>' +
          esc(pnoV18DisplayBranch(value)) + '</option>' : pnoV18FilterOption(value, filters[key])).join("")
      : '<option value="">' + (pnoV18State.filterError ? 'เตรียมตัวกรองไม่สำเร็จ' : 'กำลังเตรียมตัวกรอง…') + '</option>') + '</select></label>'
  ).join("") +
    '<button id="pno-v18-filter-reset" class="btn btn-secondary pno-v18-filter-reset" type="button">ล้างฟิลเตอร์</button>' +
    '<div id="pno-v18-filter-result" class="pno-v18-filter-result"></div>';
  bar.classList.remove("hidden");
  if (!complete)
    el("pno-v18-filter-result").textContent = pnoV18State.filterError || pnoV18State.filterProgress || "กำลังเตรียมตัวกรอง…";
  bar.querySelectorAll("[data-pno-v18-filter]").forEach((select) => {
    select.onchange = () => {
      if (!complete) return;
      const field = select.dataset.pnoV18Filter;
      filters[field] = select.value;
      pnoV18State.filterPage = 1;
      pnoV18RenderFilters();
      pnoV18RenderCurrentFilteredView();
    };
  });
  el("pno-v18-filter-reset").onclick = () => {
    filters.status = "";
    filters.action = "";
    filters.hub = "";
    filters.branch = "";
    pnoV18State.filterPage = 1;
    pnoV18RenderFilters();
    pnoV18RenderCurrentFilteredView();
  };
}

function pnoV18UnionFailure(reasonCode, details, message) {
  const error = new Error(message);
  error.pnoUnionDiagnostic = { reasonCode, ...details };
  return error;
}

function pnoV18RenderUnionDiagnostic(error) {
  if (pnoV18State.selection !== "union") return;
  const diagnostic = error?.pnoUnionDiagnostic;
  if (!["PNO_UNION_EMPTY_PNO", "PNO_UNION_DUPLICATE_PNO",
    "PNO_UNION_SEGMENT_COUNT_MISMATCH", "PNO_UNION_SOURCE_INVALID"].includes(diagnostic?.reasonCode)) return;
  const safe = { reasonCode: diagnostic.reasonCode };
  for (const field of ["segmentOrdinal", "page", "firstSegmentOrdinal", "firstPage",
    "expectedCount", "receivedCount"]) {
    if (Number.isSafeInteger(diagnostic[field]) && diagnostic[field] >= 0)
      safe[field] = diagnostic[field];
  }
  if (typeof diagnostic.sourceValid === "boolean") safe.sourceValid = diagnostic.sourceValid;
  const node = document.createElement("output");
  node.id = "pno-union-dev-diagnostic";
  node.dataset.reasonCode = safe.reasonCode;
  node.textContent = JSON.stringify(safe);
  el("pending-parcels-loading").append(node);
}

async function pnoV18UnionPage(sourceRow, type, page, force) {
  const segments = pnoV18ExactSegments(sourceRow);
  if (!segments) throw pnoV18UnionFailure("PNO_UNION_SOURCE_INVALID", {}, "ข้อมูลอ้างอิงแต่ละจุดส่งไม่ครบ");
  const signature = JSON.stringify(segments);
  if (signature !== pnoV18State.segmentSignature)
    throw pnoV18UnionFailure("PNO_UNION_SOURCE_INVALID", {}, "ข้อมูลจุดส่งเปลี่ยนระหว่างเปิดรายละเอียด");
  const key = pnoV18LocatorKey(sourceRow) + "|union|" + type;
  let full = force ? null : pnoV18CacheGet(pnoV18ViewCache, key);
  if (!full) {
    const all = [], seen = new Set(), firstSeen = new Map();
    let total = 0;
    // Explicit whole-truck selection only. Sequential exact segment pages; no aggregate locator.
    for (const segment of segments) {
      const segmentOrdinal = segments.indexOf(segment) + 1;
      const count = pnoCountForType(segment, type);
      if (!Number.isSafeInteger(count) || count < 0)
        throw pnoV18UnionFailure("PNO_UNION_SEGMENT_COUNT_MISMATCH", { segmentOrdinal }, "จำนวนพัสดุจุดส่งไม่ครบ");
      const pages = Math.max(1, Math.ceil(count / 200));
      for (let index = 1; index <= pages; index++) {
        const result = await browserPnoPage({ ...sourceRow, ...segment, id: "" }, type, index, force);
        if (result?.sourceValid !== true)
          throw pnoV18UnionFailure("PNO_UNION_SOURCE_INVALID",
            { segmentOrdinal, page: index, sourceValid: false }, "ข้อมูลพัสดุจุดส่งหรือหน้าข้อมูลไม่ครบ");
        if (result?.sourceCountMismatch === true || result?.page !== index || result?.total !== count ||
            !Array.isArray(result.parcels) ||
            result.parcels.length !== Math.min(200, Math.max(0, count - (index - 1) * 200)))
          throw pnoV18UnionFailure("PNO_UNION_SEGMENT_COUNT_MISMATCH",
            { segmentOrdinal, page: index, expectedCount: count, receivedCount: result?.total },
            "ข้อมูลพัสดุจุดส่งหรือหน้าข้อมูลไม่ครบ");
        for (const item of result.parcels) {
          const pno = String(item?.pno || "").trim().toUpperCase();
          if (!pno) throw pnoV18UnionFailure("PNO_UNION_EMPTY_PNO",
            { segmentOrdinal, page: index }, "พบ PNO ซ้ำหรือไม่ครบข้ามจุดส่ง");
          if (seen.has(pno)) throw pnoV18UnionFailure("PNO_UNION_DUPLICATE_PNO",
            { segmentOrdinal, page: index, firstSegmentOrdinal: firstSeen.get(pno).segmentOrdinal,
              firstPage: firstSeen.get(pno).page }, "พบ PNO ซ้ำหรือไม่ครบข้ามจุดส่ง");
          seen.add(pno);
          firstSeen.set(pno, { segmentOrdinal, page: index });
          all.push({ ...item, pnoSegmentIndex: segments.indexOf(segment),
            pnoSegmentLabel: segment.pnoNextStoreName || segment.pnoNextStoreId });
        }
        pnoPendingPropagatePositive({ ...sourceRow, ...segment, id: "" }, result);
      }
      total += count;
    }
    if (all.length !== total || (type === "total" && total !== sourceRow.expectedParcels) ||
        (type === "already" && total !== sourceRow.enteredParcels) ||
        (type === "no_entry" && total !== sourceRow.pendingParcels))
      throw pnoV18UnionFailure("PNO_UNION_SEGMENT_COUNT_MISMATCH",
        { expectedCount: total, receivedCount: all.length }, "ข้อมูลรวมหลายจุดส่งไม่ตรงกับยอด PreEntry");
    full = pnoV18CacheSet(pnoV18ViewCache, key, { parcels: all, total }, 120);
  }
  const pages = Math.max(1, Math.ceil(full.total / 200));
  if (page > pages) throw pnoV18UnionFailure("PNO_UNION_SEGMENT_COUNT_MISMATCH",
    { page, expectedCount: pages }, "หน้าข้อมูลเกินจำนวนที่ยืนยันได้");
  return { parcels: full.parcels.slice((page - 1) * 200, page * 200), total: full.total,
    page, proofId: sourceRow.proofId, routeName: sourceRow.routeName, sourceValid: true };
}

async function pnoV18Fetch(type, page) {
  const sourceRow = pnoV18SourceRow();
  if (!sourceRow) throw new Error("ไม่พบข้อมูลรถสำหรับ PNO");
  pnoV18State.sourceRow = sourceRow;
  pnoV18State.proofId = String(sourceRow.proofId || pnoV18State.proofId || "").trim();
  const selection = pnoV18State.selection ?? null;
  const segments = selection === null ? null : pnoV18ExactSegments(sourceRow);
  if (selection !== null && (!segments || JSON.stringify(segments) !== pnoV18State.segmentSignature))
    throw new Error("ข้อมูลจุดส่งเปลี่ยนระหว่างเปิดรายละเอียด");
  const selected = Number.isSafeInteger(selection) ? segments?.[selection] : null;
  if (selection !== null && selection !== "union" && !selected)
    throw new Error("ไม่พบจุดส่งที่เลือก");
  const locator = selected ? { ...sourceRow, ...selected, id: "" } : sourceRow;
  pnoV18State.day = String(locator.pnoSourceDay || pnoV18State.day || "").trim();
  const force = pnoV18State.force === true;
  pnoV18State.force = false;
  const cacheKey = pnoV18PageCacheKey(sourceRow, type, page);
  if (!force) {
    const cached = pnoV18CacheGet(pnoV18ViewCache, cacheKey);
    if (cached) return cached;
  }
  const result = selection === "union"
    ? await pnoV18UnionPage(sourceRow, type, page, force)
    : await browserPnoPage(locator, type, page, force);
  if (selected || selection === null) pnoPendingPropagatePositive(locator, result);
  return pnoV18CacheSet(pnoV18ViewCache, cacheKey, result, 120);
}

async function pnoV18OpenMulti(row, type, page) {
  const segments = pnoV18ExactSegments(row);
  if (!segments) return toast("ข้อมูลอ้างอิงจุดส่งยังไม่ครบ", true);
  pnoV18EnsureUi();
  const dialog = el("pending-parcels-dialog");
  el("pending-parcels-trip").textContent = [row.proofId, row.routeName].filter(Boolean).join(" · ");
  for (const id of ["pno-v18-summary", "pno-v18-filterbar", "pno-v18-bag-summary", "pending-parcels-list", "pno-v18-pager"])
    el(id)?.classList.add("hidden");
  const toolbar = dialog.querySelector(".pno-v18-toolbar");
  toolbar.classList.add("hidden");
  const loading = el("pending-parcels-loading");
  loading.classList.remove("hidden");
  loading.innerHTML = '<div class="pno-v18-segment-chooser"><strong>เลือกข้อมูลหลายจุดส่ง</strong><p>รายละเอียดจะโหลดเมื่อเลือกเท่านั้น</p>' +
    '<button class="btn btn-primary" type="button" data-pno-union="1">พัสดุรวมทั้งคัน (' + nf.format(row.expectedParcels) + ')</button>' +
    segments.map((segment, index) => '<button class="btn btn-secondary" type="button" data-pno-segment="' + index + '">' +
      esc(segment.pnoNextStoreName || segment.routeName || "จุดส่ง " + (index + 1)) +
      ' · ' + nf.format(segment.expectedParcels) + ' รายการ</button>').join("") + '</div>';
  loading.querySelectorAll("[data-pno-union],[data-pno-segment]").forEach((button) => {
    button.onclick = () => void openPendingParcels(row, type, page,
      { selection: button.dataset.pnoUnion ? "union" : Number(button.dataset.pnoSegment) });
  });
  if (!dialog.open) dialog.showModal();
}

async function pnoV18OpenPendingParcels(row, type = "no_entry", page = 1, { force = false, selection = null } = {}) {
  const args = pnoV18ResolveOpenArgs(row, type, page, { force });
  const eligible = args.row && pnoOperationalInboundEligible(args.row) &&
    pnoReadOnlyDetailEligibility(args.row).available;
  if (!eligible) return toast(args.row?.pnoState === "COUNT_MISMATCH"
    ? "ข้อมูลจำนวนไม่สมบูรณ์ จึงยังเปิด PNO ไม่ได้" : "ยังไม่มีข้อมูลเข้าคลังสำหรับเปิด PNO", true);
  const segments = args.row.pnoSegmentCount > 1 ? pnoV18ExactSegments(args.row) : null;
  if (args.row.pnoSegmentCount > 1 && !segments) return toast("ข้อมูลอ้างอิงจุดส่งยังไม่ครบ", true);
  if (segments && selection === null) return pnoV18OpenMulti(args.row, args.type, args.page);
  if (segments && selection !== "union" && (!Number.isSafeInteger(selection) || !segments[selection]))
    return toast("ไม่พบจุดส่งที่เลือก", true);
  const locator = segments ? (selection === "union" ? null : segments[selection]) : args.row;
  if (!args.proofId || (locator && (!locator.pnoSourceDay || !(locator.pnoLineId || locator.pnoVanLineId) ||
      !locator.pnoStoreId || !locator.pnoNextStoreId)))
    return toast("ข้อมูลอ้างอิง PNO ยังไม่ครบ กรุณารอข้อมูลสดรอบใหม่", true);
  pnoV18EnsureUi();
  el("pending-parcels-dialog").querySelector(".pno-v18-toolbar").classList.remove("hidden");
  el("pno-v18-summary").classList.remove("hidden");
  pnoV18State.sourceRow = args.row;
  pnoV18State.selection = segments ? selection : null;
  pnoV18State.segmentSignature = segments ? JSON.stringify(segments) : "";
  pnoV18State.proofId = args.proofId;
  pnoV18State.day = locator?.pnoSourceDay || "";
  pnoV18State.routeName = String(args.row.routeName || "").trim();
  pnoV18State.force = args.force;
  pnoV18State.filterForce = args.force;
  pnoV18State.filterRows = null;
  pnoV18State.filterKey = "";
  pnoV18State.filterAt = 0;
  pnoV18State.filterError = "";
  pnoV18State.filterProgress = "";
  pnoV18State.type = args.type;
  pnoV18State.page = args.page;
  pnoV18State.total = 0;
  pnoV18State.rows = [];
  pnoV18State.bagRows = null;
  pnoV18State.filterPage = 1;
  pnoV18State.expandedBag = "";
  pnoV18State.filters.status = "";
  pnoV18State.filters.action = "";
  pnoV18State.filters.hub = "";
  pnoV18State.filters.branch = "";
  el("pno-v18-filterbar")?.classList.add("hidden");
  el("pno-v18-bag-summary")?.classList.add("hidden");
  el("pending-parcels-trip").textContent = [pnoV18State.proofId, pnoV18State.routeName,
    segments ? selection === "union" ? "ยอดรวมทั้งคัน" : segments[selection].pnoNextStoreName : ""]
    .filter(Boolean).join(" · ");
  pnoReadOnlyExplicitNoPrefetch = true;
  try { await pnoOperationalResolve(args.row); }
  finally { pnoReadOnlyExplicitNoPrefetch = false; }
  pnoV18RenderSummary();
  const dialog = el("pending-parcels-dialog");
  if (!dialog.open) dialog.showModal();
  await pnoV18Load(args.type, args.page);
}

export function patchPnoSegmentDestinationFrontend(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;
  if (!output.includes("PNO_SCAN_EVIDENCE_TRUTH_UX_V2")) throw new Error(`${MARKER}: staged prerequisites missing`);
  output = one(output, "function pnoV18ResolveOpenArgs(",
    `// ${MARKER}: read-only segment choices and raw destination identity.\n${pnoV18DisplayBranch.toString()}\n${pnoV18ExactSegments.toString()}\n${pnoV18UnionFailure.toString()}\n${pnoV18RenderUnionDiagnostic.toString()}\n${pnoV18UnionPage.toString()}\n${pnoV18OpenMulti.toString()}\nfunction pnoV18ResolveOpenArgs(`,
    "frontend helpers");
  for (const fn of [pnoReadOnlyDetailEligibility, pnoReadOnlyUnavailableMessage,
    pnoV18ParcelFilterActive, pnoV18FilteredParcelEntries, pnoV18FilterSummaryText,
    pnoV18RenderFilters, pnoV18Fetch]) output = replaceFunction(output, fn.name, fn);
  const loadAt = output.indexOf("async function pnoV18Load(type, page) {");
  const loadEnd = output.indexOf("\n}\n", loadAt) + 2;
  if (loadAt < 0 || loadEnd < 2) throw new Error(`${MARKER}: modal loader missing`);
  const loader = one(output.slice(loadAt, loadEnd),
    `    el("pending-parcels-loading").innerHTML = '<strong>' + esc(error.message) + '</strong><span>ตรวจสอบเซสชันพัสดุเข้าคลังแล้วลองใหม่</span>';`,
    `    el("pending-parcels-loading").innerHTML = '<strong>' + esc(error.message) + '</strong><span>ตรวจสอบเซสชันพัสดุเข้าคลังแล้วลองใหม่</span>';\n    pnoV18RenderUnionDiagnostic(error);`,
    "DEV-only closed union diagnostic surface");
  output = output.slice(0, loadAt) + loader + output.slice(loadEnd);
  output = one(output, '    branch: "",\n  },\n};\n\nconst PNO_V18_VIEW_CACHE_MS',
    '    branch: "",\n    hub: "",\n  },\n  selection: null,\n  segmentSignature: "",\n};\n\nconst PNO_V18_VIEW_CACHE_MS', "modal state");
  // Every tab resets the cascade with the other filters.
  output = output.replaceAll('pnoV18State.filters.branch = "";', 'pnoV18State.filters.branch = "";\n    pnoV18State.filters.hub = "";');
  output = one(output,
    '  if (!row?.id || !pnoOperationalInboundEligible(row)) return;\n  const raw = pnoOperationalRawSummary(row);',
    '  if (!row?.id || !pnoOperationalInboundEligible(row) || row.pnoSegmentCount > 1) return;\n  const raw = pnoOperationalRawSummary(row);',
    "multi-drop background detail guard");
  const badgeAt = output.indexOf('function expectedParcelsBadge(row) {');
  const badgeEnd = output.indexOf('\n}\n', badgeAt) + 2;
  if (badgeAt < 0 || badgeEnd < 2) throw new Error(`${MARKER}: badge missing`);
  let badge = output.slice(badgeAt, badgeEnd);
  badge = badge.replace('  const enabled = detail.available && rowId;',
    '  const multi = detail.available && rowId && row.pnoSegmentCount > 1;\n  const enabled = detail.available && rowId && !multi;');
  badge = badge.replace('  return `<div class="expected-parcels-badge pno-summary ${pnoProgressClass(percent)}"',
    [
      '  const multiHtml = multi ? \'<div class="pno-multidrop-actions"><strong>ยอดรวมทั้งคัน</strong>\' +',
      '    \'<button type="button" data-pno-row="\' + rowId + \'" data-pno-mode="union">ดูพัสดุทั้งหมด</button>\' +',
      '    \'<button type="button" data-pno-row="\' + rowId + \'" data-pno-mode="choose">เลือกดูตามจุดส่ง</button></div>\' : "";',
      '  return `<div class="expected-parcels-badge pno-summary ${pnoProgressClass(percent)}"',
    ].join('\n'));
  badge = badge.replace('${unavailableHtml}</div>`;', '${unavailableHtml}${multiHtml}</div>`;');
  output = output.slice(0, badgeAt) + badge + output.slice(badgeEnd);
  output = one(output,
    '    type: String(direct.dataset.pnoType || "total"),',
    '    type: String(direct.dataset.pnoType || "total"),\n    mode: String(direct.dataset.pnoMode || ""),',
    "multi-drop card mode");
  output = one(output,
    'void Promise.resolve(openPendingParcels(row, target.type, 1))',
    'void Promise.resolve(openPendingParcels(row, target.type, 1, { selection: target.mode === "union" ? "union" : null }))',
    "explicit union/chooser selection");
  output = one(output,
    '    row?.expectedParcels, row?.enteredParcels, row?.pendingParcels,\n  ].map',
    '    row?.expectedParcels, row?.enteredParcels, row?.pendingParcels,\n    pnoV18State.selection === null ? "single" : String(pnoV18State.selection),\n    pnoV18State.segmentSignature,\n  ].map', "selection-aware cache key");
  const start = output.indexOf('openPendingParcels = async function pnoV18OpenPendingParcels(');
  const end = output.indexOf('\n}\n\n// LIVE_EVIDENCE_FRONTEND_V29', start) + 2;
  if (start < 0 || end < 2) throw new Error(`${MARKER}: modal open function missing`);
  output = output.slice(0, start) + 'openPendingParcels = ' + pnoV18OpenPendingParcels.toString() + output.slice(end);
  const rowStart = output.indexOf('function pnoV18RenderRows(');
  const rowEnd = output.indexOf('\n}\n', rowStart) + 2;
  if (rowStart < 0 || rowEnd < 2) throw new Error(`${MARKER}: parcel renderer missing`);
  let rows = output.slice(rowStart, rowEnd).replaceAll("ชื่อสาขาต่อไป", "สาขาปลายทาง")
    .replaceAll("ฮับปลายทาง", "HUB ปลายทาง")
    .replaceAll('esc(item.targetBranch || "-")', 'esc(pnoV18DisplayBranch(item.targetBranch))');
  rows = rows.replaceAll('esc(item.pno || "-")',
    'esc(item.pno || "-") + (pnoV18State.selection === "union" ? "<small>จุดส่ง: " + esc(item.pnoSegmentLabel || "-") + "</small>" : "")');
  output = output.slice(0, rowStart) + rows + output.slice(rowEnd);
  output = one(output,
    'el("pending-parcels-trip").textContent = [result.proofId || pnoV18State.proofId, pnoV18State.routeName].filter(Boolean).join(" · ");',
    'el("pending-parcels-trip").textContent = [result.proofId || pnoV18State.proofId, pnoV18State.routeName, pnoV18State.selection === "union" ? "ยอดรวมทั้งคัน" : Number.isSafeInteger(pnoV18State.selection) ? pnoV18State.sourceRow?.pnoSegments?.[pnoV18State.selection]?.pnoNextStoreName : ""].filter(Boolean).join(" · ");',
    "multi-drop scope summary");
  // Copy and Export follow visible display. Raw branch remains the option value and match key.
  for (const name of ["pnoV18Copy", "pnoV18CopyLine", "pnoV18Export"]) {
    const prefix = `async function ${name}(`;
    const at = output.indexOf(prefix), end = output.indexOf('\n}\n', at) + 2;
    if (at < 0 || end < 2) throw new Error(`${MARKER}: ${name} missing`);
    let block = output.slice(at, end).replaceAll('row.targetBranch || ""', 'pnoV18DisplayBranch(row.targetBranch)');
    if (name === "pnoV18Copy") block = block.replace(
      '["#", "PNO", "สถานะหลักฐาน", "ล่าสุด", "ฮับปลายทาง", "ชื่อสาขาต่อไป", "เวลา"]',
      '["#", "PNO", "สถานะหลักฐาน", "ล่าสุด", "HUB ปลายทาง", "สาขาปลายทาง", "เวลา"]');
    if (name === "pnoV18CopyLine") block = block.replace('pnoV18LineCell(row.targetBranch)',
      'pnoV18LineCell(pnoV18DisplayBranch(row.targetBranch))');
    if (name === "pnoV18Export") block = block.replace('"ชื่อสาขาต่อไป": pnoV18DisplayBranch(row.targetBranch)',
      '"สาขาปลายทาง": pnoV18DisplayBranch(row.targetBranch)');
    if (name === "pnoV18Export") block = block.replace('"ฮับปลายทาง": row.targetHub',
      '"HUB ปลายทาง": row.targetHub');
    output = output.slice(0, at) + block + output.slice(end);
  }
  output = one(output,
    'branch: pnoV18BagValue(items, (item) => item.targetBranch, "หลายสาขา"),',
    'branch: pnoV18BagValue(items, (item) => item.nextStoreName, "หลายสาขา"),',
    "bag next-store route meaning");
  output = one(output,
    '    const action = String(item?.lastAction || "").trim();',
    '    const action = pnoV18ParcelAction(item);',
    "bag latest action display");
  const bagAt = output.indexOf('function pnoV18RenderBags(');
  const bagEnd = output.indexOf('\n}\n', bagAt) + 2;
  if (bagAt < 0 || bagEnd < 2) throw new Error(`${MARKER}: bag renderer missing`);
  output = output.slice(0, bagAt) + output.slice(bagAt, bagEnd)
    .replaceAll('esc(item.lastAction || "-")', 'esc(pnoV18ParcelAction(item))') + output.slice(bagEnd);
  const copyAt = output.indexOf('async function pnoV18Copy()');
  const copyEnd = output.indexOf('\n}\n', copyAt) + 2;
  if (copyAt < 0 || copyEnd < 2) throw new Error(`${MARKER}: copy missing`);
  output = output.slice(0, copyAt) + output.slice(copyAt, copyEnd)
    .replaceAll('item.lastAction || ""', 'pnoV18ParcelAction(item)')
    .replaceAll('row.lastAction || ""', 'pnoV18ParcelAction(row)')
    .replace('lines.push(["#", "PNO", "สถานะหลักฐาน", "ล่าสุด", "HUB ปลายทาง", "สาขาปลายทาง", "เวลา"].join("\\t"));',
      'lines.push(["#", "PNO", "สถานะหลักฐาน", "ล่าสุด", "HUB ปลายทาง", "สาขาปลายทาง", "เวลา", ...(pnoV18State.selection === "union" ? ["จุดส่ง"] : [])].join("\\t"));')
    .replace('        row.lastActionAt || "",\n      ].map(pnoV18TsvCell)',
      '        row.lastActionAt || "",\n        ...(pnoV18State.selection === "union" ? [row.pnoSegmentLabel || ""] : []),\n      ].map(pnoV18TsvCell)') + output.slice(copyEnd);
  const lineAt = output.indexOf('async function pnoV18CopyLine()');
  const lineEnd = output.indexOf('\n}\n', lineAt) + 2;
  if (lineAt < 0 || lineEnd < 2) throw new Error(`${MARKER}: LINE copy missing`);
  output = output.slice(0, lineAt) + output.slice(lineAt, lineEnd)
    .replaceAll('pnoV18LineCell(item.lastAction)', 'pnoV18LineCell(pnoV18ParcelAction(item))')
    .replaceAll('pnoV18LineCell(row.lastAction)', 'pnoV18LineCell(pnoV18ParcelAction(row))')
    .replace('" | " + pnoV18LineCell(row.lastActionAt)\n    );',
      '" | " + pnoV18LineCell(row.lastActionAt) +\n      (pnoV18State.selection === "union" ? " | จุดส่ง: " + pnoV18LineCell(row.pnoSegmentLabel) : "")\n    );') + output.slice(lineEnd);
  const exportAt = output.indexOf('async function pnoV18Export()');
  const exportEnd = output.indexOf('\n}\n', exportAt) + 2;
  if (exportAt < 0 || exportEnd < 2) throw new Error(`${MARKER}: export missing`);
  output = output.slice(0, exportAt) + output.slice(exportAt, exportEnd)
    .replaceAll('"สาขาปลายทาง": pnoV18DisplayBranch(row.targetBranch),',
      '"สาขาปลายทาง": pnoV18DisplayBranch(row.targetBranch),\n      ...(pnoV18State.selection === "union" ? { "จุดส่ง": row.pnoSegmentLabel || "" } : {}),') + output.slice(exportEnd);
  output = output.replace('    DRIVER_SIGN: "คนขับลงชื่อรับ",', '    DRIVER_SIGN: "คนขับรถเช็คอิน TBR",');
  output = one(output,
    '  if (name && name !== "-") return name;',
    '  if (name === "คนขับรถเช็คอินTBR") return "คนขับรถเช็คอิน TBR";\n  if (name && name !== "-") return name;',
    "provider display spacing");
  const summaryAt = output.indexOf('function pnoV18RenderSummary() {');
  const summaryEnd = output.indexOf('\n}\n', summaryAt) + 2;
  if (summaryAt < 0 || summaryEnd < 2) throw new Error(`${MARKER}: summary missing`);
  const summary = output.slice(summaryAt, summaryEnd).replace(
    '  const row = pnoV18SourceRow();',
    '  const source = pnoV18SourceRow();\n  const row = Number.isSafeInteger(pnoV18State.selection) ? source?.pnoSegments?.[pnoV18State.selection] : source;');
  output = output.slice(0, summaryAt) + summary + output.slice(summaryEnd);
  return `${output}\n// ${MARKER}: no new timer or provider path.\n`;
}
