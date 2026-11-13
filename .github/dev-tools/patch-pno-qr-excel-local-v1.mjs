import { readFileSync } from 'node:fs';
const core=readFileSync(new URL('./pno-qr-excel-local-v1.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('./pno-qr-ui-local-v1.js',import.meta.url),'utf8');
export function patchPnoQrExcelLocal009(source) {
 if(source.includes('WTR009_PNO_QR_EXCEL_LOCAL_V1'))return source;
 const alter=(name,fn)=>{const prefix=source.includes('async function '+name+'(')?'async function '+name+'(':'function '+name+'(';const start=source.indexOf(prefix),end=source.indexOf('\n}\n',start)+2;if(start<0||end<=start)throw Error('WTR009 missing function '+name);source=source.slice(0,start)+fn(source.slice(start,end))+source.slice(end);};
 const once=(s,a,b)=>{if(s.split(a).length!==2)throw Error('WTR009 anchor count: '+a.slice(0,90));return s.replace(a,b);};
 alter('pnoV18RenderRows',s=>{
 s=once(s,"'</td><td><span class=\"pno-v18-badge '","'</td><td>' + pnoQrMarkup(item.pno) + '</td><td><span class=\"pno-v18-badge '");
 s=once(s,"'<div class=\"pno-v18-mobile-badges\"><span", "pnoQrMarkup(item.pno) + '<div class=\"pno-v18-mobile-badges\"><span");
 s=once(s,'<th>#</th><th>PNO</th><th>สถานะ</th>','<th>#</th><th>PNO</th><th>QR Code</th><th>สถานะ</th>');
 return s.slice(0,-1)+'  pnoQrHydrate009();\n}';});
 alter('pnoInboundRender',s=>{
 s=once(s,"'<div class=\"pno-v18-mobile-meta\">' + values.slice(1).map((value, index) =>", "pnoQrMarkup(row.pno) + '<div class=\"pno-v18-mobile-meta\">' + values.slice(1).map((value, index) =>");
 s=once(s,"'</small><b>' + cell(value) + '</b></div>').join(\"\")", "'</small><b>' + cell(value) + '</b>' + (index === 0 ? pnoQrMarkup(row.backingNo) : '') + '</div>').join(\"\")");
 s=once(s,"values.map((value) => '<td>' + cell(value) + '</td>').join(\"\")","values.map((value,index) => '<td>' + cell(value) + '</td>' + (index < 2 ? '<td>' + pnoQrMarkup(index === 0 ? row.pno : row.backingNo) + '</td>' : '')).join(\"\")");
 s=once(s,'["PNO", "เลขแบ็กกิ้ง", "การดำเนินการล่าสุด", "เวลาการดำเนินการล่าสุด", "สถานะตรวจสแกนเข้า", "เหตุผล"]','["PNO", "QR Code", "เลขแบ็กกิ้ง", "QR Code", "การดำเนินการล่าสุด", "เวลาการดำเนินการล่าสุด", "สถานะตรวจสแกนเข้า", "เหตุผล"]');
 return s.slice(0,-1)+'  pnoQrHydrate009();\n}';});
 alter('pnoV18RenderBags',s=>{
 s=once(s,'<th>เลขถุงแบ็กกิ้ง</th><th>สถานะ</th>','<th>เลขถุงแบ็กกิ้ง</th><th>QR Code</th><th>สถานะ</th>');
 s=once(s,"'<td>' + esc(summary.status) + '</td>'","'<td>' + pnoQrMarkup(pnoQrBagCode(items)) + '</td><td>' + esc(summary.status) + '</td>'");
 s=once(s,'colspan="9"','colspan="10"');
 s=once(s,'<th>#</th><th>PNO</th><th>ล่าสุด</th>','<th>#</th><th>PNO</th><th>QR Code</th><th>ล่าสุด</th>');
 s=once(s,"'</td><td>' + esc(pnoV18ParcelAction(item))","'</td><td>' + pnoQrMarkup(item.pno) + '</td><td>' + esc(pnoV18ParcelAction(item))");
 s=once(s,"'<div class=\"pno-v18-mobile-meta\">' +", "pnoQrMarkup(pnoQrBagCode(items)) + '<div class=\"pno-v18-mobile-meta\">' +");
 s=once(s,"'</strong></div><div><span>' + esc(pnoV18ParcelAction(item))","'</strong></div>' + pnoQrMarkup(item.pno) + '<div><span>' + esc(pnoV18ParcelAction(item))");
 return s.slice(0,-1)+'  pnoQrHydrate009();\n}';});
 alter('renderPendingParcelPage',s=>{
 s=once(s,'<th>PNO</th><th>Backing / Bagging</th>','<th>PNO</th><th>QR Code</th><th>Backing / Bagging</th><th>QR Code</th>');
 s=once(s,'${esc(item.pno || "-")}</strong></td>','${esc(item.pno || "-")}</strong></td><td>${pnoQrMarkup(item.pno)}</td>');
 s=once(s,'${esc(item.backingNo || "-")}</strong></td>','${esc(item.backingNo || "-")}</strong></td><td>${pnoQrMarkup(item.backingNo)}</td>');
 return s.slice(0,-1)+'  pnoQrHydrate009();\n}';});
 alter('exportPendingParcels',()=>`function exportPendingParcels() {
  if (!pnoQrOwner009()) return toast("ข้อมูลอ้างอิงไม่พร้อม จึงยัง Export ไม่ได้",true);
  return pnoQrLegacyExport009();
}`);
 alter('pnoV18Fetch',s=>{
 s=once(s,'    if (cached) return cached;','    if (cached) { pnoQrValidatePage009(cached,locator); return cached; }');
 return once(s,'  if (selected || selection === null) pnoPendingPropagatePositive(locator, result);','  pnoQrValidatePage009(result,locator);\n  if (selected || selection === null) pnoPendingPropagatePositive(locator, result);');
 });
 alter('pnoV18Export',s=>once(s,`  const ws = XLSX.utils.json_to_sheet(values);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  await XLSX.writeFile(wb, "รายการพัสดุเข้าคลัง_" + new Date().toISOString().slice(0,10) + ".xlsx");`,`  await pnoQrExport009(type,values,exportRows,sheet,currentAction);`));
 for(const name of ['pnoAsyncInvalidate','pnoAsyncBeginOpen','pnoAsyncBeginView'])alter(name,s=>once(s,'function '+name+'() {\n','function '+name+'() {\n  pnoQrCancel009();\n'));
 return source+'\n'+core+'\n'+ui+'\n';
}
