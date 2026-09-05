const VERSION = '20260905-10';

export async function maybeHandleProofUiV5(request, env, ctx, baseWorker) {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/proof-v5.js') {
    return new Response(`(${proofV6Runtime.toString()})();`, {
      headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  if (request.method !== 'GET' || url.pathname !== '/proof.html') return null;
  const upstream = await baseWorker.fetch(request, env, ctx);
  const type = upstream.headers.get('content-type') || '';
  if (!upstream.ok || !type.includes('text/html')) return upstream;
  let html = await upstream.text();
  const tag = `<script src="/proof-v5.js?v=${VERSION}" defer></script>`;
  if (!html.includes('/proof-v5.js')) html = html.replace('</head>', `${tag}</head>`);
  const headers = new Headers(upstream.headers);
  headers.set('Cache-Control', 'no-store');
  headers.delete('content-length');
  return new Response(html, { status: upstream.status, headers });
}

function proofV6Runtime() {
  const start = () => {
    const P = window.ProofV2;
    if (!P || typeof P.groupRouteCard !== 'function' || typeof P.openEditor !== 'function') return setTimeout(start, 25);
    if (window.__PROOF_V8_READY__) return;
    window.__PROOF_V8_READY__ = true; // PROOF_SMART_V8

    const mode = row => Number(row?.lineMode) === 2 ? 'รถเสริม' : (row?.lineModeText || 'ปกติ');
    const type = row => row?.lineTypeText || '—';
    const vehicle = row => row?.plateTypeText || '—';
    const barcode = row => row?.proofId || 'ยังไม่มีบาร์โค้ด';
    const card = row => {
      const standby = row.detailReady && Number.isFinite(Number(row.standbyTime)) ? P.minuteText(row.standbyTime) : 'กำลังอ่าน';
      const release = P.minuteText(row.plannedDepartureTime ?? row.startTime);
      const plate = [row.plateTypeText, row.plateNumber].filter(Boolean).join(' • ') || 'ยังไม่กำหนดทะเบียน';
      const alert = P.alertForRow(row);
      return `<article class="proof-ms-card ${Number(row.proofState) === 1 ? 'needs-action' : ''}">
        <div class="proof-ms-topline"></div>
        <header class="proof-ms-head"><div class="proof-ms-badges"><span class="proof-ms-dark">ต้นทาง</span><span class="proof-ms-vehicle">${P.esc(vehicle(row))}</span></div><h3>${P.esc(row.lineName || '—')}</h3><p><b>${P.esc(barcode(row))}</b> • ${P.esc(plate)}</p></header>
        <div class="proof-ms-yellow"><div><small>ปลายทาง</small><strong>${P.esc(P.destinationShort(row))}</strong></div><div><small>ลักษณะ</small><strong>${P.esc(mode(row))}</strong></div><div><small>เส้นทาง</small><strong>${P.esc(type(row))}</strong></div></div>
        <section class="proof-ms-section"><div class="proof-ms-title light">เวลาแผน</div><div class="proof-ms-pair"><div><small>Standby</small><strong>${P.esc(standby)}</strong></div><div><small>กำหนดปล่อย</small><strong>${P.esc(release)}</strong></div></div><div class="proof-ms-center">${P.standbyBadge(row)}</div></section>
        <section class="proof-ms-section"><div class="proof-ms-title dark">บาร์โค้ดรถ</div><div class="proof-ms-pair"><div><small>บาร์โค้ดปัจจุบัน</small><strong>${P.esc(barcode(row))}</strong></div><div><small>สถานะล่าสุด</small><strong>${P.esc(P.stateText(row))}</strong></div></div></section>
        <div class="proof-ms-driver"><div><small>คนขับรถ</small><strong>${P.esc(row.driver || 'ยังไม่กำหนดคนขับ')}</strong></div><div><small>เบอร์โทร</small><strong>${P.esc(row.driverPhone || 'ไม่มีเบอร์โทร')}</strong></div></div>
        ${alert ? `<div class="proof-ms-alert ${P.escAttr(alert.tone)}"><strong>${P.esc(alert.title)}</strong></div>` : ''}
        <footer class="proof-ms-footer">${P.actionButtons(row)}</footer></article>`;
    };

    P.actionButtons = row => {
      const code = Number(row.proofState);
      const canPrint = Boolean(P.state.profile?.canPrint) && P.PRINTABLE_STATES.has(code);
      const canCreate = code !== 1 || Boolean(P.state.profile?.canCreateProof);
      const enabled = canPrint && canCreate && Boolean(row.lineId) && Boolean(row.departureDate);
      let title = '';
      if (!P.state.profile?.canPrint) title = 'Session MS ยังไม่พร้อม หรือบัญชีนี้ไม่มีสิทธิ์ปริ้น';
      else if (code === 1 && !P.state.profile?.canCreateProof) title = 'บัญชี MS นี้ไม่มีสิทธิ์เปิดใช้งานบาร์โค้ด';
      else if (!P.PRINTABLE_STATES.has(code)) title = 'สถานะนี้ไม่รองรับการปริ้นจากหน้าเว็บ';
      const label = code === 1 ? 'ตรวจข้อมูล + เปิดบาร์โค้ด/ปริ้น' : 'ตรวจข้อมูล + ปริ้น PDF';
      return `<div class="proof-actions proof-actions-ms"><button class="btn btn-accent" type="button" data-proof-print="${P.escAttr(P.rowKey(row))}" ${enabled ? '' : 'disabled'} title="${P.escAttr(title)}">${label}</button></div>`;
    };
    P.groupRouteCard = card;
    P.mobileCard = card;
    P.tableRow = row => {
      const plate = [row.plateTypeText, row.plateNumber].filter(Boolean).join(' • ') || 'ยังไม่กำหนดทะเบียน';
      return `<tr><td class="proof-route"><strong>${P.esc(row.lineName || '—')}</strong><small>${P.routeBadges(row)} ${P.esc(P.destinationLabel(row))}</small></td><td class="proof-car"><strong>${P.esc(plate)}</strong><small>${P.esc(mode(row))}</small></td><td class="proof-driver"><strong>${P.esc(row.driver || 'ยังไม่กำหนด')}</strong><small>${P.esc(row.driverPhone || '—')}</small></td><td><strong>${P.esc(P.standbyText(row))}</strong><small>${P.esc(row.departureDate || '')}</small></td><td><strong>${P.esc(barcode(row))}</strong></td><td>${P.stateBadge(row)}${P.standbyBadge(row)}</td><td>${P.actionButtons(row)}</td></tr>`;
    };

    const oldOpen = P.openEditor;
    P.openEditor = (row, detail) => {
      oldOpen(row, detail);
      setTimeout(() => {
        const box = document.querySelector('.proof-editor-route-box');
        if (box && !box.querySelector('.proof-editor-summary-v7')) box.insertAdjacentHTML('beforeend', `<div class="proof-editor-summary-v7"><div><small>ปลายทาง</small><b>${P.esc(P.destinationLabel(row))}</b></div><div><small>ลักษณะ</small><b>${P.esc(mode(row))}</b></div><div><small>เส้นทาง</small><b>${P.esc(type(row))}</b></div></div>`);
        const h = document.querySelector('.proof-editor-head h2'); if (h) h.textContent = 'ตรวจ/แก้ข้อมูลก่อนปริ้นบาร์โค้ดรถ';
        for (const kind of ['plate', 'driver']) {
          const input = P.el(kind === 'plate' ? 'proof-editor-plate-search' : 'proof-editor-driver-search');
          if (!input || input.dataset.v7 === '1') continue;
          input.dataset.v7 = '1';
          const wrap = input.parentElement, line = document.createElement('div'); line.className = 'proof-search-row'; wrap.insertBefore(line, input); line.appendChild(input);
          const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-header proof-search-now'; b.textContent = 'ค้นหา'; line.appendChild(b);
          const run = () => { const q = String(input.value || '').trim(); if (q.length < 2) return input.focus(); P.searchEditorOptions(kind, q); };
          b.onclick = run; input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
        }
      }, 0);
    };

    const controlPost = async (action, payload = {}) => {
      const r = await P.fetchWithTimeout(`${P.CONFIG.apiBase}/api`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, token: P.state.auth?.token || '', ...payload }) });
      let data = null; try { data = await r.json(); } catch {}
      if (!r.ok || !data?.ok) throw P.apiError(data?.message || 'ทำรายการไม่สำเร็จ', data?.code || 'API_ERROR', r.status);
      return data.data;
    };
    const extractHar = async file => {
      if (!file) throw new Error('กรุณาเลือกไฟล์ HAR');
      let har; try { har = JSON.parse(await file.text()); } catch { throw new Error('อ่านไฟล์ HAR ไม่ได้'); }
      const entries = Array.isArray(har?.log?.entries) ? [...har.log.entries].reverse() : [];
      for (const entry of entries) {
        let host = ''; try { host = new URL(entry?.request?.url || '').hostname.toLowerCase(); } catch {}
        if (!host.endsWith('flashexpress.com')) continue;
        const hs = entry?.request?.headers || [];
        const get = name => String(hs.find(h => String(h?.name || '').toLowerCase() === name)?.value || '').trim();
        const sessionId = get('x-fle-session-id'), deviceId = get('x-device-id');
        if (sessionId && deviceId) return { sessionId, deviceId };
      }
      throw new Error('ไฟล์ HAR ไม่มี Session ID หรือ Device ID ของ MS');
    };
    const renderSession = error => {
      const ready = Boolean(P.state.auth && P.state.profile && !error);
      const btn = document.getElementById('proof-session-btn'), panel = document.getElementById('proof-session-panel');
      if (btn) { btn.classList.toggle('hidden', !P.state.auth); btn.textContent = 'การเชื่อมต่อ MS / HAR'; btn.classList.remove('btn-accent'); btn.classList.add('btn-header'); } const badge = document.getElementById('connection-badge'); if (badge) { badge.textContent = ready ? 'ออนไลน์' : (P.state.auth ? 'เชื่อมต่อไม่ได้' : 'ยังไม่เชื่อมต่อ'); badge.className = `badge ${ready ? 'badge-online' : 'badge-offline'}`; } const openMs = document.getElementById('connect-ms-btn'); if (openMs) openMs.classList.toggle('hidden', !P.state.auth);
      if (panel) {
        panel.classList.toggle('is-ready', ready); panel.classList.toggle('is-error', Boolean(error));
        document.getElementById('proof-session-title').textContent = ready ? 'Session ปริ้นพร้อมใช้งาน' : 'ต้องตรวจ Session ปริ้น';
        document.getElementById('proof-session-detail').textContent = ready ? `${P.state.profile?.name || 'บัญชี MS'} • ${P.state.profile?.organizationName || P.state.branch}` : (error?.message || 'ใช้ Session เดียวกับตัวเชื่อม MS ของ HUB นี้');
        document.getElementById('proof-session-open').textContent = ready ? 'พร้อม' : 'ตรวจ/เชื่อมต่อ';
      }
      const cur = document.getElementById('proof-session-current'); if (cur) cur.textContent = ready ? `พร้อม • ${P.state.profile?.name || 'บัญชี MS'}` : (error?.message || 'ยังไม่ได้ตรวจ Session');
    };
    const testSession = async (show = true) => {
      if (!P.state.auth) return false;
      const status = document.getElementById('proof-session-status'); if (status) status.textContent = 'กำลังตรวจ Session กับ MS…';
      try {
        const profile = await P.apiGet('/api/proof/profile', { token: P.state.auth.token, branch: P.state.branch });
        P.state.profile = profile; P.renderProfile(); renderSession(); if (status) status.textContent = `พร้อมใช้งาน • ${profile.name || 'บัญชี MS'}`; if (show) P.setLive('Session ปริ้นพร้อมใช้งาน', 'ok'); return true;
      } catch (e) {
        P.state.profile = null; P.renderProfile(e); renderSession(e); if (status) status.textContent = e.message || 'Session ใช้งานไม่ได้'; if (show) P.setLive(e.message || 'Session ใช้งานไม่ได้', 'error'); return false;
      }
    };
    const openSession = () => {
      if (!P.state.auth) return P.el('proof-login-dialog').showModal();
      document.getElementById('proof-session-hub').textContent = P.state.branch; document.getElementById('proof-session-har').value = ''; document.getElementById('proof-session-status').textContent = 'HAR ไฟล์เดียว ใช้ทั้งเส้นทาง MS และปริ้นบาร์โค้ด'; document.getElementById('proof-session-dialog').showModal(); testSession(false);
    };
    const closeSession = () => { const d = document.getElementById('proof-session-dialog'); if (d?.open) d.close(); };
    const pair = async () => {
      const b = document.getElementById('proof-session-qr'), s = document.getElementById('proof-session-status');
      try { b.disabled = true; s.textContent = 'กำลังสร้างหน้าสแกน QR…'; const result = await controlPost('createMsPairing', { hub: P.state.branch }); const popup = window.open(result.browserUrl, 'ms-cloud-browser'); if (!popup) throw new Error('เบราว์เซอร์บล็อก Pop-up กรุณาอนุญาตแล้วลองใหม่'); s.textContent = 'เปิดหน้าสแกน QR แล้ว • เชื่อมเสร็จให้กลับมากด ตรวจ Session'; } catch (e) { s.textContent = e.message || 'สร้าง QR ไม่สำเร็จ'; } finally { b.disabled = false; }
    };
    const saveHar = async () => {
      const b = document.getElementById('proof-session-save'), s = document.getElementById('proof-session-status'), file = document.getElementById('proof-session-har').files?.[0];
      try { b.disabled = true; s.textContent = 'กำลังอ่าน HAR และตรวจ Session…'; const c = await extractHar(file); await controlPost('saveMsConnection', { hub: P.state.branch, sessionId: c.sessionId, deviceId: c.deviceId }); if (!await testSession(false)) throw new Error('บันทึกแล้วแต่ Session ยังใช้งานกับ MS ไม่ได้'); await P.loadRoutes(false); s.textContent = 'Session ปริ้นพร้อมใช้งานแล้ว'; } catch (e) { s.textContent = e.message || 'บันทึก Session ไม่สำเร็จ'; } finally { b.disabled = false; }
    };

    const oldPrint = P.printRoute;
    P.printRoute = async key => { if (!P.state.auth) return; P.setLive('กำลังตรวจ Session ก่อนปริ้น…', 'stale'); if (!await testSession(false)) { alert('Session MS ใช้งานไม่ได้ กรุณาเชื่อมต่อ Session ปริ้นก่อน'); openSession(); return; } return oldPrint(key); };
    const oldProfile = P.renderProfile; P.renderProfile = error => { oldProfile(error); renderSession(error); };

    const nav = document.querySelector('.topbar-actions');
    if (nav && !document.getElementById('proof-session-btn')) { const b = document.createElement('button'); b.id = 'proof-session-btn'; b.className = 'btn btn-header hidden'; b.type = 'button'; b.textContent = 'ตั้งค่าการเชื่อมต่อ'; nav.insertBefore(b, P.el('refresh-btn') || null); }
    const sessionNavButton = document.getElementById('proof-session-btn'); if (sessionNavButton) sessionNavButton.onclick = e => { e?.preventDefault?.(); openSession(); };
    const legacyPanel = document.getElementById('proof-session-panel'); if (legacyPanel) legacyPanel.remove();
    if (!document.getElementById('proof-session-dialog')) {
      document.body.insertAdjacentHTML('beforeend', `<dialog id="proof-session-dialog" class="proof-session-dialog"><div class="dialog-card proof-session-card"><div class="proof-session-head"><div><small>MS Session ประจำ HUB <b id="proof-session-hub">${P.esc(P.state.branch)}</b></small><h2>ตั้งค่าการเชื่อมต่อ MS</h2></div><button id="proof-session-close" class="dialog-close" type="button">×</button></div><div class="proof-session-current"><span></span><div><small>สถานะปัจจุบัน</small><strong id="proof-session-current">ยังไม่ได้ตรวจ Session</strong></div></div><p class="proof-session-note"><b>HAR เป็นไฟล์เดียวกัน</b> • อัปครั้งเดียวใช้ทั้งหน้าเส้นทาง MS และหน้า Proof • ระบบอ่านไฟล์ในเบราว์เซอร์และส่งเฉพาะข้อมูลเชื่อมต่อที่จำเป็นไปเก็บแบบเข้ารหัส ไม่เก็บไฟล์ HAR ทั้งไฟล์</p><div class="proof-session-actions"><button id="proof-session-test" class="btn btn-header" type="button">ตรวจ Session</button><button id="proof-session-qr" class="btn btn-accent" type="button">เชื่อมต่อด้วย QR</button></div><div class="proof-har-upload proof-har-route"><div><strong>HAR เส้นทาง MS</strong><small>ใช้ไฟล์ HAR เดียวกับระบบ MS สำหรับตรวจ/ดูข้อมูลเส้นทาง</small></div><label class="btn btn-header proof-har-pick">เลือก HAR เส้นทาง<input id="proof-session-har" type="file" accept=".har,application/json" hidden></label><span id="proof-session-file-name">ยังไม่ได้เลือกไฟล์</span><button id="proof-session-save" class="btn btn-header btn-full" type="button" disabled>ตรวจและบันทึก HAR เส้นทาง</button></div><div class="proof-har-upload proof-har-print" data-proof-print-har="PROOF_PRINT_HAR_UPLOAD_V9"><div><strong>HAR สำหรับปริ้นบาร์โค้ดรถ</strong><small>เลือกไฟล์ HAR เดียวกันจากปุ่มนี้ เพื่อเช็กให้ชัดว่างานปริ้นพร้อมใช้งาน</small></div><label class="btn btn-accent proof-har-pick">เลือก HAR สำหรับปริ้น<input id="proof-print-har" type="file" accept=".har,application/json" hidden></label><span id="proof-print-har-file-name">ยังไม่ได้เลือกไฟล์</span><button id="proof-print-har-save" class="btn btn-accent btn-full" type="button" disabled>ตรวจและบันทึกสำหรับปริ้น</button></div><p id="proof-session-status" class="proof-session-status">HAR ไฟล์เดียว ใช้ทั้งเส้นทาง MS และปริ้นบาร์โค้ด</p></div></dialog>`);
      document.getElementById('proof-session-close').onclick = closeSession; document.getElementById('proof-session-test').onclick = () => testSession(true); document.getElementById('proof-session-qr').onclick = pair; document.getElementById('proof-session-save').onclick = saveHar; const harInput=document.getElementById('proof-session-har'),harSave=document.getElementById('proof-session-save'),harName=document.getElementById('proof-session-file-name'); harInput.onchange=()=>{const f=harInput.files?.[0];harName.textContent=f?f.name:'ยังไม่ได้เลือกไฟล์';harSave.disabled=!f;}; const printHarInput=document.getElementById('proof-print-har'),printHarSave=document.getElementById('proof-print-har-save'),printHarName=document.getElementById('proof-print-har-file-name'); printHarInput.onchange=()=>{const f=printHarInput.files?.[0];printHarName.textContent=f?f.name:'ยังไม่ได้เลือกไฟล์';printHarSave.disabled=!f;}; printHarSave.onclick=async()=>{const status=document.getElementById('proof-session-status'),file=printHarInput.files?.[0];try{printHarSave.disabled=true;status.textContent='กำลังตรวจ HAR สำหรับปริ้นบาร์โค้ด…';const c=await extractHar(file);await controlPost('saveMsConnection',{hub:P.state.branch,sessionId:c.sessionId,deviceId:c.deviceId});if(!await testSession(false))throw new Error('บันทึก HAR แล้ว แต่ Proof Session ยังใช้งานไม่ได้');await P.loadRoutes(false);status.textContent=`พร้อมปริ้น • ตรวจพบ request MS ${c.msRequestCount||0} รายการ`;printHarInput.value='';printHarName.textContent='บันทึกแล้ว • Proof พร้อมตรวจข้อมูลก่อนปริ้น';printHarSave.disabled=true;}catch(e){status.textContent=e.message||'ตรวจ HAR สำหรับปริ้นไม่สำเร็จ';printHarSave.disabled=!file;}}; document.getElementById('proof-session-dialog').oncancel = e => { e.preventDefault(); closeSession(); };
    }

    document.addEventListener('keydown',e=>{if(e.key==='/'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){e.preventDefault();P.el('search-input')?.focus();}});
    const th = document.querySelector('.proof-table thead tr'); if (th) th.innerHTML = '<th>ชื่อเส้นทาง / ปลายทาง</th><th>รถ / ทะเบียน</th><th>คนขับ / เบอร์</th><th>Standby / ปล่อย</th><th>บาร์โค้ดรถ</th><th>สถานะ</th><th>ปริ้น</th>';
    const heading = document.querySelector('.proof-heading p'); if (heading) heading.textContent = 'ดูรถที่ต้องจัดการ ตรวจทะเบียน/คนขับตามสิทธิ์ MS และปริ้นบาร์โค้ดด้วย Session ของ HUB';
    if (P.el('refresh-btn')) P.el('refresh-btn').textContent = 'รีเฟรชข้อมูล';

    const style = document.createElement('style'); style.id = 'proof-v7-style'; style.textContent = `
      .proof-session-panel{display:flex;align-items:center;justify-content:space-between;gap:12px;background:#fff;border:1px solid #ddd;border-left:6px solid #d19f00;padding:11px 13px;margin:0 0 14px}.proof-session-panel small{display:block;color:#777;font-size:10px}.proof-session-panel strong{display:block;margin-top:2px;font-size:14px}.proof-session-panel span{display:block;margin-top:2px;color:#666;font-size:11px}.proof-session-panel.is-ready{border-left-color:#16803c;background:#f7fff9}.proof-session-panel.is-error{border-left-color:#b3261e;background:#fff8f7}
      .proof-group{border-radius:5px!important}.proof-group-body{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(430px,1fr));gap:10px;padding:10px;background:#f3f3f1}.proof-ms-card{background:#fff;border:1px solid #d8d8d2;border-radius:8px;overflow:hidden}.proof-ms-topline{height:6px;background:#151515}.proof-ms-head{text-align:center;padding:12px}.proof-ms-badges{display:flex;gap:8px;justify-content:center;margin-bottom:8px}.proof-ms-dark,.proof-ms-vehicle{padding:5px 11px;border-radius:4px;font-size:11px;font-weight:900}.proof-ms-dark{background:#151515;color:#fff}.proof-ms-vehicle{background:#e8ebe8;border:1px solid #aaa}.proof-ms-head h3{font-size:14px;line-height:1.45;margin:0;word-break:break-word}.proof-ms-head p{margin:7px 0 0;color:#777;font-size:11px}.proof-ms-yellow{display:grid;grid-template-columns:repeat(3,1fr);background:#ffd84f;border-block:1px solid #d0ad2b}.proof-ms-yellow>div{text-align:center;padding:8px 5px;border-right:1px solid #c3a12b}.proof-ms-yellow>div:last-child{border-right:0}.proof-ms-yellow small,.proof-ms-pair small,.proof-ms-driver small{display:block;font-size:9px;color:#555;font-weight:700}.proof-ms-yellow strong{display:block;margin-top:2px;font-size:11px}.proof-ms-section{margin:9px 11px 0;border:1px solid #ddd;border-radius:6px;overflow:hidden}.proof-ms-title{text-align:center;padding:7px;font-size:11px;font-weight:900}.proof-ms-title.light{background:#e7e9e7}.proof-ms-title.dark{background:#242424;color:#fff}.proof-ms-pair{display:grid;grid-template-columns:1fr 1fr;padding:9px 7px}.proof-ms-pair>div{text-align:center;padding:2px 7px}.proof-ms-pair>div+div{border-left:1px solid #ddd}.proof-ms-pair strong{display:block;margin-top:3px;font-size:12px;word-break:break-word}.proof-ms-center{text-align:center;padding:0 7px 8px}.proof-ms-driver{display:grid;grid-template-columns:1fr 1fr;margin:9px 11px 0;border:1px solid #ddd;background:#fafafa}.proof-ms-driver>div{padding:8px 9px}.proof-ms-driver>div+div{border-left:1px solid #ddd}.proof-ms-driver strong{display:block;margin-top:3px;font-size:11px;word-break:break-word}.proof-ms-alert{margin:9px 11px 0;padding:7px 9px;border-radius:5px;text-align:center;font-size:10px}.proof-ms-alert.danger{background:#fff0ee;color:#a5362d;border:1px solid #e5aaa4}.proof-ms-alert.warning{background:#fff7da;color:#806000;border:1px solid #e1c66a}.proof-ms-alert.extra,.proof-ms-alert.info{background:#f1f1ef;border:1px solid #ddd}.proof-ms-footer{padding:9px 11px 11px}.proof-actions-ms .btn{width:100%;min-height:36px;font-size:11px;font-weight:900}
      .proof-table{border:1px solid #d5d5cf!important}.proof-table thead th{background:#ffd84f!important;color:#151515!important;border-right:1px solid #c5a42f!important;padding:9px 7px!important;font-size:10px!important}.proof-table tbody td{border-top:1px solid #e1e1dc!important;padding:8px 7px!important}.proof-table tbody tr:nth-child(even){background:#fafaf7}.proof-table .proof-actions-ms .btn{min-height:31px;font-size:9px;padding:5px}
      .proof-editor-dialog,.proof-session-dialog{border:0;border-radius:7px;padding:0;width:min(720px,calc(100vw - 16px));max-width:none;max-height:94dvh}.proof-editor-dialog::backdrop,.proof-session-dialog::backdrop{background:rgba(0,0,0,.58)}.proof-editor-card,.proof-session-card{background:#fff;padding:13px;overflow:auto;max-height:94dvh}.proof-editor-route-box{background:#fff!important;color:#222!important;border:1px solid #d7d7d1!important;border-top:6px solid #151515!important;border-radius:6px!important;text-align:center}.proof-editor-route-box small{color:#777!important}.proof-editor-state{background:#ffd84f!important;color:#151515!important;border-radius:4px!important}.proof-editor-meta{color:#666!important}.proof-editor-meta b{color:#222!important}.proof-editor-summary-v7{display:grid;grid-template-columns:repeat(3,1fr);margin:9px -13px -12px;background:#ffd84f;border-top:1px solid #d6b32d}.proof-editor-summary-v7>div{padding:7px 4px;border-right:1px solid #c7a52e}.proof-editor-summary-v7>div:last-child{border-right:0}.proof-editor-summary-v7 small{display:block;font-size:9px;color:#555}.proof-editor-summary-v7 b{display:block;font-size:10px;margin-top:2px}.proof-editor-section{border-radius:5px!important}.proof-editor-section-head{background:#e7e9e7!important}.proof-search-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px}.proof-search-row input{min-height:39px!important;border-radius:4px!important}.proof-search-now{min-width:74px}.proof-option{border-radius:4px!important}.proof-editor-actions{position:sticky;bottom:-13px;background:#fff;border-top:1px solid #ddd;padding-top:8px;z-index:2}
      .proof-session-head{display:flex;justify-content:space-between;gap:10px}.proof-session-head h2{margin:2px 0 0;font-size:18px}.proof-session-head small{color:#777}.proof-session-current{display:flex;gap:9px;align-items:center;margin-top:11px;padding:9px;border:1px solid #ddd;background:#f8f8f5}.proof-session-current>span{width:11px;height:11px;border-radius:50%;background:#d19f00}.proof-session-current small{display:block;color:#777;font-size:9px}.proof-session-current strong{display:block;margin-top:2px;font-size:12px}.proof-session-note{font-size:10px;line-height:1.55;background:#fff8d9;border-left:4px solid #ffd400;padding:8px 9px;color:#555}.proof-session-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px}.proof-har-upload{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;margin-top:9px;border:1px solid #ddd;background:#fafaf7;padding:10px}.proof-har-upload>div{display:grid}.proof-har-upload small,#proof-session-file-name,.proof-session-status{font-size:10px;color:#777}.proof-har-pick{cursor:pointer}.proof-har-upload .btn-full,#proof-session-file-name{grid-column:1/-1}
      @media(max-width:900px){.proof-group-body{grid-template-columns:1fr}.proof-desktop{display:none!important}.proof-mobile{display:block!important}.proof-mobile .proof-ms-card{margin-bottom:10px}}
      @media(max-width:430px){.proof-har-upload{grid-template-columns:1fr}.proof-har-upload .btn,.proof-har-pick{width:100%}.proof-session-panel{display:block}.proof-session-panel button{margin-top:8px;width:100%}.proof-ms-driver{grid-template-columns:1fr}.proof-ms-driver>div+div{border-left:0;border-top:1px solid #ddd}.proof-session-actions{grid-template-columns:1fr}.proof-editor-card,.proof-session-card{padding:10px}}
    `; document.head.appendChild(style);
    renderSession(); P.render();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 0), { once: true }); else setTimeout(start, 0);
}
