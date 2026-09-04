export async function maybeHandleProofPreview(request, env, ctx, baseWorker) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/proof/print-preview') return null;
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });
  if (request.method !== 'GET') return json({ ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }, 405);

  try {
    const token = url.searchParams.get('token') || '';
    const branch = cleanHub(url.searchParams.get('branch') || 'NE1');
    const lineId = text(url.searchParams.get('lineId'), 100);
    const departureDate = cleanDay(url.searchParams.get('departureDate'));
    if (!lineId || !departureDate) fail('ข้อมูลเที่ยวรถไม่ครบ', 'INVALID_PRINT_PREVIEW_REQUEST');

    await authorize(token, branch, env, baseWorker);
    const credentials = await msCredentials(env, branch);
    if (!credentials) fail(`HUB ${branch} ยังไม่ได้เชื่อมต่อ MS`, 'MS_NOT_CONFIGURED', 409);

    const detail = await readProofPopup(credentials, lineId, departureDate);
    const code = detail.proof_state == null ? null : Number(detail.proof_state);
    const stateLabels = {
      1: 'รอเปิดบาร์โค้ด',
      2: 'เปิดบาร์โค้ดแล้ว',
      7: 'ถึงสาขาต้นทางแล้ว',
      3: 'รถออกจากต้นทางแล้ว',
      4: 'จบเที่ยวแล้ว',
      6: 'รอยกเลิก',
      5: 'ยกเลิกแล้ว',
    };

    return json({
      ok: true,
      data: {
        lineId: text(detail.line_id || lineId, 100),
        departureDate,
        lineName: text(detail.line_name, 320),
        proofId: text(detail.proof_id, 100),
        proofState: code,
        proofStateText: stateLabels[code] || text(detail.proof_state_text, 120) || 'ไม่ทราบสถานะ',
        driver: text(detail.driver, 180),
        driverPhone: text(detail.driver_phone, 40),
        plateNumber: text(detail.plate_number, 120),
        plateTypeText: text(detail.plate_type_text, 80),
        plannedDepartureText: text(detail.expect_start_time, 80),
        checkedAt: new Date().toISOString(),
        source: 'MS_PROOF_POPUP_READ_ONLY',
      },
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'proof_print_preview_error',
      code: error.code || 'PRINT_PREVIEW_FAILED',
      message: error.message || String(error),
    }));
    return json({
      ok: false,
      code: error.code || 'PRINT_PREVIEW_FAILED',
      message: error.message || 'ตรวจข้อมูลก่อนปริ้นไม่สำเร็จ',
    }, error.status || 400);
  }
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
  if (!response.ok || !payload?.ok) {
    fail(payload?.message || 'สิทธิ์หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง', payload?.code || 'INVALID_SESSION', response.status || 401);
  }
}

async function readProofPopup(credentials, lineId, departureDate) {
  const url = new URL('https://ms-api.flashexpress.com/gw/nws/staff/ms/fleet/van/proof/popup');
  url.searchParams.set('lineId', lineId);
  url.searchParams.set('departureDate', departureDate);
  const response = await fetch(url, { headers: msHeaders(credentials) });
  let payload = null;
  try { payload = await response.json(); }
  catch { fail(`MS ตอบกลับข้อมูลที่อ่านไม่ได้ (${response.status})`, 'MS_PROOF_PREVIEW_ERROR', 502); }
  if (!response.ok || Number(payload?.code) !== 1) {
    fail(payload?.message || `MS ตอบกลับ ${response.status}`, 'MS_PROOF_PREVIEW_ERROR', response.status === 401 ? 401 : 502);
  }
  return payload.data || {};
}

async function msCredentials(env, hub) {
  const row = await env.DB.prepare('SELECT session_cipher,device_cipher FROM ms_connections WHERE hub=?').bind(hub).first();
  if (row) {
    return {
      sessionId: await decryptMs(row.session_cipher, env),
      deviceId: await decryptMs(row.device_cipher, env),
    };
  }
  if (hub === cleanHub(env.MS_BRANCH || 'NE1') && env.MS_SESSION_ID && env.MS_DEVICE_ID) {
    return { sessionId: env.MS_SESSION_ID, deviceId: env.MS_DEVICE_ID };
  }
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

function msHeaders(credentials) {
  return {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'th',
    'Cache-Control': 'no-cache',
    Origin: 'https://ms.flashexpress.com',
    Referer: 'https://ms.flashexpress.com/',
    'User-Agent': 'Mozilla/5.0',
    'X-DEVICE-ID': credentials.deviceId,
    'X-FH-MS-EQUIPMENT-TYPE': '5',
    'X-FLE-SESSION-ID': credentials.sessionId,
  };
}

function cleanHub(value) { return text(value, 80).toUpperCase(); }
function cleanDay(value) {
  const day = text(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '';
}
function text(value, limit = 500) { return String(value ?? '').trim().slice(0, limit); }
function unb64(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')), (char) => char.charCodeAt(0));
}
function fail(message, code = 'PRINT_PREVIEW_FAILED', status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}
function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
  };
}
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors() },
  });
}
