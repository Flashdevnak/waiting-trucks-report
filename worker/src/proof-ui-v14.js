const VERSION = '20260907-01';

export async function maybeHandleProofUiV14(request) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname !== '/proof-v14.js') return null;
  return new Response(`(()=>{const __name=(target,value)=>target;(${proofUiV14.toString()})();})();`, {
    headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function proofUiV14() {
  const boot = () => {
    const P = window.ProofV2;
    if (!window.__PROOF_V10_READY__ || !P || typeof P.render !== 'function' || typeof P.apiGet !== 'function') {
      return setTimeout(boot, 40);
    }
    if (window.__PROOF_V14_READY__) return;
    window.__PROOF_V14_READY__ = true; // PROOF_RESPONSIVE_OPS_V14

    const detailCache = new Map();
    const expanded = new Set();
    const DETAIL_TTL = 5 * 60_000;
    const keyOf = row => P.rowKey(row);
    const lane = row => typeof P.proofLaneScope === 'function' ? P.proofLaneScope(row) : 'FD';
    const destination = row => {
      const code = String(row?.destinationCode || P.destinationShort?.(row) || '').trim();
      const name = String(row?.destinationName || '').trim();
      if (code && name && !name.toUpperCase().startsWith(code.toUpperCase())) return `${code} — ${name}`;
      if (name) return name;
      if (code) return code;
      const route = String(row?.lineName || '');
      const marker = `-${String(P.state.branch || '').toUpperCase()}-`;
      const upper = route.toUpperCase();
      const i = upper.indexOf(marker);
      return i >= 0 ? route.slice(i + marker.length).split('-')[0] : 'ไม่ระบุปลายทาง';
    };
    const detailFor = row => detailCache.get(keyOf(row))?.data || row?._proofDetailV14 || row?._proofDetailV13 || null;
    const supplier = row => detailFor(row)?.fleetName || row?.fleetName || row?.supplierName || '—';
    const driver = row => detailFor(row)?.driver || row?.driver || '—';
    const phone = row => detailFor(row)?.driverPhone || row?.driverPhone || '—';
    const plate = row => [detailFor(row)?.plateNumber || row?.plateNumber, detailFor(row)?.plateTypeText || row?.plateTypeText].filter(Boolean).join(' • ') || '—';
    const barcode = row => detailFor(row)?.proofId || row?.proofId || 'ยังไม่มี';
    const status = row => typeof P.isMissedVehicle === 'function' && P.isMissedVehicle(row) ? 'รถไม่เข้า' : P.stateText(row);
    const standby = row => row?.detailReady && Number.isFinite(Number(row?.standbyTime)) ? P.minuteText(row.standbyTime) : '—';
    const release = row => P.minuteText(row?.plannedDepartureTime ?? row?.startTime);
    const hasBarcode = row => Boolean(String(detailFor(row)?.proofId || row?.proofId || '').trim());

    const canOperate = row => {
      const code = Number(row?.proofState);
      const missed = typeof P.isMissedVehicle === 'function' && P.isMissedVehicle(row);
      const canPrint = Boolean(P.state.profile?.canPrint) && P.PRINTABLE_STATES.has(code);
      const canCreate = hasBarcode(row) || code !== 1 || Boolean(P.state.profile?.canCreateProof);
      return !missed && canPrint && canCreate && Boolean(row?.lineId) && Boolean(row?.departureDate);
    };
    const actionLabel = row => {
      if (typeof P.isMissedVehicle === 'function' && P.isMissedVehicle(row)) return 'เลยเวลาปล่อย';
      return hasBarcode(row) ? 'ตรวจ / ปริ้น' : 'เปิดบาร์ / ปริ้น';
    };
    const actionPair = row => `<div class='proof-v14-action-pair'>
      <button class='btn ${canOperate(row) ? 'btn-accent' : 'btn-header'}' type='button' data-proof-print='${P.escAttr(keyOf(row))}' ${canOperate(row) ? '' : 'disabled'}>${P.esc(actionLabel(row))}</button>
      <button class='btn btn-danger-soft' type='button' disabled>ยกเลิกรถ</button>
    </div>`;

    const detailHtml = row => {
      const detail = detailFor(row);
      if (!detail && expanded.has(keyOf(row))) return `<div class='proof-v14-detail-loading'>กำลังโหลดข้อมูลเที่ยวรถ…</div>`;
      if (!detail) return '';
      const routeType = [detail.lineModeText || row.lineModeText, detail.lineTypeText || row.lineTypeText].filter(Boolean).join(' / ') || '—';
      const origin = detail.originName || P.state.branch || '—';
      const dest = destination(row);
      const fleet = detail.fleetName || '—';
      const fleetId = detail.fleetId ? `รหัสซัพ ${detail.fleetId}` : '';
      return `<div class='proof-v14-detail-grid'>
        <div><small>บริษัทซัพ</small><strong>${P.esc(fleet)}</strong>${fleetId ? `<span>${P.esc(fleetId)}</span>` : ''}</div>
        <div><small>ต้นทาง / ปลายทาง</small><strong>${P.esc(origin)}</strong><span>${P.esc(dest)}</span></div>
        <div><small>ลักษณะ / เส้นทาง</small><strong>${P.esc(routeType)}</strong><span>${P.esc(detail.track || '')}</span></div>
        <div><small>บาร์รถ / วันที่</small><strong>${P.esc(barcode(row))}</strong><span>${P.esc(row.departureDate || '')}</span></div>
      </div>`;
    };

    const rowHtml = row => {
      const key = keyOf(row);
      const isOpen = expanded.has(key);
      const missed = typeof P.isMissedVehicle === 'function' && P.isMissedVehicle(row);
      const ready = hasBarcode(row);
      return `<article class='proof-v14-row ${missed ? 'is-missed' : ready ? 'is-ready' : 'is-pending'}' data-proof-v14-row='${P.escAttr(key)}'>
        <button class='proof-v14-route-cell' type='button' data-proof-v14-expand='${P.escAttr(key)}' aria-expanded='${isOpen ? 'true' : 'false'}'>
          <small>เส้นทาง</small><strong>${P.esc(row.lineName || '—')}</strong><span>${P.esc(plate(row))}</span>
        </button>
        <div><small>บาร์รถ</small><strong class='proof-v14-barcode'>${P.esc(barcode(row))}</strong><span>${ready ? 'เปิดใช้แล้ว' : 'ยังไม่มีบาร์'}</span></div>
        <div><small>เวลา</small><strong>${P.esc(standby(row))} → ${P.esc(release(row))}</strong><span>${P.standbyBadge(row)}</span></div>
        <div><small>คนขับ / โทรศัพท์</small><strong>${P.esc(driver(row))}</strong><span>${P.esc(phone(row))}</span></div>
        <div><small>บริษัทซัพ / รถ</small><strong>${P.esc(supplier(row))}</strong><span>${P.esc(plate(row))}</span></div>
        <div class='proof-v14-status-actions'><div><small>สถานะ</small><strong>${P.esc(status(row))}</strong></div>${actionPair(row)}</div>
        ${isOpen ? detailHtml(row) : ''}
      </article>`;
    };

    P.groupRouteCard = rowHtml;
    P.mobileCard = rowHtml;
    P.groupedHtml = rows => {
      const lanes = new Map();
      for (const row of rows) {
        const l = lane(row);
        if (!lanes.has(l)) lanes.set(l, []);
        lanes.get(l).push(row);
      }
      return ['FD', 'LH'].filter(l => lanes.has(l)).map(l => {
        const items = lanes.get(l);
        const branches = new Map();
        for (const row of items) {
          const d = destination(row);
          if (!branches.has(d)) branches.set(d, []);
          branches.get(d).push(row);
        }
        const extra = items.filter(row => Number(row.lineMode) === 2).length;
        const body = [...branches.entries()].sort((a,b)=>a[0].localeCompare(b[0],'th')).map(([name, branchRows]) => `
          <section class='proof-v14-branch'>
            <header><strong>${P.esc(name)}</strong><span>${P.nf.format(branchRows.length)} เที่ยว</span></header>
            <div class='proof-v14-columns'><b>เส้นทาง</b><b>บาร์รถ</b><b>เวลา</b><b>คนขับ / โทรศัพท์</b><b>บริษัทซัพ / รถ</b><b>สถานะ / จัดการ</b></div>
            ${branchRows.map(rowHtml).join('')}
          </section>`).join('');
        return `<section class='proof-v14-lane'><div class='proof-v14-lane-head'><strong>${l}</strong><span>${P.nf.format(items.length)} เที่ยว${extra ? ` • รถเสริม ${P.nf.format(extra)}` : ''}</span></div>${body}</section>`;
      }).join('');
    };

    P.tableRow = row => `<tr><td><strong>${P.esc(row.lineName || '—')}</strong><small>${P.esc(destination(row))}</small></td><td><strong>${P.esc(barcode(row))}</strong></td><td><strong>${P.esc(standby(row))} → ${P.esc(release(row))}</strong></td><td><strong>${P.esc(driver(row))}</strong><small>${P.esc(phone(row))}</small></td><td><strong>${P.esc(supplier(row))}</strong><small>${P.esc(plate(row))}</small></td><td><strong>${P.esc(status(row))}</strong></td><td>${actionPair(row)}</td></tr>`;

    const loadDetail = async row => {
      const key = keyOf(row);
      const cached = detailCache.get(key);
      if (cached && Date.now() - cached.at < DETAIL_TTL) return cached.data;
      if (!P.state.auth) return null;
      const data = await P.apiGet('/api/proof/editor', { token:P.state.auth.token, branch:P.state.branch, lineId:row.lineId, departureDate:row.departureDate });
      detailCache.set(key, { at:Date.now(), data });
      row._proofDetailV14 = data;
      return data;
    };

    document.addEventListener('click', async event => {
      const toggle = event.target.closest('[data-proof-v14-expand]');
      if (!toggle) return;
      event.preventDefault();
      const key = toggle.dataset.proofV14Expand;
      const row = (P.state.rows || []).find(item => keyOf(item) === key);
      if (!row) return;
      if (expanded.has(key)) { expanded.delete(key); P.render(); return; }
      expanded.clear();
      expanded.add(key);
      P.render();
      try { await loadDetail(row); } catch (error) { console.warn('proof detail', error?.message || error); }
      if (expanded.has(key)) P.render();
    }, true);

    const baseOpenEditor = P.openEditor;
    P.openEditor = (row, detail) => {
      detailCache.set(keyOf(row), { at:Date.now(), data:detail });
      row._proofDetailV14 = detail;
      baseOpenEditor(row, detail);
      setTimeout(() => {
        const dialog = document.getElementById('proof-editor-dialog');
        if (!dialog) return;
        dialog.classList.add('proof-v14-editor');
        const headSmall = dialog.querySelector('.proof-editor-head small'); if (headSmall) headSmall.textContent = 'ข้อมูลเที่ยวรถ';
        const title = dialog.querySelector('.proof-editor-head h2'); if (title) title.textContent = 'ตรวจข้อมูลก่อนปริ้นบาร์รถ';
        const plan = document.getElementById('proof-editor-plan'); if (plan) plan.textContent = `Standby ${standby(row)} → ปล่อย ${release(row)}`;
        const userLabel = dialog.querySelector('.proof-editor-meta span:last-child'); if (userLabel) userLabel.firstChild && (userLabel.firstChild.textContent = 'ผู้ใช้งาน: ');
        const warning = dialog.querySelector('.proof-editor-warning'); if (warning) warning.remove();
        const checkText = dialog.querySelector('.proof-confirm-check span'); if (checkText) checkText.textContent = 'ตรวจข้อมูลแล้ว';
        dialog.querySelectorAll('.proof-lock-reason').forEach(el => { el.textContent = 'แก้จากหน้านี้ไม่ได้'; });
        dialog.querySelectorAll('.proof-editor-section-head span').forEach(el => { el.textContent = el.textContent.replace(/เลือก.*MS|จาก MS|ตามข้อมูล MS/g, '').trim(); if (!el.textContent) el.remove(); });
      }, 0);
    };

    const cleanCopy = () => {
      const heading = document.querySelector('.proof-heading p'); if (heading) heading.textContent = 'ตรวจเที่ยวรถ เปิดบาร์ และปริ้น PDF';
      const command = document.querySelector('.proof-command-head');
      if (command) {
        const small = command.querySelector('small'); if (small) small.textContent = 'ภาพรวมรถวันนี้';
        const strong = command.querySelector('strong'); if (strong) strong.textContent = 'สถานะเที่ยวรถ';
        command.querySelectorAll('span').forEach(el => el.remove());
      }
      document.querySelectorAll('.proof-selected-value>span,.proof-option>span').forEach(el => el.setAttribute('aria-hidden','true'));
    };

    const closeOtherMenus = opened => {
      document.querySelectorAll('.proof-page details[open]').forEach(details => { if (details !== opened) details.open = false; });
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
    document.querySelectorAll('.proof-page details').forEach(details => details.addEventListener('toggle', () => { if (details.open) closeOtherMenus(details); else closeOtherMenus(null); }));
    window.addEventListener('resize', () => { document.documentElement.style.overflow=''; document.body.style.overflow=''; }, { passive:true });

    const style = document.createElement('style');
    style.id = 'proof-v14-style';
    style.textContent = `
      .proof-page{overflow-x:hidden!important;color:#111b24!important}.proof-page .site-header .brand-copy span,.proof-page .site-header summary small,.proof-page .site-header .header-menu-subtitle{color:#e5e9ec!important;opacity:1!important}.proof-page .site-header summary>span:not(.nav-grid-icon){color:#fff!important}.proof-page small{color:#42505c!important}
      .proof-v14-lane{border:1px solid #cfd7dd;border-radius:12px;overflow:hidden;background:#fff;margin-bottom:14px}.proof-v14-lane-head{display:flex;justify-content:space-between;align-items:center;padding:13px 15px;background:#eef2f5;border-bottom:1px solid #cfd7dd}.proof-v14-lane-head strong{font-size:20px;color:#132331}.proof-v14-lane-head span{font-size:13px;font-weight:800;color:#43515d}
      .proof-v14-branch{border-top:7px solid #f3f5f6}.proof-v14-branch>header{display:flex;justify-content:space-between;align-items:center;background:#263746;color:#fff;padding:10px 14px}.proof-v14-branch>header strong{font-size:15px}.proof-v14-branch>header span{font-size:12px;font-weight:800;color:#e6edf2}
      .proof-v14-columns,.proof-v14-row{display:grid;grid-template-columns:minmax(240px,1.55fr) minmax(125px,.72fr) minmax(145px,.82fr) minmax(165px,.95fr) minmax(175px,1fr) minmax(260px,1.2fr);width:100%;box-sizing:border-box}.proof-v14-columns{background:#e8edf1;border-bottom:1px solid #cfd7dd}.proof-v14-columns b{padding:9px 11px;font-size:12px;color:#314351;border-right:1px solid #d3dae0}.proof-v14-row{border-bottom:1px solid #dce3e8;box-shadow:inset 3px 0 0 #d1a600}.proof-v14-row.is-ready{box-shadow:inset 3px 0 0 #4d966e}.proof-v14-row.is-missed{box-shadow:inset 3px 0 0 #bd3c34}.proof-v14-row>div,.proof-v14-route-cell{min-width:0;padding:12px 11px;border:0;border-right:1px solid #e1e6ea;background:#fff;text-align:left;font:inherit;color:inherit;box-sizing:border-box}.proof-v14-route-cell{cursor:pointer}.proof-v14-route-cell:hover{background:#f8fafb}.proof-v14-row small{display:block;font-size:12px!important;font-weight:800;color:#465662!important}.proof-v14-row strong{display:block;margin-top:3px;font-size:14px!important;line-height:1.4;color:#111a22!important;overflow-wrap:anywhere}.proof-v14-row span{display:block;margin-top:3px;font-size:12.5px!important;color:#354550!important;line-height:1.4}.proof-v14-route-cell strong{font-size:15.5px!important}.proof-v14-barcode{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
      .proof-v14-status-actions{display:grid!important;grid-template-columns:minmax(90px,.75fr) minmax(0,1.55fr);gap:8px;align-items:center}.proof-v14-action-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;width:100%}.proof-v14-action-pair .btn{width:100%!important;min-width:0!important;height:42px!important;min-height:42px!important;padding:5px 7px!important;font-size:11.5px!important;line-height:1.2!important;display:flex!important;align-items:center!important;justify-content:center!important;text-align:center!important;white-space:normal!important}
      .proof-v14-detail-loading,.proof-v14-detail-grid{grid-column:1/-1!important;border-top:1px dashed #b8c3cb;background:#f6f8f9}.proof-v14-detail-loading{padding:13px 15px;font-size:13px;font-weight:800;color:#43515d}.proof-v14-detail-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))}.proof-v14-detail-grid>div{padding:11px 13px;border-right:1px solid #dbe2e7}.proof-v14-detail-grid>div:last-child{border-right:0}.proof-v14-detail-grid strong{font-size:14px!important}
      .proof-v14-editor{width:min(980px,calc(100vw - 24px))!important;max-width:980px!important;max-height:calc(100dvh - 20px)!important;margin:auto!important;border-radius:14px!important;overflow:hidden!important}.proof-v14-editor .proof-editor-card{max-height:calc(100dvh - 20px)!important;overflow:hidden!important;padding:14px!important;display:grid!important;grid-template-columns:1fr 1fr!important;gap:10px 12px!important}.proof-v14-editor .proof-editor-head,.proof-v14-editor .proof-editor-route-box,.proof-v14-editor #proof-editor-context-v12,.proof-v14-editor .proof-confirm-check,.proof-v14-editor .proof-editor-working,.proof-v14-editor .proof-editor-actions{grid-column:1/-1!important}.proof-v14-editor .proof-editor-route-box{margin:0!important;padding:11px 13px!important;background:#fff!important;color:#111b24!important;border:1px solid #cfd7dd!important}.proof-v14-editor .proof-editor-route-box small,.proof-v14-editor .proof-editor-meta{color:#42505c!important}.proof-v14-editor .proof-editor-meta b{color:#111b24!important}.proof-v14-editor #proof-editor-context-v12{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;border:1px solid #cfd7dd!important;border-radius:10px!important;overflow:hidden!important}.proof-v14-editor #proof-editor-context-v12>div{padding:10px 12px!important;border-right:1px solid #dce2e6!important}.proof-v14-editor #proof-editor-context-v12>div:last-child{border-right:0!important}.proof-v14-editor .proof-editor-section{margin:0!important}.proof-v14-editor .proof-editor-section-head{padding:9px 11px!important}.proof-v14-editor .proof-selected-value{padding:9px 11px!important}.proof-v14-editor .proof-selected-value>span,.proof-v14-editor .proof-option>span{display:none!important}.proof-v14-editor .proof-option-list{max-height:130px!important}.proof-v14-editor .proof-confirm-check{margin:0!important;padding:8px 10px!important;background:#f6f8f9!important;border-color:#cfd7dd!important}.proof-v14-editor .proof-editor-actions{margin:0!important}.proof-v14-editor .proof-editor-actions .btn{min-width:150px!important;height:42px!important}.proof-v14-editor .proof-editor-warning{display:none!important}
      @media(max-width:1350px){.proof-v14-columns{display:none!important}.proof-v14-row{grid-template-columns:repeat(3,minmax(0,1fr))}.proof-v14-status-actions{grid-column:3!important}.proof-v14-detail-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:760px){html,body{overflow-x:hidden!important}.proof-page .site-header{position:static!important;top:auto!important}.proof-page .site-header-inner{display:block!important;padding:8px 10px!important}.proof-page .header-brand{width:100%!important;margin-bottom:8px!important}.proof-page .topbar-actions{display:grid!important;grid-template-columns:1fr 1fr!important;gap:7px!important;width:100%!important;align-items:stretch!important}.proof-page .topbar-actions>*{min-width:0!important;width:100%!important;max-width:none!important}.proof-page .topbar-actions details{position:static!important}.proof-page .topbar-actions details summary{min-height:54px!important}.proof-page .topbar-actions details[open]{grid-column:1/-1!important}.proof-page .topbar-actions details[open] .app-nav-menu,.proof-page .topbar-actions details[open] .header-menu-panel{position:static!important;inset:auto!important;transform:none!important;width:100%!important;min-width:0!important;max-width:none!important;max-height:none!important;overflow:visible!important;margin-top:6px!important}.proof-page .topbar-actions #connection-badge{display:flex!important;align-items:center!important;justify-content:center!important;min-height:44px!important}.proof-v14-row{display:grid!important;grid-template-columns:1fr 1fr!important}.proof-v14-row>div,.proof-v14-route-cell{border-right:1px solid #e1e6ea!important;border-bottom:1px solid #e1e6ea!important}.proof-v14-route-cell{grid-column:1/-1!important}.proof-v14-status-actions{grid-column:1/-1!important;display:block!important}.proof-v14-action-pair{margin-top:8px}.proof-v14-detail-grid{grid-template-columns:1fr!important}.proof-v14-detail-grid>div{border-right:0!important;border-bottom:1px solid #dbe2e7!important}.proof-v14-editor{width:100vw!important;max-width:100vw!important;height:100dvh!important;max-height:100dvh!important;border-radius:0!important}.proof-v14-editor .proof-editor-card{height:100dvh!important;max-height:100dvh!important;overflow-y:auto!important;grid-template-columns:1fr!important;padding:12px!important}.proof-v14-editor .proof-editor-head,.proof-v14-editor .proof-editor-route-box,.proof-v14-editor #proof-editor-context-v12,.proof-v14-editor .proof-editor-section,.proof-v14-editor .proof-confirm-check,.proof-v14-editor .proof-editor-working,.proof-v14-editor .proof-editor-actions{grid-column:1!important}.proof-v14-editor #proof-editor-context-v12{grid-template-columns:1fr!important}.proof-v14-editor #proof-editor-context-v12>div{border-right:0!important;border-bottom:1px solid #dce2e6!important}.proof-v14-editor .proof-editor-actions{display:grid!important;grid-template-columns:1fr 1fr!important;position:static!important}.proof-v14-editor .proof-editor-actions .btn{min-width:0!important;width:100%!important}}
      @media(max-width:430px){.proof-page .topbar-actions{grid-template-columns:1fr!important}.proof-page .topbar-actions details[open]{grid-column:1!important}.proof-v14-row{grid-template-columns:1fr!important}.proof-v14-route-cell,.proof-v14-status-actions{grid-column:1!important}.proof-v14-action-pair{grid-template-columns:1fr 1fr!important}}
    `;
    document.head.appendChild(style);
    cleanCopy();
    P.render();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0), { once:true }); else setTimeout(boot, 0);
}
