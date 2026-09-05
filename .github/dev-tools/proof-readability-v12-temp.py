from pathlib import Path
import re

ui_path=Path('worker/src/proof-ui-v10.js')
ui=ui_path.read_text()
if 'PROOF_READABILITY_V12' in ui:
    raise SystemExit('V12 already applied')
ui=ui.replace("const VERSION = '20260906-01';","const VERSION = '20260906-02';",1)

# Correct visible group title as well as destination key. V11 changed destinationLabel but the base UI kept an old function reference.
anchor="    P.destinationLabel = row => laneScope(row) === 'LH' ? 'LH • HUB TO HUB' : 'FD • Feeder / รถเสริม / อื่น ๆ';\n    P.state.proofLaneScopeV11 = P.state.proofLaneScopeV11 || 'all';\n"
replace="    P.destinationLabel = row => laneScope(row) === 'LH' ? 'LH • HUB TO HUB' : 'FD • Feeder / รถเสริม / อื่น ๆ';\n    P.destinationGroupLabel = row => P.destinationLabel(row); // PROOF_FD_LH_HEADER_V12\n    P.state.proofLaneScopeV11 = P.state.proofLaneScopeV11 || 'all';\n\n    // PROOF_DETAIL_ON_DEMAND_V12: supplier/full MS data is fetched only after the user opens one row.\n    const detailCacheV12 = new Map();\n    const DETAIL_CACHE_MS_V12 = 5 * 60_000;\n    const detailKeyV12 = row => P.rowKey(row);\n    const loadDetailV12 = async row => {\n      const key = detailKeyV12(row), cached = detailCacheV12.get(key);\n      if (cached && Date.now() - cached.at < DETAIL_CACHE_MS_V12) return cached.data;\n      if (!P.state.auth) return null;\n      const data = await P.apiGet('/api/proof/editor', { token: P.state.auth.token, branch: P.state.branch, lineId: row.lineId, departureDate: row.departureDate });\n      detailCacheV12.set(key, { at: Date.now(), data });\n      return data;\n    };\n    const updateDetailPanelV12 = (row, detail) => {\n      const panel = document.querySelector(`[data-proof-v11-detail-panel='${CSS.escape(detailKeyV12(row))}']`);\n      if (!panel) return;\n      const supplier = detail?.fleetName || 'ไม่พบชื่อซัพจาก MS';\n      const fleet = detail?.fleetId ? `Fleet ${detail.fleetId}` : 'อ่านเมื่อกดรายละเอียด';\n      const origin = detail?.originName || P.state.branch || '—';\n      const track = detail?.track || routeDestinationLabel(row) || '—';\n      const driver = detail?.driver || row.driver || 'ยังไม่กำหนดคนขับ';\n      const phone = detail?.driverPhone || row.driverPhone || 'ไม่มีเบอร์โทร';\n      const plate = [detail?.plateNumber || row.plateNumber, detail?.plateTypeText || row.plateTypeText].filter(Boolean).join(' • ') || 'ยังไม่กำหนดทะเบียน';\n      panel.innerHTML = `<div><small>บริษัทซัพ</small><strong>${P.esc(supplier)}</strong><span>${P.esc(fleet)}</span></div><div><small>ต้นทาง / เส้นทาง</small><strong>${P.esc(origin)}</strong><span>${P.esc(track)}</span></div><div><small>คนขับ / โทรศัพท์</small><strong>${P.esc(driver)}</strong><span>${P.esc(phone)}</span></div><div><small>รถ / ทะเบียน</small><strong>${P.esc(plate)}</strong><span>${P.esc(detail?.proofStateText || P.stateText(row))}</span></div><div><small>บาร์รถ</small><strong>${P.esc(detail?.proofId || row.proofId || 'ยังไม่มี')}</strong><span>${P.esc(barcodeStatus({ ...row, proofId: detail?.proofId || row.proofId }))}</span></div><div><small>เวลา</small><strong>Standby ${P.esc(P.minuteText(row.standbyTime))} → ปล่อย ${P.esc(P.minuteText(row.plannedDepartureTime ?? row.startTime))}</strong><span>${P.esc(row.departureDate || '')}</span></div>`;\n    };\n"
if anchor not in ui: raise SystemExit('lane anchor missing')
ui=ui.replace(anchor,replace,1)

# Make expanded row useful immediately, then enrich supplier/confirmed data on demand.
old="""        <div class='proof-v11-detail hidden' data-proof-v11-detail-panel='${P.escAttr(P.rowKey(row))}'>
          <div><small>กลุ่ม</small><strong>${P.esc(laneScope(row))}</strong><span>${extraVehicle(row) ? 'รถเสริม' : 'รถปกติ'}</span></div>
          <div><small>ปลายทาง</small><strong>${P.esc(destination)}</strong><span>${P.routeBadges(row)}</span></div>
          <div><small>คนขับ</small><strong>${P.esc(row.driver || 'ยังไม่กำหนด')}</strong><span>${P.esc(row.driverPhone || 'ไม่มีเบอร์โทร')}</span></div>
          <div><small>ทะเบียน</small><strong>${P.esc(plate)}</strong><span>${P.esc(barcodeStatus(row))}</span></div>
        </div>"""
new="""        <div class='proof-v11-detail hidden' data-proof-v11-detail-panel='${P.escAttr(P.rowKey(row))}'>
          <div><small>บริษัทซัพ</small><strong>กดรายละเอียดเพื่ออ่านจาก MS</strong><span>อ่านเฉพาะเมื่อเปิด • cache 5 นาที</span></div>
          <div><small>ปลายทาง / กลุ่ม</small><strong>${P.esc(destination)}</strong><span>${P.esc(laneScope(row))} • ${extraVehicle(row) ? 'รถเสริม' : 'รถปกติ'}</span></div>
          <div><small>คนขับ / โทรศัพท์</small><strong>${P.esc(row.driver || 'ยังไม่กำหนด')}</strong><span>${P.esc(row.driverPhone || 'ไม่มีเบอร์โทร')}</span></div>
          <div><small>รถ / ทะเบียน</small><strong>${P.esc(plate)}</strong><span>${P.esc(row.plateTypeText || '—')}</span></div>
          <div><small>บาร์รถ</small><strong>${P.esc(row.proofId || 'ยังไม่มี')}</strong><span>${P.esc(barcodeStatus(row))}</span></div>
          <div><small>เวลา</small><strong>Standby ${P.esc(standby)} → ปล่อย ${P.esc(release)}</strong><span>${P.esc(row.departureDate || '')}</span></div>
        </div>"""
if old not in ui: raise SystemExit('detail markup missing')
ui=ui.replace(old,new,1)

# Correct view labels so they describe FD/LH grouping, not branch grouping.
anchor="      const search = P.el('search-input'); if (search) search.placeholder = 'ค้นหาเส้นทาง / สาขา / ทะเบียนรถ / คนขับ / เบอร์ / บาร์โค้ด';\n"
insert=anchor+"      const groupBtn = P.el('group-view-btn'); if (groupBtn) groupBtn.textContent = 'แยกกลุ่ม FD / LH';\n      const listBtn = P.el('list-view-btn'); if (listBtn) listBtn.textContent = 'ตารางรวม';\n      const tableHeads = document.querySelectorAll('.proof-table thead th'); const tableLabels = ['เส้นทาง / ปลายทาง','รถ / ทะเบียน','คนขับ / โทรศัพท์','เวลา Standby / ปล่อย','บาร์รถ','สถานะ','ตรวจ / ปริ้น']; tableHeads.forEach((th,i)=>{ if(tableLabels[i]) th.textContent=tableLabels[i]; });\n"
if anchor not in ui: raise SystemExit('search anchor missing')
ui=ui.replace(anchor,insert,1)

# Detail click: accordion + one on-demand editor read, never background.
old="""        const detail = event.target.closest('[data-proof-v11-detail]'); if (detail) { const panel = document.querySelector(`[data-proof-v11-detail-panel='${CSS.escape(detail.dataset.proofV11Detail || '')}']`); if (panel) { panel.classList.toggle('hidden'); detail.textContent = panel.classList.contains('hidden') ? 'รายละเอียด' : 'ซ่อน'; } return; }"""
new="""        const detail = event.target.closest('[data-proof-v11-detail]'); if (detail) { const key = detail.dataset.proofV11Detail || ''; const panel = document.querySelector(`[data-proof-v11-detail-panel='${CSS.escape(key)}']`); if (!panel) return; const opening = panel.classList.contains('hidden'); document.querySelectorAll('[data-proof-v11-detail-panel]').forEach(x=>x.classList.add('hidden')); document.querySelectorAll('[data-proof-v11-detail]').forEach(x=>x.textContent='รายละเอียด'); if (!opening) return; panel.classList.remove('hidden'); detail.textContent='ซ่อนรายละเอียด'; const row = (P.state.rows || []).find(x=>P.rowKey(x)===key); if (!row) return; panel.classList.add('is-loading'); try { const full = await loadDetailV12(row); if (full) updateDetailPanelV12(row, full); } catch (error) { const first=panel.querySelector('strong'); if(first) first.textContent=error.message||'อ่านรายละเอียดจาก MS ไม่สำเร็จ'; } finally { panel.classList.remove('is-loading'); } return; }"""
if old not in ui: raise SystemExit('detail click handler missing')
ui=ui.replace(old,new,1)
# listener must be async
ui=ui.replace("      document.addEventListener('click', event => {\n        const detail = event.target.closest('[data-proof-v11-detail]');","      document.addEventListener('click', async event => {\n        const detail = event.target.closest('[data-proof-v11-detail]');",1)

# Readability V12 overrides + neutral print/editor modal, no emoji-driven decoration.
anchor="      `; document.head.appendChild(v11); }\n      renderCommandCounts();\n"
v12=r'''      `; document.head.appendChild(v11); }
      if (!document.getElementById('proof-v12-style')) { const v12 = document.createElement('style'); v12.id = 'proof-v12-style'; v12.textContent = `
        /* PROOF_READABILITY_V12: optimized for browser 100% zoom; color communicates only exceptions/actions. */
        .proof-page{font-size:15px!important}.proof-page .app-shell{max-width:1640px!important}.proof-heading p{font-size:13px!important;line-height:1.55}.proof-command-head small{font-size:11px!important}.proof-command-head strong{font-size:18px!important;line-height:1.4}.proof-command-head>div>span{font-size:12px!important;line-height:1.45}.proof-v11-lanes button{font-size:13px!important;min-height:40px!important;padding:7px 16px!important}.proof-command-grid-v11 button span{font-size:12px!important}.proof-command-grid-v11 button strong{font-size:28px!important}.proof-command-grid-v11 button small{font-size:11px!important;line-height:1.35}.proof-v11-watch>div:not(.proof-v11-progress-wrap){font-size:12px!important}.proof-v11-progress-wrap small{font-size:11px!important}
        .proof-group-head{min-height:60px!important;padding:13px 16px!important}.proof-group-name strong{font-size:17px!important;line-height:1.4}.proof-group-name small{font-size:13px!important;margin-top:4px!important}.proof-group-chevron{font-size:15px!important}.proof-v11-row{grid-template-columns:minmax(310px,1.7fr) minmax(185px,1fr) minmax(220px,1.08fr) minmax(175px,.9fr) 330px!important;min-height:94px!important}.proof-v11-row>div{padding:12px 14px!important}.proof-v11-row small,.proof-v11-detail small{font-size:11px!important}.proof-v11-row strong,.proof-v11-detail strong{font-size:14px!important;line-height:1.5!important}.proof-v11-row span,.proof-v11-detail span{font-size:11.5px!important;line-height:1.45!important}.proof-v11-route>strong{font-size:15px!important}.proof-v10-chip,.proof-v10-time{font-size:11px!important;padding:5px 9px!important}.proof-v11-detail{grid-template-columns:repeat(3,minmax(0,1fr))!important;padding:3px 12px 8px!important;background:#f8fafb!important}.proof-v11-detail>div{padding:11px 12px!important}.proof-v11-detail.is-loading{opacity:.68}.proof-v11-actions{display:grid!important;grid-template-columns:152px 152px!important;justify-content:end!important;gap:8px!important}.proof-v11-actions>.btn,.proof-v11-actions .proof-actions,.proof-v11-actions .proof-actions .btn{width:152px!important;min-width:152px!important;max-width:152px!important;height:42px!important;min-height:42px!important;margin:0!important;font-size:11px!important;padding:6px 8px!important}.proof-v11-actions .proof-actions{display:block!important}
        .proof-toolbar label>span{font-size:13px!important}.proof-toolbar select,.proof-toolbar input{min-height:46px!important;font-size:14px!important;padding:8px 10px!important}.proof-summary{font-size:13px!important}.proof-view-switch .btn{min-height:40px!important;font-size:12px!important}.proof-table thead th{font-size:13px!important;padding:12px 10px!important}.proof-table tbody td{font-size:13px!important;padding:12px 10px!important}.proof-table td small{font-size:11px!important;line-height:1.4}.proof-table .btn{min-height:40px!important;font-size:11px!important}
        .proof-editor-dialog{width:min(920px,calc(100vw - 28px))!important;max-width:none!important;border-radius:14px!important}.proof-editor-card{background:#fff!important;color:#202a33!important;font-size:14px!important;padding:18px!important}.proof-editor-card h2{font-size:25px!important;line-height:1.25;text-align:left}.proof-editor-route-box{text-align:center!important;border:1px solid #dfe3e8!important;border-top:3px solid #39444e!important;background:#fff!important;padding:14px!important}.proof-editor-route-box strong,#proof-editor-route{font-size:18px!important;line-height:1.45!important}.proof-editor-route-box small,.proof-editor-route-box span{font-size:12px!important}.proof-editor-summary-v7{background:#f6f8f9!important;border-color:#e0e4e7!important}.proof-editor-summary-v7>div{border-color:#e0e4e7!important}.proof-editor-section{background:#fff!important;border:1px solid #dfe3e8!important;border-radius:10px!important;overflow:hidden}.proof-editor-section-head{background:#f6f8f9!important;padding:12px 14px!important}.proof-editor-section-head b{font-size:15px!important}.proof-editor-section-head span,.proof-lock-reason{font-size:11.5px!important;line-height:1.4!important}.proof-selected-value{padding:13px 14px!important;grid-template-columns:1fr!important}.proof-selected-value>span,.proof-option>span{display:none!important}.proof-selected-value small{font-size:11px!important}.proof-selected-value strong{font-size:16px!important;line-height:1.45}.proof-selected-value em{font-size:12px!important}.proof-search-wrap{padding:0 14px 14px!important}.proof-search-wrap input,.proof-search-row input{min-height:48px!important;font-size:15px!important;padding:9px 12px!important}.proof-search-row .btn{min-height:48px!important;font-size:13px!important}.proof-option{padding:11px 12px!important;background:#fff!important;border-color:#e1e5e8!important}.proof-option:hover,.proof-option.selected{background:#f7f9fa!important;border-color:#8f9aa4!important}.proof-option strong{font-size:14px!important}.proof-option small,.proof-option-hint{font-size:12px!important;line-height:1.4}.proof-editable-tag,.proof-locked-tag{background:#eef1f3!important;color:#4b5660!important;border-color:#dce1e5!important}.proof-editor-check-row{background:#f7f8f9!important;border-color:#dfe3e8!important;font-size:13px!important}.proof-editor-dialog .dialog-actions .btn{min-height:44px!important;font-size:13px!important;min-width:170px}.proof-editor-dialog .dialog-close{font-size:24px!important}
        #proof-editor-context-v12{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:0;margin:10px 0 12px;border:1px solid #dfe3e8;border-radius:10px;background:#f8fafb;overflow:hidden}#proof-editor-context-v12>div{padding:11px 13px;border-right:1px solid #e1e5e8}#proof-editor-context-v12>div:last-child{border-right:0}#proof-editor-context-v12 small{display:block;font-size:11px;color:#7b858e;font-weight:800}#proof-editor-context-v12 strong{display:block;margin-top:3px;font-size:14px;color:#26313a;line-height:1.45}#proof-editor-context-v12 span{display:block;margin-top:2px;font-size:11.5px;color:#707b84}
        @media(max-width:1260px){.proof-v11-row{grid-template-columns:minmax(280px,1.5fr) 1fr 1fr!important}.proof-v11-actions{grid-column:2/4!important;justify-content:start!important}.proof-v11-detail{grid-template-columns:1fr 1fr!important}}@media(max-width:760px){.proof-page{font-size:15px!important}.proof-v11-detail{grid-template-columns:1fr!important}.proof-v11-actions{grid-template-columns:1fr 1fr!important}.proof-v11-actions>.btn,.proof-v11-actions .proof-actions,.proof-v11-actions .proof-actions .btn{width:100%!important;min-width:0!important;max-width:none!important}#proof-editor-context-v12{grid-template-columns:1fr!important}#proof-editor-context-v12>div{border-right:0;border-bottom:1px solid #e1e5e8}#proof-editor-context-v12>div:last-child{border-bottom:0}}
      `; document.head.appendChild(v12); }
      renderCommandCounts();
'''
if anchor not in ui: raise SystemExit('v11 style anchor missing')
ui=ui.replace(anchor,v12,1)

# Enhance print modal context from the editor payload already fetched by the existing flow; no extra MS request.
old="""    P.openEditor = (row, detail) => {
      oldOpen(row, detail);
      setTimeout(() => {
        const input = P.el('proof-editor-plate-search');"""
new="""    P.openEditor = (row, detail) => {
      detailCacheV12.set(detailKeyV12(row), { at: Date.now(), data: detail });
      oldOpen(row, detail);
      setTimeout(() => {
        updateDetailPanelV12(row, detail);
        const routeBox = document.querySelector('.proof-editor-route-box');
        let context = document.getElementById('proof-editor-context-v12');
        if (!context) { context = document.createElement('div'); context.id = 'proof-editor-context-v12'; routeBox?.insertAdjacentElement('afterend', context); }
        if (context) context.innerHTML = `<div><small>บริษัทซัพ</small><strong>${P.esc(detail.fleetName || 'ไม่พบชื่อซัพจาก MS')}</strong><span>${P.esc(detail.fleetId ? `Fleet ${detail.fleetId}` : '')}</span></div><div><small>คนขับ / โทรศัพท์</small><strong>${P.esc(detail.driver || row.driver || 'ยังไม่กำหนด')}</strong><span>${P.esc(detail.driverPhone || row.driverPhone || 'ไม่มีเบอร์โทร')}</span></div><div><small>รถ / ทะเบียน</small><strong>${P.esc([detail.plateNumber || row.plateNumber, detail.plateTypeText || row.plateTypeText].filter(Boolean).join(' • ') || 'ยังไม่กำหนด')}</strong><span>${P.esc(detail.originName || detail.track || '')}</span></div>`;
        const input = P.el('proof-editor-plate-search');"""
if old not in ui: raise SystemExit('openEditor wrapper missing')
ui=ui.replace(old,new,1)
ui_path.write_text(ui)

# HAR-grounded plate search fix: 4WJ popup type 101 is searched by MS in car/info bucket 100; include digit-only query variant.
plate_path=Path('worker/src/proof-plate-search-v5.js')
plate=plate_path.read_text()
old="""function msPlateTypeFilter(detail) {
  const lineMode = Number(detail.line_mode);
  const auditType = detail.audit_type == null ? null : Number(detail.audit_type);
  const sameModelRule = lineMode === 1 || (lineMode === 2 && [1, 3].includes(auditType));
  return sameModelRule && detail.plate_type != null ? String(detail.plate_type) : '';
}

function normalizePlateSearch(v) { return text(v, 120).normalize('NFKC').toLowerCase().replace(/[\\s\\-–—_/.()[\\]{}]+/g, ''); }
function plateSearchVariants(q) { const raw=text(q,80), noProvince=raw.replace(/\\([^)]*\\)/g,'').trim(), compact=raw.replace(/[\\s\\-–—_/.()[\\]{}]+/g,''); return [...new Set([raw,noProvince,compact].filter(x=>x.length>=2))]; }"""
new="""function msPlateTypeFilter(detail) {
  const lineMode = Number(detail.line_mode);
  const auditType = detail.audit_type == null ? null : Number(detail.audit_type);
  const sameModelRule = lineMode === 1 || (lineMode === 2 && [1, 3].includes(auditType));
  if (!sameModelRule || detail.plate_type == null) return '';
  // PROOF_PLATE_HAR_V12: MS storeLine HAR confirms 4WJ popup type 101 searches car/info with plateType=100.
  if (String(detail.plate_type_text || '').trim().toUpperCase() === '4WJ' && Number(detail.plate_type) === 101) return '100';
  return String(detail.plate_type);
}

function normalizePlateSearch(v) { return text(v, 120).normalize('NFKC').toLowerCase().replace(/[\\s\\-–—_/.()[\\]{}]+/g, ''); }
function plateSearchVariants(q) { const raw=text(q,80), noProvince=raw.replace(/\\([^)]*\\)/g,'').trim(), compact=raw.replace(/[\\s\\-–—_/.()[\\]{}]+/g,''), digits=raw.replace(/\\D/g,''); return [...new Set([raw,noProvince,compact,digits].filter(x=>x.length>=2))]; }"""
if old not in plate: raise SystemExit('plate type/variants block missing')
plate=plate.replace(old,new,1)
plate_path.write_text(plate)

# Cache-bust only Proof V10 asset.
html_path=Path('proof.html'); html=html_path.read_text(); html=html.replace('/proof-v10.js?v=20260906-01','/proof-v10.js?v=20260906-02'); html_path.write_text(html)

# Regression contract and HAR-specific test.
test_path=Path('worker/tests/proof-command-center-v10.test.mjs')
t=test_path.read_text().replace(r"/\\/proof-v10\\.js\\?v=20260906-01/",r"/\\/proof-v10\\.js\\?v=20260906-02/")
needle="  assert.match(ui, /PROOF_OPS_CONTROL_V11/);\n"
if needle in t:
    t=t.replace(needle,needle+"  assert.match(ui, /PROOF_READABILITY_V12/);\n  assert.match(ui, /PROOF_FD_LH_HEADER_V12/);\n  assert.match(ui, /PROOF_DETAIL_ON_DEMAND_V12/);\n  assert.match(ui, /บริษัทซัพ/);\n  assert.match(ui, /DETAIL_CACHE_MS_V12/);\n",1)
append=r'''

test('4WJ plate search follows the HAR-confirmed MS bucket and numeric query variant', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async input => {
    const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname.endsWith('/proof/popup')) {
      return Response.json({ code: 1, data: { fleet_id: '32', line_mode: 1, line_type: 1, audit_type: null, plate_type: 101, plate_type_text: '4WJ' } });
    }
    if (url.pathname.includes('/car/car/info')) {
      calls.push({ plateNumber: url.searchParams.get('plateNumber'), plateType: url.searchParams.get('plateType') });
      if (url.searchParams.get('plateType') === '100' && url.searchParams.get('plateNumber') === '3393') {
        return Response.json({ code: 1, data: [{ id: 262730, plate_number: 'บล-3393', fleet_company_car_type_vo: { car_type: 100, car_type_text: '4W', province_name: 'บุรีรัมย์', fleet_volist: [{ fleet_id: 32, fleet_name: '2KL (2K LOGISTICS)' }] } }] });
      }
      return Response.json({ code: 1, data: [] });
    }
    if (url.pathname.includes('/fleet/van/')) return Response.json({ code: 1, data: [] });
    throw new Error(`unexpected fetch ${url}`);
  };
  const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) }, MS_BRANCH: 'NE1', MS_SESSION_ID: 'session', MS_DEVICE_ID: 'device' };
  const baseWorker = { fetch: async () => Response.json({ ok: true, data: {} }) };
  try {
    const request = new Request('https://dev.example/api/proof/plate-options?token=t&branch=NE1&lineId=L1&departureDate=2026-09-06&q=%E0%B8%9A%E0%B8%A53393');
    const response = await maybeHandleProofPlateSearchV5(request, env, {}, baseWorker);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.data.items[0].plateNumber, 'บล-3393(บุรีรัมย์)');
    assert.ok(calls.some(x => x.plateNumber === '3393' && x.plateType === '100'));
  } finally { globalThis.fetch = originalFetch; }
});
'''
if "HAR-confirmed MS bucket" not in t: t += append
test_path.write_text(t)

print('PROOF_READABILITY_V12_PATCH=READY')
