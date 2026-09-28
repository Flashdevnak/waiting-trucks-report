const MARKER = "PNO_ALL_PAGE_FILTER_TRUTH_V1";

function replaceOne(source, before, after, label) {
  const at = source.indexOf(before);
  if (at < 0 || source.indexOf(before, at + before.length) !== -1)
    throw new Error(`${MARKER}: ${label} anchor missing or repeated`);
  return source.slice(0, at) + after + source.slice(at + before.length);
}

function replaceFunction(source, name, implementation) {
  const prefix = `${implementation.constructor.name === "AsyncFunction" ? "async " : ""}function ${name}(`;
  const start = source.indexOf(prefix);
  const end = source.indexOf("\n}\n", start) + 2;
  if (start < 0 || end < 2 || source.indexOf(prefix, start + prefix.length) !== -1)
    throw new Error(`${MARKER}: ${name} boundary missing or repeated`);
  return source.slice(0, start) + implementation.toString() + source.slice(end);
}

function pnoV18LocatorKey(row) {
  return [
    state.branch || row?.hub, row?.proofId, row?.pnoSourceDay,
    row?.pnoLineId, row?.pnoVanLineId, row?.pnoStoreId, row?.pnoNextStoreId,
    row?.expectedParcels, row?.enteredParcels, row?.pendingParcels,
  ].map((value) => String(value ?? "").trim()).join("|");
}

function pnoV18ParcelFilterDataset() {
  return Array.isArray(pnoV18State.filterRows) ? pnoV18State.filterRows : (pnoV18State.rows || []);
}

function pnoV18VisibleParcelEntries() {
  const entries = pnoV18FilteredParcelEntries();
  if (!Array.isArray(pnoV18State.filterRows)) return entries;
  const pages = Math.max(1, Math.ceil(entries.length / 200));
  pnoV18State.filterPage = Math.max(1, Math.min(pages, Number(pnoV18State.filterPage) || 1));
  const start = (pnoV18State.filterPage - 1) * 200;
  return entries.slice(start, start + 200).map((entry, visibleIndex) => ({
    ...entry, filteredIndex: start + visibleIndex,
  }));
}

async function pnoV18EnsureParcelFilterRows() {
  if (pnoV18State.type === "bag") return [];
  const sourceRow = pnoV18SourceRow();
  if (!sourceRow) throw new Error("ไม่พบข้อมูลรถสำหรับกรองทุกหน้า");
  const key = pnoV18LocatorKey(sourceRow) + "|" + pnoV18State.type;
  if (pnoV18State.filterKey === key && Array.isArray(pnoV18State.filterRows) &&
      Date.now() - Number(pnoV18State.filterAt || 0) < PNO_V18_VIEW_CACHE_MS && !pnoV18State.filterForce)
    return pnoV18State.filterRows;
  if (pnoV18State.filterKey === key && pnoV18State.filterPromise)
    return pnoV18State.filterPromise;
  pnoV18State.filterKey = key;
  pnoV18State.filterRows = null;
  pnoV18State.filterError = "";
  const task = (async () => {
    const all = [];
    const seen = new Set();
    const sourceType = pnoV18State.type === "scan_gap" ? "total" : pnoV18State.type;
    const force = pnoV18State.filterForce === true;
    let total = null;
    let pages = 1;
    for (let page = 1; page <= pages; page += 1) {
      const resultNode = el("pno-v18-filter-result");
      if (resultNode) resultNode.textContent = "กำลังรวมข้อมูลทุกหน้าเพื่อกรอง… " + nf.format(page) + "/" + nf.format(pages);
      if (force) pnoV18State.force = true;
      const result = await pnoV18Fetch(sourceType, page);
      const rows = result?.parcels;
      const reported = Number(result?.total);
      if (!Array.isArray(rows) || !Number.isSafeInteger(reported) || reported < 0 ||
          (result.page != null && Number(result.page) !== page))
        throw new Error("ข้อมูลหน้าพัสดุไม่ครบหรือไม่ตรงกับหน้าที่ขอ");
      if (total === null) {
        total = reported;
        pages = Math.max(1, Math.ceil(total / 200));
      }
      if (reported !== total || rows.length !== Math.min(200, Math.max(0, total - (page - 1) * 200)))
        throw new Error("จำนวนพัสดุจากข้อมูลต้นทางเปลี่ยนหรือขาดหน้าระหว่างกรอง");
      for (const row of rows) {
        // Within one exact trip, PNO is parcel identity. Reject an overlapping page;
        // never silently count it twice or collapse a distinct business occurrence.
        const pno = String(row?.pno || "").trim().toUpperCase();
        if (!pno || seen.has(pno))
          throw new Error("ข้อมูลพัสดุข้ามหน้าซ้ำหรือไม่มี PNO จึงยืนยันผลกรองทั้งชุดไม่ได้");
        seen.add(pno);
        all.push(row);
      }
      if (pnoV18LocatorKey(pnoV18SourceRow()) + "|" + pnoV18State.type !== key)
        throw new Error("ข้อมูลเที่ยวรถเปลี่ยนระหว่างรวมผลกรอง");
    }
    if (all.length !== total || pnoV18State.filterKey !== key)
      throw new Error("ข้อมูลเที่ยวรถเปลี่ยนระหว่างรวมผลกรอง");
    pnoV18State.filterRows = all;
    pnoV18State.filterAt = Date.now();
    pnoV18State.filterForce = false;
    pnoV18State.filterPage = 1;
    return all;
  })();
  pnoV18State.filterPromise = task;
  try { return await task; }
  catch (error) {
    if (pnoV18State.filterKey === key) {
      pnoV18State.filterRows = null;
      pnoV18State.filterError = "รวมข้อมูลทุกหน้าไม่สำเร็จ · ยังไม่แสดงผลกรองทั้งชุด";
      const node = el("pno-v18-filter-result");
      if (node) node.textContent = pnoV18State.filterError;
    }
    throw error;
  } finally {
    if (pnoV18State.filterPromise === task) pnoV18State.filterPromise = null;
  }
}

function pnoV18RenderFilters() {
  const bar = el("pno-v18-filterbar");
  if (!bar) return;
  const type = pnoV18State.type;
  const complete = type === "bag" || (Array.isArray(pnoV18State.filterRows) &&
    pnoV18State.filterKey === pnoV18LocatorKey(pnoV18SourceRow()) + "|" + type &&
    Date.now() - Number(pnoV18State.filterAt || 0) < PNO_V18_VIEW_CACHE_MS);
  const rows = type === "bag" ? (pnoV18State.bagRows || []) : (complete ? pnoV18State.filterRows : []);
  const source = type === "bag" ? pnoV18BagGroups(rows).map(([, items]) => pnoV18BagSummary(items))
    : type === "scan_gap" ? rows.filter((row) =>
      ["SUSPECTED_SCAN_IN_GAP", "INSUFFICIENT_HISTORY"].includes(row?.scanEvidence?.classification)) : rows;
  const statuses = pnoV18UniqueValues(source.map((row) => type === "bag" ? row.status : pnoV18ParcelStatus(row)));
  const actions = pnoV18UniqueValues(source.map((row) => type === "bag" ? row.latest : pnoV18ParcelAction(row)));
  const branches = pnoV18UniqueValues(source.map((row) => type === "bag" ? row.branch : row.targetBranch));
  const filters = pnoV18State.filters;
  if (complete) {
    filters.status = pnoV18ValidateFilter(filters.status, statuses);
    filters.action = pnoV18ValidateFilter(filters.action, actions);
    filters.branch = pnoV18ValidateFilter(filters.branch, branches);
  }
  const fields = [["status", "สถานะ", statuses], ["action", "การดำเนินการล่าสุด", actions],
    ["branch", "ชื่อสาขาต่อไป", branches]];
  bar.innerHTML = fields.map(([key, label, values]) =>
    '<label class="pno-v18-filter-field"><span>' + esc(label) + '</span><select id="pno-v18-filter-' + key +
    '" data-pno-v18-filter="' + key + '">' + (complete
      ? '<option value="">ทั้งหมด</option>' + values.map((value) => pnoV18FilterOption(value, filters[key])).join("")
      : '<option value="">เลือกเพื่อรวมข้อมูลทุกหน้า</option>') + '</select></label>'
  ).join("") +
    '<button id="pno-v18-filter-reset" class="btn btn-secondary pno-v18-filter-reset" type="button">ล้างฟิลเตอร์</button>' +
    '<div id="pno-v18-filter-result" class="pno-v18-filter-result"></div>';
  bar.classList.remove("hidden");
  if (!complete && pnoV18State.filterError)
    el("pno-v18-filter-result").textContent = pnoV18State.filterError;
  bar.querySelectorAll("[data-pno-v18-filter]").forEach((select) => {
    const loadOnFirstInteraction = async (event) => {
      if (complete || type === "bag") return;
      if (event?.preventDefault) event.preventDefault();
      const resultNode = el("pno-v18-filter-result");
      if (resultNode) resultNode.textContent = "กำลังรวมข้อมูลทุกหน้าเพื่อกรอง…";
      try {
        await pnoV18EnsureParcelFilterRows();
        if (pnoV18State.type !== type) return;
        pnoV18RenderFilters();
        pnoV18RenderCurrentFilteredView();
        el("pno-v18-filter-" + select.dataset.pnoV18Filter)?.focus?.();
      } catch (error) { toast(error.message || "โหลดข้อมูลสำหรับฟิลเตอร์ไม่สำเร็จ", true); }
    };
    select.onpointerdown = loadOnFirstInteraction;
    select.onfocus = loadOnFirstInteraction;
    select.onchange = async () => {
      if (!complete && type !== "bag") return loadOnFirstInteraction();
      filters[select.dataset.pnoV18Filter] = select.value;
      pnoV18State.filterPage = 1;
      pnoV18RenderFilters();
      pnoV18RenderCurrentFilteredView();
    };
  });
  el("pno-v18-filter-reset").onclick = () => {
    filters.status = "";
    filters.action = "";
    filters.branch = "";
    pnoV18State.filterPage = 1;
    pnoV18RenderFilters();
    pnoV18RenderCurrentFilteredView();
  };
}

export function patchPnoAllPageFilterFrontend(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;
  if (!output.includes("PNO_CROSS_VIEW_FILTER_PARITY_V1")) throw new Error(`${MARKER}: parity prerequisite missing`);
  output = replaceOne(output, `  filterPage: 1,\n`,
    `  filterPage: 1,\n  filterAt: 0,\n  filterPromise: null,\n  filterError: "",\n  filterForce: false,\n`, "filter state");
  for (const fn of [pnoV18LocatorKey, pnoV18ParcelFilterDataset, pnoV18VisibleParcelEntries,
    pnoV18EnsureParcelFilterRows, pnoV18RenderFilters])
    output = replaceFunction(output, fn.name, fn);
  output = replaceOne(output,
    `  const scopeTotal = filteredMode ? pnoV18State.filterRows.length : rows.length;\n  pnoV18UpdateFilterResult(allEntries.length, scopeTotal, filteredMode ? "รายการจากข้อมูลทั้งชุด" : "รายการในหน้านี้");`,
    `  const scopeTotal = filteredMode ? pnoV18State.filterRows.length : pnoV18State.total;\n  pnoV18UpdateFilterResult(allEntries.length, scopeTotal, "รายการ");\n  el("pno-v18-filter-result").textContent = "ทั้งหมด " + nf.format(scopeTotal) +
    (filteredMode ? " · ผลกรอง " + nf.format(allEntries.length) : " · ตัวเลือกกรองยังไม่รวมทุกหน้า") +
    " · แสดงหน้านี้ " + nf.format(entries.length);`, "parcel counts");
  output = replaceOne(output,
    `  const filteredMode = pnoV18ParcelFilterActive() && Array.isArray(pnoV18State.filterRows);`,
    `  const filteredMode = Array.isArray(pnoV18State.filterRows);`, "global parcel display mode");
  output = replaceOne(output,
    `    const filtered = pnoV18ParcelFilterActive() && Array.isArray(pnoV18State.filterRows);`,
    `    const filtered = Array.isArray(pnoV18State.filterRows);`, "global scan evidence display mode");
  output = replaceOne(output,
    `  if (pnoV18State.type === "scan_gap" && pnoV18ParcelFilterActive() && Array.isArray(pnoV18State.filterRows)) {`,
    `  if (pnoV18State.type === "scan_gap" && Array.isArray(pnoV18State.filterRows)) {`, "scan evidence navigation");
  output = replaceOne(output,
    `  if (pnoV18State.type !== "bag" && pnoV18ParcelFilterActive() && Array.isArray(pnoV18State.filterRows)) {`,
    `  if (pnoV18State.type !== "bag" && Array.isArray(pnoV18State.filterRows)) {`, "global parcel navigation");
  output = replaceOne(output,
    `      pnoV18UpdateFilterResult(visible.length, entries.length, "รายการหลักฐาน");`,
    `      pnoV18UpdateFilterResult(visible.length, entries.length, "รายการหลักฐาน");\n      el("pno-v18-filter-result").textContent = "ทั้งหมด " + nf.format(pnoV18State.filterRows.length) +
        " · ผลกรอง " + nf.format(entries.length) + " · แสดงหน้านี้ " + nf.format(visible.length);`, "scan evidence counts");
  output = replaceOne(output,
    `  pnoV18State.force = args.force;\n  pnoV18State.type = args.type;`,
    `  pnoV18State.force = args.force;\n  pnoV18State.filterForce = args.force;\n  pnoV18State.filterRows = null;\n  pnoV18State.filterKey = "";\n  pnoV18State.filterAt = 0;\n  pnoV18State.filterError = "";\n  pnoV18State.type = args.type;`, "modal identity and explicit refresh");
  return `${output}\n// ${MARKER}: explicit global option discovery; no background polling.\n`;
}

export function patchPnoAllPageFilterWorker(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;
  if (!output.includes("PNO_FBI_SOURCE_CONTRACT_V23")) throw new Error(`${MARKER}: worker prerequisite missing`);
  output = replaceOne(output,
    `  const page = Math.max(1, Math.min(20, Number(input.page) || 1));`,
    `  const requestedPage = Number(input.page);\n  const page = Number.isSafeInteger(requestedPage) && requestedPage >= 1 ? requestedPage : 1;`,
    "detail page clamp");
  return `${output}\n// ${MARKER}: DEV PNO detail page follows provider total beyond page 20.\n`;
}
