(()=>{
  const P=window.ProofV2;
  const baseRender=P.render;

  P.STATE_LABELS={
    1:'รอเปิดบาร์โค้ด',
    2:'เปิดบาร์โค้ดแล้ว',
    7:'ถึงสาขาต้นทางแล้ว',
    3:'รถออกจากต้นทางแล้ว',
    4:'จบเที่ยวแล้ว',
    6:'รอยกเลิก',
    5:'ยกเลิกแล้ว',
  };

  P.stateText=row=>P.STATE_LABELS[Number(row?.proofState)]||row?.proofStateText||'ไม่ทราบสถานะ';
  P.standbyText=row=>{
    const release=P.minuteText(row.plannedDepartureTime??row.startTime);
    if(!row.detailReady||!Number.isFinite(Number(row.standbyTime)))return `กำลังอ่านเวลา Standby • ปล่อยตามแผน ${release}`;
    return `Standby ${P.minuteText(row.standbyTime)} • ปล่อยตามแผน ${release}`;
  };
  P.alertForRow=(row,now=Date.now())=>{
    if(Number(row.proofState)!==1)return null;
    const a=row.acknowledgements||{},standby=P.routeStandbyMs(row);
    if(Number.isFinite(standby)){
      const diff=standby-now;
      if(diff<=0&&!a['standby-due'])return {key:'standby-due',priority:3,tone:'danger',icon:'⚠',title:`เลยเวลา Standby มาแล้ว ${P.durationShort(Math.abs(diff))}`};
      if(diff>0&&diff<=P.CONFIG.standbyLeadMinutes*60_000&&!a['standby-soon'])return {key:'standby-soon',priority:2,tone:'warning',icon:'🔔',title:`ใกล้ถึงเวลา Standby • อีก ${P.durationShort(diff)}`};
    }
    if(row.firstSeenAt&&!a.new)return {key:'new',priority:1,tone:Number(row.lineMode)===2?'extra':'info',icon:'🆕',title:Number(row.lineMode)===2?'พบรถเสริมใหม่':'พบเที่ยวรถใหม่'};
    return null;
  };
  P.activeAlerts=rows=>(rows||[]).map(row=>({row,alert:P.alertForRow(row)})).filter(x=>x.alert).sort((a,b)=>b.alert.priority-a.alert.priority||P.destinationKey(a.row).localeCompare(P.destinationKey(b.row),'th'));
  P.stateBadge=row=>{
    const code=Number(row.proofState),label=P.stateText(row);
    return `<span class='proof-state s${Number.isFinite(code)?code:''}'>${P.esc(label)}</span>`;
  };
  P.standbyBadge=row=>{
    if(!row.detailReady||!Number.isFinite(Number(row.standbyTime)))return `<span class='proof-standby-badge loading'>กำลังอ่านเวลา Standby</span>`;
    const at=P.routeStandbyMs(row);
    if(!Number.isFinite(at))return '';
    if(Number(row.proofState)!==1)return `<span class='proof-standby-badge'>Standby ${P.esc(P.minuteText(row.standbyTime))}</span>`;
    const d=at-Date.now();
    if(d<=0)return `<span class='proof-standby-badge danger'>เลย Standby ${P.esc(P.durationShort(Math.abs(d)))}</span>`;
    if(d<=P.CONFIG.standbyLeadMinutes*60_000)return `<span class='proof-standby-badge warning'>ใกล้ Standby • อีก ${P.esc(P.durationShort(d))}</span>`;
    return `<span class='proof-standby-badge'>Standby ${P.esc(P.minuteText(row.standbyTime))}</span>`;
  };

  P.actionButtons=row=>{
    const code=Number(row.proofState),canPrint=Boolean(P.state.profile?.canPrint)&&P.PRINTABLE_STATES.has(code),canCreate=code!==1||Boolean(P.state.profile?.canCreateProof),enabled=canPrint&&canCreate&&Boolean(row.lineId)&&Boolean(row.departureDate),label=code===1?'ตรวจข้อมูล + ปริ้น':'ตรวจข้อมูล + ปริ้น PDF';
    let title='';
    if(!P.state.profile?.canPrint)title='บัญชี MS นี้ไม่มีสิทธิ์ปริ้น';
    else if(code===1&&!P.state.profile?.canCreateProof)title='บัญชี MS นี้ไม่มีสิทธิ์เปิดใช้งานบาร์โค้ด';
    else if(!P.PRINTABLE_STATES.has(code))title='สถานะนี้ไม่รองรับการปริ้นจากหน้าเว็บ';
    return `<div class='proof-actions'><button class='btn btn-accent' type='button' data-proof-print='${P.escAttr(P.rowKey(row))}' ${enabled?'':'disabled'} title='${P.escAttr(title)}'>${P.esc(label)}</button><button class='btn btn-danger-soft' type='button' disabled title='ฟังก์ชันยกเลิกรถยังปิดไว้เพื่อป้องกันผลกระทบหน้างาน'>ยกเลิกรถ</button></div>`;
  };

  P.infoCell=(label,value,cls='')=>`<div class='proof-info-cell ${cls}'><small>${P.esc(label)}</small><strong>${P.esc(value||'—')}</strong></div>`;
  P.groupRouteCard=row=>{
    const car=[row.plateTypeText,row.plateNumber].filter(Boolean).join(' • ')||'ยังไม่กำหนดรถ/ทะเบียน';
    const driver=row.driver||'ยังไม่กำหนดคนขับ';
    const phone=row.driverPhone||'—';
    const barcode=row.proofId||'ยังไม่มีบาร์โค้ด';
    return `<article class='proof-route-card proof-route-card-v3 ${Number(row.proofState)===1?'needs-action':''}'>
      <div class='proof-route-card-main'>
        <div class='proof-route-card-title'><strong>${P.esc(row.lineName||'—')}</strong><span class='proof-inline-badges'>${P.routeBadges(row)}</span></div>
        <div class='proof-info-grid'>
          ${P.infoCell('รถ / ทะเบียน',car)}
          ${P.infoCell('คนขับ',driver)}
          ${P.infoCell('เบอร์โทร',phone)}
          ${P.infoCell('บาร์โค้ดรถ',barcode)}
          ${P.infoCell('เวลาแผน',P.standbyText(row),'wide')}
        </div>
      </div>
      <div class='proof-route-card-side'><div class='proof-status-stack'>${P.stateBadge(row)}${P.standbyBadge(row)}</div>${P.actionButtons(row)}</div>
    </article>`;
  };
  P.groupedHtml=rows=>{
    const g=new Map();
    for(const row of rows){const k=P.destinationKey(row);if(!g.has(k))g.set(k,[]);g.get(k).push(row);}
    return [...g.entries()].sort((a,b)=>P.groupPriority(b[1])-P.groupPriority(a[1])||a[0].localeCompare(b[0],'th')).map(([key,items])=>{
      const pending=items.filter(x=>Number(x.proofState)===1).length,extra=items.filter(x=>Number(x.lineMode)===2).length,alerts=items.filter(x=>P.alertForRow(x)).length,open=P.groupIsOpen(key,items),chips=[`${P.nf.format(items.length)} เที่ยว`,pending?`รอปริ้น ${P.nf.format(pending)}`:'ไม่มีเที่ยวรอปริ้น',extra?`รถเสริม ${P.nf.format(extra)}`:'',alerts?`ต้องดำเนินการ ${P.nf.format(alerts)}`:''].filter(Boolean);
      return `<section class='proof-group ${open?'is-open':'is-collapsed'}'><button class='proof-group-head' type='button' data-proof-group='${P.escAttr(key)}'><span class='proof-group-chevron'>${open?'▾':'▸'}</span><span class='proof-group-name'><strong>${P.esc(P.destinationGroupLabel(items[0]))}</strong><small>${P.esc(chips.join(' • '))}</small></span>${alerts?`<span class='proof-group-alert'>${P.nf.format(alerts)}</span>`:''}</button>${open?`<div class='proof-group-body'>${items.map(P.groupRouteCard).join('')}</div>`:''}</section>`;
    }).join('');
  };
  P.tableRow=row=>`<tr><td class='proof-route'><strong>${P.esc(row.lineName||'—')}</strong><small>${P.routeBadges(row)} ${P.esc(P.destinationLabel(row))}</small></td><td class='proof-car'><strong>${P.esc(row.plateNumber||'ยังไม่กำหนดทะเบียน')}</strong><small>${P.esc(row.plateTypeText||'—')}</small></td><td class='proof-driver'><strong>${P.esc(row.driver||'ยังไม่กำหนดคนขับ')}</strong><small>${P.esc(row.driverPhone||'—')}</small></td><td><strong>${P.esc(P.standbyText(row))}</strong><small>${P.esc(row.departureDate||'')}</small></td><td><strong>${P.esc(row.proofId||'ยังไม่มี')}</strong></td><td>${P.stateBadge(row)}${P.standbyBadge(row)}</td><td>${P.actionButtons(row)}</td></tr>`;
  P.mobileCard=row=>`<article class='proof-card proof-card-v3'><div class='proof-card-top'><h3>${P.esc(row.lineName||'—')}</h3>${P.stateBadge(row)}</div><div class='proof-inline-badges proof-mobile-badges'>${P.routeBadges(row)}</div><div class='proof-mobile-info-grid'>${P.infoCell('ปลายทาง',P.destinationLabel(row))}${P.infoCell('รถ / ทะเบียน',[row.plateTypeText,row.plateNumber].filter(Boolean).join(' • ')||'ยังไม่กำหนด')}${P.infoCell('คนขับ',row.driver||'ยังไม่กำหนด')}${P.infoCell('เบอร์โทร',row.driverPhone||'—')}${P.infoCell('เวลาแผน',P.standbyText(row),'wide')}${P.infoCell('บาร์โค้ดรถ',row.proofId||'ยังไม่มี')}</div><div class='proof-card-bottom'>${P.standbyBadge(row)}${P.actionButtons(row)}</div></article>`;

  P.renderAlerts=alerts=>{
    const panel=P.el('alert-panel');
    if(!alerts.length){panel.classList.add('hidden');P.el('alert-list').innerHTML='';return;}
    panel.classList.remove('hidden');
    P.el('alert-count').textContent=`${P.nf.format(alerts.length)} รายการ`;
    P.el('alert-list').innerHTML=alerts.map(({row,alert})=>`<article class='proof-alert ${P.escAttr(alert.tone)}'><div class='proof-alert-main'><div class='proof-alert-title'><span class='proof-alert-icon'>${P.esc(alert.icon)}</span><div><strong>${P.esc(alert.title)}</strong><small>${P.esc([P.destinationLabel(row),row.lineModeText||'',row.plateTypeText||''].filter(Boolean).join(' • '))}</small></div></div><div class='proof-alert-route'>${P.esc(row.lineName||'—')}</div><div class='proof-alert-meta'>${P.esc(P.standbyText(row))} • ${P.esc(P.stateText(row))}</div></div><div class='proof-alert-actions'><button class='btn btn-accent' type='button' data-proof-ack='${P.escAttr(P.rowKey(row))}' data-alert-key='${P.escAttr(alert.key)}'>รับทราบ</button><button class='btn btn-header' type='button' data-proof-open-group='${P.escAttr(P.destinationKey(row))}'>ดูสาขา ${P.esc(P.destinationShort(row))}</button></div></article>`).join('');
  };

  P.resetFilters=includeSearch=>{
    const s=P.state;
    s.stateFilter='all';s.lineType='all';s.lineMode='all';s.vehicle='all';if(includeSearch)s.query='';
    P.el('state-filter').value='all';P.el('line-type-filter').value='all';P.el('line-mode-filter').value='all';P.el('vehicle-filter').value='all';if(includeSearch)P.el('search-input').value='';
  };
  P.acknowledgeAlert=async(key,alertKey)=>{
    const row=P.state.rows.find(x=>P.rowKey(x)===key);
    if(!row||!P.state.auth||!alertKey)return;
    try{
      const d=await P.apiPost('/api/proof/ack',{token:P.state.auth.token,branch:P.state.branch,lineId:row.lineId,departureDate:row.departureDate,alertKey});
      row.acknowledgements ||= {};
      row.acknowledgements[alertKey]={at:d.acknowledgedAt||new Date().toISOString(),by:d.acknowledgedBy||P.state.auth.username||''};
      P.render();
    }catch(e){P.handleApiError(e,false);alert(e.message||'บันทึกรับทราบไม่สำเร็จ');}
  };

  P.showPrintConfirmation=(row,latest,msName)=>new Promise(resolve=>{
    const dialog=P.el('proof-print-confirm-dialog');
    const code=Number(latest.proofState??row.proofState);
    const route=latest.lineName||row.lineName||'—';
    const car=[latest.plateTypeText||row.plateTypeText,latest.plateNumber||row.plateNumber].filter(Boolean).join(' • ')||'ยังไม่กำหนด';
    const driver=latest.driver||row.driver||'ยังไม่กำหนด';
    const phone=latest.driverPhone||row.driverPhone||'—';
    const barcode=latest.proofId||row.proofId||'ยังไม่มี — ระบบจะสร้างเมื่อยืนยัน';
    const status=latest.proofStateText||P.stateText({...row,proofState:code});
    const actionText=code===1?'ข้อมูลถูกต้อง • เปิดใช้และปริ้น':'ข้อมูลถูกต้อง • ปริ้น PDF';
    P.el('proof-print-confirm-title').textContent=code===1?'ตรวจข้อมูลก่อนเปิดใช้และปริ้น':'ตรวจข้อมูลก่อนปริ้น PDF';
    P.el('proof-print-confirm-grid').innerHTML=`
      <div><small>เส้นทาง</small><strong>${P.esc(route)}</strong></div>
      <div><small>สถานะล่าสุดจาก MS</small><strong>${P.esc(status)}</strong></div>
      <div><small>รถ / ทะเบียน</small><strong>${P.esc(car)}</strong></div>
      <div><small>คนขับ</small><strong>${P.esc(driver)}</strong></div>
      <div><small>เบอร์โทร</small><strong>${P.esc(phone)}</strong></div>
      <div><small>บาร์โค้ดรถ</small><strong>${P.esc(barcode)}</strong></div>
      <div class='wide'><small>เวลาแผน</small><strong>${P.esc(P.standbyText(row))}</strong></div>
      <div class='wide'><small>ชื่อผู้ดำเนินงานบน PDF</small><strong>${P.esc(msName)}</strong></div>`;
    P.el('proof-print-confirm-note').textContent=code===1?'เมื่อกดยืนยัน ระบบจะเปิดใช้งานบาร์โค้ดใน MS และสร้าง PDF โดยใช้ข้อมูลล่าสุดจาก MS':'เมื่อกดยืนยัน ระบบจะสร้าง PDF โดยใช้ข้อมูลล่าสุดจาก MS';
    const confirmBtn=P.el('proof-print-confirm-ok'),cancelBtn=P.el('proof-print-confirm-cancel'),backBtn=P.el('proof-print-confirm-back');
    confirmBtn.textContent=actionText;
    const finish=(value)=>{confirmBtn.onclick=null;cancelBtn.onclick=null;backBtn.onclick=null;dialog.oncancel=null;if(dialog.open)dialog.close();resolve(value);};
    cancelBtn.onclick=()=>finish({confirmed:false,preview:null});
    backBtn.onclick=()=>finish({confirmed:false,preview:null});
    dialog.oncancel=e=>{e.preventDefault();finish({confirmed:false,preview:null});};
    confirmBtn.onclick=()=>{
      const preview=window.open('','_blank');
      if(preview){preview.document.write(`<!doctype html><meta charset='utf-8'><title>กำลังสร้าง PDF</title><body style='font-family:sans-serif;padding:24px'>กำลังขอไฟล์ PDF จาก MS…</body>`);preview.document.close();}
      finish({confirmed:true,preview});
    };
    dialog.showModal();
  });

  P.printRoute=async key=>{
    let row=P.state.rows.find(x=>P.rowKey(x)===key);
    if(!row||!P.state.auth)return;
    const originalCode=Number(row.proofState);
    if(!P.PRINTABLE_STATES.has(originalCode))return;
    P.setLive('กำลังตรวจข้อมูลล่าสุดจาก MS ก่อนปริ้น…','stale');
    try{
      const latest=await P.apiGet('/api/proof/print-preview',{token:P.state.auth.token,branch:P.state.branch,lineId:row.lineId,departureDate:row.departureDate});
      const latestCode=Number(latest.proofState);
      if(!P.PRINTABLE_STATES.has(latestCode)){
        P.setLive('สถานะใน MS เปลี่ยนแล้ว • กำลังรีเฟรช','stale');
        await P.loadRoutes(true);
        alert(`สถานะล่าสุดของเที่ยวนี้คือ “${latest.proofStateText||'ไม่รองรับการปริ้น'}”\nระบบยังไม่ได้เปิดใช้หรือปริ้นอะไร`);
        return;
      }
      const msName=P.state.profile?.name||'บัญชี MS ที่เชื่อมอยู่';
      const decision=await P.showPrintConfirmation(row,latest,msName);
      if(!decision.confirmed){P.renderFreshness();return;}
      const preview=decision.preview;
      P.setLive('กำลังสร้าง PDF ผ่าน MS…','stale');
      const r=await P.fetchWithTimeout(`${P.CONFIG.apiBase}/api/proof/print`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:P.state.auth.token,branch:P.state.branch,lineId:row.lineId,departureDate:row.departureDate})});
      if(!r.ok){let p=null;try{p=await r.json();}catch{}throw P.apiError(p?.message||`ปริ้นไม่สำเร็จ (${r.status})`,p?.code||'PRINT_FAILED',r.status);}
      const blob=await r.blob();
      if(!String(blob.type||'').toLowerCase().includes('pdf'))throw P.apiError('MS ไม่ได้ส่ง PDF กลับมา','PRINT_INVALID_PDF',502);
      const url=URL.createObjectURL(blob);
      if(preview)preview.location.replace(url);else window.open(url,'_blank');
      setTimeout(()=>URL.revokeObjectURL(url),120_000);
      P.setLive('ปริ้นสำเร็จ • กำลังอัปเดตสถานะล่าสุด','ok');
      await new Promise(resolve=>setTimeout(resolve,800));
      await P.loadRoutes(true);
    }catch(e){
      P.handleApiError(e,false);
      P.setLive(e.message||'ปริ้นไม่สำเร็จ','error');
      alert(`${e.message||'ปริ้นไม่สำเร็จ'}\nระบบจะไม่ทำขั้นตอนต่อหากตรวจข้อมูลก่อนปริ้นไม่ผ่าน`);
    }
  };

  P.installProofPolish=()=>{
    const nav=document.querySelector('.topbar-actions');
    if(nav&&!nav.querySelector('.app-nav')){
      nav.querySelectorAll('a.header-link').forEach(a=>a.remove());
      const menu=document.createElement('details');
      menu.className='app-nav';
      menu.innerHTML=`<summary><span class='nav-grid-icon'>▦</span><span>เมนูระบบ</span><small>จัดการเส้นทาง MS</small></summary><div class='app-nav-menu'><a href='ms.html'><span>🚚</span><b>ติดตามรถ MS</b><small>คิวรถเข้า–ออกและสถานะปัจจุบัน</small></a><a href='proof.html' class='is-current'><span>🧾</span><b>จัดการเส้นทาง MS</b><small>ตรวจสถานะและปริ้นบาร์โค้ดรถ</small></a><a href='waiting.html'><span>⏱</span><b>รถรอลงงาน</b><small>จัดการคิวและเวลารอลงงาน</small></a><a href='ms-report.html'><span>▥</span><b>สรุปรายวัน</b><small>ดูและเปรียบเทียบข้อมูลรายวัน</small></a></div>`;
      const badge=P.el('connection-badge');
      badge?.insertAdjacentElement('afterend',menu);
    }
    const refresh=P.el('refresh-btn');
    if(refresh)refresh.textContent='รีเฟรชข้อมูล';
    const alertHead=document.querySelector('.proof-alert-panel-head strong');
    if(alertHead)alertHead.textContent='รายการที่ต้องดำเนินการ';
    if(!P.el('proof-print-confirm-dialog')){
      document.body.insertAdjacentHTML('beforeend',`<dialog id='proof-print-confirm-dialog' class='proof-print-confirm-dialog'><div class='proof-confirm-card'><div class='proof-confirm-head'><div><small>ตรวจจาก MS แบบอ่านอย่างเดียวก่อน</small><h2 id='proof-print-confirm-title'>ตรวจข้อมูลก่อนปริ้น</h2></div><button id='proof-print-confirm-cancel' class='dialog-close' type='button' aria-label='ปิด'>×</button></div><div id='proof-print-confirm-grid' class='proof-confirm-grid'></div><p id='proof-print-confirm-note' class='proof-confirm-note'></p><div class='proof-confirm-actions'><button id='proof-print-confirm-back' class='btn btn-header' type='button'>กลับไปแก้/ตรวจอีกครั้ง</button><button id='proof-print-confirm-ok' class='btn btn-accent' type='button'>ข้อมูลถูกต้อง • ปริ้น</button></div></div></dialog>`);
    }
    if(!P.el('proof-v3-polish-style')){
      const style=document.createElement('style');
      style.id='proof-v3-polish-style';
      style.textContent=`
        .proof-route-card-v3{align-items:stretch;padding:14px 16px}.proof-route-card-v3 .proof-route-card-main{display:grid;gap:10px}.proof-route-card-v3 .proof-route-card-title{padding-bottom:2px}.proof-info-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.proof-info-cell{border:1px solid #e2e2dc;background:#f8f8f5;border-radius:11px;padding:9px 10px;min-width:0}.proof-info-cell small{display:block;color:#777;font-size:10px;font-weight:700;margin-bottom:4px}.proof-info-cell strong{display:block;font-size:12px;line-height:1.4;word-break:break-word}.proof-info-cell.wide{grid-column:span 2}.proof-route-card-v3 .proof-route-card-side{min-width:205px;justify-content:space-between;align-items:stretch}.proof-status-stack{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.proof-route-card-v3 .proof-actions{justify-content:flex-end}.proof-mobile-info-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.proof-card-bottom{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:12px}.proof-print-confirm-dialog{border:0;padding:0;border-radius:18px;width:min(680px,calc(100vw - 24px));max-width:none}.proof-print-confirm-dialog::backdrop{background:rgba(0,0,0,.55)}.proof-confirm-card{padding:20px;background:#fff}.proof-confirm-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.proof-confirm-head h2{margin:3px 0 0;font-size:22px}.proof-confirm-head small{color:#777;font-weight:700}.proof-confirm-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:16px}.proof-confirm-grid>div{border:1px solid #deded8;background:#f8f8f5;border-radius:11px;padding:10px}.proof-confirm-grid>div.wide{grid-column:1/-1}.proof-confirm-grid small{display:block;color:#777;font-size:11px;margin-bottom:4px}.proof-confirm-grid strong{display:block;font-size:14px;line-height:1.45;word-break:break-word}.proof-confirm-note{background:#fff6d8;border:1px solid #ead47c;border-radius:11px;padding:10px 12px;font-size:12px;line-height:1.5}.proof-confirm-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:14px}
        @media(max-width:900px){.proof-info-grid{grid-template-columns:1fr 1fr}.proof-route-card-v3 .proof-route-card-side{min-width:0}.proof-route-card-v3 .proof-actions,.proof-status-stack{justify-content:flex-start}}
        @media(max-width:760px){.proof-route-card-v3{padding:14px}.proof-route-card-v3 .proof-route-card-side{margin-top:12px;gap:10px}.proof-info-grid{grid-template-columns:1fr 1fr}.proof-info-cell.wide{grid-column:1/-1}.proof-route-card-v3 .proof-actions{width:100%}.proof-route-card-v3 .proof-actions .btn{flex:1}.proof-confirm-actions .btn{flex:1;min-width:150px}}
        @media(max-width:430px){.proof-info-grid,.proof-mobile-info-grid,.proof-confirm-grid{grid-template-columns:1fr}.proof-info-cell.wide{grid-column:auto}.proof-confirm-grid>div.wide{grid-column:auto}.proof-confirm-card{padding:16px}.proof-confirm-actions{display:grid;grid-template-columns:1fr}.proof-confirm-actions .btn{width:100%}}
      `;
      document.head.appendChild(style);
    }
  };

  P.render=()=>{
    baseRender();
    const progress=P.el('detail-progress');
    if(progress)progress.textContent=P.state.detailRemaining>0?`กำลังอ่านเวลา Standby และปลายทางอีก ${P.nf.format(P.state.detailRemaining)} เที่ยว`:'เวลา Standby และปลายทางพร้อมแล้ว';
    const alertHead=document.querySelector('.proof-alert-panel-head strong');
    if(alertHead)alertHead.textContent='รายการที่ต้องดำเนินการ';
  };

  P.bindEvents=()=>{
    P.el('refresh-btn').onclick=()=>P.loadAll(false);
    P.el('login-btn').onclick=()=>P.el('proof-login-dialog').showModal();
    P.el('login-close').onclick=P.closeLogin;
    P.el('login-form').onsubmit=P.login;
    P.el('logout-btn').onclick=P.logout;
    P.el('branch-filter').onchange=async e=>{P.state.branch=String(e.target.value||'NE1').toUpperCase();P.state.profile=null;P.state.groupOpen.clear();P.resetFilters(false);await P.loadAll(false);};
    P.el('day-filter').onchange=async e=>{P.state.day=e.target.value||P.thaiDay();P.state.stateFilter='all';P.state.groupOpen.clear();P.el('state-filter').value='all';await P.loadRoutes(false);};
    P.el('line-type-filter').onchange=e=>{P.state.lineType=e.target.value;P.render();};
    P.el('line-mode-filter').onchange=e=>{P.state.lineMode=e.target.value;P.render();};
    P.el('state-filter').onchange=e=>{P.state.stateFilter=e.target.value;P.render();};
    P.el('vehicle-filter').onchange=e=>{P.state.vehicle=e.target.value;P.render();};
    P.el('search-input').oninput=e=>{P.state.query=e.target.value.trim().toLowerCase();P.render();};
    P.el('clear-filter-btn').onclick=()=>{P.resetFilters(true);P.render();};
    P.el('group-view-btn').onclick=()=>{P.state.viewMode='group';P.render();};
    P.el('list-view-btn').onclick=()=>{P.state.viewMode='list';P.render();};
    document.querySelectorAll('[data-state]').forEach(card=>{card.tabIndex=0;card.setAttribute('role','button');card.onclick=()=>{P.state.stateFilter=card.dataset.state||'all';P.el('state-filter').value=P.state.stateFilter;P.render();};card.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();card.click();}};});
    document.addEventListener('click',e=>{
      const print=e.target.closest('[data-proof-print]');if(print){P.printRoute(print.dataset.proofPrint);return;}
      const ack=e.target.closest('[data-proof-ack]');if(ack){P.acknowledgeAlert(ack.dataset.proofAck,ack.dataset.alertKey);return;}
      const open=e.target.closest('[data-proof-open-group]');if(open){const key=open.dataset.proofOpenGroup;P.state.viewMode='group';P.state.groupOpen.set(key,true);P.render();setTimeout(()=>document.querySelector(`[data-proof-group='${P.cssEscape(key)}']`)?.scrollIntoView({behavior:'smooth',block:'center'}),0);return;}
      const group=e.target.closest('[data-proof-group]');if(group){const key=group.dataset.proofGroup,rows=P.filteredRows().filter(row=>P.destinationKey(row)===key);P.state.groupOpen.set(key,!P.groupIsOpen(key,rows));P.render();}
    });
  };

  P.installProofPolish();
})();
