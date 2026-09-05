const PROOF_REFRESH_MS = 60_000;
const PROOF_MAX_PAGES = 20;
const proofActive = new Map();
let proofSchemaReady = null;

export async function maybeHandleProofRequest(request, env, ctx, baseWorker) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/proof/')) return null;
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });

  try {
    if (request.method === 'GET' && url.pathname === '/api/proof/routes') {
      const token = url.searchParams.get('token') || '';
      const branch = cleanHub(url.searchParams.get('branch') || 'NE1');
      const day = cleanDay(url.searchParams.get('day')) || thaiDay();
      await authorize(token, branch, env, baseWorker);
      const data = await syncProofDay(env, branch, day, false);
      return json({ ok: true, data });
    }

    if (request.method === 'GET' && url.pathname === '/api/proof/profile') {
      const token = url.searchParams.get('token') || '';
      const branch = cleanHub(url.searchParams.get('branch') || 'NE1');
      await authorize(token, branch, env, baseWorker);
      const credentials = await msCredentials(env, branch);
      if (!credentials) fail(`HUB ${branch} ยังไม่ได้เชื่อมต่อ MS`, 'MS_NOT_CONFIGURED', 409);
      const profile = await readMsProfile(credentials);
      return json({ ok: true, data: publicProfile(profile) });
    }

    if (request.method === 'POST' && url.pathname === '/api/proof/print') {
      const body = await request.json();
      const branch = cleanHub(body.branch || 'NE1');
      const actor = await authorize(body.token || '', branch, env, baseWorker);
      return printProof({
        env,
        ctx,
        branch,
        actor,
        lineId: text(body.lineId, 100),
        departureDate: cleanDay(body.departureDate),
      });
    }

    return json({ ok: false, code: 'NOT_FOUND', message: 'ไม่พบ API นี้' }, 404);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'proof_control_error',
      code: error.code || 'PROOF_CONTROL_ERROR',
      message: error.message || String(error),
    }));
    return json({
      ok: false,
      code: error.code || 'PROOF_CONTROL_ERROR',
      message: error.message || 'ระบบจัดการเส้นทางขัดข้อง',
    }, error.status || 400);
  }
}

export async function runProofScheduled(env) {
  await ensureSchema(env);
  let rows = [];
  try {
    rows = (await env.DB.prepare('SELECT hub FROM ms_connections ORDER BY hub').all()).results || [];
  } catch (error) {
    console.error(JSON.stringify({ event: 'proof_cron_connection_list_error', message: error.message }));
    return;
  }

  const day = thaiDay();
  for (const row of rows.slice(0, 20)) {
    const hub = cleanHub(row.hub);
    if (!hub) continue;
    try {
      await syncProofDay(env, hub, day, true);
    } catch (error) {
      console.error(JSON.stringify({
        event: 'proof_cron_sync_error', hub, day,
        code: error.code || 'PROOF_SYNC_FAILED', message: error.message,
      }));
    }
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
  const actor = decodeActor(token);
  if (!actor?.username) fail('สิทธิ์หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง', 'INVALID_SESSION', 401);
  return actor;
}

function decodeActor(token) {
  try {
    const payload = String(token || '').split('.')[0];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

async function syncProofDay(env, hub, day, force) {
  await ensureSchema(env);
  const key = `${hub}|${day}`;
  if (proofActive.has(key)) return proofActive.get(key);

  const task = (async () => {
    const current = await env.DB.prepare(
      'SELECT source_hash,total_count,rows_json,checked_at,changed_at FROM ms_proof_snapshots WHERE hub=? AND business_day=?',
    ).bind(hub, day).first();

    if (!force && current && Date.now() - Date.parse(current.checked_at || '') < PROOF_REFRESH_MS - 5000) {
      return snapshotResult(hub, day, current);
    }

    const credentials = await msCredentials(env, hub);
    if (!credentials) fail(`HUB ${hub} ยังไม่ได้เชื่อมต่อ MS`, 'MS_NOT_CONFIGURED', 409);
    const upstream = await readProofTasks(credentials, day);
    const mapped = upstream.items.map(mapProofRow);
    const sourceHash = await sha(JSON.stringify(mapped));
    const now = new Date().toISOString();

    if (current?.source_hash === sourceHash) {
      await env.DB.prepare(
        'UPDATE ms_proof_snapshots SET total_count=?,checked_at=? WHERE hub=? AND business_day=?',
      ).bind(upstream.total, now, hub, day).run();
      return {
        hub, day, rows: mapped, total: upstream.total,
        checkedAt: now, changedAt: current.changed_at || current.checked_at || now,
        refreshSeconds: 60, source: 'MS_PROOF_TASK_LIST', changed: false,
      };
    }

    const oldRows = current ? safeJsonArray(current.rows_json) : [];
    const oldById = new Map(oldRows.map((row) => [rowKey(row), row]));
    const changes = [];
    for (const row of mapped) {
      const old = oldById.get(rowKey(row));
      if (!old || Number(old.proofState) !== Number(row.proofState) || String(old.proofId || '') !== String(row.proofId || '')) {
        changes.push({ old, row });
      }
    }

    const statements = [];
    for (const change of changes) {
      statements.push(env.DB.prepare(
        `INSERT INTO ms_proof_events(id,hub,business_day,line_id,proof_id,old_state,new_state,old_state_text,new_state_text,changed_at,snapshot_json)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        crypto.randomUUID(), hub, day, change.row.lineId, change.row.proofId || '',
        change.old?.proofState ?? null, change.row.proofState ?? null,
        change.old?.proofStateText || '', change.row.proofStateText || '', now,
        JSON.stringify(change.row),
      ));
    }
    statements.push(env.DB.prepare(
      `INSERT INTO ms_proof_snapshots(hub,business_day,source_hash,total_count,rows_json,checked_at,changed_at)
       VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(hub,business_day) DO UPDATE SET
         source_hash=excluded.source_hash,total_count=excluded.total_count,rows_json=excluded.rows_json,
         checked_at=excluded.checked_at,changed_at=excluded.changed_at`,
    ).bind(hub, day, sourceHash, upstream.total, JSON.stringify(mapped), now, now));
    await batch100(env, statements);

    return {
      hub, day, rows: mapped, total: upstream.total,
      checkedAt: now, changedAt: now,
      refreshSeconds: 60, source: 'MS_PROOF_TASK_LIST', changed: true,
      stateChanges: changes.length,
    };
  })().finally(() => proofActive.delete(key));

  proofActive.set(key, task);
  return task;
}

function snapshotResult(hub, day, row) {
  return {
    hub,
    day,
    rows: safeJsonArray(row.rows_json),
    total: Number(row.total_count) || 0,
    checkedAt: row.checked_at || '',
    changedAt: row.changed_at || row.checked_at || '',
    refreshSeconds: 60,
    source: 'TURSO_PROOF_SNAPSHOT',
    changed: false,
  };
}

async function readProofTasks(credentials, day) {
  const first = await readProofPage(credentials, day, 1);
  const items = [...first.items];
  const pages = Math.min(PROOF_MAX_PAGES, Math.ceil((first.total || items.length) / 100));
  for (let page = 2; page <= pages; page += 1) {
    const result = await readProofPage(credentials, day, page);
    items.push(...result.items);
  }
  return { items, total: first.total || items.length };
}

async function readProofPage(credentials, day, page) {
  const url = new URL('https://ms-api.flashexpress.com/gw/nws/staff/ms/fleet/van/proof/task/list');
  const query = {
    type: '1', lineType: '', startDate: day, passId: '', targetId: '',
    pageNum: String(page), pageSize: '100', proofState: '',
  };
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: msHeaders(credentials) });
  const payload = await readMsJson(response, 'MS_PROOF_LIST_ERROR');
  return {
    items: Array.isArray(payload.data?.items) ? payload.data.items : [],
    total: Number(payload.data?.pagination?.total_count) || 0,
  };
}

async function readMsProfile(credentials) {
  const response = await fetch('https://ms-api.flashexpress.com/gw/nws/staff/ms/setting/login/profile', {
    headers: msHeaders(credentials),
  });
  const payload = await readMsJson(response, 'MS_PROFILE_ERROR');
  return payload.data || {};
}

async function readProofPopup(credentials, lineId, departureDate) {
  const url = new URL('https://ms-api.flashexpress.com/gw/nws/staff/ms/fleet/van/proof/popup');
  url.searchParams.set('lineId', lineId);
  url.searchParams.set('departureDate', departureDate);
  const response = await fetch(url, { headers: msHeaders(credentials) });
  const payload = await readMsJson(response, 'MS_PROOF_POPUP_ERROR');
  return payload.data || {};
}

async function printProof({ env, ctx, branch, actor, lineId, departureDate }) {
  if (!lineId || !departureDate) fail('ข้อมูลเที่ยวรถไม่ครบ', 'INVALID_PRINT_REQUEST');
  const credentials = await msCredentials(env, branch);
  if (!credentials) fail(`HUB ${branch} ยังไม่ได้เชื่อมต่อ MS`, 'MS_NOT_CONFIGURED', 409);

  const profile = await readMsProfile(credentials);
  const permissions = new Set(Array.isArray(profile.permissions) ? profile.permissions : []);
  if (!permissions.has('action.store.proof_printing')) {
    fail('บัญชี MS นี้ไม่มีสิทธิ์ปริ้นท์บาร์โค้ดประจำรถ', 'MS_PRINT_PERMISSION_DENIED', 403);
  }

  const detail = await readProofPopup(credentials, lineId, departureDate);
  if (![1, 2, 7].includes(Number(detail.proof_state))) {
    fail(detail.proof_state === 6
      ? 'รถรายการนี้อยู่ระหว่างรอยกเลิก จึงไม่สามารถปริ้นท์ได้'
      : 'สถานะรถนี้ไม่รองรับการปริ้นท์จากหน้าเว็บ กรุณาตรวจใน MS', 'MS_PRINT_STATE_NOT_ALLOWED', 409);
  }
  if (Number(detail.proof_state) === 1 && !text(detail.proof_id, 100) && releasePassed(detail.expect_start_time, departureDate)) {
    fail('เลยเวลาปล่อยแล้ว ระบบจัดเป็นรถไม่เข้าและจะไม่เปิดบาร์โค้ดใหม่', 'MS_PROOF_RELEASE_PASSED', 409);
  }
  // PROOF_RELEASE_GUARD_V10
  if (Number(detail.proof_state) === 1 && !permissions.has('action.store.proof_create')) {
    fail('บัญชี MS นี้ไม่มีสิทธิ์เปิดใช้งานบาร์โค้ดรถ', 'MS_CREATE_PERMISSION_DENIED', 403);
  }

  const payload = {
    departure_time: detail.expect_start_time || `${departureDate} 00:00`,
    line_id: detail.line_id || lineId,
    driver: detail.driver || '',
    driver_phone: detail.driver_phone || '',
    plate_id: detail.plate_id == null ? '' : String(detail.plate_id),
    plate_number: detail.plate_number || '',
    plate_type: detail.plate_type ?? '',
    driver_id: detail.driver_id == null ? '' : String(detail.driver_id),
    fleet_id: detail.fleet_id == null ? '' : String(detail.fleet_id),
    fms_driver_id: detail.fms_driver_id ?? '',
    fms_co_driver_id: detail.fms_co_driver_id ?? '',
    fms_co_driver: detail.fms_co_driver || '',
    fms_co_driver_phone: detail.fms_co_driver_phone || '',
  };

  const first = await postProof(credentials, payload);
  const proofId = text(first?.data?.id || first?.data || detail.proof_id, 100);
  if (!proofId) fail('MS ไม่คืนเลขบาร์โค้ดรถ', 'MS_PROOF_ID_MISSING', 502);
  await postProof(credentials, { ...payload, id: proofId });

  const printUrl = `https://ms-api.flashexpress.com/gw/nws/staff/ms/fleet/van/proof/${encodeURIComponent(proofId)}/print`;
  const response = await fetch(printUrl, { headers: msHeaders(credentials) });
  if (!response.ok) fail(`MS สร้าง PDF ไม่สำเร็จ (${response.status})`, 'MS_PRINT_HTTP_ERROR', 502);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('pdf')) fail('MS ไม่ได้ส่งไฟล์ PDF กลับมา', 'MS_PRINT_INVALID_RESPONSE', 502);
  const pdf = await response.arrayBuffer();

  await ensureSchema(env);
  try {
    await env.DB.prepare(
      `INSERT INTO ms_proof_print_log(id,hub,business_day,line_id,proof_id,route_name,printed_at,ms_operator_name,ms_operator_id,web_operator)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(), branch, departureDate, lineId, proofId,
      text(detail.line_name, 300), new Date().toISOString(),
      text(profile.name, 160), String(profile.id || ''), text(actor.username, 60),
    ).run();
  } catch (error) {
    console.error(JSON.stringify({ event: 'proof_print_log_error', branch, proofId, message: error.message }));
  }

  if (ctx?.waitUntil) ctx.waitUntil(syncProofDay(env, branch, departureDate, true).catch(() => {}));

  return new Response(pdf, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${proofId}.pdf"`,
      'Cache-Control': 'no-store',
      'X-MS-Proof-Id': proofId,
      'X-MS-Operator-Name': encodeURIComponent(text(profile.name, 160)),
      'X-Web-Operator': encodeURIComponent(text(actor.username, 60)),
      ...cors(),
    },
  });
}

async function postProof(credentials, body) {
  const response = await fetch('https://ms-api.flashexpress.com/gw/nws/staff/ms/fleet/van/proof', {
    method: 'POST',
    headers: { ...msHeaders(credentials), 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify(body),
  });
  return readMsJson(response, 'MS_PROOF_POST_ERROR');
}

async function readMsJson(response, code) {
  let payload = null;
  try { payload = await response.json(); }
  catch { fail(`MS ตอบกลับข้อมูลที่อ่านไม่ได้ (${response.status})`, code, 502); }
  if (!response.ok || Number(payload?.code) !== 1) {
    fail(payload?.message || `MS ตอบกลับ ${response.status}`, code, response.status === 401 ? 401 : 502);
  }
  return payload;
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

async function msCredentials(env, hub) {
  const row = await env.DB.prepare('SELECT session_cipher,device_cipher FROM ms_connections WHERE hub=?')
    .bind(hub).first();
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
  const data = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(iv) }, key, unb64(cipher),
  );
  return new TextDecoder().decode(data);
}

async function ensureSchema(env) {
  if (proofSchemaReady) return proofSchemaReady;
  proofSchemaReady = env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ms_proof_snapshots (
      hub TEXT NOT NULL,
      business_day TEXT NOT NULL,
      source_hash TEXT NOT NULL DEFAULT '',
      total_count INTEGER NOT NULL DEFAULT 0,
      rows_json TEXT NOT NULL DEFAULT '[]',
      checked_at TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      PRIMARY KEY (hub,business_day)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ms_proof_events (
      id TEXT PRIMARY KEY NOT NULL,
      hub TEXT NOT NULL,
      business_day TEXT NOT NULL,
      line_id TEXT NOT NULL,
      proof_id TEXT NOT NULL DEFAULT '',
      old_state INTEGER,
      new_state INTEGER,
      old_state_text TEXT NOT NULL DEFAULT '',
      new_state_text TEXT NOT NULL DEFAULT '',
      changed_at TEXT NOT NULL,
      snapshot_json TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_ms_proof_events_hub_day
      ON ms_proof_events(hub,business_day,changed_at DESC)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ms_proof_print_log (
      id TEXT PRIMARY KEY NOT NULL,
      hub TEXT NOT NULL,
      business_day TEXT NOT NULL,
      line_id TEXT NOT NULL,
      proof_id TEXT NOT NULL,
      route_name TEXT NOT NULL DEFAULT '',
      printed_at TEXT NOT NULL,
      ms_operator_name TEXT NOT NULL DEFAULT '',
      ms_operator_id TEXT NOT NULL DEFAULT '',
      web_operator TEXT NOT NULL DEFAULT ''
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_ms_proof_print_log_hub_time
      ON ms_proof_print_log(hub,printed_at DESC)`),
  ]).catch((error) => {
    proofSchemaReady = null;
    throw error;
  });
  return proofSchemaReady;
}

function mapProofRow(row) {
  return {
    lineId: text(row.line_id, 100),
    departureDate: text(row.departure_date, 20),
    lineName: text(row.line_name, 320),
    lineType: row.line_type == null ? null : Number(row.line_type),
    lineTypeText: text(row.line_type_text, 80),
    lineMode: row.line_mode == null ? null : Number(row.line_mode),
    lineModeText: text(row.line_mode_text, 80),
    plateId: text(row.plate_id, 100),
    plateNumber: text(row.plate_number, 120),
    plateType: row.plate_type == null ? null : Number(row.plate_type),
    plateTypeText: text(row.plate_type_text, 80),
    driverId: text(row.driver_id, 100),
    driver: text(row.driver, 180),
    driverPhone: text(row.driver_phone, 40),
    startTime: Number(row.start_time) || 0,
    endTime: Number(row.end_time) || 0,
    proofId: text(row.proof_id, 100),
    proofState: row.proof_state == null ? null : Number(row.proof_state),
    proofStateText: text(row.proof_state_text, 120),
    cancelCarEnabled: row.cancel_car_enabled === true,
    shippingBlockedReason: text(row.ship_ticket_check_not_print_category_text, 240),
  };
}

function publicProfile(profile) {
  return {
    id: profile.id || '',
    name: text(profile.name, 160),
    organizationShortName: text(profile.organization_short_name, 80),
    organizationName: text(profile.organization_name, 200),
    canPrint: Array.isArray(profile.permissions) && profile.permissions.includes('action.store.proof_printing'),
    canCreateProof: Array.isArray(profile.permissions) && profile.permissions.includes('action.store.proof_create'),
    canCancelCar: Array.isArray(profile.permissions) && profile.permissions.includes('action.store.proof_cancel_car'),
  };
}

function rowKey(row) {
  return `${row.lineId || ''}|${row.departureDate || ''}`;
}
function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function releasePassed(value, day) { const n = Number(value); if (Number.isFinite(n) && String(value).trim() !== '' && n >= 0 && n < 3000) { const base = Date.parse(`${day}T00:00:00+07:00`); return Number.isFinite(base) && Date.now() >= base + n * 60_000; } const raw = String(value || '').trim(); let m = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/); if (m) { const at = Date.parse(`${m[1]}T${String(m[2]).padStart(2, '0')}:${m[3]}:${m[4] || '00'}+07:00`); return Number.isFinite(at) && Date.now() >= at; } m = raw.match(/(\d{1,2}):(\d{2})/); if (m) { const at = Date.parse(`${day}T${String(m[1]).padStart(2, '0')}:${m[2]}:00+07:00`); return Number.isFinite(at) && Date.now() >= at; } return false; }
function cleanHub(value) { return text(value, 80).toUpperCase(); }
function cleanDay(value) {
  const day = text(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '';
}
function thaiDay() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
function text(value, limit = 500) { return String(value ?? '').trim().slice(0, limit); }
async function batch100(env, statements) {
  for (let i = 0; i < statements.length; i += 100) await env.DB.batch(statements.slice(i, i + 100));
}
async function sha(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
function unb64(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')), (char) => char.charCodeAt(0));
}
function fail(message, code = 'PROOF_CONTROL_ERROR', status = 400) {
  const error = new Error(message); error.code = code; error.status = status; throw error;
}
function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  };
}
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors() },
  });
}
