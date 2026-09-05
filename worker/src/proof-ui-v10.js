const VERSION = '20260906-01';

export async function maybeHandleProofUiV10(request) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname !== '/proof-v10.js') return null;
  return new Response(`(()=>{const __name=(target,value)=>target;(${proofCommandCenterV10.toString()})();})();`, {
    headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function proofCommandCenterV10() {
  const start = () => {
    const P = window.ProofV2;
    if (!P || typeof P.render !== 'function' || typeof P.searchEditorOptions !== 'function' || typeof P.installProofEditor !== 'function') {
      return setTimeout(start, 30);
    }
    if (window.__PROOF_V10_READY__) return;
    window.__PROOF_V10_READY__ = true; // PROOF_COMMAND_CENTER_V10

    const releaseTimestamp = row => {
      const minute = Number(row?.plannedDepartureTime ?? row?.startTime);
      if (!row?.departureDate || !Number.isFinite(minute)) return NaN;
      const base = Date.parse(`${row.departureDate}T00:00:00+07:00`);
      return Number.isFinite(base) ? base + minute * 60_000 : NaN;
    };
    const barcodeEnabled = row => Boolean(String(row?.proofId || '').trim());
    const missedVehicle = (row, now = Date.now()) => {
      if (Number(row?.proofState) !== 1 || barcodeEnabled(row)) return false;
      const release = releaseTimestamp(row);
      return Number.isFinite(release) && now >= release;
    };
    const pendingVehicle = row => Number(row?.proofState) === 1 && !missedVehicle(row);
    const barcodeStatus = row => barcodeEnabled(row) ? 'เปิดใช้บาร์รถแล้ว' : 'ยังไม่เปิดใช้บาร์รถ';
    P.releaseTimestamp = releaseTimestamp;
    P.isMissedVehicle = missedVehicle;
    P.isBarcodeEnabled = barcodeEnabled;
    P.barcodeStatusText = barcodeStatus;

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

    P.alertForRow = (row, now = Date.now()) => {
      const a = row?.acknowledgements || {};
      if (missedVehicle(row, now)) {
        const late = now - releaseTimestamp(row);
        return { key: 'missed', priority: 5, tone: 'danger', icon: '', title: `รถไม่เข้า • เลยเวลาปล่อย ${P.durationShort(late)}` };
      }
      if (Number(row?.proofState) !== 1) return null;
      const standby = P.routeStandbyMs(row);
      const release = releaseTimestamp(row);
      if (Number.isFinite(standby)) {
        const diff = standby - now;
        if (diff > 0 && diff <= P.CONFIG.standbyLeadMinutes * 60_000 && !a['standby-soon']) {
          return { key: 'standby-soon', priority: 2, tone: 'warning', icon: '', title: `ใกล้ Standby • เหลือ ${P.durationShort(diff)}` };
        }
        if (diff <= 0 && Number.isFinite(release) && release > now && !a['standby-due']) {
          return { key: 'standby-due', priority: 2, tone: 'warning', icon: '', title: `เลย Standby • เหลือ ${P.durationShort(release - now)} ก่อนเวลาปล่อย` };
        }
      }
      if (row?.firstSeenAt && !a.new) {
        return { key: 'new', priority: 1, tone: Number(row.lineMode) === 2 ? 'extra' : 'info', icon: '', title: Number(row.lineMode) === 2 ? 'รถเสริมใหม่เข้าระบบ' : 'มีเส้นทางใหม่เข้าระบบ' };
      }
      return null;
    };

    P.stateBadge = row => {
      if (missedVehicle(row)) return `<span class='proof-v10-chip proof-v10-chip-missed'>รถไม่เข้า</span>`;
      const code = Number(row?.proofState), label = P.stateText(row);
      return `<span class='proof-v10-chip proof-v10-stage s${Number.isFinite(code) ? code : ''}'>${P.esc(label)}</span>`;
    };
    P.barcodeBadge = row => barcodeEnabled(row)
      ? `<span class='proof-v10-chip proof-v10-chip-enabled'>เปิดใช้บาร์รถแล้ว</span>`
      : `<span class='proof-v10-chip proof-v10-chip-off'>ยังไม่เปิดใช้บาร์รถ</span>`;
    P.standbyBadge = row => {
      const release = releaseTimestamp(row);
      if (missedVehicle(row)) return `<span class='proof-v10-time danger'>เลยเวลาปล่อย ${P.esc(P.durationShort(Date.now() - release))}</span>`;
      if (Number(row?.proofState) !== 1) return Number.isFinite(release) ? `<span class='proof-v10-time'>ปล่อย ${P.esc(P.minuteText(row.plannedDepartureTime ?? row.startTime))}</span>` : '';
      if (!row.detailReady || !Number.isFinite(Number(row.standbyTime))) return `<span class='proof-v10-time muted'>กำลังอ่าน Standby</span>`;
      const standby = P.routeStandbyMs(row), now = Date.now();
      if (Number.isFinite(standby) && standby <= now && Number.isFinite(release) && release > now) return `<span class='proof-v10-time warning'>เลย Standby • เหลือ ${P.esc(P.durationShort(release - now))} ก่อนปล่อย</span>`;
      if (Number.isFinite(standby) && standby > now && standby - now <= P.CONFIG.standbyLeadMinutes * 60_000) return `<span class='proof-v10-time warning'>ใกล้ Standby • ${P.esc(P.durationShort(standby - now))}</span>`;
      return `<span class='proof-v10-time'>Standby ${P.esc(P.minuteText(row.standbyTime))}</span>`;
    };

    const baseFilteredRows = P.filteredRows;
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

    const commandCount = (key, value) => {
      const el = document.querySelector(`[data-proof-v10-count='${key}']`);
      if (el) el.textContent = P.nf.format(value);
    };
    const renderCommandCounts = () => {
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
    const baseRenderMetrics = P.renderMetrics;
    P.renderMetrics = () => {
      baseRenderMetrics();
      const pending = (P.state.rows || []).filter(pendingVehicle).length;
      if (P.el('metric-1')) P.el('metric-1').textContent = P.nf.format(pending);
      renderCommandCounts();
    };

    P.actionButtons = row => {
      const code = Number(row.proofState), hasBarcode = barcodeEnabled(row), missed = missedVehicle(row);
      const canPrint = Boolean(P.state.profile?.canPrint) && P.PRINTABLE_STATES.has(code);
      const canCreate = hasBarcode || code !== 1 || Boolean(P.state.profile?.canCreateProof);
      const enabled = !missed && canPrint && canCreate && Boolean(row.lineId) && Boolean(row.departureDate);
      let title = '';
      if (missed) title = 'เลยเวลาปล่อยแล้ว ระบบจัดเป็นรถไม่เข้าและไม่เปิดบาร์ใหม่จากหน้าเว็บ';
      else if (!P.state.profile?.canPrint) title = 'Session MS ยังไม่พร้อม หรือบัญชีนี้ไม่มีสิทธิ์ปริ้น';
      else if (!hasBarcode && code === 1 && !P.state.profile?.canCreateProof) title = 'บัญชี MS นี้ไม่มีสิทธิ์เปิดใช้งานบาร์โค้ด';
      else if (!P.PRINTABLE_STATES.has(code)) title = 'สถานะนี้ไม่รองรับการปริ้นจากหน้าเว็บ';
      const label = missed ? 'รถไม่เข้า • เลยเวลาปล่อย' : hasBarcode ? 'ตรวจข้อมูล + ปริ้น PDF' : 'ตรวจข้อมูล + เปิดบาร์/ปริ้น';
      return `<div class='proof-actions proof-actions-v10'><button class='btn ${missed ? 'btn-header' : 'btn-accent'}' type='button' data-proof-print='${P.escAttr(P.rowKey(row))}' ${enabled ? '' : 'disabled'} title='${P.escAttr(title)}'>${P.esc(label)}</button></div>`;
    };

    const card = row => {
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
    P.groupRouteCard = card;
    P.mobileCard = card;
    P.tableRow = row => {
      const plate = [row.plateNumber, row.plateTypeText].filter(Boolean).join(' • ') || 'ยังไม่กำหนด';
      return `<tr class='${missedVehicle(row) ? 'proof-row-missed' : ''}'><td class='proof-route'><strong>${P.esc(row.lineName || '—')}</strong><small>${P.esc(P.destinationLabel(row))} ${P.routeBadges(row)}</small></td><td class='proof-car'><strong>${P.esc(plate)}</strong></td><td class='proof-driver'><strong>${P.esc(row.driver || 'ยังไม่กำหนด')}</strong><small>${P.esc(row.driverPhone || '—')}</small></td><td><strong>${P.esc(P.standbyText(row))}</strong>${P.standbyBadge(row)}</td><td><strong>${P.esc(row.proofId || 'ยังไม่มี')}</strong><small>${P.esc(barcodeStatus(row))}</small></td><td>${P.stateBadge(row)}</td><td>${P.actionButtons(row)}</td></tr>`;
    };

    let alertsExpanded = false;
    P.renderAlerts = alerts => {
      const panel = P.el('alert-panel'), list = P.el('alert-list'), count = P.el('alert-count');
      if (!panel || !list || !count) return;
      if (!alerts.length) { panel.classList.add('hidden'); list.innerHTML = ''; return; }
      panel.classList.remove('hidden'); panel.classList.add('proof-alert-dock-v10');
      const missedCount = alerts.filter(x => x.alert?.key === 'missed').length;
      const head = panel.querySelector('.proof-alert-panel-head');
      const title = head?.querySelector('strong'); if (title) title.textContent = missedCount ? `งานด่วน • รถไม่เข้า ${P.nf.format(missedCount)}` : 'งานที่ต้องดู';
      count.textContent = `${P.nf.format(alerts.length)} รายการ`;
      let toggle = head?.querySelector('#proof-alert-toggle-v10');
      if (head && !toggle) { toggle = document.createElement('button'); toggle.id = 'proof-alert-toggle-v10'; toggle.type = 'button'; toggle.className = 'btn btn-header proof-alert-toggle-v10'; head.appendChild(toggle); }
      if (toggle) { toggle.textContent = alertsExpanded ? 'ซ่อนรายการ' : 'ดูรายการ'; toggle.onclick = () => { alertsExpanded = !alertsExpanded; P.renderAlerts(P.activeAlerts(P.state.rows || [])); }; }
      list.classList.toggle('hidden', !alertsExpanded);
      if (!alertsExpanded) { list.innerHTML = ''; return; }
      const shown = alerts.slice(0, 12);
      list.innerHTML = shown.map(({ row, alert }) => {
        const ack = alert.key === 'missed' ? '' : `<button class='btn btn-header' type='button' data-proof-ack='${P.escAttr(P.rowKey(row))}' data-alert-key='${P.escAttr(alert.key)}'>รับทราบ</button>`;
        return `<article class='proof-alert-v10 ${P.escAttr(alert.tone)}'><div><strong>${P.esc(alert.title)}</strong><span>${P.esc(row.lineName || '—')} • ${P.esc(P.destinationLabel(row))}</span></div><div class='proof-alert-actions-v10'>${ack}<button class='btn btn-header' type='button' data-proof-open-group='${P.escAttr(P.destinationKey(row))}'>ดูเที่ยว</button></div></article>`;
      }).join('') + (alerts.length > shown.length ? `<div class='proof-alert-more'>อีก ${P.nf.format(alerts.length - shown.length)} รายการ • ใช้ตัวกรองด้านบนเพื่อดูทั้งหมด</div>` : '');
    };

    const historyCache = new Map();
    let historyItems = [], historyDays = 30;
    const historyNorm = value => P.smartSearchNormalize ? P.smartSearchNormalize(value) : String(value || '').toLowerCase().replace(/\s+/g, '');
    const renderHistory = () => {
      const list = document.getElementById('proof-history-list-v10'), input = document.getElementById('proof-history-search-v10');
      if (!list) return;
      const tokens = String(input?.value || '').trim().split(/\s+/).map(historyNorm).filter(Boolean);
      const rows = historyItems.filter(item => {
        const hay = historyNorm([item.proofId, item.routeName, item.plateNumber, item.plateTypeText, item.driver, item.driverPhone, item.statusText, item.businessDay].join(' '));
        return tokens.every(token => hay.includes(token));
      });
      const total = document.getElementById('proof-history-total-v10'); if (total) total.textContent = `${P.nf.format(rows.length)} รายการ`;
      if (!rows.length) { list.innerHTML = `<div class='proof-history-empty'>ไม่พบประวัติบาร์รถในช่วงที่เลือก</div>`; return; }
      list.innerHTML = rows.map(item => `<article class='proof-history-row-v10'>
        <div class='proof-history-id'><small>${P.esc(item.businessDay || '')}</small><strong>${P.esc(item.proofId || '—')}</strong><span>${P.esc(item.routeName || 'ไม่พบชื่อเส้นทาง')}</span></div>
        <div><small>ทะเบียน</small><strong>${P.esc(item.plateNumber || '—')}</strong><span>${P.esc(item.plateTypeText || '')}</span></div>
        <div><small>คนขับ</small><strong>${P.esc(item.driver || '—')}</strong><span>${P.esc(item.driverPhone || '')}</span></div>
        <div><small>บันทึกล่าสุด</small><strong>${P.esc(item.statusText || barcodeStatus(item))}</strong><span>${P.esc(item.recordedAtText || '')}</span></div>
        <div class='proof-history-actions-v10'><button class='btn btn-header' type='button' data-proof-history-copy='${P.escAttr(item.proofId || '')}'>คัดลอกบาร์</button><button class='btn btn-accent' type='button' data-proof-history-pdf='${P.escAttr(item.proofId || '')}'>เปิด PDF</button></div>
      </article>`).join('');
    };
    const loadHistory = async (days = 30, force = false) => {
      if (!P.state.auth) return P.el('proof-login-dialog')?.showModal();
      historyDays = days;
      document.querySelectorAll('[data-proof-history-days]').forEach(b => b.classList.toggle('is-active', Number(b.dataset.proofHistoryDays) === days));
      const list = document.getElementById('proof-history-list-v10'); if (list) list.innerHTML = `<div class='proof-history-empty'>กำลังอ่านประวัติจาก Turso…</div>`;
      try {
        let data = !force ? historyCache.get(`${P.state.branch}|${days}`) : null;
        if (!data) { data = await P.apiGet('/api/proof/history', { token: P.state.auth.token, branch: P.state.branch, days: String(days), limit: '200' }); historyCache.set(`${P.state.branch}|${days}`, data); }
        historyItems = Array.isArray(data?.items) ? data.items : [];
        renderHistory();
      } catch (error) { if (list) list.innerHTML = `<div class='proof-history-error'>${P.esc(error.message || 'โหลดประวัติไม่สำเร็จ')}</div>`; }
    };
    const openHistoryPdf = async proofId => {
      if (!proofId || !P.state.auth) return;
      const preview = window.open('', '_blank');
      if (preview) { preview.document.write(`<!doctype html><meta charset='utf-8'><title>กำลังเปิด PDF</title><body style='font-family:sans-serif;padding:24px'>กำลังอ่าน PDF บาร์โค้ดรถจาก MS…</body>`); preview.document.close(); }
      try {
        const qs = new URLSearchParams({ token: P.state.auth.token, branch: P.state.branch, proofId });
        const response = await P.fetchWithTimeout(`${P.CONFIG.apiBase}/api/proof/history-pdf?${qs}`);
        if (!response.ok) { let body = null; try { body = await response.json(); } catch {} throw new Error(body?.message || `เปิด PDF ไม่สำเร็จ (${response.status})`); }
        const blob = await response.blob(); const url = URL.createObjectURL(blob); if (preview) preview.location.replace(url); else window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 120_000);
      } catch (error) { if (preview) preview.close(); alert(error.message || 'เปิด PDF ไม่สำเร็จ'); }
    };

    const install = () => {
      const legacyMetrics = document.getElementById('metric-grid'); if (legacyMetrics) legacyMetrics.classList.add('proof-v10-legacy-metrics');
      const heading = document.querySelector('.proof-heading');
      if (heading && !document.getElementById('proof-command-center-v10')) heading.insertAdjacentHTML('afterend', `<section id='proof-command-center-v10' class='proof-command-center-v10'>
        <div class='proof-command-head'><div><small>ศูนย์ควบคุมเที่ยวรถ</small><strong>ดูแล้วรู้ทันทีว่าเหลืออะไร ต้องทำอะไร และรถอยู่ขั้นตอนไหน</strong><span>คำนวณจากข้อมูล Proof ที่โหลดอยู่แล้ว • ไม่เพิ่ม polling หรือ background API</span></div><button id='proof-history-open-v10' class='btn btn-header' type='button'>ประวัติบาร์รถ</button></div>
        <div class='proof-v11-lanes'><button type='button' data-proof-v11-lane='all' class='is-active'>ทั้งหมด <b data-proof-v10-count='all'>0</b></button><button type='button' data-proof-v11-lane='FD'>FD <b data-proof-v10-count='fd'>0</b></button><button type='button' data-proof-v11-lane='LH'>LH <b data-proof-v10-count='lh'>0</b></button></div>
        <div class='proof-command-grid proof-command-grid-v11'>
          <button type='button' data-proof-v10-filter='all' class='primary'><span>รถคงเหลือ</span><strong data-proof-v10-count='remaining'>0</strong><small>ยังไม่ออกจากต้นทาง</small></button>
          <button type='button' data-proof-v10-filter='unprinted' class='attention'><span>ยังไม่ปริ้นบาร์</span><strong data-proof-v10-count='unprinted'>0</strong><small>ต้องตรวจ/เปิดบาร์</small></button>
          <button type='button' data-proof-v10-filter='printed' class='success'><span>ปริ้น/เปิดบาร์แล้ว</span><strong data-proof-v10-count='printed'>0</strong><small>บาร์พร้อมใช้งาน</small></button>
          <button type='button' data-proof-v10-filter='7'><span>ถึงต้นทาง</span><strong data-proof-v10-count='arrived'>0</strong><small>รถมาถึงแล้ว</small></button>
          <button type='button' data-proof-v10-filter='all'><span>ออกแล้ว</span><strong data-proof-v10-count='departed'>0</strong><small>ออกจากต้นทางแล้ว</small></button>
          <button type='button' data-proof-v10-filter='all' class='extra'><span>รถเสริม</span><strong data-proof-v10-count='extra'>0</strong><small>lineMode รถเสริม</small></button>
        </div>
        <div class='proof-v11-watch'><div><span>ยังไม่ถึงต้นทาง</span><strong data-proof-v10-count='not-arrived'>0</strong></div><div class='danger'><span>รถไม่เข้า</span><strong data-proof-v10-count='missed'>0</strong></div><div class='proof-v11-progress-wrap'><div class='proof-v11-progress'><i></i><em></em></div><small id='proof-flow-progress-v11'>กำลังสรุปสถานะ</small></div></div>
      </section>`);
      const legacyAlertPanel = document.getElementById('alert-panel'); if (legacyAlertPanel) legacyAlertPanel.remove(); // PROOF_ALERT_HEADER_REMOVED_V11
      const stateFilter = P.el('state-filter');
      if (stateFilter && !stateFilter.querySelector("option[value='missed']")) {
        const missed = document.createElement('option'); missed.value = 'missed'; missed.textContent = 'รถไม่เข้า (เลยเวลาปล่อย)';
        const enabled = document.createElement('option'); enabled.value = 'barcode-enabled'; enabled.textContent = 'เปิดใช้บาร์รถแล้ว';
        stateFilter.append(missed, enabled);
      }
      const search = P.el('search-input'); if (search) search.placeholder = 'ค้นหาเส้นทาง / สาขา / ทะเบียนรถ / คนขับ / เบอร์ / บาร์โค้ด';
      const searchLabel = search?.closest('label'); const toolbar = document.querySelector('.proof-toolbar'); if (toolbar && searchLabel) toolbar.prepend(searchLabel);
      if (!document.getElementById('proof-history-dialog-v10')) document.body.insertAdjacentHTML('beforeend', `<dialog id='proof-history-dialog-v10' class='proof-history-dialog-v10'><div class='proof-history-card-v10'><header><div><small>อ่านเมื่อเปิดเท่านั้น • ไม่มี polling ประวัติ</small><h2>ประวัติบาร์รถ</h2></div><button id='proof-history-close-v10' class='dialog-close' type='button'>×</button></header><div class='proof-history-toolbar-v10'><div class='proof-history-days-v10'><button class='btn btn-header' data-proof-history-days='7' type='button'>7 วัน</button><button class='btn btn-header is-active' data-proof-history-days='30' type='button'>30 วัน</button><button class='btn btn-header' data-proof-history-days='90' type='button'>90 วัน</button></div><input id='proof-history-search-v10' type='search' placeholder='ค้นบาร์โค้ด ทะเบียน เส้นทาง หรือคนขับ'><strong id='proof-history-total-v10'>0 รายการ</strong></div><div id='proof-history-list-v10' class='proof-history-list-v10'><div class='proof-history-empty'>กดเปิดประวัติเพื่อโหลดข้อมูล</div></div><p class='proof-history-note-v10'>ประวัตินี้อ่านจาก event/print log ที่ระบบมีอยู่แล้ว จึงไม่เพิ่มการเขียนทุกครั้งที่รีเฟรช</p></div></dialog>`);

      document.querySelectorAll('[data-proof-v10-filter]').forEach(button => button.onclick = () => { const f = button.dataset.proofV10Filter; const value = f === 'unprinted' ? '1' : f === 'printed' ? 'barcode-enabled' : f; P.state.stateFilter = value; if (stateFilter) stateFilter.value = value; P.render(); });
      document.querySelectorAll('[data-proof-v11-lane]').forEach(button => button.onclick = () => { P.state.proofLaneScopeV11 = button.dataset.proofV11Lane || 'all'; P.render(); });
      const historyDialog = document.getElementById('proof-history-dialog-v10');
      document.getElementById('proof-history-open-v10').onclick = () => { historyDialog.showModal(); loadHistory(30); };
      document.getElementById('proof-history-close-v10').onclick = () => historyDialog.close();
      historyDialog.oncancel = event => { event.preventDefault(); historyDialog.close(); };
      document.querySelectorAll('[data-proof-history-days]').forEach(button => button.onclick = () => loadHistory(Number(button.dataset.proofHistoryDays) || 30));
      document.getElementById('proof-history-search-v10').oninput = renderHistory;
      document.addEventListener('click', event => {
        const detail = event.target.closest('[data-proof-v11-detail]'); if (detail) { const panel = document.querySelector(`[data-proof-v11-detail-panel='${CSS.escape(detail.dataset.proofV11Detail || '')}']`); if (panel) { panel.classList.toggle('hidden'); detail.textContent = panel.classList.contains('hidden') ? 'รายละเอียด' : 'ซ่อน'; } return; }
        const pdf = event.target.closest('[data-proof-history-pdf]'); if (pdf) { openHistoryPdf(pdf.dataset.proofHistoryPdf); return; }
        const copy = event.target.closest('[data-proof-history-copy]'); if (copy) { const value = copy.dataset.proofHistoryCopy || ''; if (value) navigator.clipboard?.writeText(value).then(() => { copy.textContent = 'คัดลอกแล้ว'; setTimeout(() => copy.textContent = 'คัดลอกบาร์', 900); }).catch(() => {}); }
      });

      const style = document.createElement('style'); style.id = 'proof-v10-style'; style.textContent = `
        .proof-page{background:#f4f6f8}.proof-page .app-shell{max-width:1560px}.proof-v10-legacy-metrics{display:none!important}
        .proof-heading{align-items:center;margin-bottom:12px}.proof-heading h1{font-size:clamp(25px,2.4vw,34px);letter-spacing:-.02em}.proof-heading p{max-width:760px;color:#69727d}
        .proof-command-center-v10{margin:0 0 12px;border:1px solid #dfe3e8;border-radius:14px;background:#fff;box-shadow:0 2px 7px rgba(25,35,45,.04);padding:13px}.proof-command-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.proof-command-head small{display:block;color:#7b8490;font-size:9px;font-weight:900;letter-spacing:.08em}.proof-command-head strong{display:block;margin-top:2px;font-size:15px;color:#1d2731}.proof-command-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px;margin-top:10px}.proof-command-grid button{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:48px;border:1px solid #dfe3e8;border-radius:10px;background:#f8fafb;color:#38434e;padding:8px 11px;cursor:pointer}.proof-command-grid button:hover,.proof-command-grid button.is-active{border-color:#c2a300;background:#fffbe8}.proof-command-grid button span{font-size:11px;font-weight:800}.proof-command-grid button strong{font-size:21px;color:#18222c}.proof-command-grid button.danger strong{color:#b42318}.proof-command-grid button.success strong{color:#167447}
        .proof-alert-panel.proof-alert-dock-v10{padding:9px 11px;margin:0 0 10px;border:1px solid #e2e5e8;border-left:4px solid #d6a800;border-radius:11px;background:#fff;box-shadow:none}.proof-alert-dock-v10 .proof-alert-panel-head{margin:0;display:grid;grid-template-columns:1fr auto auto;align-items:center}.proof-alert-dock-v10 .proof-alert-panel-head strong{font-size:13px;color:#26313b}.proof-alert-dock-v10 .proof-alert-panel-head>span{background:#eef1f4;color:#4b5560;padding:4px 8px}.proof-alert-toggle-v10{min-height:30px!important;padding:4px 9px!important;font-size:10px!important}.proof-alert-dock-v10 .proof-alert-list{margin-top:8px;gap:5px;max-height:300px;overflow:auto}.proof-alert-v10{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 9px;border:1px solid #e3e6e8;border-radius:8px;background:#fafbfc}.proof-alert-v10.danger{border-left:4px solid #b42318;background:#fff8f7}.proof-alert-v10.warning{border-left:4px solid #c58d00}.proof-alert-v10 strong{display:block;font-size:11px}.proof-alert-v10 span{display:block;margin-top:2px;color:#6f7881;font-size:10px}.proof-alert-actions-v10{display:flex;gap:5px}.proof-alert-actions-v10 .btn{min-height:29px;padding:4px 8px;font-size:9px}.proof-alert-more{padding:7px;text-align:center;color:#6f7881;font-size:10px}
        .toolbar-panel{border:1px solid #dfe3e8!important;border-radius:13px!important;background:#fff!important}.proof-toolbar{grid-template-columns:repeat(6,minmax(120px,1fr))!important;gap:8px!important}.proof-toolbar .proof-search{grid-column:1/6!important}.proof-toolbar .proof-search input{min-height:44px!important;font-size:13px;padding-inline:12px}.proof-toolbar #clear-filter-btn{min-height:44px}.proof-summary{color:#77808a}.proof-view-switch .btn{min-height:34px;font-size:10px}.proof-view-switch .btn.is-active{background:#25313c!important;color:#fff!important;border-color:#25313c!important}
        .proof-group{border:1px solid #dfe3e8!important;border-radius:12px!important;background:#fff!important;box-shadow:0 2px 7px rgba(25,35,45,.035)}.proof-group-head{background:#f7f9fa!important;padding:10px 13px!important}.proof-group-head:hover{background:#f1f4f6!important}.proof-group-name strong{color:#25313c}.proof-group-alert{background:#b42318!important}.proof-group-body{display:grid!important;grid-template-columns:1fr!important;gap:0!important;padding:0!important;background:#fff!important}
        .proof-ops-card{background:#fff;border:0;border-top:1px solid #e4e7e9;padding:0}.proof-ops-card:first-child{border-top:0}.proof-ops-card.is-missed{box-shadow:inset 4px 0 0 #b42318;background:#fffafa}.proof-ops-card.is-pending{box-shadow:inset 4px 0 0 #d5a600}.proof-ops-card.is-enabled{box-shadow:inset 4px 0 0 #23915a}.proof-ops-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:11px 14px 7px}.proof-ops-route{min-width:0}.proof-ops-route>small{display:block;color:#7b8490;font-size:9px;font-weight:800}.proof-ops-route>strong{display:inline-block;margin-top:2px;font-size:13px;color:#18222c;word-break:break-word}.proof-ops-route .proof-inline-badges{margin-left:7px}.proof-ops-status{display:flex;gap:5px;justify-content:flex-end;flex-wrap:wrap}.proof-v10-chip{display:inline-flex;align-items:center;border-radius:999px;padding:4px 8px;font-size:9px;font-weight:900;white-space:nowrap}.proof-v10-stage{background:#eef1f4;color:#46515c}.proof-v10-chip-enabled{background:#e5f6ed;color:#176b43}.proof-v10-chip-off{background:#f1f2f3;color:#66707a}.proof-v10-chip-missed{background:#fde9e7;color:#a82820}.proof-ops-grid{display:grid;grid-template-columns:1.1fr 1.1fr 1fr 1.2fr;gap:0;margin:0 14px;border:1px solid #e5e8ea;border-radius:9px;overflow:hidden;background:#fafbfc}.proof-ops-grid>div{padding:9px 11px;min-width:0;border-right:1px solid #e5e8ea}.proof-ops-grid>div:last-child{border-right:0}.proof-ops-grid small{display:block;font-size:9px;color:#7b8490;font-weight:800}.proof-ops-grid strong{display:block;margin-top:2px;font-size:11px;line-height:1.45;color:#27323c;word-break:break-word}.proof-ops-grid span{display:block;margin-top:2px;font-size:9px;color:#737d87;word-break:break-word}.proof-ops-barcode strong{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}.proof-ops-card.is-enabled .proof-ops-barcode span{color:#167447;font-weight:800}.proof-ops-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 14px 11px}.proof-v10-time{font-size:9px;color:#66707a;font-weight:800}.proof-v10-time.warning{color:#986c00}.proof-v10-time.danger{color:#b42318}.proof-actions-v10 .btn{min-height:33px;padding:5px 11px;font-size:10px;font-weight:900}.proof-actions-v10 .btn:disabled{opacity:.62}
        .proof-table{border:1px solid #dfe3e8!important}.proof-table thead th{background:#eef1f4!important;color:#35404a!important;border-right:1px solid #dfe3e8!important;font-size:10px!important}.proof-table tbody td{background:#fff!important;border-top:1px solid #e7e9eb!important}.proof-table tbody tr.proof-row-missed td{background:#fff9f8!important}.proof-table td small{display:block;margin-top:3px;color:#7a838c;font-size:9px}
        .proof-history-dialog-v10{border:0;border-radius:14px;padding:0;width:min(1180px,calc(100vw - 24px));max-width:none;max-height:90dvh}.proof-history-dialog-v10::backdrop{background:rgba(22,29,35,.55)}.proof-history-card-v10{background:#f5f7f8;padding:14px;max-height:90dvh;overflow:auto}.proof-history-card-v10>header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.proof-history-card-v10 h2{margin:2px 0 0;font-size:22px}.proof-history-card-v10 header small{color:#77808a}.proof-history-toolbar-v10{display:grid;grid-template-columns:auto minmax(220px,1fr) auto;gap:8px;align-items:center;margin-top:12px}.proof-history-days-v10{display:flex;gap:5px}.proof-history-days-v10 .is-active{background:#25313c;color:#fff}.proof-history-toolbar-v10 input{min-height:39px;border:1px solid #d5d9dd;border-radius:8px;padding:7px 10px}.proof-history-toolbar-v10>strong{font-size:11px}.proof-history-list-v10{display:grid;gap:6px;margin-top:10px}.proof-history-row-v10{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr auto;gap:8px;align-items:center;background:#fff;border:1px solid #dfe3e8;border-radius:9px;padding:9px 10px}.proof-history-row-v10 small{display:block;color:#7b8490;font-size:8px}.proof-history-row-v10 strong{display:block;margin-top:2px;color:#27323c;font-size:10px;word-break:break-word}.proof-history-row-v10 span{display:block;margin-top:2px;color:#737d87;font-size:9px;word-break:break-word}.proof-history-id strong{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}.proof-history-actions-v10{display:flex;gap:5px}.proof-history-actions-v10 .btn{min-height:31px;font-size:9px;padding:5px 8px}.proof-history-empty,.proof-history-error{padding:24px;text-align:center;color:#6f7881;background:#fff;border:1px dashed #cfd5da;border-radius:9px}.proof-history-error{color:#b42318}.proof-history-note-v10{font-size:9px;color:#7b8490;margin:9px 2px 0}
        .proof-editor-dialog{border-radius:12px!important}.proof-editor-card{background:#f7f8f9!important}.proof-editor-route-box{border-top:4px solid #46515c!important}.proof-editor-summary-v7{background:#eef1f4!important;border-color:#d9dde1!important}.proof-editor-summary-v7>div{border-color:#d9dde1!important}.proof-editor-section{background:#fff!important;border-color:#dfe3e8!important}.proof-editor-section-head{background:#f3f5f6!important}.proof-search-row input{border-color:#cfd5da!important}.proof-option:hover,.proof-option.selected{background:#fffbe8!important;border-color:#d2b000!important}
        @media(max-width:1050px){.proof-command-grid{grid-template-columns:repeat(3,1fr)}.proof-toolbar{grid-template-columns:repeat(3,1fr)!important}.proof-toolbar .proof-search{grid-column:1/-1!important}.proof-ops-grid{grid-template-columns:1fr 1fr}.proof-ops-grid>div:nth-child(2){border-right:0}.proof-ops-grid>div:nth-child(-n+2){border-bottom:1px solid #e5e8ea}.proof-history-row-v10{grid-template-columns:1fr 1fr}.proof-history-actions-v10{grid-column:1/-1}}
        @media(max-width:700px){.proof-command-head{display:block}.proof-command-head .btn{margin-top:8px;width:100%}.proof-command-grid{grid-template-columns:1fr 1fr}.proof-toolbar{grid-template-columns:1fr 1fr!important}.proof-toolbar .proof-search{grid-column:1/-1!important}.proof-alert-v10{display:block}.proof-alert-actions-v10{margin-top:6px}.proof-ops-head{display:block}.proof-ops-status{justify-content:flex-start;margin-top:6px}.proof-ops-grid{grid-template-columns:1fr}.proof-ops-grid>div{border-right:0!important;border-bottom:1px solid #e5e8ea!important}.proof-ops-grid>div:last-child{border-bottom:0!important}.proof-ops-footer{display:block}.proof-actions-v10{margin-top:7px}.proof-actions-v10 .btn{width:100%}.proof-history-toolbar-v10{grid-template-columns:1fr}.proof-history-days-v10{display:grid;grid-template-columns:repeat(3,1fr)}.proof-history-row-v10{grid-template-columns:1fr}.proof-history-actions-v10{grid-column:auto}.proof-history-actions-v10 .btn{flex:1}}
      `; document.head.appendChild(style);
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
      renderCommandCounts();
    };

    install();
    const oldOpen = P.openEditor;
    P.openEditor = (row, detail) => {
      oldOpen(row, detail);
      setTimeout(() => {
        const input = P.el('proof-editor-plate-search');
        if (input) input.placeholder = 'ค้นทะเบียน เช่น ฒม2816 หรือ 2816 • กด Enter/ค้นหา';
        const hint = P.el('proof-editor-plate-results')?.querySelector('.proof-option-hint');
        if (hint) hint.textContent = 'พิมพ์ทะเบียนอย่างน้อย 2 ตัว แล้วกด Enter หรือ “ค้นหา”';
      }, 0);
    };
    P.render();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 0), { once: true }); else setTimeout(start, 0);
}
