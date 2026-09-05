const VERSION = '20260905-06';

export async function maybeHandleProofUiV5(request, env, ctx, baseWorker) {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/proof-v5.js') {
    return new Response(PROOF_V6_JS, {
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      },
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

const PROOF_V6_JS = String.raw`(()=>{
  const start=()=>{
    const P=window.ProofV2;
    if(!P||typeof P.groupRouteCard!=='function'||typeof P.openEditor!=='function')return setTimeout(start,25);
    if(window.__PROOF_V6_READY__)return;
    window.__PROOF_V6_READY__=true;

    const routeMode=row=>Number(row&&row.lineMode)===2?'รถเสริม':(row&&row.lineModeText||'ปกติ');
    const routeType=row=>row&&row.lineTypeText||'—';
    const vehicle=row=>row&&row.plateTypeText||'—';
    const barcode=row=>row&&row.proofId||'ยังไม่มีบาร์โค้ด';
    const card=row=>{
      const standby=row.detailReady&&Number.isFinite(Number(row.standbyTime))?P.minuteText(row.standbyTime):'กำลังอ่าน';
      const release=P.minuteText(row.plannedDepartureTime??row.startTime);
      const plate=[row.plateTypeText,row.plateNumber].filter(Boolean).join(' • ')||'ยังไม่กำหนดทะเบียน';
      const driver=row.driver||'ยังไม่กำหนดคนขับ';
      const phone=row.driverPhone||'ไม่มีเบอร์โทร';
      const alert=P.alertForRow(row);
      return "<article class='proof-ms-card "+(Number(row.proofState)===1?'needs-action':'')+"'>"+
        "<div class='proof-ms-card-topline'></div>"+
        "<header class='proof-ms-card-head'><div class='proof-ms-card-badges'><span class='proof-ms-dark-badge'>ต้นทาง</span><span class='proof-ms-vehicle-badge'>"+P.esc(vehicle(row))+"</span></div>"+
        "<h3>"+P.esc(row.lineName||'—')+"</h3><p><strong>"+P.esc(barcode(row))+"</strong><span>•</span><span>"+P.esc(plate)+"</span></p></header>"+
        "<div class='proof-ms-yellow-grid'><div><small>ปลายทาง</small><strong>"+P.esc(P.destinationShort(row))+"</strong></div><div><small>ลักษณะ</small><strong>"+P.esc(routeMode(row))+"</strong></div><div><small>เส้นทาง</small><strong>"+P.esc(routeType(row))+"</strong></div></div>"+
        "<section class='proof-ms-section'><div class='proof-ms-section-title light'>เวลาแผน</div><div class='proof-ms-pair'><div><small>Standby</small><strong>"+P.esc(standby)+"</strong></div><div><small>กำหนดปล่อย</small><strong>"+P.esc(release)+"</strong></div></div><div class='proof-ms-status-center'>"+P.standbyBadge(row)+"</div></section>"+
        "<section class='proof-ms-section'><div class='proof-ms-section-title dark'>บาร์โค้ดรถ</div><div class='proof-ms-pair'><div><small>บาร์โค้ดปัจจุบัน</small><strong>"+P.esc(barcode(row))+"</strong></div><div><small>สถานะล่าสุด</small><strong>"+P.esc(P.stateText(row))+"</strong></div></div></section>"+
        "<section class='proof-ms-driver-strip'><div><small>คนขับรถ</small><strong>"+P.esc(driver)+"</strong></div><div><small>เบอร์โทร</small><strong>"+P.esc(phone)+"</strong></div></section>"+
        (alert?"<div class='proof-ms-alert "+P.escAttr(alert.tone)+"'><strong>"+P.esc(alert.title)+"</strong></div>":'')+
        "<footer class='proof-ms-card-footer'>"+P.actionButtons(row)+"</footer></article>";
    };
    P.groupRouteCard=card;
    P.mobileCard=card;
    P.tableRow=row=>{
      const plate=[row.plateTypeText,row.plateNumber].filter(Boolean).join(' • ')||'ยังไม่กำหนดทะเบียน';
      return "<tr><td class='proof-route'><strong>"+P.esc(row.lineName||'—')+"</strong><small>"+P.routeBadges(row)+" "+P.esc(P.destinationLabel(row))+"</small></td><td class='proof-car'><strong>"+P.esc(plate)+"</strong><small>"+P.esc(routeMode(row))+"</small></td><td class='proof-driver'><strong>"+P.esc(row.driver||'ยังไม่กำหนด')+"</strong><small>"+P.esc(row.driverPhone||'—')+"</small></td><td><strong>"+P.esc(P.standbyText(row))+"</strong><small>"+P.esc(row.departureDate||'')+"</small></td><td><strong>"+P.esc(barcode(row))+"</strong></td><td>"+P.stateBadge(row)+P.standbyBadge(row)+"</td><td>"+P.actionButtons(row)+"</td></tr>";
    };
    P.actionButtons=row=>{
      const code=Number(row.proofState),canPrint=Boolean(P.state.profile&&P.state.profile.canPrint)&&P.PRINTABLE_STATES.has(code),canCreate=code!==1||Boolean(P.state.profile&&P.state.profile.canCreateProof),enabled=canPrint&&canCreate&&Boolean(row.lineId)&&Boolean(row.departureDate);
      let title='';
      if(!P.state.profile||!P.state.profile.canPrint)title='Session MS ยังไม่พร้อม หรือบัญชีนี้ไม่มีสิทธิ์ปริ้น';
      else if(code===1&&!P.state.profile.canCreateProof)title='บัญชี MS นี้ไม่มีสิทธิ์เปิดใช้งานบาร์โค้ด';
      else if(!P.PRINTABLE_STATES.has(code))title='สถานะนี้ไม่รองรับการปริ้นจากหน้าเว็บ';
      const label=code===1?'ตรวจข้อมูล + เปิดบาร์โค้ด/ปริ้น':'ตรวจข้อมูล + ปริ้น PDF';
      return "<div class='proof-actions proof-actions-ms'><button class='btn btn-accent' type='button' data-proof-print='"+P.escAttr(P.rowKey(row))+"' "+(enabled?'':'disabled')+" title='"+P.escAttr(title)+"'>"+label+"</button></div>";
    };

    const oldOpen=P.openEditor;
    P.openEditor=(row,detail)=>{
      oldOpen(row,detail);
      setTimeout(()=>{
        const routeBox=document.querySelector('.proof-editor-route-box');
        if(routeBox&&!routeBox.querySelector('.proof-editor-summary-v6')){
          const summary=document.createElement('div');summary.className='proof-editor-summary-v6';summary.innerHTML="<div><small>ปลายทาง</small><b>"+P.esc(P.destinationLabel(row))+"</b></div><div><small>ลักษณะ</small><b>"+P.esc(routeMode(row))+"</b></div><div><small>เส้นทาง</small><b>"+P.esc(routeType(row))+"</b></div>";routeBox.appendChild(summary);
        }
        const h=document.querySelector('.proof-editor-head h2');if(h)h.textContent='ตรวจ/แก้ข้อมูลก่อนปริ้นบาร์โค้ดรถ';
        const enhance=kind=>{
          const input=P.el(kind==='plate'?'proof-editor-plate-search':'proof-editor-driver-search');
          if(!input||input.dataset.v6==='1')return;
          input.dataset.v6='1';const wrap=input.parentElement,rowEl=document.createElement('div');rowEl.className='proof-search-row';wrap.insertBefore(rowEl,input);rowEl.appendChild(input);
          const b=document.createElement('button');b.type='button';b.className='btn btn-header proof-search-now';b.textContent='ค้นหา';rowEl.appendChild(b);
          const run=()=>{const q=String(input.value||'').trim();if(q.length<2){input.focus();return;}P.searchEditorOptions(kind,q);};b.onclick=run;input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();run();}});
        };
        enhance('plate');enhance('driver');
      },0);
    };

    const controlPost=async(action,payload={})=>{
      const r=await P.fetchWithTimeout(P.CONFIG.apiBase+'/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,token:P.state.auth&&P.state.auth.token||'',...payload})});
      let p=null;try{p=await r.json();}catch{}
      if(!r.ok||!p||!p.ok)throw P.apiError(p&&p.message||'ทำรายการไม่สำเร็จ',p&&p.code||'API_ERROR',r.status);return p.data;
    };
    const extractHar=async file=>{
      if(!file)throw new Error('กรุณาเลือกไฟล์ HAR');let har=null;try{har=JSON.parse(await file.text());}catch{throw new Error('อ่านไฟล์ HAR ไม่ได้');}
      const entries=Array.isArray(har&&har.log&&har.log.entries)?har.log.entries:[];
      for(const entry of entries){const hs=Array.isArray(entry&&entry.request&&entry.request.headers)?entry.request.headers:[];const get=n=>String((hs.find(h=>String(h&&h.name||'').toLowerCase()===n)||{}).value||'').trim();const sessionId=get('x-fle-session-id'),deviceId=get('x-device-id');if(sessionId&&deviceId)return{sessionId,deviceId};}
      throw new Error('ไฟล์ HAR ไม่มี Session ID หรือ Device ID ของ MS');
    };
    const renderSession=error=>{
      const ready=Boolean(P.state.auth&&P.state.profile&&!error),btn=document.getElementById('proof-session-btn'),panel=document.getElementById('proof-session-panel');
      if(btn){btn.classList.toggle('hidden',!P.state.auth);btn.textContent=ready?'Session ปริ้น: พร้อม':'เชื่อม Session ปริ้น';btn.classList.toggle('btn-accent',!ready);}
      if(panel){panel.classList.toggle('is-ready',ready);panel.classList.toggle('is-error',Boolean(error));document.getElementById('proof-session-panel-title').textContent=ready?'Session ปริ้นพร้อมใช้งาน':'ต้องตรวจ Session ปริ้น';document.getElementById('proof-session-panel-detail').textContent=ready?(P.state.profile.name||'บัญชี MS')+' • '+(P.state.profile.organizationName||P.state.branch):(error&&error.message||'ใช้ Session เดียวกับตัวเชื่อม MS ของ HUB นี้');document.getElementById('proof-session-panel-badge').textContent=ready?'พร้อม':'ตรวจ/เชื่อมต่อ';}
      const cur=document.getElementById('proof-session-current');if(cur)cur.textContent=ready?'พร้อม • '+(P.state.profile.name||'บัญชี MS'):(error&&error.message||'ยังไม่ได้ตรวจ Session');
    };
    const testSession=async(show=true)=>{
      if(!P.state.auth)return false;const status=document.getElementById('proof-session-action-status');if(status)status.textContent='กำลังตรวจ Session กับ MS…';
      try{const profile=await P.apiGet('/api/proof/profile',{token:P.state.auth.token,branch:P.state.branch});P.state.profile=profile;P.renderProfile();renderSession();if(status)status.textContent='พร้อมใช้งาน • '+(profile.name||'บัญชี MS');if(show)P.setLive('Session ปริ้นพร้อมใช้งาน','ok');return true;}
      catch(e){P.state.profile=null;P.renderProfile(e);renderSession(e);if(status)status.textContent=e.message||'Session ใช้งานไม่ได้';if(show)P.setLive(e.message||'Session ใช้งานไม่ได้','error');return false;}
    };
    const openSession=()=>{if(!P.state.auth){P.el('proof-login-dialog').showModal();return;}const hub=document.getElementById('proof-session-hub');if(hub)hub.textContent=P.state.branch;document.getElementById('proof-session-har').value='';document.getElementById('proof-session-action-status').textContent='Session นี้ใช้ทั้งดูข้อมูล Proof และสร้าง PDF จาก MS';document.getElementById('proof-session-dialog').showModal();testSession(false);};
    const closeSession=()=>{const d=document.getElementById('proof-session-dialog');if(d&&d.open)d.close();};
    const pair=async()=>{const b=document.getElementById('proof-session-qr'),s=document.getElementById('proof-session-action-status');try{b.disabled=true;s.textContent='กำลังสร้างหน้าสแกน QR…';const result=await controlPost('createMsPairing',{hub:P.state.branch});const popup=window.open(result.browserUrl,'ms-cloud-browser');if(!popup)throw new Error('เบราว์เซอร์บล็อก Pop-up กรุณาอนุญาตแล้วลองใหม่');s.textContent='เปิดหน้าสแกน QR แล้ว • เชื่อมเสร็จให้กลับมากด ตรวจ Session';}catch(e){s.textContent=e.message||'สร้าง QR ไม่สำเร็จ';}finally{b.disabled=false;}};
    const saveHar=async()=>{const b=document.getElementById('proof-session-save-har'),s=document.getElementById('proof-session-action-status'),file=document.getElementById('proof-session-har').files&&document.getElementById('proof-session-har').files[0];try{b.disabled=true;s.textContent='กำลังอ่าน HAR และตรวจ Session…';const c=await extractHar(file);await controlPost('saveMsConnection',{hub:P.state.branch,sessionId:c.sessionId,deviceId:c.deviceId});s.textContent='บันทึกแล้ว • กำลังตรวจบัญชี MS…';if(!await testSession(false))throw new Error('บันทึกแล้วแต่ Session ยังใช้งานกับ MS ไม่ได้');await P.loadRoutes(false);s.textContent='Session ปริ้นพร้อมใช้งานแล้ว';}catch(e){s.textContent=e.message||'บันทึก Session ไม่สำเร็จ';}finally{b.disabled=false;}};

    const oldPrint=P.printRoute;
    P.printRoute=async key=>{if(!P.state.auth)return;P.setLive('กำลังตรวจ Session ก่อนปริ้น…','stale');if(!await testSession(false)){alert('Session MS ใช้งานไม่ได้ กรุณาเชื่อมต่อ Session ปริ้นก่อน');openSession();return;}return oldPrint(key);};
    const oldProfile=P.renderProfile;P.renderProfile=error=>{oldProfile(error);renderSession(error);};

    const nav=document.querySelector('.topbar-actions');
    if(nav&&!document.getElementById('proof-session-btn')){const b=document.createElement('button');b.id='proof-session-btn';b.className='btn btn-header hidden';b.type='button';b.textContent='เชื่อม Session ปริ้น';nav.insertBefore(b,P.el('refresh-btn')||null);b.onclick=openSession;}
    const main=document.querySelector('main.app-shell');
    if(main&&!document.getElementById('proof-session-panel')){const panel=document.createElement('section');panel.id='proof-session-panel';panel.className='proof-session-panel';panel.innerHTML="<div><small>ตัวเชื่อมต่อสำหรับปริ้นบาร์โค้ด</small><strong id='proof-session-panel-title'>ต้องตรวจ Session ปริ้น</strong><span id='proof-session-panel-detail'>ใช้ Session เดียวกับตัวเชื่อม MS ของ HUB นี้</span></div><button id='proof-session-panel-badge' class='btn btn-header' type='button'>ตรวจ/เชื่อมต่อ</button>";main.insertBefore(panel,P.el('alert-panel')||main.firstChild);document.getElementById('proof-session-panel-badge').onclick=openSession;}
    if(!document.getElementById('proof-session-dialog')){document.body.insertAdjacentHTML('beforeend',"<dialog id='proof-session-dialog' class='proof-session-dialog'><div class='proof-session-card'><div class='proof-session-head'><div><small>MS Session ประจำ HUB <b id='proof-session-hub'>"+P.esc(P.state.branch)+"</b></small><h2>เชื่อมต่อ Session สำหรับปริ้นบาร์โค้ด</h2></div><button id='proof-session-close' class='dialog-close' type='button'>×</button></div><div class='proof-session-current-box'><span class='proof-session-dot'></span><div><small>สถานะปัจจุบัน</small><strong id='proof-session-current'>ยังไม่ได้ตรวจ Session</strong></div></div><p class='proof-session-note'>ไม่ต้องสร้าง Session แยกจากหน้าติดตามรถ ระบบใช้ Session เดียวกันของ HUB และชื่อบัญชี MS นี้จะเป็นผู้ดำเนินงานบน PDF</p><div class='proof-session-actions'><button id='proof-session-test' class='btn btn-header' type='button'>ตรวจ Session</button><button id='proof-session-qr' class='btn btn-accent' type='button'>เชื่อมต่อด้วย QR</button></div><details class='proof-session-har-box'><summary>หรืออัปโหลด HAR จาก MS</summary><p>ใช้ HAR จากหน้า MS ที่มี Session ล่าสุด ระบบอ่านเฉพาะ Session ID และ Device ID แล้วเก็บแบบเข้ารหัส</p><input id='proof-session-har' type='file' accept='.har,application/json'><button id='proof-session-save-har' class='btn btn-accent btn-full' type='button'>ทดสอบและบันทึก Session</button></details><p id='proof-session-action-status' class='proof-session-status'>Session นี้ใช้ทั้งดูข้อมูล Proof และสร้าง PDF จาก MS</p></div></dialog>");document.getElementById('proof-session-close').onclick=closeSession;document.getElementById('proof-session-test').onclick=()=>testSession(true);document.getElementById('proof-session-qr').onclick=pair;document.getElementById('proof-session-save-har').onclick=saveHar;document.getElementById('proof-session-dialog').oncancel=e=>{e.preventDefault();closeSession();};}

    const tableHead=document.querySelector('.proof-table thead tr');if(tableHead)tableHead.innerHTML='<th>ชื่อเส้นทาง / ปลายทาง</th><th>รถ / ทะเบียน</th><th>คนขับ / เบอร์</th><th>Standby / ปล่อย</th><th>บาร์โค้ดรถ</th><th>สถานะ</th><th>ปริ้น</th>';
    const heading=document.querySelector('.proof-heading p');if(heading)heading.textContent='ดูรถที่ต้องจัดการ ตรวจทะเบียน/คนขับตามสิทธิ์ MS และปริ้นบาร์โค้ดด้วย Session ของ HUB';
    if(P.el('refresh-btn'))P.el('refresh-btn').textContent='รีเฟรชข้อมูล';

    const style=document.createElement('style');style.id='proof-v6-style';style.textContent=\`
      .proof-session-panel{display:flex;align-items:center;justify-content:space-between;gap:14px;background:#fff;border:1px solid #deded8;border-left:6px solid #d19f00;padding:12px 14px;margin:0 0 14px}.proof-session-panel small{display:block;color:#777;font-size:11px}.proof-session-panel strong{display:block;font-size:15px;margin-top:2px}.proof-session-panel span{display:block;color:#666;font-size:12px;margin-top:3px}.proof-session-panel.is-ready{border-left-color:#16803c;background:#f7fff9}.proof-session-panel.is-error{border-left-color:#b3261e;background:#fff8f7}
      .proof-group{border-radius:5px!important}.proof-group-head{border-radius:0!important;padding:11px 12px!important}.proof-group-body{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(430px,1fr));gap:10px;padding:10px;background:#f3f3f1}
      .proof-ms-card{background:#fff;border:1px solid #d8d8d2;border-radius:8px;overflow:hidden;min-width:0}.proof-ms-card.needs-action{border-color:#d8bd4c}.proof-ms-card-topline{height:6px;background:#151515}.proof-ms-card-head{text-align:center;padding:13px 14px 12px}.proof-ms-card-badges{display:flex;gap:8px;justify-content:center;margin-bottom:8px}.proof-ms-dark-badge,.proof-ms-vehicle-badge{display:inline-flex;align-items:center;justify-content:center;min-height:30px;padding:5px 11px;border-radius:4px;font-size:12px;font-weight:900}.proof-ms-dark-badge{background:#151515;color:#fff}.proof-ms-vehicle-badge{background:#e9ece9;color:#202020;border:1px solid #a8aaa5}.proof-ms-card-head h3{font-size:15px;line-height:1.45;margin:0;word-break:break-word}.proof-ms-card-head p{display:flex;justify-content:center;gap:6px;flex-wrap:wrap;margin:7px 0 0;color:#767676;font-size:11px}
      .proof-ms-yellow-grid{display:grid;grid-template-columns:repeat(3,1fr);background:#ffd84f;border-top:1px solid #d6b32d;border-bottom:1px solid #d6b32d}.proof-ms-yellow-grid>div{text-align:center;padding:8px 6px;border-right:1px solid #c7a52e}.proof-ms-yellow-grid>div:last-child{border-right:0}.proof-ms-yellow-grid small,.proof-ms-pair small,.proof-ms-driver-strip small{display:block;font-size:10px;font-weight:700;color:#545454}.proof-ms-yellow-grid strong{display:block;margin-top:2px;font-size:12px;color:#151515}
      .proof-ms-section{margin:10px 12px 0;border:1px solid #dddcd7;border-radius:7px;overflow:hidden}.proof-ms-section-title{text-align:center;font-size:12px;font-weight:900;padding:7px}.proof-ms-section-title.light{background:#e7e9e7;color:#333}.proof-ms-section-title.dark{background:#242424;color:#fff}.proof-ms-pair{display:grid;grid-template-columns:1fr 1fr;padding:10px 8px}.proof-ms-pair>div{text-align:center;padding:2px 8px}.proof-ms-pair>div+div{border-left:1px solid #d6d6d0}.proof-ms-pair strong{display:block;margin-top:4px;font-size:13px;word-break:break-word}.proof-ms-status-center{text-align:center;padding:0 8px 9px}.proof-ms-driver-strip{display:grid;grid-template-columns:1fr 1fr;margin:10px 12px 0;border:1px solid #dddcd7;background:#fafafa}.proof-ms-driver-strip>div{padding:9px 10px}.proof-ms-driver-strip>div+div{border-left:1px solid #dddcd7}.proof-ms-driver-strip strong{display:block;margin-top:3px;font-size:12px;word-break:break-word}.proof-ms-alert{margin:10px 12px 0;border-radius:6px;padding:8px 10px;text-align:center;font-size:11px}.proof-ms-alert.danger{background:#fff0ee;color:#a5362d;border:1px solid #e5aaa4}.proof-ms-alert.warning{background:#fff7da;color:#806000;border:1px solid #e1c66a}.proof-ms-alert.extra,.proof-ms-alert.info{background:#f1f1ef;color:#444;border:1px solid #d8d8d2}.proof-ms-card-footer{padding:10px 12px 12px}.proof-actions-ms{display:block}.proof-actions-ms .btn{width:100%;min-height:38px;font-weight:900}
      .proof-table{border-collapse:separate!important;border-spacing:0!important;border:1px solid #d5d5cf}.proof-table thead th{background:#ffd84f!important;color:#151515!important;border-right:1px solid #c5a42f!important;padding:10px 8px!important;font-size:11px!important}.proof-table tbody td{border-top:1px solid #e1e1dc!important;padding:9px 8px!important}.proof-table tbody tr:nth-child(even){background:#fafaf7}.proof-table .proof-actions-ms .btn{min-height:32px;font-size:10px;padding:5px 7px}
      .proof-editor-dialog,.proof-session-dialog{border:0;border-radius:8px;padding:0;width:min(720px,calc(100vw - 16px));max-width:none;max-height:94dvh}.proof-editor-dialog::backdrop,.proof-session-dialog::backdrop{background:rgba(0,0,0,.58)}.proof-editor-card,.proof-session-card{background:#fff;padding:14px;overflow:auto;max-height:94dvh}.proof-editor-route-box{background:#fff!important;color:#222!important;border:1px solid #d7d7d1!important;border-top:6px solid #151515!important;border-radius:6px!important;text-align:center}.proof-editor-route-box small{color:#777!important}.proof-editor-route-box strong{font-size:14px}.proof-editor-state{background:#ffd84f!important;color:#151515!important;border-radius:4px!important}.proof-editor-meta{color:#666!important;justify-content:center}.proof-editor-meta b{color:#222!important}.proof-editor-summary-v6{display:grid;grid-template-columns:repeat(3,1fr);margin:10px -13px -12px;background:#ffd84f;border-top:1px solid #d6b32d}.proof-editor-summary-v6>div{padding:7px 5px;border-right:1px solid #c7a52e}.proof-editor-summary-v6>div:last-child{border-right:0}.proof-editor-summary-v6 small{display:block;font-size:9px;color:#555}.proof-editor-summary-v6 b{display:block;font-size:11px;margin-top:2px}.proof-editor-section{border-radius:6px!important}.proof-editor-section-head{background:#e7e9e7!important;padding:9px 10px!important}.proof-search-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px}.proof-search-row input{min-height:40px!important;border-radius:4px!important}.proof-search-now{min-width:76px}.proof-option{border-radius:4px!important}.proof-confirm-check{border-radius:4px!important}.proof-editor-actions{position:sticky;bottom:-14px;background:#fff;border-top:1px solid #ddd;padding-top:8px;z-index:2}
      .proof-session-head{display:flex;justify-content:space-between;gap:12px}.proof-session-head h2{margin:2px 0 0;font-size:19px}.proof-session-head small{color:#777}.proof-session-current-box{display:flex;gap:10px;align-items:center;margin-top:12px;padding:10px;border:1px solid #dcdcd6;background:#f8f8f5}.proof-session-dot{width:12px;height:12px;border-radius:50%;background:#d19f00}.proof-session-current-box small{display:block;color:#777;font-size:10px}.proof-session-current-box strong{display:block;margin-top:2px;font-size:13px}.proof-session-note{font-size:11px;line-height:1.55;color:#5f5f5a;background:#fff8d9;border-left:4px solid #ffd400;padding:9px 10px}.proof-session-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px}.proof-session-har-box{margin-top:10px;border:1px solid #deded8;padding:9px}.proof-session-har-box summary{font-weight:800;cursor:pointer}.proof-session-har-box p,.proof-session-status{font-size:10px;color:#777}.proof-session-har-box input{width:100%;margin:6px 0 8px}
      @media(max-width:900px){.proof-group-body{grid-template-columns:1fr}.proof-desktop{display:none!important}.proof-mobile{display:block!important}.proof-mobile .proof-ms-card{margin-bottom:10px}}
      @media(max-width:760px){.proof-session-panel{align-items:flex-start}.proof-ms-card-head{padding:12px 10px 10px}.proof-ms-section,.proof-ms-driver-strip{margin-left:9px;margin-right:9px}.proof-ms-card-footer{padding-left:9px;padding-right:9px}.proof-editor-card,.proof-session-card{padding:11px}.proof-editor-section-head{display:block!important}.proof-session-actions{grid-template-columns:1fr 1fr}}
      @media(max-width:430px){.proof-session-panel{display:block}.proof-session-panel button{margin-top:8px;width:100%}.proof-ms-driver-strip{grid-template-columns:1fr}.proof-ms-driver-strip>div+div{border-left:0;border-top:1px solid #dddcd7}.proof-session-actions{grid-template-columns:1fr}}
    \`;document.head.appendChild(style);
    renderSession();P.render();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(start,0),{once:true});else setTimeout(start,0);
})();`;