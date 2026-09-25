const MARKER = "PNO_CROSS_VIEW_FILTER_PARITY_V1";

function replaceOne(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0)
    throw new Error(`${MARKER}: ${label} anchor missing or repeated`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceFunction(source, name, replacement) {
  const prefix = `${replacement.constructor.name === "AsyncFunction" ? "async " : ""}function ${name}(`;
  const start = source.indexOf(prefix);
  const end = source.indexOf("\n}\n", start) + 2;
  if (start < 0 || end < 2 || source.indexOf(prefix, start + prefix.length) >= 0)
    throw new Error(`${MARKER}: ${name} boundary missing or repeated`);
  return source.slice(0, start) + replacement.toString() + source.slice(end);
}

function pnoV18ParcelStatus(item, type = pnoV18State.type) {
  if (type === "no_entry") return pnoPendingEvidenceLabel(item);
  if (type === "scan_gap") return item?.scanEvidence?.classification === "SUSPECTED_SCAN_IN_GAP"
    ? "สงสัยหลุดสแกนเข้า" : "ประวัติไม่เพียงพอ";
  return pnoV18TextValue(item?.status || pnoV18TypeLabel(type));
}

function pnoV18ParcelFilterActive() {
  const { status, action, branch } = pnoV18State.filters;
  return Boolean(status || action || branch);
}

function pnoV18ParcelFilterDataset() {
  if (pnoV18ParcelFilterActive() && Array.isArray(pnoV18State.filterRows))
    return pnoV18State.filterRows;
  return pnoV18State.rows || [];
}

function pnoV18FilteredParcelEntries(rows = pnoV18ParcelFilterDataset()) {
  const { status, action, branch } = pnoV18State.filters;
  return rows
    .map((item, sourceIndex) => ({ item, sourceIndex }))
    .filter(({ item }) => pnoV18State.type !== "scan_gap" ||
      ["SUSPECTED_SCAN_IN_GAP", "INSUFFICIENT_HISTORY"].includes(item?.scanEvidence?.classification))
    .filter(({ item }) =>
      (!status || pnoV18ParcelStatus(item) === status) &&
      (!action || pnoV18ParcelAction(item) === action) &&
      (!branch || pnoV18TextValue(item?.targetBranch) === branch));
}

function pnoV18VisibleParcelEntries() {
  const entries = pnoV18FilteredParcelEntries();
  if (!(pnoV18ParcelFilterActive() && Array.isArray(pnoV18State.filterRows))) return entries;
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
  if (!sourceRow) return pnoV18State.rows || [];
  const key = pnoV18LocatorKey(sourceRow) + "|" + pnoV18State.type;
  if (pnoV18State.filterKey === key && Array.isArray(pnoV18State.filterRows))
    return pnoV18State.filterRows;
  const total = Math.max(Number(pnoV18State.total) || 0, (pnoV18State.rows || []).length);
  const pages = Math.max(1, Math.ceil(total / 200));
  const all = [];
  const resultNode = el("pno-v18-filter-result");
  // Only a filter change or Export calls this reader. Opening a tab does not.
  const sourceType = pnoV18State.type === "scan_gap" ? "total" : pnoV18State.type;
  for (let page = 1; page <= pages; page += 1) {
    if (resultNode) resultNode.textContent = "กำลังรวมข้อมูลทุกหน้าเพื่อกรอง… " + nf.format(page) + "/" + nf.format(pages);
    const result = await pnoV18Fetch(sourceType, page);
    all.push(...(Array.isArray(result.parcels) ? result.parcels : []));
  }
  pnoV18State.filterRows = total > 0 ? all.slice(0, total) : all;
  pnoV18State.filterKey = key;
  pnoV18State.filterPage = 1;
  return pnoV18State.filterRows;
}

function pnoV18Navigate(delta) {
  if (pnoV18State.type === "scan_gap" && pnoV18ParcelFilterActive() && Array.isArray(pnoV18State.filterRows)) {
    const pages = Math.max(1, Math.ceil(pnoV18FilteredParcelEntries().length / 200));
    pnoV18State.filterPage = Math.max(1, Math.min(pages, pnoV18State.filterPage + delta));
    pnoV18RenderCurrentFilteredView();
    return;
  }
  if (pnoV18State.type === "scan_gap") {
    void pnoInboundLoad(Math.max(1, pnoV18State.page + delta));
    return;
  }
  if (pnoV18State.type !== "bag" && pnoV18ParcelFilterActive() && Array.isArray(pnoV18State.filterRows)) {
    const pages = Math.max(1, Math.ceil(pnoV18FilteredParcelEntries().length / 200));
    pnoV18State.filterPage = Math.max(1, Math.min(pages, pnoV18State.filterPage + delta));
    pnoV18RenderRows(pnoV18State.type, pnoV18State.rows || []);
    return;
  }
  void pnoV18Load(pnoV18State.type, Math.max(1, pnoV18State.page + delta));
}

function pnoV18FilteredBagGroups(rows = pnoV18State.bagRows || []) {
  const { status, action, branch } = pnoV18State.filters;
  return pnoV18BagGroups(rows).filter(([, items]) => {
    const summary = pnoV18BagSummary(items);
    return (!status || summary.status === status) &&
      (!action || summary.latest === action) &&
      (!branch || summary.branch === branch);
  });
}

function pnoV18HasActiveFilters() {
  return pnoV18ParcelFilterActive();
}

function pnoV18FilterSummaryText() {
  const { status, action, branch } = pnoV18State.filters;
  return [status && "สถานะ=" + status, action && "ล่าสุด=" + action,
    branch && "ชื่อสาขาต่อไป=" + branch].filter(Boolean).join(" · ");
}

function pnoV18RenderCurrentFilteredView() {
  if (pnoV18State.type === "bag") {
    pnoV18RenderBagSummary(pnoV18State.bagRows || []);
    pnoV18RenderBags(pnoV18State.bagRows || []);
  } else if (pnoV18State.type === "scan_gap") {
    const entries = pnoV18FilteredParcelEntries();
    const filtered = pnoV18ParcelFilterActive() && Array.isArray(pnoV18State.filterRows);
    const visible = pnoV18VisibleParcelEntries();
    pnoInboundRender(visible.map(({ item }) => item));
    if (filtered) {
      pnoV18UpdateFilterResult(visible.length, entries.length, "รายการหลักฐาน");
      const pages = Math.max(1, Math.ceil(entries.length / 200));
      el("pno-v18-page").textContent = "ผลกรอง หน้า " + nf.format(pnoV18State.filterPage) + " / " + nf.format(pages);
      el("pno-v18-prev").disabled = pnoV18State.filterPage <= 1;
      el("pno-v18-next").disabled = pnoV18State.filterPage >= pages;
    } else {
      el("pno-v18-filter-result").textContent = "หลักฐานในหน้านี้ " + nf.format(entries.length) + " รายการ";
      const sourcePages = Math.max(1, Math.ceil(pnoV18State.total / 200));
      el("pno-v18-page").textContent = "หน้าข้อมูลต้นทาง " + nf.format(pnoV18State.page) + " / " + nf.format(sourcePages);
      el("pno-v18-prev").disabled = pnoV18State.page <= 1;
      el("pno-v18-next").disabled = pnoV18State.page >= sourcePages;
    }
    el("pno-v18-pager").classList.remove("hidden");
  } else {
    pnoV18RenderBagSummary([]);
    pnoV18RenderRows(pnoV18State.type, pnoV18State.rows || []);
  }
}

function pnoV18RenderFilters() {
  const bar = el("pno-v18-filterbar");
  if (!bar) return;
  const type = pnoV18State.type;
  const rows = type === "bag" ? (pnoV18State.bagRows || [])
    : (Array.isArray(pnoV18State.filterRows) ? pnoV18State.filterRows : (pnoV18State.rows || []));
  const source = type === "bag" ? pnoV18BagGroups(rows).map(([, items]) => pnoV18BagSummary(items))
    : type === "scan_gap" ? rows.filter((row) =>
      ["SUSPECTED_SCAN_IN_GAP", "INSUFFICIENT_HISTORY"].includes(row?.scanEvidence?.classification)) : rows;
  const statuses = pnoV18UniqueValues(source.map((row) => type === "bag" ? row.status : pnoV18ParcelStatus(row)));
  const actions = pnoV18UniqueValues(source.map((row) => type === "bag" ? row.latest : pnoV18ParcelAction(row)));
  const branches = pnoV18UniqueValues(source.map((row) => type === "bag" ? row.branch : row.targetBranch));
  const filters = pnoV18State.filters;
  filters.status = pnoV18ValidateFilter(filters.status, statuses);
  filters.action = pnoV18ValidateFilter(filters.action, actions);
  filters.branch = pnoV18ValidateFilter(filters.branch, branches);
  const fields = [
    ["status", "สถานะ", statuses],
    ["action", "การดำเนินการล่าสุด", actions],
    ["branch", "ชื่อสาขาต่อไป", branches],
  ];
  bar.innerHTML = fields.map(([key, label, values]) =>
    '<label class="pno-v18-filter-field"><span>' + esc(label) + '</span><select id="pno-v18-filter-' + key +
    '" data-pno-v18-filter="' + key + '"><option value="">ทั้งหมด</option>' +
    values.map((value) => pnoV18FilterOption(value, filters[key])).join("") + '</select></label>'
  ).join("") +
    '<button id="pno-v18-filter-reset" class="btn btn-secondary pno-v18-filter-reset" type="button">ล้างฟิลเตอร์</button>' +
    '<div id="pno-v18-filter-result" class="pno-v18-filter-result"></div>';
  bar.classList.remove("hidden");
  bar.querySelectorAll("[data-pno-v18-filter]").forEach((select) => {
    select.onchange = async () => {
      filters[select.dataset.pnoV18Filter] = select.value;
      pnoV18State.filterPage = 1;
      if (type !== "bag" && pnoV18ParcelFilterActive()) {
        try { await pnoV18EnsureParcelFilterRows(); }
        catch (error) { return toast(error.message || "โหลดข้อมูลสำหรับฟิลเตอร์ไม่สำเร็จ", true); }
      }
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

async function pnoInboundLoad(page) {
  if (pnoV18State.busy) return;
  if (pnoV18State.type !== "scan_gap") {
    pnoV18State.filterRows = null;
    pnoV18State.filterKey = "";
    pnoV18State.filterPage = 1;
    pnoV18State.filters.status = "";
    pnoV18State.filters.action = "";
    pnoV18State.filters.branch = "";
  }
  pnoV18State.type = "scan_gap";
  pnoV18State.page = Math.max(1, Number(page) || 1);
  pnoPendingRenderNote();
  pnoV18SetActive("scan_gap");
  pnoInboundToggleActions(false);
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
    pnoV18RenderFilters();
    pnoV18RenderCurrentFilteredView();
    el("pending-parcels-loading").classList.add("hidden");
    el("pending-parcels-list").classList.remove("hidden");
  } catch (error) {
    el("pending-parcels-loading").textContent = "โหลดหลักฐานไม่สำเร็จ กรุณาลองใหม่";
  } finally {
    pnoV18State.busy = false;
  }
}

async function pnoV18Export() {
  const type = pnoV18State.type;
  let values, sheet, exportRows;
  if (type === "bag") {
    values = pnoV18FilteredBagGroups().map(([bag, items], index) => {
      const summary = pnoV18BagSummary(items);
      return { "ลำดับ": index + 1, "เลขถุงแบ็กกิ้ง": bag,
        "สถานะ": summary.status, "การดำเนินการล่าสุด": summary.latest,
        "จำนวนพัสดุ": items.length, "HUB ถัดไป": summary.hub,
        "ชื่อสาขาต่อไป": summary.branch };
    });
    sheet = "รายการถุงแบ็กกิ้ง";
  } else {
    await pnoV18EnsureParcelFilterRows();
    exportRows = pnoV18FilteredParcelEntries(pnoV18State.filterRows).map(({ item }) => item);
    values = exportRows.map((row, index) => type === "scan_gap" ? ({
      "ลำดับ": index + 1, "PNO": row.pno || "",
      "เลขถุงแบ็กกิ้ง": row.backingNo || "",
      "การดำเนินการล่าสุด": pnoV18ParcelAction(row),
      "เวลาการดำเนินการล่าสุด": row.lastActionAt || "",
      "สถานะหลักฐานสแกนเข้า": pnoV18ParcelStatus(row, type),
      "เวลาหลักฐานสแกนเข้า": row.scanEvidence?.scanInEventAt || "",
      "เหตุผล": row.scanEvidence?.reason || "",
    }) : ({
      "ลำดับ": index + 1, "PNO": row.pno || "",
      "เลขถุงแบ็กกิ้ง": row.backingNo || "",
      "สถานะ": pnoV18ParcelStatus(row, type),
      "การดำเนินการล่าสุด": pnoV18ParcelAction(row),
      "เวลา": row.lastActionAt || "",
      "จุดที่ระบุในข้อมูลพัสดุ": row.targetHub || "",
      "ชื่อสาขาต่อไป": row.targetBranch || "",
    }));
    sheet = type === "scan_gap" ? "หลักฐานสแกนเข้า" : "รายการพัสดุ";
  }
  if (!values.length) return toast("ยังไม่มีข้อมูลสำหรับ Export", true);
  const ws = XLSX.utils.json_to_sheet(values);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  XLSX.writeFile(wb, "รายการพัสดุเข้าคลัง_" + new Date().toISOString().slice(0,10) + ".xlsx");
}

export function patchPnoCrossViewFilterParity(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;
  output = replaceOne(output,
    `    status: "",\n    action: "",\n    bagStatus: "",\n    bagAction: "",\n    bagHub: "",\n    bagBranch: "",`,
    `    status: "",\n    action: "",\n    branch: "",`, "shared state");
  for (const implementation of [pnoV18ParcelStatus, pnoV18ParcelFilterActive,
    pnoV18ParcelFilterDataset,
    pnoV18FilteredParcelEntries, pnoV18VisibleParcelEntries,
    pnoV18EnsureParcelFilterRows, pnoV18Navigate,
    pnoV18FilteredBagGroups, pnoV18HasActiveFilters,
    pnoV18FilterSummaryText, pnoV18RenderCurrentFilteredView,
    pnoV18RenderFilters, pnoInboundLoad, pnoV18Export])
    output = replaceFunction(output, implementation.name, implementation);
  output = replaceOne(output,
    `  if (pnoV18State.type !== type) {\n    pnoV18State.filterRows = null;\n    pnoV18State.filterKey = "";\n    pnoV18State.filterPage = 1;\n    pnoV18State.filters.status = "";\n    pnoV18State.filters.action = "";\n  }`,
    `  if (pnoV18State.type !== type) {\n    pnoV18State.filterRows = null;\n    pnoV18State.filterKey = "";\n    pnoV18State.filterPage = 1;\n    pnoV18State.filters.status = "";\n    pnoV18State.filters.action = "";\n    pnoV18State.filters.branch = "";\n  }`, "tab state");
  output = replaceOne(output,
    `async function pnoV18LoadBags() {\n  if (pnoV18State.busy) return;\n  pnoInboundToggleActions(false);\n  pnoV18State.type = "bag";`,
    `async function pnoV18LoadBags() {\n  if (pnoV18State.busy) return;\n  pnoInboundToggleActions(false);\n  if (pnoV18State.type !== "bag") {\n    pnoV18State.filterRows = null;\n    pnoV18State.filterKey = "";\n    pnoV18State.filterPage = 1;\n    pnoV18State.filters.status = "";\n    pnoV18State.filters.action = "";\n    pnoV18State.filters.branch = "";\n  }\n  pnoV18State.type = "bag";`, "bag tab filter reset");
  output = replaceOne(output,
    `  el("pno-v18-page").textContent = "หน้า " + nf.format(pnoV18State.page) + " / " + nf.format(pages);\n  el("pno-v18-prev").disabled = pnoV18State.page <= 1;\n  el("pno-v18-next").disabled = pnoV18State.page >= pages;`,
    `  if (!(pnoV18ParcelFilterActive() && Array.isArray(pnoV18State.filterRows))) {\n    el("pno-v18-page").textContent = "หน้า " + nf.format(pnoV18State.page) + " / " + nf.format(pages);\n    el("pno-v18-prev").disabled = pnoV18State.page <= 1;\n    el("pno-v18-next").disabled = pnoV18State.page >= pages;\n  }`, "filtered parcel pager");
  output = replaceOne(output,
    `  pnoV18State.filters.bagStatus = "";\n  pnoV18State.filters.bagAction = "";\n  pnoV18State.filters.bagHub = "";\n  pnoV18State.filters.bagBranch = "";`,
    `  pnoV18State.filters.branch = "";`, "modal reset");
  output = replaceOne(output,
    `    lines.push("หมวด: " + pnoV18TypeLabel(pnoV18State.type) + " | หน้า " + nf.format(pnoV18State.page));`,
    `    lines.push("หมวด: " + (pnoV18State.type === "scan_gap" ? "หลุดสแกนเข้า" : pnoV18TypeLabel(pnoV18State.type)) +\n      (pnoV18ParcelFilterActive() && Array.isArray(pnoV18State.filterRows) ? " · ผลกรองทั้งชุด" : " | หน้า " + nf.format(pnoV18State.page)));`, "LINE dataset description");
  output = replaceOne(output,
    `    lines.push("พบ " + nf.format(entries.length) + " รายการในหน้านี้");`,
    `    lines.push("พบ " + nf.format(entries.length) + (pnoV18ParcelFilterActive() && Array.isArray(pnoV18State.filterRows) ? " รายการในผลกรอง" : " รายการในหน้านี้"));`, "LINE result description");
  output = replaceOne(output,
    `    entries.forEach(({ item: row, sourceIndex }) => {\n      lines.push([\n        (pnoV18State.page - 1) * 200 + sourceIndex + 1,`,
    `    entries.forEach(({ item: row, sourceIndex }, index) => {\n      lines.push([\n        pnoV18ParcelFilterActive() && Array.isArray(pnoV18State.filterRows) ? index + 1 : (pnoV18State.page - 1) * 200 + sourceIndex + 1,`, "filtered copy numbering");
  output = replaceOne(output,
    `    pnoV18AppendLineLimited(lines, entries, ({ item: row, sourceIndex }) =>\n      ((pnoV18State.page - 1) * 200 + sourceIndex + 1) + ". " + pnoV18LineCell(row.pno) +`,
    `    pnoV18AppendLineLimited(lines, entries, ({ item: row, sourceIndex }, index) =>\n      (pnoV18ParcelFilterActive() && Array.isArray(pnoV18State.filterRows) ? index + 1 : (pnoV18State.page - 1) * 200 + sourceIndex + 1) + ". " + pnoV18LineCell(row.pno) +`, "filtered LINE numbering");
  return `${output}\n// ${MARKER}: shared PNO filter projection; no provider endpoint or background acquisition.\n`;
}
