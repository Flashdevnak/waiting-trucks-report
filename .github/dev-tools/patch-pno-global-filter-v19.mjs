const MARKER = "PNO_GLOBAL_FILTER_V19";

function replaceUnique(source, from, to, label) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`${MARKER}: ${label} anchor missing or non-unique`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

export function patchPnoGlobalFilterV19(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;
  if (!output.includes("PNO_APPROVED_MODAL_V18")) return output;

  output = replaceUnique(
    output,
    `// PNO_APPROVED_MODAL_V18: approved DEV-only warehouse parcel modal.`,
    `// PNO_APPROVED_MODAL_V18: approved DEV-only warehouse parcel modal.
// ${MARKER}: exact all-page filtering is triggered only by an explicit filter change.`,
    "marker",
  );

  output = replaceUnique(
    output,
    `  bagRows: null,
  busy: false,`,
    `  bagRows: null,
  filterRows: null,
  filterKey: "",
  filterPage: 1,
  busy: false,`,
    "filter state",
  );

  output = replaceUnique(
    output,
    `    row?.pnoStoreId, row?.pnoNextStoreId,
    row?.expectedParcels, row?.enteredParcels, row?.pendingParcels,`,
    `    row?.pnoStoreId, row?.pnoNextStoreId, row?.pnoCanReport,
    row?.expectedParcels, row?.enteredParcels, row?.pendingParcels,`,
    "V18 locator canReport",
  );

  output = replaceUnique(
    output,
    `  el("pno-v18-prev").onclick = () => void pnoV18Load(pnoV18State.type, Math.max(1, pnoV18State.page - 1));
  el("pno-v18-next").onclick = () => void pnoV18Load(pnoV18State.type, pnoV18State.page + 1);`,
    `  el("pno-v18-prev").onclick = () => void pnoV18Navigate(-1);
  el("pno-v18-next").onclick = () => void pnoV18Navigate(1);`,
    "pager handlers",
  );

  output = replaceUnique(
    output,
    `function pnoV18FilteredParcelEntries() {
  const status = pnoV18State.filters.status;
  const action = pnoV18State.filters.action;
  return (pnoV18State.rows || []).map((item, sourceIndex) => ({ item, sourceIndex })).filter(({ item }) =>
    (!status || pnoV18ParcelStatus(item) === status) &&
    (!action || pnoV18ParcelAction(item) === action)
  );
}

`,
    `function pnoV18ParcelFilterActive() {
  return Boolean(pnoV18State.filters.status || pnoV18State.filters.action);
}

function pnoV18ParcelFilterDataset() {
  if (pnoV18ParcelFilterActive() && Array.isArray(pnoV18State.filterRows))
    return pnoV18State.filterRows;
  return pnoV18State.rows || [];
}

function pnoV18FilteredParcelEntries() {
  const status = pnoV18State.filters.status;
  const action = pnoV18State.filters.action;
  return pnoV18ParcelFilterDataset().map((item, sourceIndex) => ({ item, sourceIndex })).filter(({ item }) =>
    (!status || pnoV18ParcelStatus(item) === status) &&
    (!action || pnoV18ParcelAction(item) === action)
  );
}

function pnoV18VisibleParcelEntries() {
  const entries = pnoV18FilteredParcelEntries();
  if (!(pnoV18ParcelFilterActive() && Array.isArray(pnoV18State.filterRows))) return entries;
  const pages = Math.max(1, Math.ceil(entries.length / 200));
  pnoV18State.filterPage = Math.max(1, Math.min(pages, Number(pnoV18State.filterPage) || 1));
  const start = (pnoV18State.filterPage - 1) * 200;
  return entries.slice(start, start + 200).map((entry, visibleIndex) => ({
    ...entry,
    filteredIndex: start + visibleIndex,
  }));
}

async function pnoV18EnsureParcelFilterRows() {
  if (pnoV18State.type === "bag") return [];
  const sourceRow = pnoV18SourceRow();
  if (!sourceRow) return pnoV18State.rows || [];
  const key = pnoV18LocatorKey(sourceRow) + "|" + pnoV18State.type;
  if (pnoV18State.filterKey === key && Array.isArray(pnoV18State.filterRows))
    return pnoV18State.filterRows;

  const total = Math.max(Number(pnoV18State.total) || 0, (pnoV18State.rows || []).length);
  const pages = Math.max(1, Math.ceil(total / 200));
  const all = [];
  const resultNode = el("pno-v18-filter-result");
  for (let page = 1; page <= pages; page += 1) {
    if (resultNode)
      resultNode.textContent = "กำลังรวมข้อมูลทุกหน้าเพื่อกรอง… " + nf.format(page) + "/" + nf.format(pages);
    const result = await pnoV18Fetch(pnoV18State.type, page);
    all.push(...(Array.isArray(result.parcels) ? result.parcels : []));
  }
  pnoV18State.filterRows = total > 0 ? all.slice(0, total) : all;
  pnoV18State.filterKey = key;
  pnoV18State.filterPage = 1;
  return pnoV18State.filterRows;
}

function pnoV18Navigate(delta) {
  if (pnoV18State.type !== "bag" && pnoV18ParcelFilterActive() && Array.isArray(pnoV18State.filterRows)) {
    const entries = pnoV18FilteredParcelEntries();
    const pages = Math.max(1, Math.ceil(entries.length / 200));
    pnoV18State.filterPage = Math.max(1, Math.min(pages, pnoV18State.filterPage + delta));
    pnoV18RenderRows(pnoV18State.type, pnoV18State.rows || []);
    return;
  }
  void pnoV18Load(pnoV18State.type, Math.max(1, pnoV18State.page + delta));
}

`,
    "global parcel filter helpers",
  );

  output = replaceUnique(
    output,
    `    const rows = pnoV18State.rows || [];
    const statuses = pnoV18UniqueValues(rows.map((item) => pnoV18ParcelStatus(item)));`,
    `    const rows = Array.isArray(pnoV18State.filterRows) ? pnoV18State.filterRows : (pnoV18State.rows || []);
    const statuses = pnoV18UniqueValues(rows.map((item) => pnoV18ParcelStatus(item)));`,
    "filter option dataset",
  );

  output = replaceUnique(
    output,
    `    note = "กรองเฉพาะข้อมูล " + nf.format(rows.length) + " รายการในหน้าปัจจุบัน";`,
    `    note = Array.isArray(pnoV18State.filterRows)
      ? "กรองจากข้อมูลทั้งชุด " + nf.format(rows.length) + " รายการ"
      : "เลือกฟิลเตอร์เพื่อรวมข้อมูลทุกหน้าอัตโนมัติ";`,
    "filter hint",
  );

  output = replaceUnique(
    output,
    `  bar.querySelectorAll("[data-pno-v18-filter]").forEach((select) => {
    select.onchange = () => {
      pnoV18State.filters[select.dataset.pnoV18Filter] = select.value;
      pnoV18RenderCurrentFilteredView();
    };
  });`,
    `  bar.querySelectorAll("[data-pno-v18-filter]").forEach((select) => {
    select.onchange = async () => {
      pnoV18State.filters[select.dataset.pnoV18Filter] = select.value;
      pnoV18State.filterPage = 1;
      if (pnoV18State.type !== "bag" && pnoV18ParcelFilterActive()) {
        try {
          await pnoV18EnsureParcelFilterRows();
        } catch (error) {
          return toast(error.message || "โหลดข้อมูลสำหรับฟิลเตอร์ไม่สำเร็จ", true);
        }
        pnoV18RenderFilters();
      }
      pnoV18RenderCurrentFilteredView();
    };
  });`,
    "filter change",
  );

  output = replaceUnique(
    output,
    `    } else {
      pnoV18State.filters.status = "";
      pnoV18State.filters.action = "";
    }
    pnoV18RenderFilters();`,
    `    } else {
      pnoV18State.filters.status = "";
      pnoV18State.filters.action = "";
      pnoV18State.filterPage = 1;
    }
    pnoV18RenderFilters();`,
    "filter reset",
  );

  const renderStart = output.indexOf("function pnoV18RenderRows(type, rows) {");
  const renderEnd = output.indexOf("\n\nfunction pnoV18ApplyPageResult", renderStart);
  if (renderStart < 0 || renderEnd < 0)
    throw new Error(`${MARKER}: render rows boundary missing`);
  const renderRows = `function pnoV18RenderRows(type, rows) {
  const list = el("pending-parcels-list");
  const allEntries = pnoV18FilteredParcelEntries();
  const filteredMode = pnoV18ParcelFilterActive() && Array.isArray(pnoV18State.filterRows);
  const entries = pnoV18VisibleParcelEntries();
  const scopeTotal = filteredMode ? pnoV18State.filterRows.length : rows.length;
  pnoV18UpdateFilterResult(allEntries.length, scopeTotal, filteredMode ? "รายการจากข้อมูลทั้งชุด" : "รายการในหน้านี้");

  if (filteredMode) {
    const pages = Math.max(1, Math.ceil(allEntries.length / 200));
    el("pno-v18-page").textContent = "ผลกรอง หน้า " + nf.format(pnoV18State.filterPage) + " / " + nf.format(pages);
    el("pno-v18-prev").disabled = pnoV18State.filterPage <= 1;
    el("pno-v18-next").disabled = pnoV18State.filterPage >= pages;
    el("pno-v18-pager").classList.remove("hidden");
  }

  if (!entries.length) {
    list.innerHTML = '<div class="empty-state">ไม่พบรายการตามฟิลเตอร์ที่เลือก</div>';
    return;
  }

  const rowNumber = (entry) => filteredMode
    ? Number(entry.filteredIndex ?? 0) + 1
    : (pnoV18State.page - 1) * 200 + Number(entry.sourceIndex || 0) + 1;

  const desktopRows = entries.map((entry) => {
    const item = entry.item;
    const status = pnoV18ParcelStatus(item, type);
    return '<tr><td>' + nf.format(rowNumber(entry)) +
      '</td><td class="pno-v18-pno">' + esc(item.pno || "-") +
      '</td><td><span class="pno-v18-badge ' + pnoV18StatusClass(type, status) + '">' + esc(status) +
      '</span></td><td><span class="pno-v18-badge ' + pnoV18ActionClass(item.lastAction) + '">' + esc(item.lastAction || "-") +
      '</span></td><td>' + esc(item.targetHub || "-") +
      '</td><td>' + esc(item.targetBranch || "-") +
      '</td><td>' + esc(item.lastActionAt || "-") + '</td></tr>';
  }).join("");

  const mobileRows = entries.map((entry) => {
    const item = entry.item;
    const status = pnoV18ParcelStatus(item, type);
    return '<article class="pno-v18-mobile-card pno-v18-parcel-card">' +
      '<div class="pno-v18-mobile-top"><span class="pno-v18-mobile-index">#' + nf.format(rowNumber(entry)) +
      '</span><strong class="pno-v18-pno">' + esc(item.pno || "-") + '</strong></div>' +
      '<div class="pno-v18-mobile-badges"><span class="pno-v18-badge ' + pnoV18StatusClass(type, status) + '">' + esc(status) +
      '</span><span class="pno-v18-badge ' + pnoV18ActionClass(item.lastAction) + '">' + esc(item.lastAction || "-") + '</span></div>' +
      '<div class="pno-v18-mobile-meta">' +
        '<div><small>HUB ปลายทาง</small><b>' + esc(item.targetHub || "-") + '</b></div>' +
        '<div><small>สาขาปลายทาง</small><b>' + esc(item.targetBranch || "-") + '</b></div>' +
        '<div><small>เวลา</small><b>' + esc(item.lastActionAt || "-") + '</b></div>' +
      '</div></article>';
  }).join("");

  list.innerHTML =
    '<div class="pno-v18-desktop"><table class="pno-v18-table"><thead><tr><th>#</th><th>PNO</th><th>สถานะ</th><th>ล่าสุด</th><th>HUB ปลายทาง</th><th>สาขาปลายทาง</th><th>เวลา</th></tr></thead><tbody>' +
    desktopRows + '</tbody></table></div>' +
    '<div class="pno-v18-mobile pno-v18-mobile-stack">' + mobileRows + '</div>';
}`;
  output = output.slice(0, renderStart) + renderRows + output.slice(renderEnd);

  output = replaceUnique(
    output,
    `async function pnoV18Load(type, page) {
  if (pnoV18State.busy) return;
  pnoV18State.type = type;`,
    `async function pnoV18Load(type, page) {
  if (pnoV18State.busy) return;
  if (pnoV18State.type !== type) {
    pnoV18State.filterRows = null;
    pnoV18State.filterKey = "";
    pnoV18State.filterPage = 1;
    pnoV18State.filters.status = "";
    pnoV18State.filters.action = "";
  }
  pnoV18State.type = type;`,
    "type switch filter reset",
  );

  output = replaceUnique(
    output,
    `  pnoV18State.rows = [];
  pnoV18State.bagRows = null;
  pnoV18State.expandedBag = "";`,
    `  pnoV18State.rows = [];
  pnoV18State.bagRows = null;
  pnoV18State.filterRows = null;
  pnoV18State.filterKey = "";
  pnoV18State.filterPage = 1;
  pnoV18State.expandedBag = "";`,
    "open filter reset",
  );

  output = replaceUnique(
    output,
    `    const entries = pnoV18FilteredParcelEntries();
    if (!entries.length) return toast("ยังไม่มีข้อมูลพัสดุตามฟิลเตอร์ให้คัดลอก", true);`,
    `    const entries = pnoV18VisibleParcelEntries();
    if (!entries.length) return toast("ยังไม่มีข้อมูลพัสดุตามฟิลเตอร์ให้คัดลอก", true);`,
    "copy visible filtered page",
  );

  output = replaceUnique(
    output,
    `    const entries = pnoV18FilteredParcelEntries();
    if (!entries.length) return toast("ยังไม่มีข้อมูลพัสดุตามฟิลเตอร์สำหรับส่ง LINE", true);`,
    `    const entries = pnoV18VisibleParcelEntries();
    if (!entries.length) return toast("ยังไม่มีข้อมูลพัสดุตามฟิลเตอร์สำหรับส่ง LINE", true);`,
    "LINE visible filtered page",
  );

  output = replaceUnique(
    output,
    `    lines.push("หมวด: " + pnoV18TypeLabel(pnoV18State.type) + " | หน้า " + nf.format(pnoV18State.page));`,
    `    const displayPage = pnoV18ParcelFilterActive() && Array.isArray(pnoV18State.filterRows)
      ? pnoV18State.filterPage
      : pnoV18State.page;
    lines.push("หมวด: " + pnoV18TypeLabel(pnoV18State.type) + " | หน้า " + nf.format(displayPage));`,
    "LINE filtered page label",
  );

  return output;
}
