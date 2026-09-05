from pathlib import Path
import re

ui_path = Path('worker/src/proof-ui-v10.js')
ui = ui_path.read_text()

# 1) Browser runtime helper must stay scoped per generated asset.
ui = ui.replace("return new Response(`const __name=(target,value)=>target;(${proofCommandCenterV10.toString()})();`, {", "return new Response(`(()=>{const __name=(target,value)=>target;(${proofCommandCenterV10.toString()})();})();`, {")

v5_path = Path('worker/src/proof-ui-v5.js')
v5 = v5_path.read_text()
v5 = v5.replace("return new Response(`const __name=(target,value)=>target;(${proofV6Runtime.toString()})();`, {", "return new Response(`(()=>{const __name=(target,value)=>target;(${proofV6Runtime.toString()})();})();`, {")
v5_path.write_text(v5)

anchor = "    P.barcodeStatusText = barcodeStatus;\n"
insert = r'''    P.barcodeStatusText = barcodeStatus;

    // PROOF_OPS_CONTROL_V11: all insight is derived locally from the already-loaded Proof rows.
    const originalDestinationKey = P.destinationKey;
    const originalDestinationLabel = P.destinationLabel;
    const routeDestinationLabel = row => originalDestinationLabel(row);
    const stateLabel = row => String(P.stateText(row) || row?.proofStateText || '').trim();
    const isLH = row => {
      const raw = [row?.routeTypeText, row?.lineTypeText, row?.routeType, row?.lineType, row?.lineCategory, row?.lineName]
        .filter(value => value !== null && value !== undefined && value !== '')
        .join(' ').toUpperCase();
      return /(^|[\s_\-])LH([\s_\-]|$)|LINE\s*HAUL|LINEHAUL/.test(raw);
    };
    const laneScope = row => isLH(row) ? 'LH' : 'FD';
    const departedVehicle = row => {
      const text = stateLabel(row);
      if (/^รอ/.test(text)) return false;
      return /(ออกจากต้นทางแล้ว|ออกเดินทางแล้ว|ปล่อยรถแล้ว|DEPARTED|RELEASED)/i.test(text);
    };
    const arrivedVehicle = row => Number(row?.proofState) === 7 || /(ถึงสาขาต้นทางแล้ว|ถึงต้นทางแล้ว|ARRIVED\s*(?:AT\s*)?ORIGIN)/i.test(stateLabel(row));
    const extraVehicle = row => Number(row?.lineMode) === 2;
    const notArrivedVehicle = row => !arrivedVehicle(row) && !departedVehicle(row);
    const remainingVehicle = row => !departedVehicle(row);
    const urgencyRank = row => {
      if (missedVehicle(row)) return 0;
      if (!barcodeEnabled(row)) return 1;
      if (extraVehicle(row) && !departedVehicle(row)) return 2;
      if (notArrivedVehicle(row)) return 3;
      if (arrivedVehicle(row) && !departedVehicle(row)) return 4;
      return 5;
    };
    const nextActionText = row => {
      if (missedVehicle(row)) return 'รถไม่เข้า • เลยเวลาปล่อย';
      if (!barcodeEnabled(row)) return 'ยังไม่ปริ้นบาร์';
      if (departedVehicle(row)) return 'ออกจากต้นทางแล้ว';
      if (arrivedVehicle(row)) return 'ถึงต้นทางแล้ว';
      if (extraVehicle(row)) return 'รถเสริม • บาร์พร้อม';
      return 'บาร์พร้อม • รอรถถึงต้นทาง';
    };
    P.proofLaneScope = laneScope;
    P.proofDepartedVehicle = departedVehicle;
    P.proofArrivedVehicle = arrivedVehicle;
    P.proofRemainingVehicle = remainingVehicle;
    P.destinationKey = row => `proof-lane:${laneScope(row)}`;
    P.destinationLabel = row => laneScope(row) === 'LH' ? 'LH • HUB TO HUB' : 'FD • Feeder / รถเสริม / อื่น ๆ';
    P.state.proofLaneScopeV11 = P.state.proofLaneScopeV11 || 'all';
'''
if anchor not in ui:
    raise SystemExit('barcode anchor missing')
ui = ui.replace(anchor, insert, 1)

# 2) Filtering: keep all old filters, add FD/LH local scope and smart operational ordering.
pattern = re.compile(r"    const baseFilteredRows = P\.filteredRows;\n    P\.filteredRows = \(\) => \{.*?\n    \};\n\n    const commandCount", re.S)
replacement = r'''    const baseFilteredRows = P.filteredRows;
    P.filteredRows = () => {
      const filter = String(P.state.stateFilter || 'all');
      P.state.stateFilter = 'all';
      let rows;
      try { rows = baseFilteredRows(); } finally { P.state.stateFilter = filter; }
      if (filter === 'missed') rows = rows.filter(row => missedVehicle(row));
      else if (filter === 'barcode-enabled') rows = rows.filter(row => barcodeEnabled(row));
      else if (filter === '1') rows = rows.filter(row => pendingVehicle(row));
      else if (filter !== 'all') {
        P.state.stateFilter = filter;
        try { rows = baseFilteredRows(); } finally { P.state.stateFilter = filter; }
      }
      const scope = String(P.state.proofLaneScopeV11 || 'all').toUpperCase();
      if (scope === 'FD' || scope === 'LH') rows = rows.filter(row => laneScope(row) === scope);
      return [...rows].sort((a, b) => {
        const lane = (laneScope(a) === 'FD' ? 0 : 1) - (laneScope(b) === 'FD' ? 0 : 1);
        if (lane) return lane;
        const urgent = urgencyRank(a) - urgencyRank(b);
        if (urgent) return urgent;
        const ar = releaseTimestamp(a), br = releaseTimestamp(b);
        if (Number.isFinite(ar) && Number.isFinite(br) && ar !== br) return ar - br;
        return String(a?.lineName || '').localeCompare(String(b?.lineName || ''), 'th');
      });
    };

    const commandCount'''
ui, n = pattern.subn(replacement, ui, count=1)
if n != 1:
    raise SystemExit('filteredRows block missing')

# 3) Operational KPI renderer.
pattern = re.compile(r"    const renderCommandCounts = \(\) => \{.*?\n    \};\n    const baseRenderMetrics", re.S)
replacement = r'''    const renderCommandCounts = () => {
      const rows = P.state.rows || [];
      const remaining = rows.filter(remainingVehicle).length;
      const unprinted = rows.filter(row => !barcodeEnabled(row) && !missedVehicle(row)).length;
      const printed = rows.filter(barcodeEnabled).length;
      const arrived = rows.filter(arrivedVehicle).length;
      const departed = rows.filter(departedVehicle).length;
      const notArrived = rows.filter(notArrivedVehicle).length;
      const extra = rows.filter(extraVehicle).length;
      const missed = rows.filter(missedVehicle).length;
      const fd = rows.filter(row => laneScope(row) === 'FD').length;
      const lh = rows.filter(row => laneScope(row) === 'LH').length;
      commandCount('all', rows.length);
      commandCount('remaining', remaining);
      commandCount('unprinted', unprinted);
      commandCount('printed', printed);
      commandCount('arrived', arrived);
      commandCount('departed', departed);
      commandCount('not-arrived', notArrived);
      commandCount('extra', extra);
      commandCount('missed', missed);
      commandCount('fd', fd);
      commandCount('lh', lh);
      const center = document.getElementById('proof-command-center-v10');
      if (center) {
        const total = Math.max(1, rows.length);
        center.style.setProperty('--proof-print-progress', `${Math.round(printed * 100 / total)}%`);
        center.style.setProperty('--proof-depart-progress', `${Math.round(departed * 100 / total)}%`);
        const progress = document.getElementById('proof-flow-progress-v11');
        if (progress) progress.textContent = `บาร์พร้อม ${P.nf.format(printed)}/${P.nf.format(rows.length)} • ออกแล้ว ${P.nf.format(departed)}/${P.nf.format(rows.length)}`;
      }
      document.querySelectorAll('[data-proof-v11-lane]').forEach(button => button.classList.toggle('is-active', button.dataset.proofV11Lane === String(P.state.proofLaneScopeV11 || 'all')));
      document.querySelectorAll('[data-proof-v10-filter]').forEach(button => {
        const f = button.dataset.proofV10Filter;
        const expected = f === 'unprinted' ? '1' : f === 'printed' ? 'barcode-enabled' : f;
        button.classList.toggle('is-active', String(P.state.stateFilter) === expected);
      });
    };
    const baseRenderMetrics'''
ui, n = pattern.subn(replacement, ui, count=1)
if n != 1:
    raise SystemExit('renderCommandCounts block missing')

# 4) Replace dense card with compact operational row + expandable detail.
pattern = re.compile(r"    const card = row => \{.*?\n    \};\n    P\.groupRouteCard = card;", re.S)
replacement = r'''    const card = row => {
      const missed = missedVehicle(row), enabled = barcodeEnabled(row), departed = departedVehicle(row), arrived = arrivedVehicle(row);
      const plate = [row.plateNumber, row.plateTypeText].filter(Boolean).join(' • ') || 'ยังไม่กำหนดทะเบียน';
      const release = P.minuteText(row.plannedDepartureTime ?? row.startTime);
      const standby = row.detailReady && Number.isFinite(Number(row.standbyTime)) ? P.minuteText(row.standbyTime) : '—';
      const destination = routeDestinationLabel(row) || '—';
      const cls = missed ? 'is-missed' : !enabled ? 'is-pending' : departed ? 'is-departed' : arrived ? 'is-arrived' : 'is-enabled';
      return `<article class='proof-ops-card proof-ops-card-v11 ${cls}'>
        <div class='proof-v11-row'>
          <div class='proof-v11-route'><small>${P.esc(destination)}</small><strong>${P.esc(row.lineName || '—')}</strong><span>${P.esc(plate)}</span></div>
          <div class='proof-v11-signal'><small>สถานะตอนนี้</small><strong>${P.esc(nextActionText(row))}</strong><span>${P.stateBadge(row)}</span></div>
          <div class='proof-v11-time'><small>เวลา</small><strong>Standby ${P.esc(standby)} → ปล่อย ${P.esc(release)}</strong><span>${P.standbyBadge(row)}</span></div>
          <div class='proof-v11-barcode'><small>บาร์รถ</small><strong>${P.esc(row.proofId || 'ยังไม่มี')}</strong><span>${enabled ? 'ปริ้น/เปิดใช้แล้ว' : 'ต้องตรวจและเปิดบาร์'}</span></div>
          <div class='proof-v11-actions'><button class='btn btn-header' type='button' data-proof-v11-detail='${P.escAttr(P.rowKey(row))}'>รายละเอียด</button>${P.actionButtons(row)}</div>
        </div>
        <div class='proof-v11-detail hidden' data-proof-v11-detail-panel='${P.escAttr(P.rowKey(row))}'>
          <div><small>กลุ่ม</small><strong>${P.esc(laneScope(row))}</strong><span>${extraVehicle(row) ? 'รถเสริม' : 'รถปกติ'}</span></div>
          <div><small>ปลายทาง</small><strong>${P.esc(destination)}</strong><span>${P.routeBadges(row)}</span></div>
          <div><small>คนขับ</small><strong>${P.esc(row.driver || 'ยังไม่กำหนด')}</strong><span>${P.esc(row.driverPhone || 'ไม่มีเบอร์โทร')}</span></div>
          <div><small>ทะเบียน</small><strong>${P.esc(plate)}</strong><span>${P.esc(barcodeStatus(row))}</span></div>
        </div>
      </article>`;
    };
    P.groupRouteCard = card;'''
ui, n = pattern.subn(replacement, ui, count=1)
if n != 1:
    raise SystemExit('card block missing')

# 5) Replace dashboard HTML with operational overview.
old = """        <div class='proof-command-head'><div><small>PROOF COMMAND CENTER</small><strong>จัดการบาร์รถแบบเห็นสถานะจริงในจุดเดียว</strong></div><button id='proof-history-open-v10' class='btn btn-header' type='button'>ประวัติบาร์รถ</button></div>
        <div class='proof-command-grid'>
          <button type='button' data-proof-v10-filter='all'><span>ทั้งหมด</span><strong data-proof-v10-count='all'>0</strong></button>
          <button type='button' data-proof-v10-filter='pending'><span>รอเปิดบาร์</span><strong data-proof-v10-count='pending'>0</strong></button>
          <button type='button' data-proof-v10-filter='missed' class='danger'><span>รถไม่เข้า</span><strong data-proof-v10-count='missed'>0</strong></button>
          <button type='button' data-proof-v10-filter='enabled' class='success'><span>เปิดใช้บาร์แล้ว</span><strong data-proof-v10-count='enabled'>0</strong></button>
          <button type='button' data-proof-v10-filter='7'><span>ถึงต้นทาง</span><strong data-proof-v10-count='arrived'>0</strong></button>
        </div>"""
new = """        <div class='proof-command-head'><div><small>ศูนย์ควบคุมเที่ยวรถ</small><strong>ดูแล้วรู้ทันทีว่าเหลืออะไร ต้องทำอะไร และรถอยู่ขั้นตอนไหน</strong><span>คำนวณจากข้อมูล Proof ที่โหลดอยู่แล้ว • ไม่เพิ่ม polling หรือ background API</span></div><button id='proof-history-open-v10' class='btn btn-header' type='button'>ประวัติบาร์รถ</button></div>
        <div class='proof-v11-lanes'><button type='button' data-proof-v11-lane='all' class='is-active'>ทั้งหมด <b data-proof-v10-count='all'>0</b></button><button type='button' data-proof-v11-lane='FD'>FD <b data-proof-v10-count='fd'>0</b></button><button type='button' data-proof-v11-lane='LH'>LH <b data-proof-v10-count='lh'>0</b></button></div>
        <div class='proof-command-grid proof-command-grid-v11'>
          <button type='button' data-proof-v10-filter='all' class='primary'><span>รถคงเหลือ</span><strong data-proof-v10-count='remaining'>0</strong><small>ยังไม่ออกจากต้นทาง</small></button>
          <button type='button' data-proof-v10-filter='unprinted' class='attention'><span>ยังไม่ปริ้นบาร์</span><strong data-proof-v10-count='unprinted'>0</strong><small>ต้องตรวจ/เปิดบาร์</small></button>
          <button type='button' data-proof-v10-filter='printed' class='success'><span>ปริ้น/เปิดบาร์แล้ว</span><strong data-proof-v10-count='printed'>0</strong><small>บาร์พร้อมใช้งาน</small></button>
          <button type='button' data-proof-v10-filter='7'><span>ถึงต้นทาง</span><strong data-proof-v10-count='arrived'>0</strong><small>รถมาถึงแล้ว</small></button>
          <button type='button' data-proof-v10-filter='all'><span>ออกแล้ว</span><strong data-proof-v10-count='departed'>0</strong><small>ออกจากต้นทางแล้ว</small></button>
          <button type='button' data-proof-v10-filter='all' class='extra'><span>รถเสริม</span><strong data-proof-v10-count='extra'>0</strong><small>lineMode รถเสริม</small></button>
        </div>
        <div class='proof-v11-watch'><div><span>ยังไม่ถึงต้นทาง</span><strong data-proof-v10-count='not-arrived'>0</strong></div><div class='danger'><span>รถไม่เข้า</span><strong data-proof-v10-count='missed'>0</strong></div><div class='proof-v11-progress-wrap'><div class='proof-v11-progress'><i></i><em></em></div><small id='proof-flow-progress-v11'>กำลังสรุปสถานะ</small></div></div>"""
if old not in ui:
    raise SystemExit('command center html anchor missing')
ui = ui.replace(old, new, 1)

# 6) Remove distracting alert panel entirely and wire lane/detail interactions.
anchor = "      const stateFilter = P.el('state-filter');\n"
insert = "      const legacyAlertPanel = document.getElementById('alert-panel'); if (legacyAlertPanel) legacyAlertPanel.remove(); // PROOF_ALERT_HEADER_REMOVED_V11\n      const stateFilter = P.el('state-filter');\n"
if anchor not in ui:
    raise SystemExit('install stateFilter anchor missing')
ui = ui.replace(anchor, insert, 1)

old = "      document.querySelectorAll('[data-proof-v10-filter]').forEach(button => button.onclick = () => { const f = button.dataset.proofV10Filter; const value = f === 'pending' ? '1' : f === 'enabled' ? 'barcode-enabled' : f; P.state.stateFilter = value; if (stateFilter) stateFilter.value = value; P.render(); });\n"
new = "      document.querySelectorAll('[data-proof-v10-filter]').forEach(button => button.onclick = () => { const f = button.dataset.proofV10Filter; const value = f === 'unprinted' ? '1' : f === 'printed' ? 'barcode-enabled' : f; P.state.stateFilter = value; if (stateFilter) stateFilter.value = value; P.render(); });\n      document.querySelectorAll('[data-proof-v11-lane]').forEach(button => button.onclick = () => { P.state.proofLaneScopeV11 = button.dataset.proofV11Lane || 'all'; P.render(); });\n"
if old not in ui:
    raise SystemExit('filter listener anchor missing')
ui = ui.replace(old, new, 1)

old = "      document.addEventListener('click', event => {\n        const pdf = event.target.closest('[data-proof-history-pdf]');"
new = "      document.addEventListener('click', event => {\n        const detail = event.target.closest('[data-proof-v11-detail]'); if (detail) { const panel = document.querySelector(`[data-proof-v11-detail-panel='${CSS.escape(detail.dataset.proofV11Detail || '')}']`); if (panel) { panel.classList.toggle('hidden'); detail.textContent = panel.classList.contains('hidden') ? 'รายละเอียด' : 'ซ่อน'; } return; }\n        const pdf = event.target.closest('[data-proof-history-pdf]');"
if old not in ui:
    raise SystemExit('document click anchor missing')
ui = ui.replace(old, new, 1)

# 7) Add a second, clean override stylesheet instead of making the existing V10 CSS riskier.
anchor = "      document.head.appendChild(style);\n"
style_block = r'''      document.head.appendChild(style);
      if (!document.getElementById('proof-v11-style')) { const v11 = document.createElement('style'); v11.id = 'proof-v11-style'; v11.textContent = `
        .proof-alert-panel{display:none!important}
        .proof-command-center-v10{padding:14px 16px!important;border-radius:16px!important;box-shadow:0 8px 24px rgba(28,39,49,.055)!important}.proof-command-head>div>span{display:block;margin-top:3px;color:#7a838b;font-size:10px}.proof-v11-lanes{display:flex;gap:6px;margin-top:12px}.proof-v11-lanes button{border:1px solid #d9dee3;background:#f7f9fa;color:#4b5660;border-radius:999px;min-height:34px;padding:5px 13px;font-size:11px;font-weight:900;cursor:pointer}.proof-v11-lanes button b{margin-left:5px;font-size:12px}.proof-v11-lanes button.is-active{background:#202a33;color:#fff;border-color:#202a33}
        .proof-command-grid-v11{grid-template-columns:repeat(6,minmax(0,1fr))!important}.proof-command-grid-v11 button{display:block!important;text-align:left;min-height:82px!important;background:#fff!important;border-color:#e1e5e8!important;padding:10px 12px!important}.proof-command-grid-v11 button:hover,.proof-command-grid-v11 button.is-active{border-color:#9ea8b1!important;background:#f9fbfc!important}.proof-command-grid-v11 button span{display:block;color:#69737c;font-size:10px!important}.proof-command-grid-v11 button strong{display:block;margin-top:2px;font-size:26px!important}.proof-command-grid-v11 button small{display:block;margin-top:3px;color:#9199a1;font-size:9px}.proof-command-grid-v11 .attention strong{color:#9a6a00!important}.proof-command-grid-v11 .success strong{color:#167447!important}.proof-command-grid-v11 .extra strong{color:#6f55a3!important}
        .proof-v11-watch{display:grid;grid-template-columns:auto auto minmax(260px,1fr);gap:8px;align-items:center;margin-top:8px}.proof-v11-watch>div:not(.proof-v11-progress-wrap){display:flex;align-items:center;gap:8px;padding:7px 10px;background:#f7f9fa;border-radius:9px;font-size:10px;color:#68727b}.proof-v11-watch>div strong{font-size:14px;color:#26313a}.proof-v11-watch .danger{background:#fff4f2!important}.proof-v11-watch .danger strong{color:#b42318!important}.proof-v11-progress-wrap{padding:4px 0}.proof-v11-progress{height:7px;position:relative;background:#e9edf0;border-radius:999px;overflow:hidden}.proof-v11-progress i,.proof-v11-progress em{position:absolute;left:0;top:0;bottom:0;border-radius:999px}.proof-v11-progress i{width:var(--proof-print-progress,0%);background:#8fc8a8}.proof-v11-progress em{width:var(--proof-depart-progress,0%);background:#3d596f;opacity:.75}.proof-v11-progress-wrap small{display:block;margin-top:4px;color:#7a848d;font-size:9px;text-align:right}
        .proof-group{margin-bottom:10px!important}.proof-group-head{min-height:48px!important;background:#f5f7f8!important}.proof-group-name strong{font-size:14px!important}.proof-group-name small{color:#7a838c!important}.proof-group-alert{display:none!important}
        .proof-ops-card-v11{box-shadow:none!important;background:#fff!important;border-top:1px solid #e8ebed!important}.proof-ops-card-v11.is-missed{box-shadow:inset 3px 0 0 #c7342d!important}.proof-ops-card-v11.is-pending{box-shadow:inset 3px 0 0 #d0a000!important}.proof-ops-card-v11.is-enabled{box-shadow:inset 3px 0 0 #82b998!important}.proof-ops-card-v11.is-arrived{box-shadow:inset 3px 0 0 #5f8fb7!important}.proof-ops-card-v11.is-departed{box-shadow:inset 3px 0 0 #7a858e!important;opacity:.88}.proof-v11-row{display:grid;grid-template-columns:minmax(260px,1.7fr) minmax(150px,1fr) minmax(180px,1fr) minmax(150px,1fr) auto;gap:0;align-items:center;min-height:76px}.proof-v11-row>div{padding:10px 12px;min-width:0}.proof-v11-row small,.proof-v11-detail small{display:block;color:#8a939b;font-size:9px;font-weight:800}.proof-v11-row strong,.proof-v11-detail strong{display:block;margin-top:2px;color:#26313a;font-size:11px;line-height:1.4;word-break:break-word}.proof-v11-row span,.proof-v11-detail span{display:block;margin-top:2px;color:#74808a;font-size:9px}.proof-v11-route>strong{font-size:13px}.proof-v11-barcode>strong{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.proof-v11-signal .proof-v10-chip{display:inline-flex;margin-top:3px}.proof-v11-time .proof-v10-time{display:inline-flex;margin-top:3px}.proof-v11-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px!important;padding-right:14px!important}.proof-v11-actions .proof-actions{margin:0}.proof-v11-actions .btn{min-height:32px!important;padding:5px 9px!important;font-size:9px!important;white-space:nowrap}.proof-v11-detail{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px dashed #e3e7ea;background:#fafbfc;padding:0 10px}.proof-v11-detail>div{padding:9px 10px}.proof-v11-detail.hidden{display:none!important}
        .proof-toolbar{grid-template-columns:repeat(6,minmax(115px,1fr))!important}.proof-toolbar .proof-search{grid-column:1/5!important}.proof-toolbar .proof-search input{background:#fff!important}.proof-view-switch{opacity:.85}
        @media(max-width:1180px){.proof-command-grid-v11{grid-template-columns:repeat(3,minmax(0,1fr))!important}.proof-v11-row{grid-template-columns:minmax(240px,1.5fr) 1fr 1fr}.proof-v11-barcode{grid-column:1/2}.proof-v11-actions{grid-column:2/4;justify-content:flex-start!important}.proof-v11-detail{grid-template-columns:1fr 1fr}.proof-v11-watch{grid-template-columns:1fr 1fr}.proof-v11-progress-wrap{grid-column:1/-1}}
        @media(max-width:720px){.proof-command-grid-v11{grid-template-columns:1fr 1fr!important}.proof-command-grid-v11 button{min-height:70px!important}.proof-v11-watch{grid-template-columns:1fr 1fr}.proof-v11-row{display:block;min-height:0}.proof-v11-row>div{padding:7px 11px}.proof-v11-route{padding-top:11px!important}.proof-v11-actions{display:flex!important;padding-bottom:11px!important}.proof-v11-detail{grid-template-columns:1fr 1fr}.proof-toolbar .proof-search{grid-column:1/-1!important}}
      `; document.head.appendChild(v11); }
'''
if anchor not in ui:
    raise SystemExit('style append anchor missing')
ui = ui.replace(anchor, style_block, 1)

ui_path.write_text(ui)

# 8) Permanent regression assertions.
test_path = Path('worker/tests/proof-command-center-v10.test.mjs')
test = test_path.read_text()
anchor = "  assert.match(ui, /proof-command-center-v10/);\n"
extra = "  assert.match(ui, /proof-command-center-v10/);\n  assert.match(ui, /PROOF_OPS_CONTROL_V11/);\n  assert.match(ui, /PROOF_ALERT_HEADER_REMOVED_V11/);\n  assert.match(ui, /proofLaneScope/);\n  assert.match(ui, /FD • Feeder \/ รถเสริม \/ อื่น ๆ/);\n  assert.match(ui, /LH • HUB TO HUB/);\n  assert.match(ui, /รถคงเหลือ/);\n  assert.match(ui, /ยังไม่ปริ้นบาร์/);\n  assert.match(ui, /ออกจากต้นทางแล้ว/);\n  assert.match(ui, /รถเสริม/);\n  assert.match(ui, /proof-v11-detail/);\n  assert.doesNotMatch(ui, /setInterval\\s*\\(/);\n"
if anchor not in test:
    raise SystemExit('test anchor missing')
test = test.replace(anchor, extra, 1)
test = test.replace("assert.match(v5, /const __name=\\(target,value\\)=>target/);", "assert.match(v5, /\\(\\(\\)=>\\{const __name=\\(target,value\\)=>target/);")
test = test.replace("assert.match(ui, /const __name=\\(target,value\\)=>target/);", "assert.match(ui, /\\(\\(\\)=>\\{const __name=\\(target,value\\)=>target/);")
test_path.write_text(test)

print('PROOF_OPS_CONTROL_V11_PATCHED=YES')
print('ALERT_HEADER_REMOVED=YES')
print('GROUPS=FD,LH')
print('NEW_BACKGROUND_API=0')
print('NEW_POLLING=0')
print('NEW_HISTORY_WRITES=0')
print('TBR_CHANGED=NO')
print('PRODUCTION_TOUCHED=NO')
