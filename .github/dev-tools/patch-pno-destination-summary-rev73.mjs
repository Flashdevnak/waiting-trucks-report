const MARKER = 'PNO_DESTINATION_SUMMARY_REV73';

// Only documented destination-field code forms. Never branch-name similarity,
// next-store or operationalMatchHub. Preserve the authoritative display name.
export function pnoDestinationHub(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim(), upper = raw.toUpperCase();
  if (!raw || ['UNKNOWN', 'NULL', 'UNDEFINED', 'N/A', '-'].includes(upper)) return null;
  const named = upper.match(/^(?:\d+\s+)?([A-Z]+[A-Z0-9]*)_B?HUB(?:\b|[-\s])/);
  const code = named?.[1] || (/^[A-Z]+[0-9]*$/.test(upper) ? upper : '');
  return code ? { code, raw } : null;
}

export function pnoDestinationDisplayBranch(value) {
  // The accepted R-field samples use a leading numeric TH store identifier.
  // This is display-only; grouping/filter identity retains the complete R value.
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw.replace(/^\(TH\d+\)\s*/i, '').trim() || raw;
}

export function pnoDestinationCompare(a, b) {
  return a.localeCompare(b, 'th', { numeric: true, sensitivity: 'variant' }) ||
    (a < b ? -1 : a > b ? 1 : 0);
}

export function pnoDestinationAggregate(rows, currentHub, complete = true) {
  const current = pnoDestinationHub(currentHub);
  if (!complete || !current || !Array.isArray(rows)) return { status: 'INCOMPLETE', own: [], other: [], total: null, ownTotal: null, otherTotal: null, unclassified: null };
  if (rows.some(row => !row || typeof row !== 'object' || typeof row.pno !== 'string' || !row.pno.trim()))
    return { status: 'INVALID', own: [], other: [], total: null, ownTotal: null, otherTotal: null, unclassified: null };
  const own = new Map(), other = new Map();
  let ownTotal = 0, otherTotal = 0, unclassified = 0;
  for (const row of rows) {
    // One validated package-list row = one parcel occurrence, not bag quantity.
    // Deduplication/occurrence verification belongs to the existing exact-locator
    // all-page pipeline; do not collapse separate occurrences by PNO here.
    const hub = pnoDestinationHub(row.targetHub);
    if (!hub) { unclassified++; continue; }
    if (hub.code === current.code) {
      const branch = typeof row.targetBranch === 'string' ? row.targetBranch.trim() : '';
      if (!branch || ['-', 'UNKNOWN', 'N/A'].includes(branch.toUpperCase())) { unclassified++; continue; }
      if (!own.has(branch)) own.set(branch, { identity: branch, label: pnoDestinationDisplayBranch(branch), count: 0 });
      own.get(branch).count++; ownTotal++;
    } else {
      if (!other.has(hub.code)) other.set(hub.code, { identity: hub.code, label: hub.raw, count: 0 });
      const group = other.get(hub.code);
      if (pnoDestinationCompare(hub.raw, group.label) < 0) group.label = hub.raw;
      group.count++; otherTotal++;
    }
  }
  const ownRows = [...own.values()], labels = new Map();
  for (const row of ownRows) labels.set(row.label, (labels.get(row.label) || 0) + 1);
  for (const row of ownRows) if (labels.get(row.label) > 1) row.label = row.identity;
  ownRows.sort((a, b) => b.count - a.count || pnoDestinationCompare(a.label, b.label) || pnoDestinationCompare(a.identity, b.identity));
  const otherRows = [...other.values()].sort((a, b) => b.count - a.count || pnoDestinationCompare(a.identity, b.identity));
  return { status: 'COMPLETE', currentHub: current.code, own: ownRows, other: otherRows,
    ownTotal, otherTotal, unclassified, total: rows.length };
}

export function pnoDestinationMarkup(summary, scopeLabel, stateLabel = '') {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const formatter = new Intl.NumberFormat('th-TH');
  const number = value => formatter.format(value);
  const title = '<header><h3>สรุปปลายทางพัสดุ</h3><p>' + escape(scopeLabel) + '</p></header>';
  if (summary.status !== 'COMPLETE') return title + '<p class="pno-destination-state" role="status">' + escape(stateLabel || 'ข้อมูลยังไม่ครบทุกหน้า · ยังไม่แสดงยอดปลายทาง') + '</p>';
  const lines = rows => rows.length ? '<ul>' + rows.map(row => '<li title="' + escape(row.identity) + '"><span>' + escape(row.label) + '</span><b>' + number(row.count) + ' <small>ชิ้น</small></b></li>').join('') + '</ul>' : '<p class="pno-destination-empty">ไม่พบรายการในขอบเขตนี้</p>';
  return title + '<div class="pno-destination-columns"><section><h4>สาขาปลายทางใน HUB ของเรา · ' + escape(summary.currentHub) + '</h4>' + lines(summary.own) +
    '<footer><span>รวมส่งสาขาภายใน ' + escape(summary.currentHub) + '</span><b>' + number(summary.ownTotal) + ' ชิ้น</b></footer></section>' +
    '<section><h4>ฮับปลายทางอื่น</h4>' + lines(summary.other) + '<footer><span>รวมฮับปลายทางอื่น</span><b>' + number(summary.otherTotal) + ' ชิ้น</b></footer></section></div>' +
    (summary.unclassified ? '<p class="pno-destination-unknown"><span>ไม่สามารถจำแนกปลายทางได้</span><b>' + number(summary.unclassified) + ' ชิ้น</b></p>' : '') +
    '<p class="pno-destination-total">รวมพัสดุตามขอบเขตและตัวกรองนี้ <b>' + number(summary.total) + ' ชิ้น</b></p>';
}

export const PNO_DESTINATION_STYLE = `
.pno-destination-summary{margin:12px 16px;padding:16px;border:1px solid #dfe3e6;border-radius:10px;background:#fff;color:#202124}
.pno-destination-summary h3{margin:0;font-size:18px;line-height:1.4;font-weight:800}
.pno-destination-summary header>p{margin:5px 0 14px;color:#626b73;font-size:13px;line-height:1.6;overflow-wrap:anywhere}
.pno-destination-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.pno-destination-columns section{min-width:0;border:1px solid #e0e4e8;border-radius:8px;overflow:hidden}
.pno-destination-columns h4{margin:0;padding:12px 14px;background:#f4f6f8;font-size:15px;line-height:1.5}
.pno-destination-columns ul{margin:0;padding:0 14px;list-style:none}
.pno-destination-columns li{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:14px;padding:11px 0;border-bottom:1px solid #edf0f2;font-size:15px;line-height:1.5}
.pno-destination-columns li:last-child{border:0}.pno-destination-columns li>span{overflow-wrap:anywhere}
.pno-destination-summary b{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;font-size:16px}
.pno-destination-summary small{font-size:12px;color:#69717a;font-weight:500}
.pno-destination-columns footer{padding:12px 14px;background:#fafbfc;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;font-size:14px;border-top:1px solid #e0e4e8}
.pno-destination-empty,.pno-destination-state{padding:12px 14px;color:#69717a;font-size:14px;line-height:1.6}
.pno-destination-unknown{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:12px 14px;background:#fff6e8;border:1px solid #ecd9b8;border-radius:7px;font-size:14px}
.pno-destination-total{margin:14px 0 0;color:#535e67;font-size:14px;line-height:1.6}.pno-destination-total b{margin-left:8px}
@media(max-width:640px){.pno-destination-summary{margin:10px 12px;padding:12px}.pno-destination-columns{grid-template-columns:1fr;gap:12px}.pno-destination-columns h4{padding:11px 12px}.pno-destination-columns li{font-size:14px;gap:10px}.pno-destination-columns footer{font-size:13px}.pno-destination-summary b{font-size:15px}}
`;

function pnoDestinationRuntime() {
  let coverage = null;
  function scopeKey() { const row = pnoV18SourceRow(); return row ? pnoV18LocatorKey(row) + '|' + pnoV18State.type : ''; }
  function observe(key, result, page) {
    if (!key || key !== scopeKey() || pnoV18State.type === 'bag') return;
    if (page === 1) coverage = { key, total: result?.total, last: 0, count: 0, valid: true };
    if (!coverage || coverage.key !== key) return;
    coverage.valid &&= result?.sourceValid === true && result?.sourceCountMismatch !== true &&
      Number.isSafeInteger(result?.total) && result.total >= 0 && result.total === coverage.total &&
      Number(result.page) === page && page === coverage.last + 1 && Array.isArray(result.parcels) &&
      result.parcels.length === Math.min(200, Math.max(0, coverage.total - (page - 1) * 200));
    coverage.last = page; coverage.count += Array.isArray(result?.parcels) ? result.parcels.length : 0;
  }
  function ensure() {
    const card = el('pno-v18-summary');
    if (!card) return null;
    let panel = el('pno-destination-summary');
    if (!panel) { panel = document.createElement('section'); panel.id = 'pno-destination-summary'; panel.className = 'pno-destination-summary'; panel.setAttribute('aria-label', 'สรุปปลายทางพัสดุ'); card.insertAdjacentElement('afterend', panel); }
    if (!el('pno-destination-summary-style')) { const style = document.createElement('style'); style.id = 'pno-destination-summary-style'; style.textContent = PNO_DESTINATION_STYLE; document.head.append(style); }
    return panel;
  }
  function renderSummary() {
    const panel = ensure(); if (!panel) return;
    panel.hidden = el('pno-v18-summary').classList.contains('hidden');
    const type = pnoV18State.type, key = scopeKey();
    const complete = type !== 'bag' && Boolean(key) && !pnoV18State.filterForce && !pnoV18State.filterError &&
      Array.isArray(pnoV18State.filterRows) && pnoV18State.filterKey === key && coverage?.key === key && coverage.valid &&
      coverage.last === Math.max(1, Math.ceil(coverage.total / 200)) && coverage.count === coverage.total &&
      pnoV18State.filterRows.length === coverage.total;
    const rows = complete ? pnoV18FilteredParcelEntries(pnoV18State.filterRows).map(entry => entry.item) : null;
    const summary = pnoDestinationAggregate(rows, state.branch, complete);
    const label = ({ total: 'ทั้งหมด', already: 'เข้าคลังแล้ว', no_entry: 'คงเหลือ', scan_gap: 'รายการตรวจสแกนเข้า', bag: 'แบ็กกิ้ง' })[type] || '';
    const row = pnoV18SourceRow();
    const scope = 'เฉพาะเที่ยว/จุดส่งที่เลือก · HUB ' + String(state.branch || '-') + ' · ' + label +
      (pnoV18State.day ? ' · ' + pnoV18State.day : '') + ' · ' + String(row?.proofId || '-') +
      (pnoV18State.routeName ? ' · ' + pnoV18State.routeName : '') +
      (pnoV18State.selection === 'union' ? ' · รวมจุดส่งทั้งคัน' : Number.isSafeInteger(pnoV18State.selection) ? ' · จุดส่ง ' + (pnoV18State.selection + 1) : '') +
      (pnoV18FilterSummaryText() ? ' · ' + pnoV18FilterSummaryText() : '') +
      ' · รวมทุกหน้า · ยอดนี้แยกจากยอด PreEntry บนการ์ด';
    const status = type === 'bag' ? 'เลือกแท็บรายการพัสดุเพื่อดูสรุปปลายทาง' : pnoV18State.filterError ?
      'ข้อมูลปลายทางไม่ครบหรือโหลดไม่สำเร็จ · ยังไม่แสดงยอดรวม' : coverage?.key === key && !coverage.valid ?
      'ข้อมูลต้นทางไม่สมบูรณ์ · ยังไม่แสดงยอดปลายทาง' : 'กำลังเตรียมข้อมูลทุกหน้า · ยังไม่แสดงยอดปลายทาง';
    panel.innerHTML = pnoDestinationMarkup(summary, scope, status);
  }
  const safeRender = () => { try { renderSummary(); } catch { const panel = el('pno-destination-summary'); if (panel) panel.textContent = 'สรุปปลายทางพัสดุไม่พร้อม · ยังไม่แสดงยอดรวม'; } };
  const fetchOriginal = pnoV18Fetch;
  pnoV18Fetch = async function (...args) {
    const key = scopeKey();
    try { const result = await fetchOriginal(...args); try { observe(key, result, Number(args[1])); } catch { coverage = null; } return result; }
    catch (error) { if (key === scopeKey()) coverage = null; safeRender(); throw error; }
  };
  // Preserve existing call/return/throw behavior. Observers create no fetch, timer,
  // polling, endpoint, storage or all-page acquisition of their own.
  const wrap = fn => function (...args) { const result = fn.apply(this, args); safeRender(); return result; };
  pnoV18RenderSummary = wrap(pnoV18RenderSummary);
  pnoV18RenderFilters = wrap(pnoV18RenderFilters);
  pnoV18RenderCurrentFilteredView = wrap(pnoV18RenderCurrentFilteredView);
  pnoV18SetActive = wrap(pnoV18SetActive);
  render = wrap(render);
  const resetOriginal = resetPendingParcelModal;
  resetPendingParcelModal = function (...args) { const result = resetOriginal.apply(this, args); coverage = null; safeRender(); return result; };
  const multiOriginal = pnoV18OpenMulti;
  pnoV18OpenMulti = async function (...args) { const result = await multiOriginal.apply(this, args); safeRender(); return result; };
}

export function patchPnoDestinationSummary(source) {
  let output = String(source || '');
  if (output.includes(MARKER)) return output;
  if (!output.includes('PNO_SEGMENT_DESTINATION_FRONTEND_V1') || !output.includes('PNO_ALL_PAGE_FILTER_TRUTH_V1'))
    throw new Error(MARKER + ': exact destination/all-page prerequisites missing');
  const pure = [pnoDestinationHub, pnoDestinationDisplayBranch, pnoDestinationCompare,
    pnoDestinationAggregate, pnoDestinationMarkup].map(fn => fn.toString()).join('\n');
  return output + '\n// ' + MARKER + ': passive DEV-only all-page destination summary.\n' + pure +
    '\nconst PNO_DESTINATION_STYLE = ' + JSON.stringify(PNO_DESTINATION_STYLE) + ';\n(' + pnoDestinationRuntime.toString() + ')();\n';
}
