// WTR009R local-only closure transform. Original WTR008/009 source modules remain unchanged.
export function patchPnoQrClosure009R(source) {
 if(source.includes('WTR009R_PNO_QR_CLOSURE_V1'))return source;
 const once=(s,a,b)=>{if(s.split(a).length!==2)throw Error('WTR009R anchor count '+a.slice(0,90));return s.replace(a,b);};
 const alter=(name,fn)=>{const prefix=source.includes('async function '+name+'(')?'async function '+name+'(':'function '+name+'(';const a=source.indexOf(prefix),b=source.indexOf('\n}\n',a)+2;if(a<0||b<=a)throw Error('WTR009R missing '+name);source=source.slice(0,a)+fn(source.slice(a,b))+source.slice(b);};
 alter('pnoQrValidatePage009',()=>validate.toString().replace('function validate(','function pnoQrValidatePage009('));
 alter('pnoV18Fetch',s=>{s=once(s,'pnoQrValidatePage009(cached,locator);','pnoQrValidatePage009(cached,locator,{hub:state.branch,type,page,union:selection === "union",unionScope:pnoV18LocatorKey(sourceRow)+"|union|"+type});');return once(s,'pnoQrValidatePage009(result,locator);','pnoQrValidatePage009(result,locator,{hub:state.branch,type,page,union:selection === "union",unionScope:pnoV18LocatorKey(sourceRow)+"|union|"+type});');});
 alter('pnoV18UnionPage',s=>{
 s=once(s,'  let full = force ? null : pnoV18CacheGet(pnoV18ViewCache, key);', '  let full = force ? null : pnoV18CacheGet(pnoV18ViewCache, key);\n  if(full && full.pnoQrUnionScope009R !== key)throw pnoV18UnionFailure("PNO_UNION_SOURCE_INVALID",{},"ข้อมูลรวมหลายจุดส่งไม่ตรงขอบเขตปัจจุบัน");');
 s=once(s,'{ parcels: all, total }, 120)', '{ parcels: all, total, pnoQrUnionScope009R:key }, 120)');
 return once(s,'page, proofId: sourceRow.proofId, routeName: sourceRow.routeName, sourceValid: true };','page, proofId: sourceRow.proofId, routeName: sourceRow.routeName, sourceValid: true, pnoQrUnionScope009R:full.pnoQrUnionScope009R };');
 });
 alter('pnoAsyncPage',s=>{
 s=once(s,'  if (!owner) return browserPnoPage(row, type, page, force);','  if (!owner) { const result=await browserPnoPage(row,type,page,force); pnoQrValidatePage009(result,row,{hub:state.branch,type,page}); return result; }');
 return once(s,'    return result;','    pnoQrValidatePage009(result,row,{hub:state.branch,type,page});\n    return result;');
 });
 alter('pnoQrMarkup',s=>once(s,"function pnoQrMarkup(code) {","function pnoQrMarkup(code) {\n  if(typeof TextEncoder!=='function'||typeof btoa!=='function')return '<span class=\"pno-qr009-missing\">อุปกรณ์ไม่รองรับ QR Code</span>';"));
 alter('pnoQrSaveSheets009',s=>{
 s=once(s,'async function pnoQrSaveSheets009(sheets,currentAction) {',"async function pnoQrSaveSheets009(sheets,currentAction) {\n  if(typeof TextEncoder!=='function'||typeof MessageChannel!=='function'||typeof Blob!=='function'||typeof URL==='undefined'||typeof URL.createObjectURL!=='function'||typeof URL.revokeObjectURL!=='function')throw new Error('PNO_EXCEL_BROWSER_API_UNAVAILABLE');");
 return once(s,"  await pnoQrDownload009(bytes,'รายการพัสดุเข้าคลัง_'+new Date().toISOString().slice(0,10)+'.xlsx');", "  try { await pnoQrDownload009(bytes,'รายการพัสดุเข้าคลัง_'+new Date().toISOString().slice(0,10)+'.xlsx'); }\n  catch(error) { if(!current())throw pnoAsyncCancelled(); throw error; }");
 });
 const xmlLine=source.split('\n').find(line=>line.startsWith('const xml=s=>'));if(!xmlLine?.endsWith(';'))throw Error('WTR009R XML anchor');source=once(source,xmlLine,xmlLine.slice(0,-1)+".replace(/\\r/g,'&#13;');");
 alter('workbook',s=>{
 s=once(s,'async function workbook(sheets,{current=()=>true,yieldFn=yieldTurn}={}){','async function workbook(sheets,{current=()=>true,yieldFn=yieldTurn}={}){\n'+budget.toString()+'\n budget(sheets); let imageBytes009R=0;\n');
 s=once(s,"if(!media.has(value)){const mid=media.size+1;media.set(value,{id:mid,bytes:png(value)});}","if(!media.has(value)){if(media.size>=20000)throw Error('PNO_EXCEL_IMAGE_LIMIT');const mid=media.size+1,bytes=png(value);imageBytes009R+=bytes.length;if(imageBytes009R>32*1024*1024)throw Error('PNO_EXCEL_IMAGE_BYTES_LIMIT');media.set(value,{id:mid,bytes});}");
 return once(s,' const bytes=zip(entries);check();return bytes;'," let size009R=0;if(entries.length>60000)throw Error('PNO_EXCEL_ZIP_ENTRIES_LIMIT');for(const [name,value]of entries){size009R+=utf8(name).length*2+76+(typeof value==='string'?utf8(value).length:value.length);if(size009R>64*1024*1024)throw Error('PNO_EXCEL_ZIP_BYTES_LIMIT');}\n const bytes=zip(entries);check();return bytes;");
 });
 return source+'\n// WTR009R_PNO_QR_CLOSURE_V1 — RELEASE HOLD\n'+pnoQrNormalizeProof009R.toString()+'\n';
}
function pnoQrNormalizeProof009R(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g,'');
}
function validate(result,locator,context={}) {
  const reject=()=>{const error=new Error('PNO_QR_SOURCE_IDENTITY_UNVERIFIED');error.pnoUnionDiagnostic={reasonCode:'PNO_UNION_SOURCE_INVALID',page:context.page,sourceValid:result?.sourceValid===true};throw error;};
  const proof=pnoQrNormalizeProof009R(locator?.proofId);
  if(result?.sourceValid!==true || !proof || !Object.prototype.hasOwnProperty.call(result,'proofId') ||
     pnoQrNormalizeProof009R(result.proofId)!==proof ||
     !['total','already','no_entry'].includes(context.type) ||
     !Number.isSafeInteger(context.page)||context.page<1||result.page!==context.page ||
     !Array.isArray(result.parcels)||result.parcels.length>200||
     !Number.isSafeInteger(result.total)||result.total<result.parcels.length)reject();
  // A union result is virtual, produced by the exact-segment composer. Each
  // underlying canonical page is validated in pnoAsyncPage before composition.
  if(context.union===true){if(!context.unionScope||result.pnoQrUnionScope009R!==context.unionScope)reject();return;}
  const bounded=value=>String(value||'').trim().slice(0,160);
  const expected={hub:String(context.hub||locator?.hub||'').trim().toUpperCase(),
    day:String(locator?.pnoSourceDay||''),lineId:bounded(locator?.pnoLineId||locator?.pnoVanLineId),
    sourceStoreId:bounded(locator?.pnoStoreId),targetStoreId:bounded(locator?.pnoNextStoreId),type:context.type};
  for(const [key,value]of Object.entries(expected))
    if(!value||!Object.prototype.hasOwnProperty.call(result,key)||result[key]!==value)reject();
}
function budget(sheets) {
 if(!Array.isArray(sheets)||!sheets.length||sheets.length>8)throw Error('PNO_EXCEL_INPUT_INVALID');
 let rows=0,cells=0,textBytes=0;const names=new Set();
 for(const sheet of sheets){
  if(!sheet||typeof sheet.name!=='string'||!sheet.name.trim()||sheet.name.length>31||/[\\/*?:\[\]\u0000-\u001f]/u.test(sheet.name))throw Error('PNO_EXCEL_SHEET_NAME_INVALID');
  const name=sheet.name.toUpperCase();if(names.has(name))throw Error('PNO_EXCEL_SHEET_NAME_DUPLICATE');names.add(name);
  if(!Array.isArray(sheet.rows)||!sheet.rows.length||!Array.isArray(sheet.qrKeys)||sheet.qrKeys.some(k=>typeof k!=='string')||new Set(sheet.qrKeys).size!==sheet.qrKeys.length)throw Error('PNO_EXCEL_INPUT_INVALID');
  rows+=sheet.rows.length;if(rows>10000)throw Error('PNO_EXCEL_LIMIT_10000');
  for(const row of sheet.rows){
   if(!row||typeof row!=='object'||Array.isArray(row))throw Error('PNO_EXCEL_INPUT_INVALID');
   const entries=Object.entries(row);cells+=entries.length+sheet.qrKeys.length;if(cells>200000)throw Error('PNO_EXCEL_CELL_LIMIT');
   for(const [key,value]of entries){
    if(!['string','number','boolean','undefined'].includes(typeof value)&&value!==null)throw Error('PNO_EXCEL_VALUE_INVALID');
    if(typeof value==='number'&&!Number.isFinite(value))throw Error('PNO_EXCEL_VALUE_INVALID');
    const str=String(value??'');if(key.length>32767||str.length>32767)throw Error('PNO_EXCEL_CELL_TEXT_LIMIT');
    for(const part of [key,str]){if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(part))throw Error('PNO_EXCEL_XML_CHAR_INVALID');
    for(let i=0;i<part.length;i++){const c=part.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){if(++i>=part.length||part.charCodeAt(i)<0xdc00||part.charCodeAt(i)>0xdfff)throw Error('PNO_EXCEL_UTF16_INVALID');}else if(c>=0xdc00&&c<=0xdfff)throw Error('PNO_EXCEL_UTF16_INVALID');}}
    textBytes+=utf8(key).length+utf8(str).length;if(textBytes>8*1024*1024)throw Error('PNO_EXCEL_TEXT_BYTES_LIMIT');
   }
  }
 }
}
