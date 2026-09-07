const VERSION = '20260907-03';

export async function maybeHandleProofUiV15(request) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname !== '/proof-v15.js') return null;
  return new Response(`(()=>{const __name=(target,value)=>target;(${proofUiV15.toString()})();})();`, {
    headers: { 'Content-Type':'application/javascript; charset=utf-8', 'Cache-Control':'no-store' },
  });
}

function proofUiV15() {
  const boot = () => {
    const P = window.ProofV2;
    if (!window.__PROOF_V14_READY__ || !P || typeof P.render !== 'function' || typeof P.apiGet !== 'function') {
      return setTimeout(boot, 40);
    }
    if (window.__PROOF_V15_READY__) return;
    window.__PROOF_V15_READY__ = true; // PROOF_POLISH_V15

    const detailCache = new Map();
    const expanded = new Set();
    const DETAIL_TTL = 5 * 60_000;
    const keyOf = row => P.rowKey(row);
    const laneOf = row => typeof P.proofLaneScope === 'function' ? P.proofLaneScope(row) : 'FD';
    const text = (value, fallback) => String(value ?? '').trim() || fallback;
    const cleanPlate = value => String(value ?? '').trim().replace(/\s*\(([^)]+)\)\s*/g, ' ($1)').replace(/\s{2,}/g, ' ');
    const detailFor = row => detailCache.get(keyOf(row))?.data || row?._proofDetailV15 || row?._proofDetailV14 || row?._proofDetailV13 || null;
    const supplier = row => text(detailFor(row)?.fleetName || row?.fleetName, 'ยังไม่พบข้อมูลบริษัทซัพ');
    const supplierId = row => text(detailFor(row)?.fleetId || row?.fleetId, '');
    const driver = row => text(detailFor(row)?.driver || row?.driver, 'ยังไม่กำหนดคนขับ');
    const phone = row => text(detailFor(row)?.driverPhone || row?.driverPhone, 'ยังไม่มีเบอร์โทร');
    const plateNumber = row => cleanPlate(detailFor(row)?.plateNumber || row?.plateNumber) || 'ยังไม่กำหนดทะเบียน';
    const vehicleType = row => text(detailFor(row)?.plateTypeText || row?.plateTypeText, 'ไม่ระบุประเภทรถ');
    const barcode = row => text(detailFor(row)?.proofId || row?.proofId, 'ยังไม่มีบาร์รถ');
    const stateText = row => typeof P.isMissedVehicle === 'function' && P.isMissedVehicle(row) ? 'รถไม่เข้า' : text(P.stateText(row), 'ไม่ทราบสถานะ');
    const standbyText = row => row?.detailReady && Number.isFinite(Number(row?.standbyTime)) ? P.minuteText(row.standbyTime) : 'ยังไม่ทราบ';
    const releaseText = row => P.minuteText(row?.plannedDepartureTime ?? row?.startTime);
    const hasBarcode = row => Boolean(String(detailFor(row)?.proofId || row?.proofId || '').trim());

    const destination = row => {
      const code = String(row?.destinationCode || P.destinationShort?.(row) || '').trim();
      const name = String(row?.destinationName || '').trim();
      if (code && name) {
        const normalized = name.toUpperCase();
        if (normalized.startsWith(code.toUpperCase())) return name;
        return `${code} ${name}`;
      }
      if (name) return name;
      if (code) return code;
      const route = String(row?.lineName || '');
      const marker = `-${String(P.state.branch || '').toUpperCase()}-`;
      const upper = route.toUpperCase();
      const index = upper.indexOf(marker);
      return index >= 0 ? route.slice(index + marker.length).split('-')[0] : 'ไม่ระบุปลายทาง';
    };

    const typeTags = row => {
      const values = [laneOf(row), row?.lineTypeText, Number(row?.lineMode) === 2 ? 'รถเสริม' : '']
        .map(value => String(value || '').trim())
        .filter(Boolean);
      return [...new Set(values)].map(value => `<span>${P.esc(value)}</span>`).join('');
    };

    const canOperate = row => {
      const code = Number(row?.proofState);
      const missed = typeof P.isMissedVehicle === 'function' && P.isMissedVehicle(row);
      const canPrint = Boolean(P.state.profile?.canPrint) && P.PRINTABLE_STATES.has(code);
      const canCreate = hasBarcode(row) || code !== 1 || Boolean(P.state.profile?.canCreateProof);
      return !missed && canPrint && canCreate && Boolean(row?.lineId) && Boolean(row?.departureDate);
    };
    const mainAction = row => hasBarcode(row) ? 'ตรวจและปริ้น' : 'เปิดบาร์และปริ้น';
    const actionPair = row => `<div class='proof-v15-actions'>
      <button class='btn ${canOperate(row) ? 'btn-accent' : 'btn-header'}' type='button' data-proof-print='${P.escAttr(keyOf(row))}' ${canOperate(row) ? '' : 'disabled'}>${P.esc(mainAction(row))}</button>
      <button class='btn btn-danger-soft' type='button' disabled>ยกเลิกรถ</button>
    </div>`;

    const detailHtml = row => {
      const detail = detailFor(row);
      if (!detail && expanded.has(keyOf(row))) return `<div class='proof-v15-detail-loading'>กำลังโหลดข้อมูลเที่ยวรถ</div>`;
      if (!detail) return '';
      const type = [detail.lineModeText || row.lineModeText, detail.lineTypeText || row.lineTypeText].filter(Boolean).join('  ') || 'ไม่ระบุ';
      const origin = text(detail.originName || P.state.branch, 'ไม่ระบุต้นทาง');
      return `<div class='proof-v15-detail-grid'>
        <div><small>บริษัทซัพ</small><strong>${P.esc(supplier(row))}</strong>${supplierId(row) ? `<span>รหัสซัพ ${P.esc(supplierId(row))}</span>` : ''}</div>
        <div><small>ต้นทางและปลายทาง</small><strong>${P.esc(origin)}</strong><span>${P.esc(destination(row))}</span></div>
        <div><small>ประเภทเที่ยว</small><strong>${P.esc(type)}</strong>${detail.track ? `<span>${P.esc(detail.track)}</span>` : ''}</div>
        <div><small>บาร์รถและวันที่</small><strong>${P.esc(barcode(row))}</strong><span>${P.esc(row.departureDate || '')}</span></div>
      </div>`;
    };

    const rowHtml = row => {
      const key = keyOf(row);
      const isOpen = expanded.has(key);
      const missed = typeof P.isMissedVehicle === 'function' && P.isMissedVehicle(row);
      const ready = hasBarcode(row);
      const routeName = text(row.lineName, 'ไม่ระบุเส้นทาง');
      return `<article class='proof-v15-row ${missed ? 'is-missed' : ready ? 'is-ready' : 'is-pending'}' data-proof-v15-row='${P.escAttr(key)}'>
        <button class='proof-v15-route' type='button' data-proof-v15-expand='${P.escAttr(key)}' aria-expanded='${isOpen ? 'true' : 'false'}' title='${P.escAttr(routeName)}'>
          <small>เส้นทาง</small><strong>${P.esc(routeName)}</strong><div class='proof-v15-tags'>${typeTags(row)}</div>
        </button>
        <div class='proof-v15-cell barcode'><small>บาร์รถ</small><strong>${P.esc(barcode(row))}</strong><span>${ready ? 'เปิดใช้แล้ว' : 'ยังไม่ได้เปิดบาร์'}</span></div>
        <div class='proof-v15-cell time'><small>เวลา</small><strong>ปล่อย ${P.esc(releaseText(row))}</strong><span>Standby ${P.esc(standbyText(row))}</span></div>
        <div class='proof-v15-cell driver'><small>คนขับและเบอร์โทร</small><strong>${P.esc(driver(row))}</strong><span>${P.esc(phone(row))}</span></div>
        <div class='proof-v15-cell supplier'><small>บริษัทซัพและรถ</small><strong>${P.esc(supplier(row))}</strong><div class='proof-v15-vehicle'><span>ทะเบียน ${P.esc(plateNumber(row))}</span><span>รถ ${P.esc(vehicleType(row))}</span></div></div>
        <div class='proof-v15-status'><div><small>สถานะ</small><strong>${P.esc(stateText(row))}</strong></div>${actionPair(row)}</div>
        ${isOpen ? detailHtml(row) : ''}
      </article>`;
    };

    P.groupRouteCard = rowHtml;
    P.mobileCard = rowHtml;
    P.groupedHtml = rows => {
      const lanes = new Map();
      for (const row of rows) {
        const lane = laneOf(row);
        if (!lanes.has(lane)) lanes.set(lane, []);
        lanes.get(lane).push(row);
      }
      return ['FD', 'LH'].filter(lane => lanes.has(lane)).map(lane => {
        const items = lanes.get(lane);
        const groups = new Map();
        for (const row of items) {
          const dest = destination(row);
          if (!groups.has(dest)) groups.set(dest, []);
          groups.get(dest).push(row);
        }
        const extra = items.filter(row => Number(row.lineMode) === 2).length;
        const groupHtml = [...groups.entries()].sort((a,b) => a[0].localeCompare(b[0], 'th')).map(([name, groupRows]) => `
          <section class='proof-v15-branch'>
            <header><div><strong>${P.esc(name)}</strong><span>${lane}</span></div><b>${P.nf.format(groupRows.length)} เที่ยว</b></header>
            <div class='proof-v15-columns'><b>เส้นทาง</b><b>บาร์รถ</b><b>เวลา</b><b>คนขับและเบอร์โทร</b><b>บริษัทซัพและรถ</b><b>สถานะและจัดการ</b></div>
            ${groupRows.map(rowHtml).join('')}
          </section>`).join('');
        return `<section class='proof-v15-lane' data-proof-lane='${lane}'><div class='proof-v15-lane-head'><div><strong>${lane}</strong><span>${lane === 'LH' ? 'รถส่งต่อ HUB' : 'รถส่งสาขาและรถเสริม'}</span></div><div class='proof-v15-lane-count'><b>${P.nf.format(items.length)} เที่ยว</b>${extra ? `<span>รถเสริม ${P.nf.format(extra)} เที่ยว</span>` : ''}</div></div>${groupHtml}</section>`;
      }).join('');
    };

    P.tableRow = row => `<tr><td><strong>${P.esc(text(row.lineName, 'ไม่ระบุเส้นทาง'))}</strong></td><td><strong>${P.esc(barcode(row))}</strong></td><td><strong>ปล่อย ${P.esc(releaseText(row))}</strong><small>Standby ${P.esc(standbyText(row))}</small></td><td><strong>${P.esc(driver(row))}</strong><small>${P.esc(phone(row))}</small></td><td><strong>${P.esc(supplier(row))}</strong><small>${P.esc(plateNumber(row))} ${P.esc(vehicleType(row))}</small></td><td><strong>${P.esc(stateText(row))}</strong></td><td>${actionPair(row)}</td></tr>`;

    const loadDetail = async row => {
      const key = keyOf(row);
      const cached = detailCache.get(key);
      if (cached && Date.now() - cached.at < DETAIL_TTL) return cached.data;
      if (!P.state.auth) return null;
      const data = await P.apiGet('/api/proof/editor', {
        token:P.state.auth.token,
        branch:P.state.branch,
        lineId:row.lineId,
        departureDate:row.departureDate,
      });
      detailCache.set(key, { at:Date.now(), data });
      row._proofDetailV15 = data;
      if (data?.fleetName) row.fleetName = data.fleetName;
      if (data?.fleetId) row.fleetId = data.fleetId;
      return data;
    };

    document.addEventListener('click', async event => {
      const toggle = event.target.closest('[data-proof-v15-expand]');
      if (!toggle) return;
      event.preventDefault();
      event.stopPropagation();
      const key = toggle.dataset.proofV15Expand;
      const row = (P.state.rows || []).find(item => keyOf(item) === key);
      if (!row) return;
      if (expanded.has(key)) { expanded.delete(key); P.render(); return; }
      expanded.clear();
      expanded.add(key);
      P.render();
      try { await loadDetail(row); }
      catch (error) { console.warn('proof detail', error?.message || error); }
      if (expanded.has(key)) P.render();
    }, true);

    const normalizeVisibleText = value => {
      const raw = String(value ?? '');
      if (raw.trim() === '—') return 'ยังไม่ระบุ';
      return raw
        .replace(/\s*•\s*/g, ' ')
        .replace(/\s*—\s*/g, ' ')
        .replace(/\s*→\s*/g, ' ถึง ')
        .replace(/\s{2,}/g, ' ');
    };

    const polishTextNodes = root => {
      if (!root) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        if (node.parentElement?.closest('script,style')) continue;
        const next = normalizeVisibleText(node.nodeValue);
        if (next !== node.nodeValue) node.nodeValue = next;
      }
    };

    const polishEditor = () => {
      const dialog = document.getElementById('proof-editor-dialog');
      if (!dialog?.open) return;
      dialog.classList.add('proof-v15-editor');
      const title = dialog.querySelector('.proof-editor-head h2');
      if (title) title.textContent = 'ตรวจข้อมูลก่อนปริ้นบาร์รถ';
      const sub = dialog.querySelector('.proof-editor-head small');
      if (sub) sub.textContent = 'ตรวจเที่ยวรถก่อนยืนยัน';
      const route = document.getElementById('proof-editor-route');
      if (route && route.textContent.trim() === '—') route.textContent = 'ไม่ระบุเส้นทาง';
      const plan = document.getElementById('proof-editor-plan');
      if (plan) plan.textContent = normalizeVisibleText(plan.textContent).replace(/^Standby\s*/i, 'Standby ');

      const plateHead = document.querySelector('#proof-editor-plate-box .proof-editor-section-head b');
      if (plateHead) plateHead.textContent = 'ทะเบียนรถ';
      const driverHead = document.querySelector('#proof-editor-driver-box .proof-editor-section-head b');
      if (driverHead) driverHead.textContent = 'คนขับและเบอร์โทร';
      dialog.querySelectorAll('.proof-editable-tag').forEach(el => { el.textContent = 'แก้ไขได้'; });
      dialog.querySelectorAll('.proof-locked-tag').forEach(el => { el.textContent = 'แก้ไขไม่ได้'; });
      dialog.querySelectorAll('.proof-lock-reason').forEach(el => {
        el.textContent = normalizeVisibleText(el.textContent).replace(/^MS\s*/i, '');
      });

      const context = document.getElementById('proof-editor-context-v12');
      if (context) {
        const cells = [...context.children];
        if (cells[0]) {
          const span = cells[0].querySelector('span');
          if (span?.textContent.trim().startsWith('Fleet ')) span.textContent = `รหัสซัพ ${span.textContent.trim().slice(6)}`;
        }
        if (cells[1]) cells[1].querySelector('small') && (cells[1].querySelector('small').textContent = 'คนขับและเบอร์โทร');
        if (cells[2]) {
          cells[2].querySelector('small') && (cells[2].querySelector('small').textContent = 'ทะเบียนรถ');
          const strong = cells[2].querySelector('strong');
          if (strong) strong.textContent = normalizeVisibleText(cleanPlate(strong.textContent));
        }
      }

      const confirm = document.getElementById('proof-editor-confirm');
      if (confirm) confirm.textContent = Number(P.editorState?.detail?.proofState) === 1 ? 'ยืนยัน เปิดบาร์และปริ้น' : 'ยืนยันและปริ้น';
      const check = dialog.querySelector('.proof-confirm-check span');
      if (check) check.textContent = 'ตรวจข้อมูลถูกต้องแล้ว';

      dialog.querySelectorAll('.proof-option-hint').forEach(el => {
        let value = normalizeVisibleText(el.textContent);
        if (/^พบ\s+\d+\s+รายการ/.test(value)) value = value.replace(/ผลตรงที่สุดอยู่ด้านบน.*/,'เลือกข้อมูลที่ต้องการด้านล่าง');
        if (value.includes('พร้อมค้นหา')) value = 'พิมพ์ข้อมูลแล้วกด Enter หรือกดค้นหา';
        if (value.includes('ไม่พบข้อมูลใน MS')) value = 'ไม่พบรายการ ลองค้นหาโดยไม่ใส่ขีดหรือเว้นวรรค';
        el.textContent = value;
      });

      dialog.querySelectorAll('[data-editor-plate]').forEach(button => {
        const strong = button.querySelector('strong');
        const small = button.querySelector('small');
        if (strong) strong.textContent = cleanPlate(strong.textContent) || 'ไม่ระบุทะเบียน';
        if (small && small.textContent.trim()) small.textContent = `ประเภทรถ ${normalizeVisibleText(small.textContent)}`;
      });
      dialog.querySelectorAll('[data-editor-driver]').forEach(button => {
        const small = button.querySelector('small');
        if (!small) return;
        const raw = normalizeVisibleText(small.textContent).trim();
        if (raw && !raw.startsWith('เบอร์โทร')) small.textContent = `เบอร์โทร ${raw}`;
      });
      polishTextNodes(dialog);
    };

    const baseOpenEditor = P.openEditor;
    P.openEditor = (row, detail) => {
      detailCache.set(keyOf(row), { at:Date.now(), data:detail });
      row._proofDetailV15 = detail;
      if (detail?.fleetName) row.fleetName = detail.fleetName;
      if (detail?.fleetId) row.fleetId = detail.fleetId;
      baseOpenEditor(row, detail);
      setTimeout(polishEditor, 0);
    };

    const baseRender = P.render;
    P.render = (...args) => {
      const result = baseRender(...args);
      queueMicrotask(() => polishTextNodes(document.querySelector('.proof-page')));
      return result;
    };

    // PROOF_EDITOR_EVENT_POLISH_V15: polish only when search results are rendered; no continuous DOM observer.
    const baseRenderEditorSearchItems = P.renderEditorSearchItems;
    if (typeof baseRenderEditorSearchItems === 'function') {
      P.renderEditorSearchItems = (...args) => {
        const result = baseRenderEditorSearchItems(...args);
        queueMicrotask(polishEditor);
        return result;
      };
    }

    const style = document.createElement('style');
    style.id = 'proof-v15-style';
    style.textContent = `
      .proof-v15-lane{border:1px solid #ccd4da;border-radius:14px;overflow:hidden;background:#fff;margin-bottom:16px;box-shadow:0 3px 12px rgba(15,28,38,.06)}
      .proof-v15-lane-head{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 16px;background:#edf1f4;border-bottom:1px solid #ccd4da}
      .proof-v15-lane[data-proof-lane='FD'] .proof-v15-lane-head{box-shadow:inset 5px 0 0 #f0c900}.proof-v15-lane[data-proof-lane='LH'] .proof-v15-lane-head{box-shadow:inset 5px 0 0 #334b5f}
      .proof-v15-lane-head>div:first-child{display:flex;align-items:center;gap:10px}.proof-v15-lane-head strong{font-size:22px;color:#12202b}.proof-v15-lane-head span{font-size:12px;color:#52616d;font-weight:700}
      .proof-v15-lane-count{display:flex;gap:8px;align-items:center}.proof-v15-lane-count b,.proof-v15-lane-count span{display:inline-flex;padding:5px 9px;border-radius:999px;background:#fff;border:1px solid #cbd4da;color:#263746;font-size:12px;white-space:nowrap}
      .proof-v15-branch{border-top:8px solid #f4f6f7}.proof-v15-branch>header{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 14px;background:#263746;color:#fff}.proof-v15-branch>header>div{display:flex;align-items:center;gap:9px;min-width:0}.proof-v15-branch>header strong{font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.proof-v15-branch>header span{display:inline-flex;padding:3px 7px;border-radius:999px;background:#fff;color:#263746;font-size:10px;font-weight:900}.proof-v15-branch>header b{font-size:12px;white-space:nowrap}
      .proof-v15-columns,.proof-v15-row{display:grid;grid-template-columns:minmax(280px,1.55fr) minmax(130px,.7fr) minmax(145px,.78fr) minmax(185px,.95fr) minmax(225px,1.15fr) minmax(260px,1.2fr);width:100%;box-sizing:border-box}
      .proof-v15-columns{background:#e8edf1;border-bottom:1px solid #ccd4da}.proof-v15-columns b{padding:9px 11px;border-right:1px solid #d1d8de;color:#314351;font-size:11.5px;white-space:nowrap;text-align:left}
      .proof-v15-row{border-bottom:1px solid #dce3e8;box-shadow:inset 3px 0 0 #d1a600}.proof-v15-row.is-ready{box-shadow:inset 3px 0 0 #458166}.proof-v15-row.is-missed{box-shadow:inset 3px 0 0 #b83c34}
      .proof-v15-route,.proof-v15-cell,.proof-v15-status{min-width:0;padding:11px;border:0;border-right:1px solid #e0e6ea;background:#fff;box-sizing:border-box;text-align:left;font:inherit;color:inherit}.proof-v15-route{cursor:pointer}.proof-v15-route:hover{background:#f7f9fa}
      .proof-v15-row small{display:block;color:#566571!important;font-size:10.5px!important;font-weight:800}.proof-v15-row strong{display:block;color:#101921!important;font-size:13.5px!important;line-height:1.35;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.proof-v15-row span{font-size:11.5px;color:#3f4f5a;line-height:1.35}
      .proof-v15-route>strong{font-size:14.5px!important}.proof-v15-tags{display:flex;gap:5px;align-items:center;margin-top:6px;overflow:hidden}.proof-v15-tags span{display:inline-flex!important;flex:0 0 auto;padding:2px 6px;border-radius:999px;background:#eef2f5;border:1px solid #d3dbe1;font-size:9.5px!important;font-weight:900;color:#314554}
      .proof-v15-cell.barcode strong{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.proof-v15-cell.time strong,.proof-v15-cell.time span,.proof-v15-cell.driver strong,.proof-v15-cell.driver span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
      .proof-v15-vehicle{display:flex;gap:5px;align-items:center;margin-top:5px;min-width:0;overflow:hidden}.proof-v15-vehicle span{display:inline-flex!important;min-width:0;max-width:100%;padding:2px 6px;background:#f3f5f6;border-radius:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .proof-v15-status{display:grid;grid-template-columns:minmax(88px,.72fr) minmax(0,1.6fr);gap:8px;align-items:center}.proof-v15-status>div:first-child{min-width:0}.proof-v15-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;width:100%}.proof-v15-actions .btn{width:100%!important;min-width:0!important;height:42px!important;min-height:42px!important;padding:6px 7px!important;font-size:10.8px!important;font-weight:900!important;line-height:1!important;display:flex!important;align-items:center!important;justify-content:center!important;white-space:nowrap!important;text-align:center!important}
      .proof-v15-detail-loading,.proof-v15-detail-grid{grid-column:1/-1!important;border-top:1px solid #cbd5dc;background:#f7f9fa}.proof-v15-detail-loading{padding:13px 15px;font-size:13px;font-weight:800;color:#43515d}.proof-v15-detail-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))}.proof-v15-detail-grid>div{padding:11px 13px;border-right:1px solid #dbe2e7;min-width:0}.proof-v15-detail-grid>div:last-child{border-right:0}.proof-v15-detail-grid small{display:block;font-size:10px;color:#596874}.proof-v15-detail-grid strong,.proof-v15-detail-grid span{display:block;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .proof-v15-editor{width:min(1060px,calc(100vw - 28px))!important;max-width:1060px!important;max-height:calc(100dvh - 24px)!important;margin:auto!important;border-radius:16px!important;overflow:hidden!important}
      .proof-v15-editor .proof-editor-card{max-height:calc(100dvh - 24px)!important;overflow-y:auto!important;overflow-x:hidden!important;padding:16px!important;display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;gap:12px 14px!important;background:#fff!important}
      .proof-v15-editor .proof-editor-head,.proof-v15-editor .proof-editor-route-box,.proof-v15-editor #proof-editor-context-v12,.proof-v15-editor .proof-confirm-check,.proof-v15-editor .proof-editor-working,.proof-v15-editor .proof-editor-actions{grid-column:1/-1!important}
      .proof-v15-editor .proof-editor-head{text-align:center!important;align-items:center!important}.proof-v15-editor .proof-editor-head>div{flex:1}.proof-v15-editor .proof-editor-head h2{font-size:24px!important;margin:2px 0!important}.proof-v15-editor .proof-editor-head small{font-size:11px!important}
      .proof-v15-editor .proof-editor-route-box{margin:0!important;padding:12px 14px!important;background:#f7f9fa!important;color:#111b24!important;border:1px solid #cbd5dc!important;border-radius:12px!important;text-align:center!important}.proof-v15-editor .proof-editor-route-box strong{font-size:19px!important}.proof-v15-editor .proof-editor-meta{justify-content:center!important;color:#42505c!important}.proof-v15-editor .proof-editor-meta b{color:#111b24!important}
      .proof-v15-editor #proof-editor-context-v12{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;border:1px solid #cbd5dc!important;border-radius:12px!important;overflow:hidden!important;background:#fff!important}.proof-v15-editor #proof-editor-context-v12>div{padding:10px 12px!important;border-right:1px solid #dce3e8!important;text-align:center!important;min-width:0}.proof-v15-editor #proof-editor-context-v12>div:last-child{border-right:0!important}.proof-v15-editor #proof-editor-context-v12 strong,.proof-v15-editor #proof-editor-context-v12 span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .proof-v15-editor .proof-editor-section{margin:0!important;border:1px solid #cbd5dc!important;border-radius:12px!important;overflow:hidden!important;background:#fff!important}.proof-v15-editor #proof-editor-plate-box{box-shadow:inset 0 4px 0 #e6c300}.proof-v15-editor #proof-editor-driver-box{box-shadow:inset 0 4px 0 #55758c}
      .proof-v15-editor .proof-editor-section-head{padding:11px 12px!important;text-align:center!important;align-items:center!important}.proof-v15-editor .proof-editor-section-head>div:first-child{flex:1}.proof-v15-editor .proof-editor-section-head b{font-size:15px!important}.proof-v15-editor .proof-selected-value{padding:10px 12px!important;text-align:center!important;justify-content:center!important}.proof-v15-editor .proof-selected-value>span,.proof-v15-editor .proof-option>span{display:none!important}.proof-v15-editor .proof-selected-value>div{min-width:0}.proof-v15-editor .proof-selected-value strong,.proof-v15-editor .proof-selected-value em{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .proof-v15-editor .proof-search-wrap{padding:0 12px 12px!important}.proof-v15-editor .proof-search-wrap input{min-height:48px!important;font-size:15px!important}.proof-v15-editor .proof-search-wrap button{min-height:48px!important;font-weight:900!important}
      .proof-v15-editor .proof-option-list{min-height:175px!important;max-height:270px!important;overflow-y:auto!important;padding:7px!important;margin-top:8px!important;background:#f5f7f8!important;border:1px solid #dbe2e7!important;border-radius:10px!important;display:grid!important;grid-auto-rows:min-content!important;gap:7px!important}
      .proof-v15-editor .proof-option{min-height:58px!important;padding:10px 12px!important;border:1px solid #d5dde2!important;border-radius:10px!important;background:#fff!important;box-shadow:0 1px 2px rgba(15,28,38,.04)!important}.proof-v15-editor .proof-option:hover,.proof-v15-editor .proof-option.selected{background:#fff9d9!important;border-color:#d4b300!important}.proof-v15-editor .proof-option>div{width:100%!important;min-width:0!important}.proof-v15-editor .proof-option strong{font-size:14px!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.proof-v15-editor .proof-option small{font-size:11px!important;color:#52616d!important;margin-top:4px!important;white-space:normal!important}
      .proof-v15-editor .proof-option-hint{min-height:38px!important;display:flex!important;align-items:center!important;justify-content:center!important;text-align:center!important;background:#fff!important;border-radius:8px!important;color:#53626e!important;font-size:11.5px!important;padding:8px!important}.proof-v15-editor .proof-confirm-check{margin:0!important;padding:9px 11px!important;background:#fff9dd!important;border-color:#e2c84f!important}.proof-v15-editor .proof-editor-actions{position:sticky!important;bottom:-16px!important;z-index:5!important;margin:0 -16px -16px!important;padding:10px 16px 14px!important;background:#fff!important;border-top:1px solid #dce3e8!important}.proof-v15-editor .proof-editor-actions .btn{min-width:190px!important;height:46px!important;white-space:nowrap!important}.proof-v15-editor .proof-editor-warning{display:none!important}
      @media(max-width:1320px){.proof-v15-columns{display:none!important}.proof-v15-row{grid-template-columns:repeat(3,minmax(0,1fr))}.proof-v15-status{grid-column:3!important}.proof-v15-detail-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.proof-v15-route,.proof-v15-cell,.proof-v15-status{border-bottom:1px solid #e1e6ea}}
      @media(max-width:760px){.proof-v15-lane-head{align-items:flex-start}.proof-v15-lane-head>div:first-child{display:block}.proof-v15-lane-count{display:grid;justify-items:end}.proof-v15-branch>header{align-items:flex-start}.proof-v15-branch>header>div{display:block}.proof-v15-branch>header span{margin-top:4px}.proof-v15-row{grid-template-columns:1fr!important}.proof-v15-route,.proof-v15-cell,.proof-v15-status{grid-column:1!important;border-right:0!important;border-bottom:1px solid #e1e6ea!important}.proof-v15-status{display:block!important}.proof-v15-actions{margin-top:10px}.proof-v15-detail-grid{grid-template-columns:1fr!important}.proof-v15-detail-grid>div{border-right:0!important;border-bottom:1px solid #dbe2e7!important}.proof-v15-editor{width:calc(100vw - 12px)!important;max-height:calc(100dvh - 10px)!important}.proof-v15-editor .proof-editor-card{grid-template-columns:1fr!important;max-height:calc(100dvh - 10px)!important;padding:10px!important;gap:10px!important}.proof-v15-editor .proof-editor-head,.proof-v15-editor .proof-editor-route-box,.proof-v15-editor #proof-editor-context-v12,.proof-v15-editor .proof-confirm-check,.proof-v15-editor .proof-editor-working,.proof-v15-editor .proof-editor-actions,.proof-v15-editor .proof-editor-section{grid-column:1!important}.proof-v15-editor #proof-editor-context-v12{grid-template-columns:1fr!important}.proof-v15-editor #proof-editor-context-v12>div{border-right:0!important;border-bottom:1px solid #dce3e8!important}.proof-v15-editor #proof-editor-context-v12>div:last-child{border-bottom:0!important}.proof-v15-editor .proof-option-list{min-height:155px!important;max-height:230px!important}.proof-v15-editor .proof-editor-actions{margin:0 -10px -10px!important;padding:9px 10px 12px!important;display:grid!important;grid-template-columns:1fr 1fr!important}.proof-v15-editor .proof-editor-actions .btn{min-width:0!important;width:100%!important;font-size:12px!important}}
      @media(max-width:430px){.proof-v15-editor .proof-editor-actions{grid-template-columns:1fr!important}.proof-v15-editor .proof-editor-actions .btn{width:100%!important;max-width:100%!important;overflow:hidden!important}}
    `;
    document.getElementById('proof-v15-style')?.remove();
    document.head.appendChild(style);

    polishTextNodes(document.querySelector('.proof-page'));
    setTimeout(() => { P.render(); polishTextNodes(document.querySelector('.proof-page')); }, 0);
  };
  boot();
}
