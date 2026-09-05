export async function maybeHandleProofPlateSearchV5(request, env, ctx, baseWorker) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/proof/plate-options') return null;
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });
  if (request.method !== 'GET') return json({ ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }, 405);

  try {
    const token = url.searchParams.get('token') || '';
    const branch = cleanHub(url.searchParams.get('branch') || 'NE1');
    const lineId = text(url.searchParams.get('lineId'), 100);
    const departureDate = cleanDay(url.searchParams.get('departureDate'));
    const q = text(url.searchParams.get('q'), 80);
    if (!lineId || !departureDate) fail('ข้อมูลเที่ยวรถไม่ครบ', 'INVALID_PLATE_SEARCH');
    await authorize(token, branch, env, baseWorker);
    const credentials = await requiredCredentials(env, branch);
    const detail = await readProofPopup(credentials, lineId, departureDate);
    const policy = platePolicy(detail);
    if (!policy.editable) return json({ ok: true, data: { items: [], locked: true, reason: policy.reason } });
    if (q.length < 2) return json({ ok: true, data: { items: [], locked: false } });

    const items = await readPlateOptions(credentials, detail, q);
    return json({ ok: true, data: { items: items.map(publicPlate), locked: false, source: 'MS_PROOF_PLATE_SELECTOR_V5' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'proof_plate_search_v5_error', code: error.code || 'MS_PLATE_LIST_ERROR', message: error.message || String(error) }));
    return json({ ok: false, code: error.code || 'MS_PLATE_LIST_ERROR', message: error.message || 'ค้นหาทะเบียนจาก MS ไม่สำเร็จ' }, error.status || 400);
  }
}

function platePolicy(detail) {
  const lineMode = Number(detail.line_mode);
  const lineType = Number(detail.line_type);
  const auditType = detail.audit_type == null ? null : Number(detail.audit_type);
  const editable = Boolean(detail.fleet_id) && (auditType === 1 || (lineMode === 1 && lineType !== 4)) && lineMode !== 4 && auditType !== 2;
  let reason = '';
  if (!editable) {
    if (lineMode === 4 || auditType === 2) reason = 'MS ล็อกทะเบียนตามประเภทเที่ยว/การตรวจสอบของเที่ยวนี้';
    else if (!detail.fleet_id) reason = 'MS ไม่ได้ผูกบริษัทซัพสำหรับเลือกทะเบียน';
    else reason = 'MS ไม่เปิดช่องเลือกทะเบียนสำหรับเที่ยวนี้';
  }
  return { editable, reason };
}

function msPlateTypeFilter(detail) {
  const lineMode = Number(detail.line_mode);
  const auditType = detail.audit_type == null ? null : Number(detail.audit_type);
  const sameModelRule = lineMode === 1 || (lineMode === 2 && [1, 3].includes(auditType));
  if (!sameModelRule || detail.plate_type == null) return '';
  // PROOF_PLATE_HAR_V12: MS storeLine HAR confirms 4WJ popup type 101 searches car/info with plateType=100.
  if (String(detail.plate_type_text || '').trim().toUpperCase() === '4WJ' && Number(detail.plate_type) === 101) return '100';
  return String(detail.plate_type);
}

function normalizePlateSearch(v) { return text(v, 120).normalize('NFKC').toLowerCase().replace(/[\s\-–—_/.()[\]{}]+/g, ''); }
function plateSearchVariants(q) { const raw=text(q,80), noProvince=raw.replace(/\([^)]*\)/g,'').trim(), compact=raw.replace(/[\s\-–—_/.()[\]{}]+/g,''), digits=raw.replace(/\D/g,''); return [...new Set([raw,noProvince,compact,digits].filter(x=>x.length>=2))]; }
function plateTypeValue(x) { const vo=x?.fleet_company_car_type_vo||{}; return String(vo.car_type??x?.type??''); }
function plateItems(data) { if(Array.isArray(data))return data; if(!data||typeof data!=='object')return []; for(const key of ['items','list','records','rows','content','data']){if(Array.isArray(data[key]))return data[key]; if(data[key]&&typeof data[key]==='object'){const nested=plateItems(data[key]);if(nested.length)return nested;}} return []; }
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
  for(const variant of variants.slice(0,2)){
    try{const items=await fetchPlateSearch(credentials,fallback,{fleetId,id:'',plateNumber:variant,pageSize:'50',pageNum:'1',plateType:requiredType});anySuccess=true;const ranked=rankPlateItems(items,q,requiredType);if(ranked.length)return ranked;}catch(error){lastError=error;}
  }
  // PROOF_PLATE_SEARCH_RECOVERY_V10: only after an explicit user search misses, scan a small fleet page and filter locally.
  for(const endpoint of [primary,fallback]){
    try{const items=await fetchPlateSearch(credentials,endpoint,{fleetId,id:'',plateNumber:'',pageSize:'100',pageNum:'1',plateType:requiredType});anySuccess=true;const ranked=rankPlateItems(items,q,requiredType);if(ranked.length)return ranked;}catch(error){lastError=error;}
  }
  if(!anySuccess&&lastError)throw lastError;
  return [];
}
// PROOF_PLATE_SEARCH_V8: extra attempts happen only after an explicit user search; no polling/background call added.

function plateDisplay(x) {
  const base = text(x.plate_number || x.label, 120);
  if (/\(.+\)$/.test(base)) return base;
  const province = text(x.fleet_company_car_type_vo?.province_name || x.province_name, 80);
  return province ? `${base}(${province})` : base;
}

function publicPlate(x) {
  const vo = x.fleet_company_car_type_vo || {};
  return {
    id: String(x.id ?? ''),
    plateNumber: plateDisplay(x),
    plateType: vo.car_type ?? x.type ?? null,
    plateTypeText: text(vo.car_type_text || x.type_text, 80),
    provinceName: text(vo.province_name || x.province_name, 80),
    label: [plateDisplay(x), text(vo.car_type_text || x.type_text, 80)].filter(Boolean).join(' • '),
  };
}

async function authorize(token, branch, env, baseWorker) {
  if (!token) fail('กรุณาเข้าสู่ระบบ', 'INVALID_SESSION', 401);
  const internal = new URL('https://worker.internal/api');
  internal.searchParams.set('action', 'settings');
  internal.searchParams.set('token', token);
  internal.searchParams.set('branch', branch);
  const response = await baseWorker.fetch(new Request(internal, { method: 'GET' }), env);
  let payload = null;
  try { payload = await response.json(); } catch {}
  if (!response.ok || !payload?.ok) fail(payload?.message || 'สิทธิ์หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง', payload?.code || 'INVALID_SESSION', response.status || 401);
}

async function readProofPopup(credentials, lineId, departureDate) {
  const url = new URL('https://ms-api.flashexpress.com/gw/nws/staff/ms/fleet/van/proof/popup');
  url.searchParams.set('lineId', lineId);
  url.searchParams.set('departureDate', departureDate);
  const payload = await readMsJson(await fetch(url, { headers: msHeaders(credentials) }), 'MS_PROOF_POPUP_ERROR');
  return payload.data || {};
}

async function requiredCredentials(env, hub) {
  const credentials = await msCredentials(env, hub);
  if (!credentials) fail(`HUB ${hub} ยังไม่ได้เชื่อมต่อ MS`, 'MS_NOT_CONFIGURED', 409);
  return credentials;
}

async function msCredentials(env, hub) {
  const row = await env.DB.prepare('SELECT session_cipher,device_cipher FROM ms_connections WHERE hub=?').bind(hub).first();
  if (row) return { sessionId: await decryptMs(row.session_cipher, env), deviceId: await decryptMs(row.device_cipher, env) };
  if (hub === cleanHub(env.MS_BRANCH || 'NE1') && env.MS_SESSION_ID && env.MS_DEVICE_ID) return { sessionId: env.MS_SESSION_ID, deviceId: env.MS_DEVICE_ID };
  return null;
}

async function decryptMs(value, env) {
  const [iv, cipher] = String(value || '').split('.');
  if (!iv || !cipher) fail('ข้อมูลเชื่อมต่อ MS เสียหาย', 'MS_CREDENTIAL_ERROR', 500);
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.AUTH_SECRET}|ms-credentials`));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(cipher));
  return new TextDecoder().decode(data);
}

async function readMsJson(response, code) {
  let payload = null;
  try { payload = await response.json(); }
  catch { fail(`MS ตอบกลับข้อมูลที่อ่านไม่ได้ (${response.status})`, code, 502); }
  if (!response.ok || Number(payload?.code) !== 1) fail(payload?.message || `MS ตอบกลับ ${response.status}`, code, response.status === 401 ? 401 : 502);
  return payload;
}

function msHeaders(c) {
  return {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'th',
    'Cache-Control': 'no-cache',
    Origin: 'https://ms.flashexpress.com',
    Referer: 'https://ms.flashexpress.com/',
    'User-Agent': 'Mozilla/5.0',
    'X-DEVICE-ID': c.deviceId,
    'X-FH-MS-EQUIPMENT-TYPE': '5',
    'X-FLE-SESSION-ID': c.sessionId,
  };
}

function cleanHub(v) { return text(v, 80).toUpperCase(); }
function cleanDay(v) { const s = text(v, 20); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; }
function text(v, n = 500) { return String(v ?? '').trim().slice(0, n); }
function unb64(v) { const s = String(v || '').replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(s.padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0)); }
function fail(message, code = 'MS_PLATE_LIST_ERROR', status = 400) { const error = new Error(message); error.code = code; error.status = status; throw error; }
function cors() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,OPTIONS' }; }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors() } }); }
