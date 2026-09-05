from pathlib import Path

ui_path=Path('worker/src/proof-ui-v10.js')
ui=ui_path.read_text()
if 'PROOF_GRID_V13' in ui:
    raise SystemExit('V13 already applied')
ui=ui.replace("const VERSION = '20260906-02';","const VERSION = '20260906-03';",1)
ui=ui.replace("      panel.innerHTML = `<div><small>บริษัทซัพ</small>","      row._proofDetailV13 = detail; // PROOF_GRID_V13\n      panel.innerHTML = `<div><small>บริษัทซัพ</small>",1)
anchor="""    P.render();
  };
"""
block=r'''    // PROOF_GRID_V13: dense operational grid, nested destination headings, plain field language.
    const supplierTextV13 = row => row?._proofDetailV13?.fleetName || row?.fleetName || row?.supplierName || '—';
    const driverTextV13 = row => row?._proofDetailV13?.driver || row?.driver || '—';
    const phoneTextV13 = row => row?._proofDetailV13?.driverPhone || row?.driverPhone || '—';
    const plateTextV13 = row => [row?._proofDetailV13?.plateNumber || row?.plateNumber, row?._proofDetailV13?.plateTypeText || row?.plateTypeText].filter(Boolean).join(' • ') || '—';
    const branchTextV13 = row => routeDestinationLabel(row) || P.destinationShort?.(row) || 'ปลายทางไม่ระบุ';
    const compactStatusV13 = row => missedVehicle(row) ? 'รถไม่เข้า' : P.stateText(row);

    P.actionButtons = row => {
      const code=Number(row.proofState), hasBarcode=barcodeEnabled(row), missed=missedVehicle(row);
      const canPrint=Boolean(P.state.profile?.canPrint)&&P.PRINTABLE_STATES.has(code);
      const canCreate=hasBarcode||code!==1||Boolean(P.state.profile?.canCreateProof);
      const enabled=!missed&&canPrint&&canCreate&&Boolean(row.lineId)&&Boolean(row.departureDate);
      const label=missed?'เลยเวลาปล่อย':hasBarcode?'ตรวจ / ปริ้น':'ตรวจ / เปิดบาร์ / ปริ้น';
      return `<div class='proof-actions proof-actions-v13'><button class='btn ${missed?'btn-header':'btn-accent'}' type='button' data-proof-print='${P.escAttr(P.rowKey(row))}' ${enabled?'':'disabled'}>${P.esc(label)}</button></div>`;
    };

    const rowCardV13 = row => {
      const release=P.minuteText(row.plannedDepartureTime??row.startTime);
      const standby=row.detailReady&&Number.isFinite(Number(row.standbyTime))?P.minuteText(row.standbyTime):'—';
      const barcode=row.proofId||'ยังไม่มี';
      return `<article class='proof-grid-row-v13 ${missedVehicle(row)?'is-missed':barcodeEnabled(row)?'is-ready':'is-pending'}'>
        <div class='proof-grid-route-v13'><small>เส้นทาง</small><strong>${P.esc(row.lineName||'—')}</strong><span>${P.esc(plateTextV13(row))}</span></div>
        <div class='proof-grid-bar-v13'><small>บาร์รถ</small><strong>${P.esc(barcode)}</strong><span>${P.esc(barcodeStatus(row))}</span></div>
        <div><small>เวลา</small><strong>${P.esc(standby)} → ${P.esc(release)}</strong><span>${P.standbyBadge(row)}</span></div>
        <div><small>คนขับ / โทรศัพท์</small><strong>${P.esc(driverTextV13(row))}</strong><span>${P.esc(phoneTextV13(row))}</span></div>
        <div><small>ซัพ / รถ</small><strong>${P.esc(supplierTextV13(row))}</strong><span>${P.esc(plateTextV13(row))}</span></div>
        <div class='proof-grid-actions-v13'><div class='proof-grid-status-v13'><small>สถานะ</small><strong>${P.esc(compactStatusV13(row))}</strong></div><div class='proof-grid-btns-v13'><button class='btn btn-header' type='button' data-proof-v11-detail='${P.escAttr(P.rowKey(row))}'>รายละเอียด</button>${P.actionButtons(row)}</div></div>
        <div class='proof-v11-detail hidden' data-proof-v11-detail-panel='${P.escAttr(P.rowKey(row))}'>
          <div><small>บริษัทซัพ</small><strong>${P.esc(supplierTextV13(row))}</strong></div><div><small>ปลายทาง</small><strong>${P.esc(branchTextV13(row))}</strong></div><div><small>คนขับ / โทรศัพท์</small><strong>${P.esc(driverTextV13(row))}</strong><span>${P.esc(phoneTextV13(row))}</span></div><div><small>รถ / ทะเบียน</small><strong>${P.esc(plateTextV13(row))}</strong></div><div><small>บาร์รถ</small><strong>${P.esc(barcode)}</strong></div><div><small>เวลา</small><strong>${P.esc(standby)} → ${P.esc(release)}</strong></div>
        </div>
      </article>`;
    };
    P.groupRouteCard=rowCardV13; P.mobileCard=rowCardV13;

    P.groupedHtml = rows => {
      const lanes=new Map();
      for(const row of rows){const lane=laneScope(row);if(!lanes.has(lane))lanes.set(lane,[]);lanes.get(lane).push(row);}
      return ['FD','LH'].filter(l=>lanes.has(l)).map(lane=>{
        const items=lanes.get(lane), branches=new Map();
        for(const row of items){const b=branchTextV13(row);if(!branches.has(b))branches.set(b,[]);branches.get(b).push(row);}
        const pending=items.filter(x=>Number(x.proofState)===1).length, extra=items.filter(x=>Number(x.lineMode)===2).length;
        const body=[...branches.entries()].sort((a,b)=>a[0].localeCompare(b[0],'th')).map(([branch,branchRows])=>`<section class='proof-branch-v13'><header><strong>${P.esc(branch)}</strong><span>${P.nf.format(branchRows.length)} เที่ยว</span></header><div class='proof-branch-columns-v13'><b>เส้นทาง</b><b>บาร์รถ</b><b>เวลา</b><b>คนขับ / โทรศัพท์</b><b>ซัพ / รถ</b><b>สถานะ / จัดการ</b></div>${branchRows.map(rowCardV13).join('')}</section>`).join('');
        return `<section class='proof-group is-open proof-lane-v13'><div class='proof-group-head proof-lane-head-v13'><span class='proof-group-name'><strong>${lane==='LH'?'LH • HUB TO HUB':'FD • Feeder / รถเสริม / อื่น ๆ'}</strong><small>${P.nf.format(items.length)} รายการ${pending?` • รอจัดการ ${P.nf.format(pending)}`:''}${extra?` • รถเสริม ${P.nf.format(extra)}`:''}</small></span></div><div class='proof-group-body proof-lane-body-v13'>${body}</div></section>`;
      }).join('');
    };

    P.tableRow = row => `<tr><td class='proof-route'><strong>${P.esc(row.lineName||'—')}</strong><small>${P.esc(branchTextV13(row))}</small></td><td><strong>${P.esc(row.proofId||'ยังไม่มี')}</strong></td><td><strong>${P.esc(driverTextV13(row))}</strong><small>${P.esc(phoneTextV13(row))}</small></td><td><strong>${P.esc(supplierTextV13(row))}</strong><small>${P.esc(plateTextV13(row))}</small></td><td><strong>${P.esc(P.minuteText(row.standbyTime))} → ${P.esc(P.minuteText(row.plannedDepartureTime??row.startTime))}</strong></td><td>${P.stateBadge(row)}</td><td>${P.actionButtons(row)}</td></tr>`;
    const tableHeadsV13=document.querySelectorAll('.proof-table thead th');['เส้นทาง / ปลายทาง','บาร์รถ','คนขับ / โทรศัพท์','ซัพ / รถ','เวลา','สถานะ','จัดการ'].forEach((x,i)=>{if(tableHeadsV13[i])tableHeadsV13[i].textContent=x;});

    const commandHead=document.querySelector('.proof-command-head'); if(commandHead){const s=commandHead.querySelector('small'),strong=commandHead.querySelector('strong'),span=commandHead.querySelector('span');if(s)s.textContent='ภาพรวมเที่ยวรถ';if(strong)strong.textContent='สถานะเที่ยวรถวันนี้';if(span)span.remove();}
    const privacy=document.querySelector('.privacy-note'); if(privacy)privacy.remove();
    const detailProgress=P.el('detail-progress'); if(detailProgress&&/กำลังอ่าน/.test(detailProgress.textContent)) detailProgress.textContent='ข้อมูลเส้นทาง';

    const oldOpenV13=P.openEditor;
    P.openEditor=(row,detail)=>{oldOpenV13(row,detail);setTimeout(()=>{
      const title=document.querySelector('#proof-editor-dialog h2');if(title)title.textContent='ตรวจข้อมูลก่อนปริ้นบาร์รถ';
      const context=document.getElementById('proof-editor-context-v12');if(context)context.querySelectorAll('small').forEach(el=>{if(el.textContent==='บริษัทซัพ')return;if(el.textContent.includes('โทรศัพท์'))el.textContent='คนขับ / โทรศัพท์';});
      document.querySelectorAll('.proof-lock-reason').forEach(el=>{if(/Fleet|App|ระบบ/.test(el.textContent))el.textContent='ข้อมูลส่วนนี้แก้จาก MS เท่านั้น';});
      document.querySelectorAll('.proof-editor-section-head span').forEach(el=>{el.textContent=el.textContent.replace('เหมือนช่อง','ตามข้อมูล').replace('ตามข้อมูล MS','จาก MS');});
      const checkLabel=document.querySelector('.proof-editor-confirm-check span, .proof-confirm-row span'); if(checkLabel&&/ยืนยัน/.test(checkLabel.textContent))checkLabel.textContent='ตรวจข้อมูลแล้ว';
    },0);};

    const styleV13=document.createElement('style'); styleV13.id='proof-v13-style'; styleV13.textContent=`
      .proof-page{color:#17212b!important}.proof-page small,.proof-page .proof-summary,.proof-page .proof-group-name small{color:#4f5b66!important}.proof-lane-head-v13{min-height:62px!important;background:#eef2f5!important;border-bottom:1px solid #cfd6dc!important}.proof-lane-head-v13 .proof-group-name strong{font-size:18px!important;color:#142332!important}.proof-lane-head-v13 .proof-group-name small{font-size:13px!important;color:#4b5966!important}.proof-lane-body-v13{display:block!important}.proof-branch-v13{border-top:8px solid #f1f4f6;background:#fff}.proof-branch-v13>header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#263746;color:#fff}.proof-branch-v13>header strong{font-size:15px}.proof-branch-v13>header span{font-size:12px;font-weight:800;color:#dfe7ed}.proof-branch-columns-v13,.proof-grid-row-v13{display:grid;grid-template-columns:minmax(300px,1.65fr) minmax(145px,.78fr) minmax(175px,.9fr) minmax(190px,1fr) minmax(190px,1fr) 330px;align-items:stretch}.proof-branch-columns-v13{background:#e8edf1;border-bottom:1px solid #cfd6dc}.proof-branch-columns-v13 b{padding:9px 12px;font-size:12px;color:#344553;border-right:1px solid #d2d9df}.proof-grid-row-v13{border-bottom:1px solid #dce2e6;box-shadow:inset 3px 0 0 #caa000}.proof-grid-row-v13.is-ready{box-shadow:inset 3px 0 0 #4c966d}.proof-grid-row-v13.is-missed{box-shadow:inset 3px 0 0 #bd3b34}.proof-grid-row-v13>div:not(.proof-v11-detail){padding:12px 12px;border-right:1px solid #e1e6ea;min-width:0}.proof-grid-row-v13 small{display:block;font-size:12px!important;font-weight:800;color:#53606c!important}.proof-grid-row-v13 strong{display:block;margin-top:3px;font-size:15px!important;line-height:1.45;color:#101820!important;word-break:break-word}.proof-grid-row-v13 span{display:block;margin-top:3px;font-size:12.5px!important;line-height:1.4;color:#36434f!important}.proof-grid-route-v13 strong{font-size:16px!important}.proof-grid-bar-v13 strong{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:15px!important}.proof-grid-actions-v13{display:grid!important;grid-template-columns:110px 1fr;gap:8px;align-items:center}.proof-grid-status-v13{padding:0!important;border:0!important}.proof-grid-status-v13 strong{font-size:13px!important}.proof-grid-btns-v13{display:grid;grid-template-columns:145px 145px;gap:7px;justify-content:end}.proof-grid-btns-v13>.btn,.proof-grid-btns-v13 .proof-actions,.proof-grid-btns-v13 .proof-actions .btn{width:145px!important;min-width:145px!important;max-width:145px!important;height:42px!important;min-height:42px!important;margin:0!important;padding:5px 7px!important;font-size:11px!important;display:flex;align-items:center;justify-content:center;white-space:normal;text-align:center;line-height:1.2}.proof-grid-btns-v13 .proof-actions{display:block!important}.proof-v11-detail{grid-column:1/-1!important;grid-template-columns:repeat(6,1fr)!important;border-top:1px dashed #bcc7cf!important;background:#f6f8fa!important}.proof-v11-detail>div{border-right:1px solid #dce2e6}.proof-editor-route-box{display:block!important;padding:15px 18px!important}.proof-editor-summary-v7{display:grid!important;grid-template-columns:repeat(3,1fr)!important}.proof-editor-summary-v7>div{min-height:74px!important;display:flex!important;flex-direction:column!important;justify-content:center!important}.proof-editor-summary-v7 small,.proof-editor-context-v12 small,#proof-editor-context-v12 small{color:#42505d!important;font-size:12px!important}.proof-editor-summary-v7 strong,#proof-editor-context-v12 strong{color:#111b24!important;font-size:15px!important}.proof-editor-summary-v7 span,#proof-editor-context-v12 span{color:#3f4d59!important;font-size:12px!important}.proof-editor-section-head span,.proof-lock-reason,.proof-option-hint{color:#465460!important;font-size:12px!important}.proof-editor-card{color:#17212b!important}.proof-editor-card label,.proof-editor-card p{color:#273541!important}.privacy-note{display:none!important}
      @media(max-width:1250px){.proof-branch-columns-v13{display:none}.proof-grid-row-v13{grid-template-columns:1.5fr .8fr 1fr 1fr}.proof-grid-row-v13>div:nth-child(5){grid-column:1/3}.proof-grid-actions-v13{grid-column:3/5}.proof-v11-detail{grid-template-columns:repeat(3,1fr)!important}}
      @media(max-width:760px){.proof-grid-row-v13{display:block}.proof-grid-row-v13>div:not(.proof-v11-detail){border-right:0;border-bottom:1px solid #e4e8eb}.proof-grid-actions-v13{display:block!important}.proof-grid-btns-v13{grid-template-columns:1fr 1fr;margin-top:8px}.proof-grid-btns-v13>.btn,.proof-grid-btns-v13 .proof-actions,.proof-grid-btns-v13 .proof-actions .btn{width:100%!important;min-width:0!important;max-width:none!important}.proof-v11-detail{grid-template-columns:1fr 1fr!important}}
    `; document.head.appendChild(styleV13);

    P.render();
  };
'''
if anchor not in ui: raise SystemExit('render anchor missing')
ui=ui.replace(anchor,block,1)
ui_path.write_text(ui)

plate_path=Path('worker/src/proof-plate-search-v5.js')
plate=plate_path.read_text()
if 'PROOF_PLATE_UNTYPED_FALLBACK_V13' not in plate:
    marker="""  // PROOF_PLATE_SEARCH_RECOVERY_V10: only after an explicit user search misses, scan a small fleet page and filter locally.
"""
    insert="""  // PROOF_PLATE_UNTYPED_FALLBACK_V13: MS can place a registration in another car-type bucket; only run after an explicit typed search missed.
  for(const variant of variants.slice(0,2)){
    for(const endpoint of [primary,fallback]){
      try{const items=await fetchPlateSearch(credentials,endpoint,{fleetId,id:'',plateNumber:variant,pageSize:'50',pageNum:'1',plateType:''});anySuccess=true;const ranked=rankPlateItems(items,q,'');if(ranked.length)return ranked;}catch(error){lastError=error;}
    }
  }
"""+marker
    if marker not in plate: raise SystemExit('plate marker missing')
    plate=plate.replace(marker,insert,1)
plate_path.write_text(plate)

html_path=Path('proof.html')
html=html_path.read_text().replace('/proof-v10.js?v=20260906-02','/proof-v10.js?v=20260906-03')
html_path.write_text(html)

test=Path('worker/tests/proof-command-center-v10.test.mjs')
t=test.read_text().replace('20260906-02','20260906-03')
t += "\n// PROOF_GRID_V13 regression marker\n"
test.write_text(t)
print('PROOF_GRID_V13_PATCH=READY')
