export async function maybeHandleProofHistoryV10(request, env, ctx, baseWorker) {
  const url = new URL(request.url);
  if (!['/api/proof/history', '/api/proof/history-pdf'].includes(url.pathname)) return null;
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });
  if (request.method !== 'GET') return json({ ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }, 405);
  try {
    const token = url.searchParams.get('token') || '';
    const branch = cleanHub(url.searchParams.get('branch') || 'NE1');
    await authorize(token, branch, env, baseWorker);
    if (url.pathname === '/api/proof/history-pdf') return historyPdf(env, branch, text(url.searchParams.get('proofId'), 100));
    const days = clamp(Number(url.searchParams.get('days')) || 30, 1, 180);
    const limit = clamp(Number(url.searchParams.get('limit')) || 200, 1, 300);
    return json({ ok: true, data: await historyRows(env, branch, days, limit) });
  } catch (error) {
    return json({ ok: false, code: error.code || 'PROOF_HISTORY_ERROR', message: error.message || 'อ่านประวัติบาร์รถไม่สำเร็จ' }, error.status || 400);
  }
}

async function historyRows(env, hub, days, limit) {
  const since = bangkokDayOffset(-(days - 1));
  let prints = [], events = [];
  try {
    prints = (await env.DB.prepare(`SELECT business_day,line_id,proof_id,route_name,printed_at,ms_operator_name,web_operator FROM ms_proof_print_log WHERE hub=? AND business_day>=? AND proof_id<>'' ORDER BY printed_at DESC LIMIT ?`).bind(hub, since, limit).all()).results || [];
  } catch (error) { if (!missingTable(error)) throw error; }
  try {
    events = (await env.DB.prepare(`SELECT business_day,line_id,proof_id,new_state,new_state_text,changed_at,snapshot_json FROM ms_proof_events WHERE hub=? AND business_day>=? AND proof_id<>'' ORDER BY changed_at DESC LIMIT ?`).bind(hub, since, limit * 2).all()).results || [];
  } catch (error) { if (!missingTable(error)) throw error; }

  const map = new Map();
  for (const event of events) {
    const proofId = text(event.proof_id, 100); if (!proofId) continue;
    const snap = safeObject(event.snapshot_json), at = text(event.changed_at, 60);
    const current = map.get(proofId) || { proofId, businessDay: text(event.business_day, 20), lineId: text(event.line_id, 100), createdAt: at };
    if (!current.createdAt || (at && at < current.createdAt)) current.createdAt = at;
    current.recordedAt = current.recordedAt && current.recordedAt > at ? current.recordedAt : at;
    current.routeName ||= text(snap.lineName, 320);
    current.plateNumber ||= text(snap.plateNumber, 120);
    current.plateTypeText ||= text(snap.plateTypeText, 80);
    current.driver ||= text(snap.driver, 180);
    current.driverPhone ||= text(snap.driverPhone, 40);
    current.statusText = text(event.new_state_text, 120) || current.statusText || 'เปิดใช้บาร์รถแล้ว';
    current.source = current.source || 'MS_PROOF_EVENT';
    map.set(proofId, current);
  }
  for (const row of prints) {
    const proofId = text(row.proof_id, 100); if (!proofId) continue;
    const at = text(row.printed_at, 60), current = map.get(proofId) || { proofId, businessDay: text(row.business_day, 20), lineId: text(row.line_id, 100), createdAt: at };
    current.businessDay ||= text(row.business_day, 20); current.lineId ||= text(row.line_id, 100); current.routeName ||= text(row.route_name, 320);
    current.printedAt = at; current.recordedAt = current.recordedAt && current.recordedAt > at ? current.recordedAt : at;
    current.msOperatorName = text(row.ms_operator_name, 160); current.webOperator = text(row.web_operator, 80); current.statusText ||= 'เปิดใช้บาร์รถแล้ว'; current.source = 'MS_PROOF_PRINT_LOG';
    map.set(proofId, current);
  }
  const items = [...map.values()].sort((a, b) => String(b.recordedAt || '').localeCompare(String(a.recordedAt || ''))).slice(0, limit).map(item => ({ ...item, recordedAtText: formatBangkok(item.recordedAt) }));
  return { hub, days, since, items, total: items.length, source: 'TURSO_EXISTING_PROOF_HISTORY_V10', historyWrites: 0, pollingAdded: false };
}

async function historyPdf(env, hub, proofId) {
  if (!proofId) fail('ไม่พบเลขบาร์โค้ดรถ', 'INVALID_PROOF_ID');
  let found = null;
  try { found = await env.DB.prepare(`SELECT proof_id FROM ms_proof_print_log WHERE hub=? AND proof_id=? LIMIT 1`).bind(hub, proofId).first(); } catch (error) { if (!missingTable(error)) throw error; }
  if (!found) {
    try { found = await env.DB.prepare(`SELECT proof_id FROM ms_proof_events WHERE hub=? AND proof_id=? LIMIT 1`).bind(hub, proofId).first(); } catch (error) { if (!missingTable(error)) throw error; }
  }
  if (!found) fail('ไม่พบประวัติบาร์โค้ดนี้ใน HUB ที่เลือก', 'PROOF_HISTORY_NOT_FOUND', 404);
  const credentials = await msCredentials(env, hub); if (!credentials) fail(`HUB ${hub} ยังไม่ได้เชื่อมต่อ MS`, 'MS_NOT_CONFIGURED', 409);
  const response = await fetch(`https://ms-api.flashexpress.com/gw/nws/staff/ms/fleet/van/proof/${encodeURIComponent(proofId)}/print`, { headers: msHeaders(credentials) });
  if (!response.ok) fail(`MS เปิด PDF ไม่สำเร็จ (${response.status})`, 'MS_HISTORY_PDF_HTTP_ERROR', 502);
  const type = response.headers.get('content-type') || ''; if (!type.toLowerCase().includes('pdf')) fail('MS ไม่ได้ส่ง PDF กลับมา', 'MS_HISTORY_PDF_INVALID', 502);
  return new Response(await response.arrayBuffer(), { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${proofId}.pdf"`, 'Cache-Control': 'no-store', ...cors() } });
}

async function authorize(token, branch, env, baseWorker) {
  if (!token) fail('กรุณาเข้าสู่ระบบ', 'INVALID_SESSION', 401);
  const internal = new URL('https://worker.internal/api'); internal.searchParams.set('action', 'settings'); internal.searchParams.set('token', token); internal.searchParams.set('branch', branch);
  const response = await baseWorker.fetch(new Request(internal, { method: 'GET' }), env); let payload = null; try { payload = await response.json(); } catch {}
  if (!response.ok || !payload?.ok) fail(payload?.message || 'สิทธิ์หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง', payload?.code || 'INVALID_SESSION', response.status || 401);
}
async function msCredentials(env, hub) { const row = await env.DB.prepare('SELECT session_cipher,device_cipher FROM ms_connections WHERE hub=?').bind(hub).first(); if (row) return { sessionId: await decryptMs(row.session_cipher, env), deviceId: await decryptMs(row.device_cipher, env) }; if (hub === cleanHub(env.MS_BRANCH || 'NE1') && env.MS_SESSION_ID && env.MS_DEVICE_ID) return { sessionId: env.MS_SESSION_ID, deviceId: env.MS_DEVICE_ID }; return null; }
async function decryptMs(value, env) { const [iv, cipher] = String(value || '').split('.'); if (!iv || !cipher) fail('ข้อมูลเชื่อมต่อ MS เสียหาย', 'MS_CREDENTIAL_ERROR', 500); const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.AUTH_SECRET}|ms-credentials`)); const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']); const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(cipher)); return new TextDecoder().decode(data); }
function msHeaders(c) { return { Accept: 'application/json, text/plain, */*', 'Accept-Language': 'th', 'Cache-Control': 'no-cache', Origin: 'https://ms.flashexpress.com', Referer: 'https://ms.flashexpress.com/', 'User-Agent': 'Mozilla/5.0', 'X-DEVICE-ID': c.deviceId, 'X-FH-MS-EQUIPMENT-TYPE': '5', 'X-FLE-SESSION-ID': c.sessionId }; }
function bangkokDayOffset(delta) { const d = new Date(Date.now() + delta * 86400000); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
function formatBangkok(value) { const ms = Date.parse(value || ''); if (!Number.isFinite(ms)) return ''; return new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(ms)); }
function safeObject(value) { try { const v = JSON.parse(value || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } }
function missingTable(error) { return /no such table|does not exist/i.test(String(error?.message || error || '')); }
function cleanHub(v) { return text(v, 80).toUpperCase(); } function text(v, n = 500) { return String(v ?? '').trim().slice(0, n); } function clamp(v, min, max) { return Math.max(min, Math.min(max, Math.floor(Number(v) || min))); }
function unb64(v) { const s = String(v || '').replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(s.padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0)); }
function fail(message, code = 'PROOF_HISTORY_ERROR', status = 400) { const e = new Error(message); e.code = code; e.status = status; throw e; }
function cors() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,OPTIONS' }; }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors() } }); }
