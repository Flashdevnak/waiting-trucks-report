const META_TTL_MS = 4 * 60 * 60_000;
const META_SWEEP_MS = 60_000;
const META_BATCH = 20;
const META_CONCURRENCY = 5;
const META_LEASE_MS = 45_000;
const PRINTABLE_STATES = new Set([1, 2, 7]);

let schemaReady = null;
const activeSweeps = new Map();
const lastSweepAt = new Map();

export async function enrichProofRoutesV15(request, response, env) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname !== '/api/proof/routes-v2' || !response?.ok) return response;

  let payload;
  try { payload = await response.json(); }
  catch { return response; }
  if (!payload?.ok || !Array.isArray(payload?.data?.rows)) return responseJson(response, payload);

  const hub = cleanHub(payload.data.hub || payload.data.branch || url.searchParams.get('branch') || 'NE1');
  const day = cleanDay(payload.data.day || url.searchParams.get('day'));
  if (!hub || !day || !payload.data.rows.length) return responseJson(response, payload);

  try {
    await ensureSchema(env);
    let cache = await readMeta(env, hub, day);
    applyMeta(payload.data.rows, cache);

    const key = `${hub}|${day}`;
    const now = Date.now();
    const candidates = metaCandidatesV15(payload.data.rows, cache, now);
    if (candidates.length && now - (lastSweepAt.get(key) || 0) >= META_SWEEP_MS) {
      let task = activeSweeps.get(key);
      if (!task) {
        lastSweepAt.set(key, now);
        task = (async () => {
          const lease = await acquireMetaLease(env, hub, day, now);
          if (!lease) return;
          await hydrateMeta(env, hub, day, candidates.slice(0, META_BATCH));
        })().finally(() => activeSweeps.delete(key));
        activeSweeps.set(key, task);
      }
      await task;
      cache = await readMeta(env, hub, day);
      applyMeta(payload.data.rows, cache);
    }

    payload.data.metaSupplierCacheV15 = true;
    payload.data.source = `${payload.data.source || 'PROOF'}+SUPPLIER_META_V15`;
  } catch (error) {
    console.error(JSON.stringify({
      event: 'proof_supplier_meta_v15_error',
      hub,
      day,
      code: error.code || 'PROOF_SUPPLIER_META_V15_ERROR',
      message: error.message || String(error),
    }));
  }

  return responseJson(response, payload);
}

export function metaCandidatesV15(rows, cache, now = Date.now()) {
  return (Array.isArray(rows) ? rows : []).filter(row => {
    if (!row?.lineId || !PRINTABLE_STATES.has(Number(row.proofState))) return false;
    const item = cache instanceof Map ? cache.get(String(row.lineId)) : null;
    const checked = Date.parse(item?.checkedAt || '');
    return !item || !Number.isFinite(checked) || now - checked >= META_TTL_MS;
  });
}

export function applyMeta(rows, cache) {
  if (!(cache instanceof Map)) return rows;
  for (const row of Array.isArray(rows) ? rows : []) {
    const item = cache.get(String(row?.lineId || ''));
    if (!item) continue;
    row.fleetId = item.fleetId || '';
    row.fleetName = item.fleetName || '';
    row.supplierCheckedAt = item.checkedAt || '';
  }
  return rows;
}

async function acquireMetaLease(env, hub, day, now = Date.now()) {
  const token = crypto.randomUUID();
  const leaseUntil = now + META_LEASE_MS;
  await env.DB.prepare(
    `INSERT INTO ms_proof_meta_lease_v15(hub,business_day,lease_token,lease_until)
     VALUES(?,?,?,?)
     ON CONFLICT(hub,business_day) DO UPDATE SET
       lease_token=excluded.lease_token,
       lease_until=excluded.lease_until
     WHERE ms_proof_meta_lease_v15.lease_until < ?`,
  ).bind(hub, day, token, leaseUntil, now).run();
  const row = await env.DB.prepare(
    'SELECT lease_token,lease_until FROM ms_proof_meta_lease_v15 WHERE hub=? AND business_day=?',
  ).bind(hub, day).first();
  return row?.lease_token === token && Number(row?.lease_until || 0) === leaseUntil;
}

async function hydrateMeta(env, hub, day, rows) {
  const credentials = await msCredentials(env, hub);
  if (!credentials) return;
  const fetched = await mapLimit(rows, META_CONCURRENCY, async row => {
    try {
      const detail = await readProofPopup(credentials, row.lineId, row.departureDate || day);
      return {
        lineId: String(row.lineId),
        fleetId: text(detail?.fleet_id, 100),
        fleetName: text(detail?.fleet_name, 200),
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error(JSON.stringify({
        event: 'proof_supplier_meta_v15_row_error',
        hub,
        lineId: String(row?.lineId || ''),
        message: error.message || String(error),
      }));
      return null;
    }
  });

  const statements = fetched.filter(Boolean).map(item => env.DB.prepare(
    `INSERT INTO ms_proof_route_meta_v15(hub,business_day,line_id,fleet_id,fleet_name,checked_at)
     VALUES(?,?,?,?,?,?)
     ON CONFLICT(hub,business_day,line_id) DO UPDATE SET
       fleet_id=excluded.fleet_id,
       fleet_name=excluded.fleet_name,
       checked_at=excluded.checked_at`,
  ).bind(hub, day, item.lineId, item.fleetId, item.fleetName, item.checkedAt));

  for (let i = 0; i < statements.length; i += 100) await env.DB.batch(statements.slice(i, i + 100));
}

async function readMeta(env, hub, day) {
  const result = await env.DB.prepare(
    'SELECT line_id,fleet_id,fleet_name,checked_at FROM ms_proof_route_meta_v15 WHERE hub=? AND business_day=?',
  ).bind(hub, day).all();
  return new Map((result.results || []).map(row => [String(row.line_id), {
    fleetId: row.fleet_id || '',
    fleetName: row.fleet_name || '',
    checkedAt: row.checked_at || '',
  }]));
}

async function readProofPopup(credentials, lineId, departureDate) {
  const url = new URL('https://ms-api.flashexpress.com/gw/nws/staff/ms/fleet/van/proof/popup');
  url.searchParams.set('lineId', String(lineId || ''));
  url.searchParams.set('departureDate', String(departureDate || ''));
  const response = await fetch(url, { headers:msHeaders(credentials) });
  let payload = null;
  try { payload = await response.json(); } catch {}
  if (!response.ok || Number(payload?.code) !== 1) {
    const error = new Error(payload?.message || `MS ตอบกลับ ${response.status}`);
    error.code = 'MS_PROOF_POPUP_META_ERROR';
    throw error;
  }
  return payload.data || {};
}

async function msCredentials(env, hub) {
  const row = await env.DB.prepare('SELECT session_cipher,device_cipher FROM ms_connections WHERE hub=?')
    .bind(hub).first();
  if (row) return {
    sessionId: await decryptMs(row.session_cipher, env),
    deviceId: await decryptMs(row.device_cipher, env),
  };
  if (hub === cleanHub(env.MS_BRANCH || 'NE1') && env.MS_SESSION_ID && env.MS_DEVICE_ID) {
    return { sessionId:env.MS_SESSION_ID, deviceId:env.MS_DEVICE_ID };
  }
  return null;
}

async function decryptMs(value, env) {
  const [iv, cipher] = String(value || '').split('.');
  if (!iv || !cipher) throw new Error('ข้อมูลเชื่อมต่อ MS เสียหาย');
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.AUTH_SECRET}|ms-credentials`));
  const key = await crypto.subtle.importKey('raw', raw, { name:'AES-GCM' }, false, ['decrypt']);
  const data = await crypto.subtle.decrypt({ name:'AES-GCM', iv:unb64(iv) }, key, unb64(cipher));
  return new TextDecoder().decode(data);
}

function msHeaders(credentials) {
  return {
    Accept:'application/json, text/plain, */*',
    'Accept-Language':'th',
    'Cache-Control':'no-cache',
    Origin:'https://ms.flashexpress.com',
    Referer:'https://ms.flashexpress.com/',
    'User-Agent':'Mozilla/5.0',
    'X-DEVICE-ID':credentials.deviceId,
    'X-FH-MS-EQUIPMENT-TYPE':'5',
    'X-FLE-SESSION-ID':credentials.sessionId,
  };
}

async function ensureSchema(env) {
  if (schemaReady) return schemaReady;
  schemaReady = env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ms_proof_route_meta_v15(
      hub TEXT NOT NULL,
      business_day TEXT NOT NULL,
      line_id TEXT NOT NULL,
      fleet_id TEXT NOT NULL DEFAULT '',
      fleet_name TEXT NOT NULL DEFAULT '',
      checked_at TEXT NOT NULL,
      PRIMARY KEY(hub,business_day,line_id)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ms_proof_meta_lease_v15(
      hub TEXT NOT NULL,
      business_day TEXT NOT NULL,
      lease_token TEXT NOT NULL,
      lease_until INTEGER NOT NULL,
      PRIMARY KEY(hub,business_day)
    )`),
  ]).catch(error => { schemaReady = null; throw error; });
  return schemaReady;
}

async function mapLimit(items, limit, fn) {
  const output = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      output[current] = await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length:Math.min(Math.max(1, limit), items.length || 1) }, worker));
  return output;
}

function responseJson(response, payload) {
  const headers = new Headers(response.headers || {});
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(payload), { status:response.status, headers });
}

function cleanHub(value) { return text(value, 80).toUpperCase(); }
function cleanDay(value) { const day = text(value, 20); return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : ''; }
function text(value, limit = 500) { return String(value ?? '').trim().slice(0, limit); }
function unb64(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')), char => char.charCodeAt(0));
}
