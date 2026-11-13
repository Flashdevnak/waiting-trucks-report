// WTR009_PNO_QR_EXCEL_LOCAL_V1 — PNO-only local candidate, RELEASE HOLD.
const pnoQrUi009 = { observer:null, cache:new Map(), overlay:null, job:0 };
function pnoQrValidatePage009(result,locator) {
  if (result?.sourceValid !== true || (result.proofId != null &&
      String(result.proofId).trim() !== String(locator?.proofId || '').trim()))
    throw new Error('PNO_QR_SOURCE_IDENTITY_UNVERIFIED');
}
function pnoQrBagCode(items) {
  if (!Array.isArray(items) || !items.length) return null;
  const code = items[0].backingNo;
  return PnoQr009.valid(code) && items.every(item => item.backingNo === code) ? code : null;
}
function pnoQrOwner009() {
  const owner = pnoAsyncCapture();
  return owner && owner.key && owner.hub && pnoAsyncOwn(owner) ? owner : null;
}
function pnoQrMarkup(code) {
  if (!pnoQrOwner009() || !PnoQr009.valid(code)) return '<span class="pno-qr009-missing">ไม่มีรหัสสำหรับสร้าง QR</span>';
  return '<button type="button" class="pno-qr009-button" data-pno-qr009="' + esc(encodeURIComponent(code)) + '" aria-label="ขยาย QR Code"><span>QR Code · แตะขยาย</span></button>';
}
function pnoQrReset009() {
  pnoQrUi009.observer?.disconnect();
  pnoQrUi009.observer = null;
  if (pnoQrUi009.overlay) { const dialog=pnoQrUi009.overlay; pnoQrUi009.overlay=null; dialog.onclose=null; dialog.close(); dialog.remove(); }
}
function pnoQrCancel009() {
  pnoQrUi009.job += 1;
  pnoQrReset009();
  pnoQrUi009.cache.clear();
}
function pnoQrUri009(code) {
  if (pnoQrUi009.cache.has(code)) return pnoQrUi009.cache.get(code);
  const bytes = PnoQr009.png(code);
  let binary = ''; for (const b of bytes) binary += String.fromCharCode(b);
  const uri = 'data:image/png;base64,' + btoa(binary);
  if (pnoQrUi009.cache.size >= 256) pnoQrUi009.cache.delete(pnoQrUi009.cache.keys().next().value);
  pnoQrUi009.cache.set(code,uri);
  return uri;
}
function pnoQrHydrate009() {
  pnoQrReset009();
  const owner = pnoQrOwner009();
  if (!owner || typeof document.querySelectorAll !== 'function') return;
  const signature = pnoAsyncActionSignature();
  const current = () => pnoAsyncOwn(owner) && signature === pnoAsyncActionSignature();
  if (!document.getElementById('pno-qr009-style')) {
    const style = document.createElement('style'); style.id = 'pno-qr009-style';
    style.textContent = '.pno-qr009-button{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;width:80px;min-height:80px;max-width:100%;padding:3px;border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:8px;cursor:pointer;font-size:10px}.pno-qr009-button img{display:block;width:72px;height:72px;image-rendering:pixelated}.pno-qr009-missing{font-size:11px;color:#64748b}.pno-qr009-dialog{max-width:min(90vw,420px);padding:16px;border:1px solid #cbd5e1;border-radius:12px}.pno-qr009-dialog img{width:100%;max-width:360px;image-rendering:pixelated}.pno-qr009-dialog p{overflow-wrap:anywhere}.pno-v18-mobile .pno-qr009-button{margin:6px 0}.pno-qr009-dialog::backdrop{background:#0008}';
    document.head.append(style);
  }
  const load = button => {
    if (!current() || !button.isConnected || !button.getClientRects().length || button.querySelector('img')) return;
    const code = decodeURIComponent(button.dataset.pnoQr009);
    const image = document.createElement('img'); image.src = pnoQrUri009(code); image.alt = 'QR Code'; button.prepend(image);
  };
  const buttons = el('pending-parcels-list').querySelectorAll('[data-pno-qr009]');
  if (typeof IntersectionObserver === 'function') {
    pnoQrUi009.observer = new IntersectionObserver(entries => { for (const entry of entries) if(entry.isIntersecting) { load(entry.target); pnoQrUi009.observer?.unobserve(entry.target); } }, {root:null,rootMargin:'100px'});
  }
  for (const button of buttons) {
    if (pnoQrUi009.observer) pnoQrUi009.observer.observe(button);
    button.onclick = () => {
      if (!current() || !button.isConnected) return;
      const code = decodeURIComponent(button.dataset.pnoQr009);
      pnoQrReset009();
      const dialog = document.createElement('dialog'); dialog.className = 'pno-qr009-dialog';
      const image = document.createElement('img'); image.src = pnoQrUri009(code); image.alt = 'QR Code';
      const label = document.createElement('p'); label.textContent = code;
      const close = document.createElement('button'); close.type = 'button'; close.textContent = 'ปิด';
      close.onclick = () => dialog.close();
      dialog.onclose = () => { dialog.remove(); if(pnoQrUi009.overlay===dialog)pnoQrUi009.overlay=null; if(current())pnoQrHydrate009(); };
      dialog.append(image,label,close); document.body.append(dialog); pnoQrUi009.overlay=dialog; dialog.showModal();
    };
  }
}
function pnoQrSheets009(type, values, exportRows, sheet) {
  if (!pnoQrOwner009()) throw new Error('PNO_QR_IDENTITY_UNVERIFIED');
  if (type !== 'bag') {
    if (!Array.isArray(pnoV18State.filterRows) || !Array.isArray(exportRows)) throw new Error('PNO_QR_INCOMPLETE_EXPORT');
    // Preserve raw code types; numeric identities must never be advertised as scan-safe.
    values = values.map((value,index) => ({...value,PNO:exportRows[index].pno,'เลขถุงแบ็กกิ้ง':exportRows[index].backingNo}));
    return [{name:sheet,rows:values,qrKeys:['PNO','เลขถุงแบ็กกิ้ง']}];
  }
  if (!Array.isArray(pnoV18State.bagRows)) throw new Error('PNO_QR_INCOMPLETE_BAGS');
  const groups = pnoV18FilteredBagGroups();
  if (groups.length !== values.length) throw new Error('PNO_QR_BAG_PROJECTION_CHANGED');
  const members = [];
  values = values.map((value,index) => {
    const [bag,items] = groups[index], code = pnoQrBagCode(items);
    if (value['เลขถุงแบ็กกิ้ง'] !== bag) throw new Error('PNO_QR_BAG_ORDER_CHANGED');
    // Grouping trims display keys in the baseline. Ambiguous raw membership is rejected.
    if (code === null) throw new Error('PNO_QR_BAG_RAW_IDENTITY_AMBIGUOUS');
    for (const item of items) members.push({'ลำดับ':members.length+1,PNO:item.pno,'เลขถุงแบ็กกิ้ง':item.backingNo,'สถานะ':pnoV18ParcelStatus(item,'total'),'การดำเนินการล่าสุด':pnoV18ParcelAction(item),'เวลา':item.lastActionAt||'','HUB ปลายทาง':item.targetHub||'','สาขาปลายทาง':pnoV18DisplayBranch(item.targetBranch),'ชื่อสาขาต่อไป':item.nextStoreName||'',...(pnoV18State.selection==='union'?{'จุดส่ง':item.pnoSegmentLabel||''}:{})});
    return {...value,'เลขถุงแบ็กกิ้ง':code};
  });
  return [{name:sheet,rows:values,qrKeys:['เลขถุงแบ็กกิ้ง']},{name:'พัสดุภายในถุงตามตัวกรอง',rows:members,qrKeys:['PNO','เลขถุงแบ็กกิ้ง']}];
}
function pnoQrDownload009(bytes, filename) {
  const blob = new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  try { link.href=url;link.download=filename;document.body.append(link);link.click(); }
  finally { link.remove(); URL.revokeObjectURL(url); }
}
async function pnoQrSaveSheets009(sheets,currentAction) {
  const owner = pnoQrOwner009(); if (!owner || !currentAction()) throw pnoAsyncCancelled();
  const job = ++pnoQrUi009.job;
  const current = () => job === pnoQrUi009.job && pnoAsyncOwn(owner) && currentAction();
  const bytes = await PnoQr009.workbook(sheets,{current});
  if (!current()) throw pnoAsyncCancelled();
  await pnoQrDownload009(bytes,'รายการพัสดุเข้าคลัง_'+new Date().toISOString().slice(0,10)+'.xlsx');
}
async function pnoQrLegacyExport009() {
  const owner = pnoQrOwner009(), signature = pnoAsyncActionSignature();
  const current = () => Boolean(owner && pnoAsyncOwn(owner) && signature === pnoAsyncActionSignature());
  if (!current()) return;
  try {
    const type = pnoV18State.type;
    if (!['total','already','no_entry'].includes(type)) throw new Error('PNO_LEGACY_VIEW_UNSUPPORTED');
    await pnoV18EnsureParcelFilterRows(); if(!current())return;
    const category = type==='already'?'เข้าคลังแล้ว':type==='total'?'พัสดุทั้งหมด':'คงเหลือ';
    const rows = pnoV18FilteredParcelEntries(pnoV18State.filterRows).map(({item},index)=>({
      'ลำดับ':index+1,'เลขพัสดุ':item.pno,'ประเภท PNO':category,'Backing / Bagging':item.backingNo||'',
      'การดำเนินการล่าสุด':item.lastAction||item.status||'','เวลาที่ดำเนินการล่าสุด':item.lastActionAt||'',
      'ฮับปลายทาง':item.targetHub||'','ชื่อสาขาต่อไป':item.targetBranch||''
    }));
    if(!rows.length)return toast('ยังไม่มีข้อมูลสำหรับ Export',true);
    await pnoQrSaveSheets009([{name:'PNO',rows,qrKeys:['เลขพัสดุ','Backing / Bagging']}],current);
  } catch(error) {
    if(!current()||error?.code==='PNO_LOCAL_ASYNC_CANCELLED')return;
    toast('ดำเนินการไม่สำเร็จ กรุณาลองใหม่',true);
  }
}
async function pnoQrExport009(type,values,exportRows,sheet,currentAction) {
  const owner = pnoQrOwner009(); if (!owner || !currentAction()) throw pnoAsyncCancelled();
  return pnoQrSaveSheets009(pnoQrSheets009(type,values,exportRows,sheet),currentAction);
}
