const VERSION = '20260905-05';

export async function maybeHandleProofUiV5(request, env, ctx, baseWorker) {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/proof-v5.js') {
    return new Response(PROOF_V5_JS, {
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

const PROOF_V5_JS = String.raw`(()=>{
  const start=()=>{
    const P=window.ProofV2;
    if(!P||typeof P.groupRouteCard!=='function'||typeof P.openEditor!=='function')return setTimeout(start,25);
    if(window.__PROOF_V5_READY__)return;
    window.__PROOF_V5_READY__=true;

    const accent=row=>Number(row?.proofState)===1?'#d9b400':Number(row?.proofState)===2?'#2980b9':Number(row?.proofState)===3||Number(row?.proofState)===4?'#167044':'#697177';
    const details=row=>{
      const car=[row.plateTypeText,row.plateNumber].filter(Boolean).join(' • ')||'ยังไม่กำหนด';
      const driver=row.driver||'ยังไม่กำหนดคนขับ';
      const phone=row.driverPhone||'ไม่มีเบอร์';
      return `<div class='detail-grid proof-track-grid'>
        <div><span>รถ / ทะเบียน</span><strong>${P.esc(car)}</strong></div>
        <div><span>คนขับ / เบอร์โทร</span><strong>${P.esc(driver)}</strong><small>${P.esc(phone)}</small></div>
        <div><span>เวลาแผน</span><strong>${P.esc(P.standbyText(row))}</strong></div>
        <div><span>บาร์โค้ดรถ</span><strong>${P.esc(row.proofId||'ยังไม่มี')}</strong><small>${P.esc(P.stateText(row))}</small></div>
      </div>`;
    };

    P.actionButtons=row=>{
      const code=Number(row.proofState),canPrint=Boolean(P.state.profile?.canPrint)&&P.PRINTABLE_STATES.has(code),canCreate=code!==1||Boolean(P.state.profile?.canCreateProof),enabled=canPrint&&canCreate&&Boolean(row.lineId)&&Boolean(row.departureDate);
      let title='';
      if(!P.state.profile?.canPrint)title='บัญชี MS นี้ไม่มีสิทธิ์ปริ้น';
      else if(code===1&&!P.state.profile?.canCreateProof)title='บัญชี MS นี้ไม่มีสิทธิ์เปิดใช้งานบาร์โค้ด';
      else if(!P.PRINTABLE_STATES.has(code))title='สถานะนี้ไม่รองรับการปริ้นจากหน้าเว็บ';
      return `<div class='row-actions proof-track-actions'><button class='btn btn-accent' type='button' data-proof-print='${P.escAttr(P.rowKey(row))}' ${enabled?'':'disabled'} title='${P.escAttr(title)}'>ตรวจ/แก้ข้อมูล + ปริ้น</button></div>`;
    };

    P.groupRouteCard=row=>`<article class='truck-card proof-track-card ${Number(row.proofState)===1?'needs-action':''}' style='--card-accent:${accent(row)}'>
      <div class='truck-card-head proof-track-head'>
        <div class='proof-track-route'><strong>${P.esc(row.lineName||'—')}</strong><div class='proof-inline-badges'>${P.routeBadges(row)}</div></div>
        <div class='truck-status proof-track-status'>${P.stateBadge(row)}${P.standbyBadge(row)}</div>
      </div>
      ${details(row)}
      ${P.actionButtons(row)}
    </article>`;

    P.mobileCard=row=>`<article class='truck-card proof-track-card ${Number(row.proofState)===1?'needs-action':''}' style='--card-accent:${accent(row)}'>
      <div class='truck-card-head proof-track-head'>
        <div class='proof-track-route'><strong>${P.esc(row.lineName||'—')}</strong><div class='proof-inline-badges'>${P.routeBadges(row)}</div></div>
        <div class='truck-status proof-track-status'>${P.stateBadge(row)}${P.standbyBadge(row)}</div>
      </div>
      ${details(row)}
      ${P.actionButtons(row)}
    </article>`;

    P.renderAlerts=alerts=>{
      const panel=P.el('alert-panel');
      if(!alerts?.length){panel?.classList.add('hidden');if(P.el('alert-list'))P.el('alert-list').innerHTML='';return;}
      panel.classList.remove('hidden');
      P.el('alert-count').textContent=`${P.nf.format(alerts.length)} รายการ`;
      P.el('alert-list').innerHTML=alerts.map(({row,alert})=>`<article class='proof-alert proof-alert-v5 ${P.escAttr(alert.tone)}'>
        <div class='proof-alert-main'><div class='proof-alert-title'><span class='proof-alert-icon'>${P.esc(alert.icon)}</span><div><strong>${P.esc(alert.title)}</strong><small>${P.esc(P.destinationLabel(row))} • ${P.esc(row.plateTypeText||'')}</small></div></div><div class='proof-alert-route'>${P.esc(row.lineName||'—')}</div><div class='proof-alert-meta'>${P.esc(P.standbyText(row))} • ${P.esc(P.stateText(row))}</div></div>
        <div class='proof-alert-actions'><button class='btn btn-accent' type='button' data-proof-ack='${P.escAttr(P.rowKey(row))}' data-alert-key='${P.escAttr(alert.key)}'>รับทราบ</button><button class='btn btn-header' type='button' data-proof-open-group='${P.escAttr(P.destinationKey(row))}'>ดูสาขา</button></div>
      </article>`).join('');
    };

    const oldOpen=P.openEditor;
    P.openEditor=(row,detail)=>{
      oldOpen(row,detail);
      setTimeout(()=>{
        const enhance=(kind)=>{
          const input=P.el(kind==='plate'?'proof-editor-plate-search':'proof-editor-driver-search');
          if(!input||input.dataset.v5==='1')return;
          input.dataset.v5='1';
          const wrap=input.parentElement;
          const row=document.createElement('div');row.className='proof-search-row';
          wrap.insertBefore(row,input);row.appendChild(input);
          const button=document.createElement('button');button.type='button';button.className='btn btn-header proof-search-now';button.textContent='ค้นหา';row.appendChild(button);
          const run=()=>{const q=String(input.value||'').trim();if(q.length<2){input.focus();return;}P.searchEditorOptions(kind,q);};
          button.onclick=run;
          input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();run();}});
        };
        enhance('plate');enhance('driver');
      },0);
    };

    const style=document.createElement('style');
    style.id='proof-v5-style';
    style.textContent=`
      .proof-group{border-radius:5px!important}.proof-group-head{border-radius:0!important;padding:11px 12px!important}.proof-group-name strong{font-size:15px!important}.proof-group-name small{font-size:11px!important}
      .proof-track-card{border-radius:4px!important;border-left:4px solid var(--card-accent)!important;padding:11px 12px!important;margin:0!important;background:#fff!important;box-shadow:none!important}.proof-group-body .proof-track-card{border-left-width:4px!important;border-top:1px solid var(--line-dark)!important;border-right:0!important;border-bottom:0!important}.proof-group-body .proof-track-card:first-child{border-top:0!important}
      .proof-track-head{margin-bottom:9px!important;align-items:flex-start!important}.proof-track-route{min-width:0}.proof-track-route>strong{display:block;font-size:14px;line-height:1.4;word-break:break-word}.proof-track-route .proof-inline-badges{margin-top:5px}.proof-track-status{min-width:120px}.proof-track-status .proof-standby-badge{display:block;margin:5px 0 0!important;text-align:center}
      .proof-track-grid{gap:8px 12px!important;border-top:1px solid #ecece8;padding-top:9px}.proof-track-grid>div{min-width:0}.proof-track-grid span{font-size:10px!important}.proof-track-grid strong{display:block;font-size:12px!important;line-height:1.4;word-break:break-word}.proof-track-grid small{display:block;color:var(--muted);font-size:10px;margin-top:2px;word-break:break-word}
      .proof-track-actions{margin-top:10px!important;display:block!important}.proof-track-actions .btn{width:100%!important;min-height:36px;padding:7px 10px!important;font-size:12px!important}
      .proof-alert-panel{border-radius:5px!important;padding:11px!important}.proof-alert-panel-head{margin-bottom:8px!important}.proof-alert-panel-head strong{font-size:15px!important}.proof-alert-v5{border-radius:4px!important;padding:9px 10px!important;align-items:center!important}.proof-alert-v5 .proof-alert-route{font-size:12px;margin-top:5px}.proof-alert-v5 .proof-alert-meta{font-size:10px}.proof-alert-v5 .proof-alert-title strong{font-size:12px}.proof-alert-v5 .proof-alert-title small{font-size:10px}.proof-alert-v5 .proof-alert-actions .btn{padding:6px 9px;font-size:11px}
      .proof-editor-dialog{border-radius:6px!important;width:min(620px,calc(100vw - 14px))!important;max-height:94dvh!important}.proof-editor-card{padding:14px!important;max-height:94dvh!important}.proof-editor-head h2{font-size:18px!important}.proof-editor-route-box{background:#f5f5f2!important;color:var(--ink)!important;border:1px solid var(--line-dark)!important;border-radius:4px!important;padding:10px 11px!important}.proof-editor-route-box small{color:#777!important}.proof-editor-route-box strong{font-size:13px!important}.proof-editor-meta{color:#666!important;font-size:10px!important}.proof-editor-meta b{color:var(--ink)!important}.proof-editor-state{font-size:10px!important;padding:4px 7px!important}
      .proof-editor-section{border-radius:4px!important;margin-top:9px!important}.proof-editor-section-head{padding:8px 10px!important}.proof-editor-section-head b{font-size:13px!important}.proof-selected-value{padding:9px 10px!important}.proof-selected-value>span{width:28px!important;height:28px!important;border-radius:4px!important}.proof-selected-value strong{font-size:12px!important}.proof-selected-value em{font-size:11px!important}.proof-search-wrap{padding:0 10px 10px!important}.proof-search-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px}.proof-search-row input{min-height:38px!important;border-radius:3px!important}.proof-search-now{min-width:74px;padding:6px 10px!important}.proof-option-list{max-height:150px!important}.proof-option{border-radius:3px!important;padding:7px 8px!important}.proof-confirm-check{border-radius:4px!important;padding:9px 10px!important;margin-top:10px!important}.proof-editor-warning{margin:7px 1px!important}.proof-editor-actions{position:sticky;bottom:-14px;background:#fff;border-top:1px solid #e5e5e0;padding:9px 0 0;margin-top:9px!important;z-index:2}.proof-editor-actions .btn{min-width:110px!important}
      @media(max-width:760px){.proof-track-head{display:flex!important}.proof-track-status{min-width:105px}.proof-track-grid{grid-template-columns:1fr 1fr!important}.proof-alert-v5{display:block!important}.proof-alert-v5 .proof-alert-actions{margin-top:8px!important}.proof-editor-card{padding:11px!important}.proof-editor-actions{bottom:-11px}.proof-editor-section-head{display:flex!important;align-items:center!important}.proof-editor-section-head>div:last-child{margin-top:0!important}.proof-lock-reason{display:none!important}}
      @media(max-width:390px){.proof-track-grid{grid-template-columns:1fr 1fr!important;gap:7px 10px!important}.proof-track-status{min-width:92px}.proof-state{white-space:normal!important;text-align:center;font-size:10px!important;padding:4px 6px!important}.proof-standby-badge{font-size:9px!important;padding:3px 5px!important}.proof-track-route>strong{font-size:13px}.proof-search-row{grid-template-columns:1fr auto}.proof-editor-section-head{display:block!important}.proof-editor-section-head>div:last-child{margin-top:5px!important}}
    `;
    document.head.appendChild(style);
    P.render();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(start,0),{once:true});else setTimeout(start,0);
})();`;
