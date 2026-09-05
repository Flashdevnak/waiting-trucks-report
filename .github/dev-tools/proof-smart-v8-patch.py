from pathlib import Path
import re


def read(p): return Path(p).read_text(encoding='utf-8')
def write(p,s): Path(p).write_text(s, encoding='utf-8')
def replace_once(s, old, new, label):
    if old not in s: raise SystemExit(f'{label}: target not found')
    return s.replace(old,new,1)

# 1) Local table search: format-tolerant, zero network.
p='proof-v2-ui.js'; s=read(p)
pattern=re.compile(r"P\.filteredRows=\(\)=>\{.*?\}; P\.renderMetrics=", re.S)
replacement="""P.smartSearchNormalize=v=>String(v??'').normalize('NFKC').toLowerCase().replace(/[\\s\\-–—_/.()[\\]{}:;,'\"`~!@#$%^&*+=?<>|\\\\]+/g,''); /* PROOF_SMART_SEARCH_V8 */ P.rowSearchText=row=>[row.lineName,row.lineTypeText,row.lineModeText,row.plateNumber,row.plateTypeText,row.driver,row.driverPhone,row.proofId,row.proofStateText,row.destinationCode,row.destinationName,P.standbyText(row)].join(' '); P.filteredRows=()=>{const s=P.state,tokens=String(s.query||'').trim().split(/\\s+/).map(P.smartSearchNormalize).filter(Boolean);return s.rows.filter(row=>{if(s.stateFilter!=='all'&&String(row.proofState??'')!==s.stateFilter)return false;if(s.lineType!=='all'&&P.lineTypeKey(row)!==s.lineType)return false;if(s.lineMode!=='all'&&P.lineModeKey(row)!==s.lineMode)return false;if(s.vehicle!=='all'&&P.vehicleKey(row)!==s.vehicle)return false;if(!tokens.length)return true;const hay=P.smartSearchNormalize(P.rowSearchText(row));return tokens.every(token=>hay.includes(token));}).sort((a,b)=>{const aa=P.alertForRow(a),bb=P.alertForRow(b);if(Boolean(aa)!==Boolean(bb))return bb?1:-1;if(Number(a.proofState)===1&&Number(b.proofState)!==1)return -1;if(Number(b.proofState)===1&&Number(a.proofState)!==1)return 1;return P.destinationKey(a).localeCompare(P.destinationKey(b),'th')||(Number(a.plannedDepartureTime??a.startTime)||0)-(Number(b.plannedDepartureTime??b.startTime)||0);})}; P.renderMetrics="""
s2,n=pattern.subn(replacement,s,count=1)
if n!=1: raise SystemExit('proof-v2-ui filteredRows block not found')
write(p,s2)

# 2) Editor search: manual only, five-minute browser cache, normalized/ranked results.
p='proof-v2-actions.js'; s=read(p)
s=replace_once(s,'  let searchTimer=null;','  let searchTimer=null;\n  const editorSearchCache=new Map();\n  const EDITOR_SEARCH_CACHE_MS=5*60_000; // PROOF_EDITOR_SEARCH_CACHE_V8','proof-v2-actions cache')
start=s.find('  P.queueEditorSearch=(kind,value)=>{')
end=s.find('  P.choosePlate=button=>{',start)
if start<0 or end<0: raise SystemExit('proof-v2-actions search block not found')
block=r'''  P.editorSearchNorm=v=>String(v??'').normalize('NFKC').toLowerCase().replace(/[\s\-–—_/.()[\]{}:;,'"`~!@#$%^&*+=?<>|\\]+/g,'');
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

'''
s=s[:start]+block+s[end:]
write(p,s)

# 3) Plate selector: user-triggered variants/fallback, larger page only on search.
p='worker/src/proof-plate-search-v5.js'; s=read(p)
start=s.find('async function readPlateOptions(credentials, detail, q) {')
end=s.find('\nfunction plateDisplay',start)
if start<0 or end<0: raise SystemExit('proof plate search function not found')
block=r'''function normalizePlateSearch(v) { return text(v, 120).normalize('NFKC').toLowerCase().replace(/[\s\-–—_/.()[\]{}]+/g, ''); }
function plateSearchVariants(q) { const raw=text(q,80), noProvince=raw.replace(/\([^)]*\)/g,'').trim(), compact=raw.replace(/[\s\-–—_/.()[\]{}]+/g,''); return [...new Set([raw,noProvince,compact].filter(x=>x.length>=2))]; }
function plateTypeValue(x) { const vo=x?.fleet_company_car_type_vo||{}; return String(vo.car_type??x?.type??''); }
function plateItems(data) { return Array.isArray(data)?data:Array.isArray(data?.items)?data.items:[]; }
function rankPlateItems(items,q,requiredType) { const nq=normalizePlateSearch(q),seen=new Set(),out=[]; for(const item of items){ const itemType=plateTypeValue(item); if(requiredType&&itemType&&itemType!==String(requiredType))continue; const key=String(item?.id??'')||normalizePlateSearch(item?.plate_number||item?.label); if(!key||seen.has(key))continue; seen.add(key); out.push(item); } const score=x=>{const n=normalizePlateSearch(x?.plate_number||x?.label);return n===nq?4:n.startsWith(nq)?3:n.includes(nq)?2:1;}; return out.sort((a,b)=>score(b)-score(a)).slice(0,50); }
async function fetchPlateSearch(credentials, endpoint, params) { const url=new URL(endpoint); for(const [key,value] of Object.entries(params)) url.searchParams.set(key,value); const response=await fetch(url,{headers:msHeaders(credentials)}); const payload=await readMsJson(response,'MS_PLATE_LIST_ERROR'); return plateItems(payload.data); }
async function readPlateOptions(credentials, detail, q) {
  const fleetId=String(detail.fleet_id||''), requiredType=msPlateTypeFilter(detail), variants=plateSearchVariants(q);
  const primary='https://ms-api.flashexpress.com/gw/fms/ms/car/car/info';
  const fallback=`https://ms-api.flashexpress.com/gw/nws/staff/ms/fleet/van/${encodeURIComponent(fleetId)}`;
  let lastError=null, anySuccess=false;
  for(const variant of variants){
    try{const items=await fetchPlateSearch(credentials,primary,{fleetId,id:'',plateNumber:variant,pageSize:'50',pageNum:'1',plateType:requiredType});anySuccess=true;const ranked=rankPlateItems(items,q,requiredType);if(ranked.length)return ranked;}catch(error){lastError=error;}
  }
  try{const items=await fetchPlateSearch(credentials,fallback,{fleetId,id:'',plateNumber:variants[0]||q,pageSize:'50',pageNum:'1',plateType:requiredType});anySuccess=true;const ranked=rankPlateItems(items,q,requiredType);if(ranked.length)return ranked;}catch(error){lastError=error;}
  if(!anySuccess&&lastError)throw lastError;
  return [];
}
// PROOF_PLATE_SEARCH_V8: extra attempts happen only after an explicit user search; no polling/background call added.
'''
s=s[:start]+block+s[end:]
write(p,s)

# 4) Driver search: one MS call, normalize phone query and dedupe.
p='worker/src/proof-editor.js'; s=read(p)
start=s.find('async function readDriverOptions(credentials,detail,q){')
end=s.find('\n\nasync function readPlateOptions',start)
if start<0 or end<0: raise SystemExit('proof driver search function not found')
block=r'''async function readDriverOptions(credentials,detail,q){
  const url=new URL('https://ms-api.flashexpress.com/gw/fms/ms/driver/list');
  url.searchParams.set('fleetId',String(detail.fleet_id||''));
  url.searchParams.set('carType','');
  const raw=text(q,80),digits=raw.replace(/\D/g,''),compact=raw.replace(/\s/g,''),query=(digits.length>=4&&digits.length>=compact.length-2)?digits:raw;
  if(query)url.searchParams.set('nameOrMobile',query); else if(detail.fms_driver_id!=null)url.searchParams.set('driverId',String(detail.fms_driver_id));
  const payload=await readMsJson(await fetch(url,{headers:msHeaders(credentials)}),'MS_DRIVER_LIST_ERROR');
  const items=Array.isArray(payload.data)?payload.data:Array.isArray(payload.data?.items)?payload.data.items:[],seen=new Set(),out=[];
  for(const item of items){const key=String(item?.driver_id??'')||`${text(item?.driver_name,180)}|${text(item?.mobile,40)}`;if(!key||seen.has(key))continue;seen.add(key);out.push(item);}
  return out; // PROOF_DRIVER_SEARCH_V8: one request only when user explicitly searches.
}'''
s=s[:start]+block+s[end:]
write(p,s)

# 5) Proof-only HAR UX: exactly one HAR upload control, shared by route + print; newer credential in HAR wins.
p='worker/src/proof-ui-v5.js'; s=read(p)
s=s.replace("const VERSION = '20260905-09';","const VERSION = '20260905-10';",1)
s=s.replace('if (window.__PROOF_V7_READY__) return;\n    window.__PROOF_V7_READY__ = true;','if (window.__PROOF_V8_READY__) return;\n    window.__PROOF_V8_READY__ = true; // PROOF_SMART_V8',1)
old="""      for (const entry of (har?.log?.entries || [])) {
        const hs = entry?.request?.headers || [];
        const get = name => String(hs.find(h => String(h?.name || '').toLowerCase() === name)?.value || '').trim();
        const sessionId = get('x-fle-session-id'), deviceId = get('x-device-id');
        if (sessionId && deviceId) return { sessionId, deviceId };
      }"""
new="""      const entries = Array.isArray(har?.log?.entries) ? [...har.log.entries].reverse() : [];
      for (const entry of entries) {
        let host = ''; try { host = new URL(entry?.request?.url || '').hostname.toLowerCase(); } catch {}
        if (!host.endsWith('flashexpress.com')) continue;
        const hs = entry?.request?.headers || [];
        const get = name => String(hs.find(h => String(h?.name || '').toLowerCase() === name)?.value || '').trim();
        const sessionId = get('x-fle-session-id'), deviceId = get('x-device-id');
        if (sessionId && deviceId) return { sessionId, deviceId };
      }"""
s=replace_once(s,old,new,'proof-ui HAR extractor')
s=s.replace("btn.textContent = 'ตั้งค่าการเชื่อมต่อ';","btn.textContent = 'การเชื่อมต่อ MS / HAR';",1)
s=s.replace("document.getElementById('proof-session-status').textContent = 'Session นี้ใช้ทั้งดูข้อมูล Proof และสร้าง PDF จาก MS';","document.getElementById('proof-session-status').textContent = 'HAR ไฟล์เดียว ใช้ทั้งเส้นทาง MS และปริ้นบาร์โค้ด';",1)
s=s.replace("const sessionNavButton = document.getElementById('proof-session-btn'); if (sessionNavButton) sessionNavButton.onclick = openSession;","const sessionNavButton = document.getElementById('proof-session-btn'); if (sessionNavButton) sessionNavButton.onclick = e => { e?.preventDefault?.(); openSession(); };",1)
old_dialog='<p class="proof-session-note">ใช้ตัวเชื่อมต่อ MS ชุดเดียวกับหน้าติดตามรถของ HUB นี้ เมื่อเชื่อมแล้วจะใช้ทั้งอ่านข้อมูล แก้ข้อมูลที่ MS อนุญาต และปริ้น PDF</p><div class="proof-session-actions"><button id="proof-session-test" class="btn btn-header" type="button">ตรวจ Session</button><button id="proof-session-qr" class="btn btn-accent" type="button">เชื่อมต่อด้วย QR</button></div><details class="proof-session-har"><summary>หรืออัปโหลด HAR จาก MS</summary><p>ระบบอ่าน Session ID และ Device ID แล้วบันทึกผ่านตัวเชื่อมเดิมของ HUB</p><input id="proof-session-har" type="file" accept=".har,application/json"><button id="proof-session-save" class="btn btn-accent btn-full" type="button">ทดสอบและบันทึก Session</button></details><p id="proof-session-status" class="proof-session-status">Session นี้ใช้ทั้งดูข้อมูล Proof และสร้าง PDF จาก MS</p>'
new_dialog='<p class="proof-session-note"><b>HAR เป็นไฟล์เดียวกัน</b> • อัปครั้งเดียวใช้ทั้งหน้าเส้นทาง MS และหน้า Proof • ระบบอ่านไฟล์ในเบราว์เซอร์และส่งเฉพาะข้อมูลเชื่อมต่อที่จำเป็นไปเก็บแบบเข้ารหัส ไม่เก็บไฟล์ HAR ทั้งไฟล์</p><div class="proof-session-actions"><button id="proof-session-test" class="btn btn-header" type="button">ตรวจ Session</button><button id="proof-session-qr" class="btn btn-accent" type="button">เชื่อมต่อด้วย QR</button></div><div class="proof-har-upload"><div><strong>อัปโหลด HAR</strong><small>ใช้ทั้งเส้นทาง MS + ปริ้นบาร์โค้ด</small></div><label class="btn btn-accent proof-har-pick">เลือกไฟล์ HAR<input id="proof-session-har" type="file" accept=".har,application/json" hidden></label><span id="proof-session-file-name">ยังไม่ได้เลือกไฟล์</span><button id="proof-session-save" class="btn btn-header btn-full" type="button" disabled>ตรวจและบันทึก HAR</button></div><p id="proof-session-status" class="proof-session-status">HAR ไฟล์เดียว ใช้ทั้งเส้นทาง MS และปริ้นบาร์โค้ด</p>'
s=replace_once(s,old_dialog,new_dialog,'proof-ui dialog HAR block')
old_bind="document.getElementById('proof-session-close').onclick = closeSession; document.getElementById('proof-session-test').onclick = () => testSession(true); document.getElementById('proof-session-qr').onclick = pair; document.getElementById('proof-session-save').onclick = saveHar; document.getElementById('proof-session-dialog').oncancel = e => { e.preventDefault(); closeSession(); };"
new_bind="document.getElementById('proof-session-close').onclick = closeSession; document.getElementById('proof-session-test').onclick = () => testSession(true); document.getElementById('proof-session-qr').onclick = pair; document.getElementById('proof-session-save').onclick = saveHar; const harInput=document.getElementById('proof-session-har'),harSave=document.getElementById('proof-session-save'),harName=document.getElementById('proof-session-file-name'); harInput.onchange=()=>{const f=harInput.files?.[0];harName.textContent=f?f.name:'ยังไม่ได้เลือกไฟล์';harSave.disabled=!f;}; document.getElementById('proof-session-dialog').oncancel = e => { e.preventDefault(); closeSession(); };"
s=replace_once(s,old_bind,new_bind,'proof-ui HAR bind')
s=s.replace("    const th = document.querySelector('.proof-table thead tr');", "    document.addEventListener('keydown',e=>{if(e.key==='/'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){e.preventDefault();P.el('search-input')?.focus();}});\n    const th = document.querySelector('.proof-table thead tr');",1)
s=s.replace(".proof-session-har{margin-top:9px;border:1px solid #ddd;padding:8px}.proof-session-har summary{font-weight:800}.proof-session-har p,.proof-session-status{font-size:9px;color:#777}.proof-session-har input{width:100%;margin:6px 0 8px}", ".proof-har-upload{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;margin-top:9px;border:1px solid #ddd;background:#fafaf7;padding:10px}.proof-har-upload>div{display:grid}.proof-har-upload small,#proof-session-file-name,.proof-session-status{font-size:10px;color:#777}.proof-har-pick{cursor:pointer}.proof-har-upload .btn-full,#proof-session-file-name{grid-column:1/-1}",1)
s=s.replace("@media(max-width:430px){.proof-session-panel{display:block}", "@media(max-width:430px){.proof-har-upload{grid-template-columns:1fr}.proof-har-upload .btn,.proof-har-pick{width:100%}.proof-session-panel{display:block}",1)
write(p,s)

# 6) Persistent contract test.
p='worker/tests/proof-smart-v8.test.mjs'
write(p,"""import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const root=new URL('../../',import.meta.url);
const get=path=>readFile(new URL(path,root),'utf8');
const [core,ui,actions,plate,editor,proofUi]=await Promise.all([get('proof-v2-core.js'),get('proof-v2-ui.js'),get('proof-v2-actions.js'),get('worker/src/proof-plate-search-v5.js'),get('worker/src/proof-editor.js'),get('worker/src/proof-ui-v5.js')]);
test('Proof Smart V8 search/HAR stays quota-safe',()=>{
  assert.match(core,/pollMs:60_000/);
  assert.match(ui,/PROOF_SMART_SEARCH_V8/);
  assert.match(actions,/PROOF_EDITOR_SEARCH_CACHE_V8/);
  assert.match(actions,/กด Enter หรือปุ่ม “ค้นหา”/);
  assert.match(plate,/PROOF_PLATE_SEARCH_V8/);
  assert.match(plate,/pageSize:'50'/);
  assert.match(editor,/PROOF_DRIVER_SEARCH_V8/);
  assert.match(proofUi,/PROOF_SMART_V8/);
  assert.match(proofUi,/HAR เป็นไฟล์เดียวกัน/);
  assert.match(proofUi,/ใช้ทั้งเส้นทาง MS \+ ปริ้นบาร์โค้ด/);
  assert.match(proofUi,/entries.*reverse/);
  assert.doesNotMatch(plate,/setInterval|scheduled|cron/i);
  assert.doesNotMatch(editor,/cancel_car/);
});
""")
print('PROOF_SMART_V8_PATCH=READY')
