(()=>{
  const P=window.ProofV2;
  const baseRender=P.render;
  let searchTimer=null;
  const editorSearchCache=new Map();
  const EDITOR_SEARCH_CACHE_MS=5*60_000; // PROOF_EDITOR_SEARCH_CACHE_V8

  P.STATE_LABELS={1:'รอเปิดบาร์โค้ด',2:'เปิดบาร์โค้ดแล้ว',7:'ถึงสาขาต้นทางแล้ว',3:'รถออกจากต้นทางแล้ว',4:'จบเที่ยวแล้ว',6:'รอยกเลิก',5:'ยกเลิกแล้ว'};
  P.stateText=row=>P.STATE_LABELS[Number(row?.proofState)]||row?.proofStateText||'ไม่ทราบสถานะ';
  P.standbyText=row=>{
    const release=P.minuteText(row.plannedDepartureTime??row.startTime);
    if(!row.detailReady||!Number.isFinite(Number(row.standbyTime)))return `กำลังอ่าน Standby • ปล่อย ${release}`;
    return `Standby ${P.minuteText(row.standbyTime)} • ปล่อย ${release}`;
  };

  P.actionButtons=row=>{
    const code=Number(row.proofState);
    const canPrint=Boolean(P.state.profile?.canPrint)&&P.PRINTABLE_STATES.has(code);
    const canCreate=code!==1||Boolean(P.state.profile?.canCreateProof);
    const enabled=canPrint&&canCreate&&Boolean(row.lineId)&&Boolean(row.departureDate);
    let title='';
    if(!P.state.profile?.canPrint)title='บัญชี MS นี้ไม่มีสิทธิ์ปริ้น';
    else if(code===1&&!P.state.profile?.canCreateProof)title='บัญชี MS นี้ไม่มีสิทธิ์เปิดใช้งานบาร์โค้ด';
    else if(!P.PRINTABLE_STATES.has(code))title='สถานะนี้ไม่รองรับการปริ้นจากหน้าเว็บ';
    return `<div class='proof-actions proof-actions-v4'><button class='btn btn-accent' type='button' data-proof-print='${P.escAttr(P.rowKey(row))}' ${enabled?'':'disabled'} title='${P.escAttr(title)}'>ตรวจ/แก้ข้อมูล + ปริ้น</button><button class='btn btn-danger-soft' type='button' disabled title='ยังปิดไว้เพื่อป้องกันผลกระทบหน้างาน'>ยกเลิกรถ</button></div>`;
  };

  P.msInfo=(icon,label,value,sub='',cls='')=>`<div class='proof-ms-info ${cls}'><span class='proof-ms-info-icon'>${icon}</span><div><small>${P.esc(label)}</small><strong>${P.esc(value||'—')}</strong>${sub?`<em>${P.esc(sub)}</em>`:''}</div></div>`;
  P.groupRouteCard=row=>{
    const car=[row.plateTypeText,row.plateNumber].filter(Boolean).join(' • ')||'ยังไม่กำหนด';
    const driver=row.driver||'ยังไม่กำหนดคนขับ';
    const phone=row.driverPhone||'ไม่มีเบอร์';
    const barcode=row.proofId||'ยังไม่มีบาร์โค้ด';
    return `<article class='proof-route-card proof-route-card-v4 ${Number(row.proofState)===1?'needs-action':''}'>
      <div class='proof-v4-head'>
        <div class='proof-v4-route'><strong>${P.esc(row.lineName||'—')}</strong><span class='proof-inline-badges'>${P.routeBadges(row)}</span></div>
        <div class='proof-v4-status'>${P.stateBadge(row)}${P.standbyBadge(row)}</div>
      </div>
      <div class='proof-v4-grid'>
        ${P.msInfo('🚚','รถ / ทะเบียน',car,'ข้อมูลล่าสุดจาก MS','car')}
        ${P.msInfo('👤','คนขับ',driver,phone,'driver')}
        ${P.msInfo('🕒','เวลาแผน',P.standbyText(row),row.departureDate||'','time')}
        ${P.msInfo('▣','บาร์โค้ดรถ',barcode,P.stateText(row),'barcode')}
      </div>
      <div class='proof-v4-footer'>${P.actionButtons(row)}</div>
    </article>`;
  };

  P.tableRow=row=>`<tr><td class='proof-route'><strong>${P.esc(row.lineName||'—')}</strong><small>${P.routeBadges(row)} ${P.esc(P.destinationLabel(row))}</small></td><td class='proof-car'><strong>${P.esc(row.plateNumber||'ยังไม่กำหนด')}</strong><small>${P.esc(row.plateTypeText||'—')}</small></td><td class='proof-driver'><strong>${P.esc(row.driver||'ยังไม่กำหนด')}</strong><small>${P.esc(row.driverPhone||'—')}</small></td><td><strong>${P.esc(P.standbyText(row))}</strong><small>${P.esc(row.departureDate||'')}</small></td><td><strong>${P.esc(row.proofId||'ยังไม่มี')}</strong></td><td>${P.stateBadge(row)}${P.standbyBadge(row)}</td><td>${P.actionButtons(row)}</td></tr>`;
  P.mobileCard=row=>`<article class='proof-card proof-card-v4'><div class='proof-v4-head'><div class='proof-v4-route'><strong>${P.esc(row.lineName||'—')}</strong><span class='proof-inline-badges'>${P.routeBadges(row)}</span></div><div class='proof-v4-status'>${P.stateBadge(row)}</div></div><div class='proof-v4-grid'>${P.msInfo('🚚','รถ / ทะเบียน',[row.plateTypeText,row.plateNumber].filter(Boolean).join(' • ')||'ยังไม่กำหนด','','car')}${P.msInfo('👤','คนขับ',row.driver||'ยังไม่กำหนด',row.driverPhone||'ไม่มีเบอร์','driver')}${P.msInfo('🕒','เวลาแผน',P.standbyText(row),'','time')}${P.msInfo('▣','บาร์โค้ดรถ',row.proofId||'ยังไม่มี',P.stateText(row),'barcode')}</div><div class='proof-v4-footer'>${P.standbyBadge(row)}${P.actionButtons(row)}</div></article>`;

  P.resetFilters=includeSearch=>{
    const s=P.state;s.stateFilter='all';s.lineType='all';s.lineMode='all';s.vehicle='all';if(includeSearch)s.query='';
    P.el('state-filter').value='all';P.el('line-type-filter').value='all';P.el('line-mode-filter').value='all';P.el('vehicle-filter').value='all';if(includeSearch)P.el('search-input').value='';
  };

  P.acknowledgeAlert=async(key,alertKey)=>{
    const row=P.state.rows.find(x=>P.rowKey(x)===key);if(!row||!P.state.auth||!alertKey)return;
    try{const d=await P.apiPost('/api/proof/ack',{token:P.state.auth.token,branch:P.state.branch,lineId:row.lineId,departureDate:row.departureDate,alertKey});row.acknowledgements ||= {};row.acknowledgements[alertKey]={at:d.acknowledgedAt||new Date().toISOString(),by:d.acknowledgedBy||P.state.auth.username||''};P.render();}
    catch(e){P.handleApiError(e,false);alert(e.message||'บันทึกรับทราบไม่สำเร็จ');}
  };

  P.editorState=null;
  P.editorPolicyText=(editable,reason)=>editable?`<span class='proof-editable-tag'>แก้ไขได้ตาม MS</span>`:`<span class='proof-locked-tag'>MS ล็อก</span>${reason?`<small class='proof-lock-reason'>${P.esc(reason)}</small>`:''}`;
  P.editorSelectedHtml=(kind,detail)=>{
    if(kind==='plate'){
      const value=[detail.plateTypeText,detail.plateNumber].filter(Boolean).join(' • ')||'ยังไม่กำหนดทะเบียน';
      return `<div class='proof-selected-value'><span>🚚</span><div><small>ทะเบียนที่ใช้ปริ้น</small><strong id='proof-editor-plate-selected'>${P.esc(value)}</strong></div></div>`;
    }
    return `<div class='proof-selected-value'><span>👤</span><div><small>คนขับที่ใช้ปริ้น</small><strong id='proof-editor-driver-selected'>${P.esc(detail.driver||'ยังไม่กำหนด')}</strong><em id='proof-editor-driver-phone'>${P.esc(detail.driverPhone||'ไม่มีเบอร์')}</em></div></div>`;
  };

  P.openEditor=(row,detail)=>{
    P.editorState={row,detail,selection:{plateId:String(detail.plateId||''),fmsDriverId:String(detail.fmsDriverId||'')}};
    const d=P.el('proof-editor-dialog');
    P.el('proof-editor-route').textContent=detail.lineName||row.lineName||'—';
    P.el('proof-editor-status').textContent=detail.proofStateText||P.stateText(row);
    P.el('proof-editor-plan').textContent=`${row.detailReady?P.standbyText(row):'เวลาแผนจาก MS'}${detail.plannedDepartureText?` • ${detail.plannedDepartureText}`:''}`;
    P.el('proof-editor-ms-user').textContent=P.state.profile?.name||'บัญชี MS ที่เชื่อมอยู่';
    const plateBox=P.el('proof-editor-plate-box');
    plateBox.innerHTML=`<div class='proof-editor-section-head'><div><b>รถ / ทะเบียน</b><span>เลือกเหมือนช่องทะเบียนใน MS</span></div><div>${P.editorPolicyText(detail.policy?.plateEditable,detail.policy?.plateReason)}</div></div>${P.editorSelectedHtml('plate',detail)}${detail.policy?.plateEditable?`<div class='proof-search-wrap'><input id='proof-editor-plate-search' type='search' placeholder='พิมพ์ทะเบียนอย่างน้อย 2 ตัว' autocomplete='off'><div id='proof-editor-plate-results' class='proof-option-list'><div class='proof-option-hint'>พิมพ์ทะเบียนเพื่อค้นหาจาก MS</div></div></div>`:''}`;
    const driverBox=P.el('proof-editor-driver-box');
    driverBox.innerHTML=`<div class='proof-editor-section-head'><div><b>คนขับ / เบอร์โทร</b><span>เลือกคนขับแล้วชื่อและเบอร์จะตามข้อมูล MS</span></div><div>${P.editorPolicyText(detail.policy?.driverEditable,detail.policy?.driverReason)}</div></div>${P.editorSelectedHtml('driver',detail)}${detail.policy?.driverEditable?`<div class='proof-search-wrap'><input id='proof-editor-driver-search' type='search' placeholder='พิมพ์ชื่อหรือเบอร์อย่างน้อย 2 ตัว' autocomplete='off'><div id='proof-editor-driver-results' class='proof-option-list'><div class='proof-option-hint'>พิมพ์ชื่อหรือเบอร์เพื่อค้นหาจาก MS</div></div></div>`:''}`;
    const check=P.el('proof-editor-check');check.checked=false;
    const confirm=P.el('proof-editor-confirm');confirm.disabled=true;confirm.textContent=Number(detail.proofState)===1?'ยืนยัน • เปิดบาร์โค้ดและปริ้น':'ยืนยัน • ปริ้น PDF';
    check.onchange=()=>{confirm.disabled=!check.checked;};
    const plateInput=P.el('proof-editor-plate-search');if(plateInput)plateInput.oninput=()=>P.queueEditorSearch('plate',plateInput.value);
    const driverInput=P.el('proof-editor-driver-search');if(driverInput)driverInput.oninput=()=>P.queueEditorSearch('driver',driverInput.value);
    d.showModal();
  };

  P.editorSearchNorm=v=>String(v??'').normalize('NFKC').toLowerCase().replace(/[\s\-–—_/.()[\]{}:;,'"`~!@#$%^&*+=?<>|\\]+/g,'');
  P.queueEditorSearch=(kind,value)=>{
    clearTimeout(searchTimer);
    const q=String(value||'').trim(),target=P.el(kind==='plate'?'proof-editor-plate-results':'proof-editor-driver-results');
    if(q.length<2){target.innerHTML=`<div class='proof-option-hint'>พิมพ์อย่างน้อย 2 ตัวเพื่อค้นหา</div>`;return;}
    target.innerHTML=`<div class='proof-option-hint'>พร้อมค้นหา • กด Enter หรือปุ่ม “ค้นหา” เพื่อค้นจาก MS</div>`;
  };
  P.renderEditorSearchItems=(kind,target,items,q)=>{
    const nq=P.editorSearchNorm(q),score=item=>{const raw=kind==='plate'?(item.plateNumber||item.label||''):`${item.name||''} ${item.phone||''}`,n=P.editorSearchNorm(raw);return n===nq?4:n.startsWith(nq)?3:n.includes(nq)?2:1;};
    const sorted=[...items].sort((a,b)=>score(b)-score(a)||String(kind==='plate'?(a.plateNumber||a.label||''):(a.name||'')).localeCompare(String(kind==='plate'?(b.plateNumber||b.label||''):(b.name||'')),'th'));
    if(!sorted.length){target.innerHTML=`<div class='proof-option-hint'>ไม่พบข้อมูลใน MS • ลองทะเบียนแบบไม่ใส่ขีด/เว้นวรรค หรือเบอร์เป็นตัวเลขล้วน</div>`;return;}
    target.innerHTML=`<div class='proof-option-hint'>พบ ${P.nf.format(sorted.length)} รายการ • ผลตรงที่สุดอยู่ด้านบน</div>`+sorted.map(item=>kind==='plate'?`<button type='button' class='proof-option' data-editor-plate='${P.escAttr(item.id)}' data-label='${P.escAttr(item.label||item.plateNumber||'')}'><span>🚚</span><div><strong>${P.esc(item.plateNumber||item.label||'—')}</strong><small>${P.esc(item.plateTypeText||'')}</small></div></button>`:`<button type='button' class='proof-option' data-editor-driver='${P.escAttr(item.id)}' data-name='${P.escAttr(item.name||'')}' data-phone='${P.escAttr(item.phone||'')}'><span>👤</span><div><strong>${P.esc(item.name||'—')}</strong><small>${P.esc(item.phone||'ไม่มีเบอร์')}${item.auditStateText?` • ${P.esc(item.auditStateText)}`:''}</small></div></button>`).join('');
  };
  P.searchEditorOptions=async(kind,q)=>{
    const s=P.editorState;if(!s||!P.state.auth)return;
    const target=P.el(kind==='plate'?'proof-editor-plate-results':'proof-editor-driver-results'),path=kind==='plate'?'/api/proof/plate-options':'/api/proof/driver-options',clean=String(q||'').trim();
    if(clean.length<2)return;
    const cacheKey=[P.state.branch,s.detail.lineId,s.detail.departureDate,kind,P.editorSearchNorm(clean)].join('|'),cached=editorSearchCache.get(cacheKey);
    if(cached&&Date.now()-cached.at<EDITOR_SEARCH_CACHE_MS){P.renderEditorSearchItems(kind,target,cached.items,clean);return;}
    target.innerHTML=`<div class='proof-option-hint'>กำลังค้นหาจาก MS…</div>`;
    try{const d=await P.apiGet(path,{token:P.state.auth.token,branch:P.state.branch,lineId:s.detail.lineId,departureDate:s.detail.departureDate,q:clean}),items=Array.isArray(d.items)?d.items:[];editorSearchCache.set(cacheKey,{at:Date.now(),items});if(editorSearchCache.size>80)editorSearchCache.delete(editorSearchCache.keys().next().value);P.renderEditorSearchItems(kind,target,items,clean);}catch(e){target.innerHTML=`<div class='proof-option-error'>${P.esc(e.message||'ค้นหาไม่สำเร็จ')}</div>`;}
  };

  P.choosePlate=button=>{
    if(!P.editorState)return;P.editorState.selection.plateId=button.dataset.editorPlate||'';
    P.el('proof-editor-plate-selected').textContent=button.dataset.label||'—';
    document.querySelectorAll('#proof-editor-plate-results .proof-option').forEach(x=>x.classList.toggle('selected',x===button));
  };
  P.chooseDriver=button=>{
    if(!P.editorState)return;P.editorState.selection.fmsDriverId=button.dataset.editorDriver||'';
    P.el('proof-editor-driver-selected').textContent=button.dataset.name||'—';P.el('proof-editor-driver-phone').textContent=button.dataset.phone||'ไม่มีเบอร์';
    document.querySelectorAll('#proof-editor-driver-results .proof-option').forEach(x=>x.classList.toggle('selected',x===button));
  };

  P.closeEditor=()=>{const d=P.el('proof-editor-dialog');if(d?.open)d.close();P.editorState=null;clearTimeout(searchTimer);};

  P.confirmEditorPrint=async()=>{
    const s=P.editorState;if(!s||!P.state.auth)return;
    const preview=window.open('','_blank');
    if(preview){preview.document.write(`<!doctype html><meta charset='utf-8'><title>กำลังสร้าง PDF</title><body style='font-family:sans-serif;padding:24px'>กำลังยืนยันข้อมูลกับ MS และสร้าง PDF…</body>`);preview.document.close();}
    const confirm=P.el('proof-editor-confirm');confirm.disabled=true;P.el('proof-editor-working').classList.remove('hidden');
    try{
      const r=await P.fetchWithTimeout(`${P.CONFIG.apiBase}/api/proof/print-edit`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:P.state.auth.token,branch:P.state.branch,lineId:s.detail.lineId,departureDate:s.detail.departureDate,selection:s.selection})});
      if(!r.ok){let p=null;try{p=await r.json();}catch{}throw P.apiError(p?.message||`ปริ้นไม่สำเร็จ (${r.status})`,p?.code||'PRINT_FAILED',r.status);}
      const blob=await r.blob();if(!String(blob.type||'').toLowerCase().includes('pdf'))throw P.apiError('MS ไม่ได้ส่ง PDF กลับมา','PRINT_INVALID_PDF',502);
      const url=URL.createObjectURL(blob);if(preview)preview.location.replace(url);else window.open(url,'_blank');setTimeout(()=>URL.revokeObjectURL(url),120_000);
      P.closeEditor();P.setLive('ปริ้นสำเร็จ • กำลังอัปเดตข้อมูลล่าสุด','ok');await new Promise(r=>setTimeout(r,800));await P.loadRoutes(true);
    }catch(e){if(preview)preview.close();P.handleApiError(e,false);P.el('proof-editor-working').classList.add('hidden');confirm.disabled=!P.el('proof-editor-check').checked;P.setLive(e.message||'ปริ้นไม่สำเร็จ','error');alert(`${e.message||'ปริ้นไม่สำเร็จ'}\nระบบหยุดขั้นตอนและไม่ได้ทำรายการต่อ`);}
  };

  P.printRoute=async key=>{
    const row=P.state.rows.find(x=>P.rowKey(x)===key);if(!row||!P.state.auth||!P.PRINTABLE_STATES.has(Number(row.proofState)))return;
    P.setLive('กำลังอ่านข้อมูลแก้ไขล่าสุดจาก MS…','stale');
    try{
      const detail=await P.apiGet('/api/proof/editor',{token:P.state.auth.token,branch:P.state.branch,lineId:row.lineId,departureDate:row.departureDate});
      if(!P.PRINTABLE_STATES.has(Number(detail.proofState))){await P.loadRoutes(true);alert(`สถานะล่าสุดคือ “${detail.proofStateText||'ไม่รองรับการปริ้น'}”\nยังไม่มีการแก้ไขหรือปริ้นใด ๆ`);return;}
      P.openEditor(row,detail);P.renderFreshness();
    }catch(e){P.handleApiError(e,false);P.setLive(e.message||'อ่านข้อมูลจาก MS ไม่สำเร็จ','error');alert(e.message||'อ่านข้อมูลจาก MS ไม่สำเร็จ');}
  };

  P.installProofEditor=()=>{
    const nav=document.querySelector('.topbar-actions');
    if(nav&&!nav.querySelector('.app-nav')){
      nav.querySelectorAll('a.header-link').forEach(a=>a.remove());
      const menu=document.createElement('details');menu.className='app-nav';menu.innerHTML=`<summary><span class='nav-grid-icon'>▦</span><span>เมนูระบบ</span><small>จัดการเส้นทาง MS</small></summary><div class='app-nav-menu'><a href='ms.html'><span>🚚</span><b>ติดตามรถ MS</b><small>คิวรถเข้า–ออกและสถานะปัจจุบัน</small></a><a href='proof.html' class='is-current'><span>🧾</span><b>จัดการเส้นทาง MS</b><small>ตรวจ/แก้ข้อมูลและปริ้นบาร์โค้ดรถ</small></a><a href='waiting.html'><span>⏱</span><b>รถรอลงงาน</b><small>จัดการคิวและเวลารอลงงาน</small></a><a href='ms-report.html'><span>▥</span><b>สรุปรายวัน</b><small>ดูและเปรียบเทียบข้อมูลรายวัน</small></a></div>`;P.el('connection-badge')?.insertAdjacentElement('afterend',menu);
    }
    if(P.el('refresh-btn'))P.el('refresh-btn').textContent='รีเฟรชข้อมูล';
    const heading=document.querySelector('.proof-heading p');if(heading)heading.textContent='ดูรถคงเหลือ ตรวจ/แก้ทะเบียนและคนขับตามสิทธิ์ที่ MS อนุญาต แล้วปริ้นบาร์โค้ดรถ';
    const alertHead=document.querySelector('.proof-alert-panel-head strong');if(alertHead)alertHead.textContent='รายการที่ต้องดำเนินการ';
    if(!P.el('proof-editor-dialog'))document.body.insertAdjacentHTML('beforeend',`<dialog id='proof-editor-dialog' class='proof-editor-dialog'><div class='proof-editor-card'><div class='proof-editor-head'><div><small>ข้อมูลล่าสุดจาก MS</small><h2>ตรวจ/แก้ข้อมูลก่อนปริ้น</h2></div><button id='proof-editor-close' class='dialog-close' type='button'>×</button></div><div class='proof-editor-route-box'><div><small>เส้นทาง</small><strong id='proof-editor-route'>—</strong></div><span id='proof-editor-status' class='proof-editor-state'>—</span><div class='proof-editor-meta'><span>เวลา: <b id='proof-editor-plan'>—</b></span><span>ผู้ดำเนินงาน PDF: <b id='proof-editor-ms-user'>—</b></span></div></div><section id='proof-editor-plate-box' class='proof-editor-section'></section><section id='proof-editor-driver-box' class='proof-editor-section'></section><label class='proof-confirm-check'><input id='proof-editor-check' type='checkbox'><span>ตรวจสอบข้อมูลแล้ว และยืนยันให้ใช้ข้อมูลด้านบนกับ MS เพื่อปริ้นรถเที่ยวนี้</span></label><p class='proof-editor-warning'>ช่องที่ขึ้น “MS ล็อก” จะไม่สามารถเปลี่ยนจากเว็บนี้ได้ ระบบตรวจสิทธิ์และสถานะกับ MS ซ้ำอีกครั้งก่อนเขียนจริง</p><div id='proof-editor-working' class='proof-editor-working hidden'>กำลังยืนยันข้อมูลและสร้าง PDF จาก MS…</div><div class='proof-editor-actions'><button id='proof-editor-cancel' class='btn btn-header' type='button'>ยกเลิก</button><button id='proof-editor-confirm' class='btn btn-accent' type='button' disabled>ยืนยัน • ปริ้น</button></div></div></dialog>`);
    P.el('proof-editor-close').onclick=P.closeEditor;P.el('proof-editor-cancel').onclick=P.closeEditor;P.el('proof-editor-confirm').onclick=P.confirmEditorPrint;P.el('proof-editor-dialog').oncancel=e=>{e.preventDefault();P.closeEditor();};
    if(!P.el('proof-v4-style')){const style=document.createElement('style');style.id='proof-v4-style';style.textContent=`
      .proof-route-card-v4,.proof-card-v4{background:#fff;border:1px solid #deded8;border-radius:14px;overflow:hidden}.proof-route-card-v4{display:block;padding:0;margin:0}.proof-route-card-v4.needs-action{border-color:#e1c45d;box-shadow:0 0 0 2px rgba(255,212,0,.08)}.proof-v4-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:12px 14px;background:#fafaf7;border-bottom:1px solid #e7e7e2}.proof-route-card-v4.needs-action .proof-v4-head{background:#fff9df}.proof-v4-route{min-width:0;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.proof-v4-route>strong{font-size:14px;line-height:1.45;word-break:break-word}.proof-v4-status{display:flex;gap:5px;align-items:center;justify-content:flex-end;flex-wrap:wrap}.proof-v4-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0}.proof-ms-info{display:flex;gap:9px;align-items:flex-start;padding:12px 13px;min-width:0;border-right:1px solid #ecece7}.proof-ms-info:last-child{border-right:0}.proof-ms-info-icon{width:30px;height:30px;display:grid;place-items:center;background:#f3f3ef;border-radius:9px;flex:0 0 auto}.proof-ms-info small{display:block;font-size:10px;color:#777;font-weight:700}.proof-ms-info strong{display:block;margin-top:2px;font-size:12px;line-height:1.45;word-break:break-word}.proof-ms-info em{display:block;margin-top:2px;font-size:11px;font-style:normal;color:#707070;word-break:break-word}.proof-ms-info.car{box-shadow:inset 0 -3px 0 #ffd400}.proof-ms-info.driver{box-shadow:inset 0 -3px 0 #dceaff}.proof-ms-info.time{box-shadow:inset 0 -3px 0 #e7e7e7}.proof-ms-info.barcode{box-shadow:inset 0 -3px 0 #dff3e5}.proof-v4-footer{display:flex;justify-content:flex-end;gap:8px;align-items:center;padding:9px 13px;background:#fafaf7;border-top:1px solid #e7e7e2}.proof-actions-v4{margin:0}.proof-actions-v4 .btn-accent{font-weight:900}.proof-card-v4{padding:0;margin-bottom:10px}.proof-card-v4 .proof-v4-footer{justify-content:space-between}.proof-editor-dialog{border:0;border-radius:18px;padding:0;width:min(760px,calc(100vw - 20px));max-width:none;max-height:92vh}.proof-editor-dialog::backdrop{background:rgba(0,0,0,.58)}.proof-editor-card{background:#fff;padding:18px;overflow:auto;max-height:92vh}.proof-editor-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.proof-editor-head h2{margin:3px 0 0;font-size:22px}.proof-editor-head small{color:#777;font-weight:700}.proof-editor-route-box{margin-top:14px;padding:12px 13px;border-radius:12px;background:#151515;color:#fff;display:grid;grid-template-columns:1fr auto;gap:7px 12px}.proof-editor-route-box small{display:block;color:#bdbdbd;font-size:10px}.proof-editor-route-box strong{display:block;margin-top:2px;line-height:1.45;word-break:break-word}.proof-editor-state{background:#ffd400;color:#151515;border-radius:999px;padding:5px 9px;font-size:11px;font-weight:900;align-self:start}.proof-editor-meta{grid-column:1/-1;display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:#d8d8d8}.proof-editor-meta b{color:#fff}.proof-editor-section{margin-top:12px;border:1px solid #deded8;border-radius:13px;overflow:hidden}.proof-editor-section-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:10px 12px;background:#f7f7f3;border-bottom:1px solid #e3e3de}.proof-editor-section-head b{display:block;font-size:14px}.proof-editor-section-head>div>span{display:block;font-size:10px;color:#777;margin-top:2px}.proof-editable-tag,.proof-locked-tag{display:inline-flex;border-radius:999px;padding:4px 7px;font-size:10px;font-weight:900;white-space:nowrap}.proof-editable-tag{background:#dff5e6;color:#176b38}.proof-locked-tag{background:#ececec;color:#555}.proof-lock-reason{display:block;text-align:right;max-width:230px;color:#777;margin-top:4px;font-size:9px}.proof-selected-value{display:flex;gap:10px;align-items:flex-start;padding:12px}.proof-selected-value>span{width:34px;height:34px;display:grid;place-items:center;border-radius:9px;background:#fff4c6}.proof-selected-value small{display:block;color:#777;font-size:10px}.proof-selected-value strong{display:block;margin-top:2px;font-size:14px}.proof-selected-value em{display:block;font-style:normal;color:#666;font-size:12px;margin-top:2px}.proof-search-wrap{padding:0 12px 12px}.proof-search-wrap input{width:100%;min-height:42px;border:1px solid #cfcfc9;border-radius:10px;padding:8px 10px}.proof-option-list{display:grid;gap:5px;margin-top:7px;max-height:190px;overflow:auto}.proof-option{display:flex;gap:9px;align-items:center;width:100%;border:1px solid #e0e0da;border-radius:10px;background:#fff;padding:9px;text-align:left;cursor:pointer}.proof-option:hover,.proof-option.selected{border-color:#d4ad00;background:#fff9dc}.proof-option>span{width:28px;height:28px;display:grid;place-items:center;border-radius:8px;background:#f3f3ef}.proof-option strong{display:block;font-size:12px}.proof-option small{display:block;font-size:10px;color:#777;margin-top:2px}.proof-option-hint,.proof-option-error{padding:8px;font-size:11px;color:#777}.proof-option-error{color:#b42318}.proof-confirm-check{display:flex;gap:9px;align-items:flex-start;margin-top:14px;padding:11px 12px;border-radius:11px;background:#fff9df;border:1px solid #ead47c;font-size:12px;line-height:1.5}.proof-confirm-check input{margin-top:3px;transform:scale(1.1)}.proof-editor-warning{font-size:10px;color:#777;line-height:1.5;margin:9px 2px}.proof-editor-working{padding:9px 10px;background:#eef5ff;border-radius:9px;font-size:11px;font-weight:700}.proof-editor-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.proof-editor-actions .btn{min-width:130px}
      @media(max-width:1050px){.proof-v4-grid{grid-template-columns:1fr 1fr}.proof-ms-info:nth-child(2){border-right:0}.proof-ms-info:nth-child(-n+2){border-bottom:1px solid #ecece7}}
      @media(max-width:760px){.proof-v4-head{display:block}.proof-v4-status{justify-content:flex-start;margin-top:8px}.proof-v4-grid{grid-template-columns:1fr 1fr}.proof-v4-footer{justify-content:flex-start}.proof-actions-v4{width:100%;display:grid;grid-template-columns:1fr 1fr}.proof-actions-v4 .btn{width:100%}.proof-editor-section-head{display:block}.proof-editor-section-head>div:last-child{margin-top:6px}.proof-lock-reason{text-align:left;max-width:none}.proof-editor-actions{display:grid;grid-template-columns:1fr 1fr}.proof-editor-actions .btn{width:100%}}
      @media(max-width:430px){.proof-v4-grid{grid-template-columns:1fr}.proof-ms-info{border-right:0!important;border-bottom:1px solid #ecece7!important}.proof-ms-info:last-child{border-bottom:0!important}.proof-actions-v4,.proof-editor-actions{grid-template-columns:1fr}.proof-editor-card{padding:14px}.proof-editor-route-box{grid-template-columns:1fr}.proof-editor-state{justify-self:start}.proof-editor-meta{grid-column:auto}.proof-confirm-check{font-size:11px}}
    `;document.head.appendChild(style);}
  };

  P.render=()=>{baseRender();const progress=P.el('detail-progress');if(progress)progress.textContent=P.state.detailRemaining>0?`กำลังอ่าน Standby/ปลายทางอีก ${P.nf.format(P.state.detailRemaining)} เที่ยว`:'Standby/ปลายทางพร้อมแล้ว';};

  P.bindEvents=()=>{
    P.el('refresh-btn').onclick=()=>P.loadAll(false);P.el('login-btn').onclick=()=>P.el('proof-login-dialog').showModal();P.el('login-close').onclick=P.closeLogin;P.el('login-form').onsubmit=P.login;P.el('logout-btn').onclick=P.logout;
    P.el('branch-filter').onchange=async e=>{P.state.branch=String(e.target.value||'NE1').toUpperCase();P.state.profile=null;P.state.groupOpen.clear();P.resetFilters(false);await P.loadAll(false);};
    P.el('day-filter').onchange=async e=>{P.state.day=e.target.value||P.thaiDay();P.state.stateFilter='all';P.state.groupOpen.clear();P.el('state-filter').value='all';await P.loadRoutes(false);};
    P.el('line-type-filter').onchange=e=>{P.state.lineType=e.target.value;P.render();};P.el('line-mode-filter').onchange=e=>{P.state.lineMode=e.target.value;P.render();};P.el('state-filter').onchange=e=>{P.state.stateFilter=e.target.value;P.render();};P.el('vehicle-filter').onchange=e=>{P.state.vehicle=e.target.value;P.render();};P.el('search-input').oninput=e=>{P.state.query=e.target.value.trim().toLowerCase();P.render();};P.el('clear-filter-btn').onclick=()=>{P.resetFilters(true);P.render();};P.el('group-view-btn').onclick=()=>{P.state.viewMode='group';P.render();};P.el('list-view-btn').onclick=()=>{P.state.viewMode='list';P.render();};
    document.querySelectorAll('[data-state]').forEach(card=>{card.tabIndex=0;card.setAttribute('role','button');card.onclick=()=>{P.state.stateFilter=card.dataset.state||'all';P.el('state-filter').value=P.state.stateFilter;P.render();};card.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();card.click();}};});
    document.addEventListener('click',e=>{const plate=e.target.closest('[data-editor-plate]');if(plate){P.choosePlate(plate);return;}const driver=e.target.closest('[data-editor-driver]');if(driver){P.chooseDriver(driver);return;}const print=e.target.closest('[data-proof-print]');if(print){P.printRoute(print.dataset.proofPrint);return;}const ack=e.target.closest('[data-proof-ack]');if(ack){P.acknowledgeAlert(ack.dataset.proofAck,ack.dataset.alertKey);return;}const open=e.target.closest('[data-proof-open-group]');if(open){const key=open.dataset.proofOpenGroup;P.state.viewMode='group';P.state.groupOpen.set(key,true);P.render();setTimeout(()=>document.querySelector(`[data-proof-group='${P.cssEscape(key)}']`)?.scrollIntoView({behavior:'smooth',block:'center'}),0);return;}const group=e.target.closest('[data-proof-group]');if(group){const key=group.dataset.proofGroup,rows=P.filteredRows().filter(row=>P.destinationKey(row)===key);P.state.groupOpen.set(key,!P.groupIsOpen(key,rows));P.render();}});
  };

  window.addEventListener('DOMContentLoaded',P.installProofEditor);
})();
