const MARKER = 'PNO_BAG_MEMBER_FILTER_PARITY_REV86';
function replaceFunction(source, name, transform) {
  const start = source.indexOf(`function ${name}(`);
  const from = source.slice(Math.max(0,start-6),start)==='async ' ? start-6 : start;
  const end = source.indexOf('\n}\n',start)+2;
  if(start<0||end<start)throw new Error(`${MARKER}: missing ${name}`);
  return source.slice(0,from)+transform(source.slice(from,end))+source.slice(end);
}

function pnoV18FilteredBagGroups(rows = pnoV18State.bagRows || []) {
  // One opened exact PNO locator is one occurrence. Reject overlapping pages,
  // never deduplicate unrelated occurrences or fabricate missing parcel IDs.
  const seen = new Set();
  for (const item of rows) {
    const id = String(item?.pno || '').trim().toUpperCase();
    if (!id || seen.has(id)) throw new Error('ข้อมูลพัสดุซ้ำหรือไม่มี PNO จึงยืนยันผลกรองไม่ได้');
    seen.add(id);
  }
  // Same per-parcel status/action/Q/R projection as ALL, before bag grouping.
  return pnoV18BagGroups(pnoV18FilteredParcelEntries(rows).map(({item}) => item));
}

async function pnoV18LoadBags() {
  if (pnoV18State.busy) return;
  pnoInboundToggleActions(false);
  if (pnoV18State.type !== 'bag') {
    pnoV18State.filterRows = null;
    pnoV18State.filterKey = '';
    pnoV18State.filterPage = 1;
    pnoV18State.filters.status = '';
    pnoV18State.filters.action = '';
    pnoV18State.filters.hub = '';
    pnoV18State.filters.branch = '';
  }
  pnoV18State.type = 'bag';
  pnoPendingRenderNote();
  pnoV18State.expandedBag = '';
  pnoV18SetActive('bag');
  el('pno-v18-pager').classList.add('hidden');
  const sourceRow = pnoV18SourceRow();
  const bagKey = sourceRow ? pnoV18LocatorKey(sourceRow) : '';
  if (!bagKey) throw new Error('ข้อมูลอ้างอิงเที่ยวไม่ครบ');
  const cachedBag = pnoV18CacheGet(pnoV18BagCache, bagKey);
  pnoV18State.bagRows = null;
  pnoV18State.filterError = '';
  pnoV18State.busy = true;
  el('pending-parcels-loading').textContent = 'กำลังรวมเลขถุงแบ็กกิ้ง…';
  el('pending-parcels-loading').classList.remove('hidden');
  el('pending-parcels-list').classList.add('hidden');
  try {
    let all, total;
    if (cachedBag && pnoV18State.force !== true) {
      all = cachedBag.rows; total = cachedBag.total;
    } else {
      all = []; total = null;
      let pages = 1;
      for (let page=1; page<=pages; page+=1) {
        const result = await pnoV18Fetch('total',page);
        const reported = Number(result?.total), rows = result?.parcels;
        if (!Number.isSafeInteger(reported)||reported<0||!Array.isArray(rows)||
            result.sourceValid===false||(result.page!=null&&Number(result.page)!==page))
          throw new Error('ข้อมูลหน้าพัสดุไม่ครบหรือไม่ตรงหน้า');
        if (total===null) { total=reported;pages=Math.max(1,Math.ceil(total/200)); }
        if (reported!==total||rows.length!==Math.min(200,Math.max(0,total-(page-1)*200)))
          throw new Error('จำนวนพัสดุเปลี่ยนหรือขาดหน้าระหว่างรวมถุง');
        all.push(...rows);
        if (pnoV18LocatorKey(pnoV18SourceRow())!==bagKey||pnoV18State.type!=='bag')
          throw new Error('เที่ยวรถเปลี่ยนระหว่างรวมถุง');
      }
    }
    if (!Array.isArray(all)||!Number.isSafeInteger(total)||total<0||all.length!==total||
        pnoV18LocatorKey(pnoV18SourceRow())!==bagKey||pnoV18State.type!=='bag')
      throw new Error('ข้อมูลถุงทั้งชุดไม่ครบหรือเที่ยวรถเปลี่ยน');
    // Closed membership validation runs before acceptance/cache publication.
    pnoV18FilteredBagGroups(all);
    pnoV18State.bagRows = all;
    pnoV18State.total = total;
    pendingParcelRows = all;
    if (!cachedBag || pnoV18State.force===true)
      pnoV18CacheSet(pnoV18BagCache,bagKey,{rows:all,total},24);
    pnoV18RenderSummary();
    pnoV18RenderFilters();
    pnoV18RenderBags(all);
    el('pending-parcels-loading').classList.add('hidden');
    el('pending-parcels-list').classList.remove('hidden');
  } catch(error) {
    pnoV18State.bagRows = null;
    pnoV18State.filterError = 'ข้อมูลถุงไม่ครบ · ยังไม่ยืนยันยอดหรือผลกรอง';
    el('pending-parcels-loading').innerHTML='<strong>'+esc(error.message)+'</strong>';
    pnoV18RenderFilters();
  } finally { pnoV18State.busy=false; }
}

export function patchPnoBagFilterParityRev86(source) {
  if(source.includes(MARKER))return source;
  let out=source;
  out=replaceFunction(out,'pnoV18ParcelFilterActive',b=>b.replace('(pnoV18State.type !== "bag" && hub)','hub'));
  out=replaceFunction(out,'pnoV18ParcelStatus',b=>b.replace('pnoV18TypeLabel(type))','pnoV18TypeLabel(type === "bag" ? "total" : type))'));
  out=replaceFunction(out,'pnoV18FilteredBagGroups',()=>pnoV18FilteredBagGroups.toString());
  out=replaceFunction(out,'pnoV18FilterSummaryText',b=>b
    .replace('pnoV18State.type !== "bag" && hub &&','hub &&')
    .replace('(pnoV18State.type === "bag" ? "ชื่อสาขาต่อไป=" + branch : "สาขาปลายทาง=" + pnoV18DisplayBranch(branch))','("สาขาปลายทาง=" + pnoV18DisplayBranch(branch))'));
  out=replaceFunction(out,'pnoV18BagSummary',b=>b
    .replace('(item) => item.nextStoreName, "หลายสาขา"','(item) => item.targetBranch, "หลายสาขา"')
    .replace('    latest: pnoV18BagLatest(items),','    latest: pnoV18BagLatest(items),\n    nextStore: pnoV18BagValue(items, (item) => item.nextStoreName, "หลายสาขา"),'));
  out=replaceFunction(out,'pnoV18RenderFilters',b=>b
    .replace('type === "bag" || (Array.isArray','(type === "bag" && Array.isArray(pnoV18State.bagRows)) || (type !== "bag" && Array.isArray')
    .replace('pnoV18BagGroups(rows).map(([, items]) => pnoV18BagSummary(items))','rows.filter((item) => String(item?.backingNo || "").trim())')
    .replace('type === "bag" ? row.status : pnoV18ParcelStatus(row)','pnoV18ParcelStatus(row)')
    .replace('type === "bag" ? row.latest : pnoV18ParcelAction(row)','pnoV18ParcelAction(row)')
    .replace('type === "bag" ? [] : pnoV18UniqueValues(source.map((row) => row.targetHub))','pnoV18UniqueValues(source.map((row) => row.targetHub))')
    .replace('    filters.status = pnoV18ValidateFilter(filters.status, statuses);','    if (filters.status && !statuses.includes(filters.status)) statuses.push(filters.status);')
    .replace('    filters.action = pnoV18ValidateFilter(filters.action, actions);','    if (filters.action && !actions.includes(filters.action)) actions.push(filters.action);')
    .replace('    if (type !== "bag") filters.hub = pnoV18ValidateFilter(filters.hub, hubs);','    if (filters.hub && !hubs.includes(filters.hub)) hubs.push(filters.hub);')
    .replace('type === "bag" ? source : source.filter','source.filter')
    .replace('type === "bag" ? row.branch : row.targetBranch','row.targetBranch')
    .replace('...(type === "bag" ? [] : [["hub", "HUB ปลายทาง", hubs]])','["hub", "HUB ปลายทาง", hubs]')
    .replace('type === "bag" ? "ชื่อสาขาต่อไป" : "สาขาปลายทาง"','"สาขาปลายทาง"')
    .replace('key === "branch" && type !== "bag"','key === "branch"'));
  // REV89: reset selected values on a tab transition, never the option universe.
  // Same-tab interactions/cache reopen preserve values; HUB validates its child.
  out=replaceFunction(out,'pnoV18Load',b=>b.replace(
    '    pnoV18State.filters.branch = "";',
    '    pnoV18State.filters.branch = "";\n    pnoV18State.filters.hub = "";'));
  out=replaceFunction(out,'pnoInboundLoad',b=>b.replace(
    '    pnoV18State.filters.branch = "";',
    '    pnoV18State.filters.branch = "";\n    pnoV18State.filters.hub = "";'));
  out=replaceFunction(out,'pnoV18LoadBags',()=>pnoV18LoadBags.toString());
  // One membership source is used by desktop/mobile/expanded/copy/LINE/XLSX.
  for(const name of ['pnoV18RenderBags','pnoV18Copy','pnoV18Export'])
    out=replaceFunction(out,name,b=>b.replaceAll('HUB ถัดไป','HUB ปลายทาง').replaceAll('ชื่อสาขาต่อไป','สาขาปลายทาง'));
  out=replaceFunction(out,'pnoV18RenderBags',b=>b
    .replace('    const summary = pnoV18BagSummary(items);','    const summary = pnoV18BagSummary(items);\n    const wholeCount = allGroups.find(([key]) => key === bag)?.[1].length || 0;\n    const memberCountText = pnoV18HasActiveFilters() ? nf.format(items.length) + " ตรงตัวกรอง / " + nf.format(wholeCount) + " ชิ้นในถุง" : nf.format(items.length) + " ชิ้น";')
    .replaceAll("nf.format(items.length) + ' ชิ้น'", "memberCountText")
    .replace("nf.format(items.length) + ' ชิ้น</span>'", "memberCountText + '</span>'")
    .replace('<th>สาขาปลายทาง</th><th></th>','<th>สาขาปลายทาง</th><th>ชื่อสาขาต่อไป</th><th></th>')
    .replace("'<td>' + esc(summary.branch) + '</td>'", "'<td>' + esc(pnoV18DisplayBranch(summary.branch)) + '</td>' + '<td>' + esc(summary.nextStore) + '</td>'")
    .replace('colspan="8"','colspan="9"')
    .replace("'<div><small>สาขาปลายทาง</small><b>' + esc(summary.branch) + '</b></div>'", "'<div><small>สาขาปลายทาง</small><b>' + esc(pnoV18DisplayBranch(summary.branch)) + '</b></div>' + '<div><small>ชื่อสาขาต่อไป</small><b>' + esc(summary.nextStore) + '</b></div>'"));
  out=replaceFunction(out,'pnoV18RenderBagSummary',b=>b.replace('จำนวนชิ้นในถุง','จำนวนชิ้นในถุงที่ตรงตัวกรอง'));
  // REV89: Copy and LINE must not lose the distinct N-field while adding Q/R.
  out=replaceFunction(out,'pnoV18Copy',b=>b
    .replace('["#", "เลขถุงแบ็กกิ้ง", "ล่าสุด", "จำนวนพัสดุ", "HUB ปลายทาง", "สาขาปลายทาง"]',
      '["#", "เลขถุงแบ็กกิ้ง", "ล่าสุด", "จำนวนพัสดุ", "HUB ปลายทาง", "สาขาปลายทาง", "ชื่อสาขาต่อไป"]')
    .replace('items.length, summary.hub, summary.branch,',
      'items.length, summary.hub, summary.branch, summary.nextStore,'));
  out=replaceFunction(out,'pnoV18CopyLine',b=>b.replace(
    'nf.format(group.items.length) + " ชิ้น"',
    'nf.format(group.items.length) + " ชิ้น" +\n        " | สาขาปลายทาง: " + pnoV18LineCell(pnoV18DisplayBranch(group.summary.branch)) +\n        " | ชื่อสาขาต่อไป: " + pnoV18LineCell(group.summary.nextStore) +\n        " | ล่าสุด: " + pnoV18LineCell(group.summary.latest)'));
  // Retain N independently in parcel and scan-evidence Copy/LINE/XLSX too.
  // It is presentation metadata, never Q/R identity or a scan truth boundary.
  out=replaceFunction(out,'pnoV18Copy',b=>b
    .replace('"สาขาปลายทาง", "เวลา", ...(pnoV18State.selection',
      '"สาขาปลายทาง", "ชื่อสาขาต่อไป", "เวลา", ...(pnoV18State.selection')
    .replace('        pnoV18DisplayBranch(row.targetBranch),',
      '        pnoV18DisplayBranch(row.targetBranch),\n        row.nextStoreName || "",'));
  out=replaceFunction(out,'pnoV18CopyLine',b=>b.replace(
    'pnoV18LineCell(pnoV18DisplayBranch(row.targetBranch)) +',
    'pnoV18LineCell(pnoV18DisplayBranch(row.targetBranch)) +\n      " | ชื่อสาขาต่อไป: " + pnoV18LineCell(row.nextStoreName) +'));
  out=replaceFunction(out,'pnoV18Export',b=>b
    .replace('"เหตุผล": row.scanEvidence?.reason || "",',
      '"เหตุผล": row.scanEvidence?.reason || "",\n      "HUB ปลายทาง": row.targetHub || "",\n      "สาขาปลายทาง": pnoV18DisplayBranch(row.targetBranch),\n      "ชื่อสาขาต่อไป": row.nextStoreName || "",')
    .replace('"สาขาปลายทาง": pnoV18DisplayBranch(row.targetBranch),\n      ...(pnoV18State.selection',
      '"สาขาปลายทาง": pnoV18DisplayBranch(row.targetBranch),\n      "ชื่อสาขาต่อไป": row.nextStoreName || "",\n      ...(pnoV18State.selection'));
  // Keep source-backed next-store value independent in exports (not R-field).
  out=replaceFunction(out,'pnoV18Export',b=>b.replace('"สาขาปลายทาง": summary.branch','"สาขาปลายทาง": summary.branch, "ชื่อสาขาต่อไป": summary.nextStore'));
  return out+'\n// '+MARKER+': member-first Q/R filtering; transport/cadence unchanged.\n';
}
