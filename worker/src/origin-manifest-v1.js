const MANIFEST_REFRESH_MS = 5 * 60 * 1000;
const MANIFEST_STALE_MAX_MS = 30 * 60 * 1000;
const MANIFEST_PAGE_SIZE = 100;
const MANIFEST_MAX_PAGES = 20;
const MANIFEST_KEY_PREFIX = "__LH_MANIFEST__:";

export const ORIGIN_MANIFEST_POLICY = Object.freeze({
  marker: "MS_ORIGIN_LH_MANIFEST_V1",
  refreshMs: MANIFEST_REFRESH_MS,
  sharedPerHub: true,
  originOnly: true,
  matchKey: "proofId",
  pageSize: MANIFEST_PAGE_SIZE,
  maxPages: MANIFEST_MAX_PAGES,
  weightUnit: "Kg",
  dataPersistenceWrites: 0,
  analyticsWrites: 0,
  extraMsPolling: 0,
  queueAuthority: false,
  actualArrivalAuthority: "ROUTE",
});

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "Content-Type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    },
  });
}

function fail(message, code = "ORIGIN_MANIFEST_ERROR", status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function cleanHub(value) {
  const hub = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,20}$/.test(hub)) fail("HUB ไม่ถูกต้อง", "INVALID_HUB");
  return hub;
}

function normalizeProofId(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function bangkokDay(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function thaiDay(now = Date.now()) {
  return bangkokDay(new Date(now));
}

function isOrigin(row) {
  return String(row?.attendanceType || "").includes("ต้นทาง");
}

export function activeOriginDays(rows, now = Date.now()) {
  const result = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isOrigin(row)) continue;
    if (!normalizeProofId(row?.proofId)) continue;
    if (row?.actualDepartureAt || row?.queueCancelledAt) continue;
    const day = bangkokDay(
      row?.estimatedDepartureAt || row?.estimatedArrivalAt || new Date(now),
    );
    if (day) result.add(day);
  }
  return [...result].sort().slice(-2);
}

export function normalizeManifestRows(rows, fetchedAt = new Date().toISOString()) {
  const byProof = new Map();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const proofId = normalizeProofId(raw?.proofId ?? raw?.proof_id);
    if (!proofId) continue;
    const candidate = {
      proofId: String(raw?.proofId ?? raw?.proof_id ?? "").trim(),
      manifestShippedParcels: numberOrNull(raw?.actual_shipment_total),
      manifestWeightKg: numberOrNull(raw?.weight),
      manifestUpdatedAt: fetchedAt,
      manifestSource: "LH_MANIFEST",
    };
    const previous = byProof.get(proofId);
    if (!previous) {
      byProof.set(proofId, candidate);
      continue;
    }
    const shipped = [previous.manifestShippedParcels, candidate.manifestShippedParcels]
      .filter((value) => Number.isFinite(value));
    const weight = [previous.manifestWeightKg, candidate.manifestWeightKg]
      .filter((value) => Number.isFinite(value));
    byProof.set(proofId, {
      ...previous,
      manifestShippedParcels: shipped.length ? Math.max(...shipped) : null,
      manifestWeightKg: weight.length ? Math.max(...weight) : null,
      manifestUpdatedAt: fetchedAt,
    });
  }
  return byProof;
}

export function applyManifestToRows(rows, manifestByProof) {
  if (!(manifestByProof instanceof Map) || !manifestByProof.size) return rows;
  return (Array.isArray(rows) ? rows : []).map((row) => {
    if (!isOrigin(row)) return row;
    const match = manifestByProof.get(normalizeProofId(row?.proofId));
    return match ? { ...row, ...match } : row;
  });
}

export class ManifestRefreshCache {
  constructor({ loader, now = () => Date.now(), ttlMs = MANIFEST_REFRESH_MS } = {}) {
    this.loader = loader;
    this.now = now;
    this.ttlMs = ttlMs;
    this.cache = new Map();
    this.active = new Map();
  }

  clear() {
    this.cache.clear();
    this.active.clear();
  }

  async get(day) {
    const now = this.now();
    const cached = this.cache.get(day);
    if (cached?.until > now) return { ...cached, cacheHit: true };
    if (this.active.has(day)) return this.active.get(day);
    const task = (async () => {
      try {
        const loaded = await this.loader(day);
        const value = {
          ...loaded,
          until: this.now() + this.ttlMs,
          cacheHit: false,
          stale: false,
          error: "",
        };
        this.cache.set(day, value);
        return value;
      } catch (error) {
        const prior = this.cache.get(day);
        const priorFetched = Date.parse(String(prior?.fetchedAt || ""));
        const usablePrior =
          prior && Number.isFinite(priorFetched) && this.now() - priorFetched <= MANIFEST_STALE_MAX_MS;
        const value = usablePrior
          ? {
              ...prior,
              until: this.now() + this.ttlMs,
              cacheHit: false,
              stale: true,
              error: error?.message || String(error),
            }
          : {
              day,
              rows: [],
              total: 0,
              pages: 0,
              upstreamRequests: 0,
              fetchedAt: "",
              until: this.now() + this.ttlMs,
              cacheHit: false,
              stale: false,
              error: error?.message || String(error),
            };
        this.cache.set(day, value);
        return value;
      } finally {
        this.active.delete(day);
      }
    })();
    this.active.set(day, task);
    return task;
  }
}

function manifestDbKey(hub) {
  return `${MANIFEST_KEY_PREFIX}${cleanHub(hub)}`;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64ToBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function credentialKey(env) {
  const raw = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${env.AUTH_SECRET}|ms-origin-manifest-credentials`),
  );
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptCredentials(value, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await credentialKey(env),
      new TextEncoder().encode(value),
    ),
  );
  return `${bytesToBase64(iv)}.${bytesToBase64(cipher)}`;
}

async function decryptCredentials(value, env) {
  const [iv, cipher] = String(value || "").split(".");
  if (!iv || !cipher) fail("ข้อมูลเชื่อมต่อ LH Manifest เสียหาย", "MANIFEST_CREDENTIAL_ERROR", 500);
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    await credentialKey(env),
    base64ToBytes(cipher),
  );
  return JSON.parse(new TextDecoder().decode(clear));
}

function credentialValue(value, max = 2000) {
  return String(value || "").trim().slice(0, max);
}

function sanitizeCredentials(input) {
  const credentials = {
    auth: credentialValue(input?.auth),
    lang: credentialValue(input?.lang || "th", 20),
    fbid: credentialValue(input?.fbid, 100),
    time: credentialValue(input?.time, 100),
    webSign: credentialValue(input?.webSign || "hbi", 50),
    _from: credentialValue(input?._from, 100),
    storeFrom: credentialValue(input?.storeFrom, 100),
  };
  if (!credentials.auth || !credentials.fbid || !credentials.time || !credentials.storeFrom)
    fail("ไฟล์ HAR ไม่มีข้อมูลเชื่อมต่อ LH Manifest ที่ต้องใช้", "INVALID_MANIFEST_HAR");
  return credentials;
}

function canAccess(hub, actor) {
  const wanted = cleanHub(hub);
  return Boolean(
    actor?.role === "admin" ||
    (Array.isArray(actor?.branches) &&
      (actor.branches.includes("*") || actor.branches.includes(wanted))),
  );
}

function requireAccess(hub, actor) {
  const wanted = cleanHub(hub);
  if (!canAccess(wanted, actor)) fail("ไม่มีสิทธิ์ดู HUB นี้", "FORBIDDEN", 403);
  return wanted;
}

async function readCredentialRow(env, hub) {
  return env.DB.prepare(
    "SELECT credentials_cipher,updated_at,updated_by,last_success_at,last_error FROM ms_bus_connections WHERE hub=?",
  ).bind(manifestDbKey(hub)).first();
}

async function loadCredentials(env, hub) {
  const row = await readCredentialRow(env, hub);
  if (!row?.credentials_cipher) return null;
  try {
    return await decryptCredentials(row.credentials_cipher, env);
  } catch (error) {
    console.error(JSON.stringify({ event: "origin_manifest_credential_error", hub, message: error.message }));
    return null;
  }
}


export async function readManifestPage(credentials, day, page = 1, fetchImpl = fetch) {
  const url = new URL("https://hbi-common.flashexpress.com/api/route/route_outhouse");
  for (const [key, value] of Object.entries({
    day,
    storeFrom: credentials.storeFrom,
    storeTo: "",
    proofId: "",
    page: String(page),
    page_size: String(MANIFEST_PAGE_SIZE),
  })) url.searchParams.set(key, value);

  const body = new URLSearchParams({
    auth: credentials.auth,
    lang: credentials.lang || "th",
    fbid: credentials.fbid,
    time: credentials.time,
    webSign: credentials.webSign || "hbi",
    _from: credentials._from || "",
  });
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Origin: "https://cbi-fbi.flashexpress.com",
      Referer: "https://cbi-fbi.flashexpress.com/",
      "User-Agent": "Mozilla/5.0",
      "BI-PLATFORM": "",
    },
    body,
  });
  if (!response.ok) fail(`LH Manifest ตอบกลับ ${response.status}`, "MANIFEST_HTTP_ERROR", 502);
  const payload = await response.json();
  if (Number(payload?.code) !== 1)
    fail(payload?.msg || payload?.message || "เซสชัน LH Manifest หมดอายุ", "MANIFEST_SESSION_EXPIRED", 502);
  if (payload?.data?.error)
    fail(String(payload.data.error), "MANIFEST_QUERY_ERROR", 502);
  const rows = Array.isArray(payload?.data?.DataList) ? payload.data.DataList : [];
  return {
    rows,
    total: Number(payload?.data?.total ?? payload?.data?.Total) || rows.length,
  };
}

async function readManifestDay(credentials, day, fetchImpl = fetch) {
  const first = await readManifestPage(credentials, day, 1, fetchImpl);
  const rows = [...first.rows];
  const pages = Math.max(
    1,
    Math.min(MANIFEST_MAX_PAGES, Math.ceil((first.total || rows.length) / MANIFEST_PAGE_SIZE)),
  );
  let upstreamRequests = 1;
  if (pages > 1) {
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, index) =>
        readManifestPage(credentials, day, index + 2, fetchImpl),
      ),
    );
    upstreamRequests += rest.length;
    for (const page of rest) rows.push(...page.rows);
  }
  const fetchedAt = new Date().toISOString();
  return {
    day,
    rows,
    total: first.total || rows.length,
    pages,
    upstreamRequests,
    fetchedAt,
  };
}

export class OriginManifestCoordinator {
  constructor(ctx, env, options = {}) {
    this.ctx = ctx;
    this.env = env;
    this.fetchImpl = options.fetchImpl || fetch;
    this.credentialsLoaded = false;
    this.credentials = null;
    this.cache = new ManifestRefreshCache({
      loader: async (day) => {
        const credentials = await this.getCredentials();
        if (!credentials) fail("HUB นี้ยังไม่ได้เชื่อม LH Manifest", "MANIFEST_NOT_CONFIGURED", 404);
        return readManifestDay(credentials, day, this.fetchImpl);
      },
      now: options.now || (() => Date.now()),
    });
  }

  async getCredentials() {
    if (this.credentialsLoaded) return this.credentials;
    this.credentials = await loadCredentials(this.env, this.hub);
    this.credentialsLoaded = true;
    return this.credentials;
  }

  invalidate() {
    this.credentialsLoaded = false;
    this.credentials = null;
    this.cache.clear();
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/origin-manifest/invalidate") {
      this.hub = cleanHub(url.searchParams.get("hub"));
      this.invalidate();
      return json({ ok: true, invalidated: true });
    }
    if (url.pathname !== "/origin-manifest/refresh") return null;
    const body = await request.json();
    this.hub = cleanHub(body?.hub);
    const days = [...new Set((Array.isArray(body?.days) ? body.days : []).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(String(day))))].slice(-2);
    if (!days.length) return json({ ok: true, rows: [], days: [], upstreamRequests: 0, cacheHits: 0 });

    const results = [];
    for (const day of days) results.push(await this.cache.get(day));
    const manifestByProof = new Map();
    for (const result of results) {
      for (const [proofId, row] of normalizeManifestRows(result.rows, result.fetchedAt)) {
        const prior = manifestByProof.get(proofId);
        if (!prior || Date.parse(row.manifestUpdatedAt || "") >= Date.parse(prior.manifestUpdatedAt || ""))
          manifestByProof.set(proofId, row);
      }
    }
    return json({
      ok: true,
      rows: [...manifestByProof.values()],
      days,
      upstreamRequests: results.reduce((sum, item) => sum + (item.cacheHit ? 0 : Number(item.upstreamRequests) || 0), 0),
      cacheHits: results.filter((item) => item.cacheHit).length,
      stale: results.some((item) => item.stale),
      error: results.find((item) => item.error)?.error || "",
      refreshedAt: results.map((item) => item.fetchedAt).filter(Boolean).sort().at(-1) || "",
      refreshMs: MANIFEST_REFRESH_MS,
    });
  }
}

async function coordinatorStub(env, hub) {
  const binding = env?.MS_REFRESH_COORDINATOR;
  if (!binding?.idFromName || !binding?.get) return null;
  const id = binding.idFromName(`origin-manifest:${cleanHub(hub)}`);
  return binding.get(id);
}

async function invalidateCoordinator(env, hub) {
  const stub = await coordinatorStub(env, hub);
  if (!stub) return;
  const url = new URL("https://origin-manifest.internal/origin-manifest/invalidate");
  url.searchParams.set("hub", hub);
  try { await stub.fetch(url); } catch {}
}

export async function originManifestStatus(env, actor, wantedHub) {
  const hub = requireAccess(wantedHub, actor);
  const row = await readCredentialRow(env, hub);
  return {
    configured: Boolean(row?.credentials_cipher),
    updatedAt: row?.updated_at || "",
    updatedBy: row?.updated_by || "",
    lastSuccessAt: row?.last_success_at || "",
    refreshMs: MANIFEST_REFRESH_MS,
    source: "LH_MANIFEST",
    dataPersistenceWrites: 0,
  };
}

export async function saveOriginManifestConnection(env, actor, wantedHub, inputCredentials) {
  const hub = requireAccess(wantedHub, actor);
  const credentials = sanitizeCredentials(inputCredentials);
  const test = await readManifestPage(credentials, thaiDay(), 1);
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO ms_bus_connections(hub,credentials_cipher,updated_at,updated_by,last_success_at,last_error) VALUES(?,?,?,?,?,?) ON CONFLICT(hub) DO UPDATE SET credentials_cipher=excluded.credentials_cipher,updated_at=excluded.updated_at,updated_by=excluded.updated_by,last_success_at=excluded.last_success_at,last_error=''",
  ).bind(
    manifestDbKey(hub),
    await encryptCredentials(JSON.stringify(credentials), env),
    now,
    String(actor?.username || "ORIGIN_MANIFEST").slice(0, 80),
    now,
    "",
  ).run();
  await invalidateCoordinator(env, hub);
  return {
    hub,
    total: test.total,
    updatedAt: now,
    source: "LH_MANIFEST",
    refreshMs: MANIFEST_REFRESH_MS,
    dataPersistenceWrites: 0,
  };
}

export async function originManifestLive(env, actor, wantedHub, wantedDays) {
  const hub = requireAccess(wantedHub, actor);
  const days = [...new Set((Array.isArray(wantedDays) ? wantedDays : String(wantedDays || "").split(","))
    .map((day) => String(day).trim())
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)))].slice(-2);
  if (!days.length) {
    return { rows: [], days: [], upstreamRequests: 0, cacheHits: 0, refreshMs: MANIFEST_REFRESH_MS };
  }
  const stub = await coordinatorStub(env, hub);
  if (!stub) fail("Shared LH Manifest coordinator ไม่พร้อมใช้งาน", "MANIFEST_COORDINATOR_UNAVAILABLE", 503);
  const response = await stub.fetch(
    new Request("https://origin-manifest.internal/origin-manifest/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hub, days }),
    }),
  );
  const live = await response.json();
  return {
    rows: Array.isArray(live?.rows) ? live.rows : [],
    days,
    upstreamRequests: Number(live?.upstreamRequests) || 0,
    cacheHits: Number(live?.cacheHits) || 0,
    stale: Boolean(live?.stale),
    error: live?.error || "",
    refreshedAt: live?.refreshedAt || "",
    refreshMs: MANIFEST_REFRESH_MS,
    source: "LH_MANIFEST",
    dataPersistenceWrites: 0,
  };
}

export async function appendOriginManifestFrontend(response) {
  if (!response?.ok) return response;
  const base = await response.text();
  const headers = new Headers(response.headers);
  headers.set("content-type", "application/javascript; charset=utf-8");
  headers.set("cache-control", "no-store");
  if (base.includes("MS_ORIGIN_LH_MANIFEST_V1"))
    return new Response(base, { status: response.status, headers });
  return new Response(`${base.trimEnd()}\n${ORIGIN_MANIFEST_UI_JS}\n`, {
    status: response.status,
    headers,
  });
}

export function wrapOriginManifestAssets(env) {
  const assets = env?.ASSETS;
  if (!assets || typeof assets.fetch !== "function") return env;
  const wrappedAssets = {
    async fetch(request) {
      const response = await assets.fetch(request);
      try {
        const url = new URL(typeof request === "string" ? request : request.url);
        if (url.pathname === "/ms.js") return appendOriginManifestFrontend(response);
      } catch {}
      return response;
    },
  };
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === "ASSETS") return wrappedAssets;
      return Reflect.get(target, property, receiver);
    },
  });
}

export function originManifestFrontendSource() {
  return ORIGIN_MANIFEST_UI_JS;
}

const ORIGIN_MANIFEST_UI_JS = String.raw`(() => {
  if (globalThis.__MS_ORIGIN_MANIFEST_UI_V1__) return;
  globalThis.__MS_ORIGIN_MANIFEST_UI_V1__ = true;
  const marker = 'MS_ORIGIN_LH_MANIFEST_V1';
  const kgf = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });

  function manifestBadge(row) {
    if (typeof isOrigin !== 'function' || !isOrigin(row)) return '';
    const rawParcels = row?.manifestShippedParcels;
    const rawWeight = row?.manifestWeightKg;
    const parcels = Number(rawParcels);
    const weight = Number(rawWeight);
    const hasParcels = rawParcels !== null && rawParcels !== undefined && rawParcels !== '' && Number.isFinite(parcels);
    const hasWeight = rawWeight !== null && rawWeight !== undefined && rawWeight !== '' && Number.isFinite(weight);
    if (!hasParcels && !hasWeight) return '';
    const parcelText = hasParcels ? nf.format(parcels) + ' ชิ้น' : '-';
    const weightText = hasWeight ? kgf.format(weight) + ' Kg' : '-';
    return '<div class="origin-manifest-badge" title="LH Manifest · อัปเดตทุก 5 นาที"><span>พัสดุออกจริง <strong>' + esc(parcelText) + '</strong></span><span>น้ำหนัก <strong>' + esc(weightText) + '</strong></span></div>';
  }

  function installStyle() {
    if (document.getElementById('origin-manifest-style-v1')) return;
    const style = document.createElement('style');
    style.id = 'origin-manifest-style-v1';
    style.textContent = `
.origin-manifest-badge {
  width: min(100%, 390px);
  max-width: 100%;
  margin: 8px auto 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: #62676d;
  font-size: 12px;
  line-height: 1.25;
}
.origin-manifest-badge > span {
  min-width: 0;
  min-height: 36px;
  padding: 7px 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  white-space: normal;
  text-align: center;
  border: 1px solid #c8cac6;
  border-radius: 7px;
  background: #ffffff;
  color: #62676d;
}
.origin-manifest-badge > span:first-child { border-top: 3px solid #ffd400; }
.origin-manifest-badge > span:last-child { border-top: 3px solid #252525; }
.origin-manifest-badge strong { color: #151515; font-weight: 900; }
.compact-card-head .origin-manifest-badge { margin-top: 8px; }
@media (max-width: 700px) {
  .origin-manifest-badge {
    width: 100%;
    max-width: none;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    justify-self: stretch;
  }
  .origin-manifest-badge > span {
    flex-direction: column;
    gap: 2px;
    padding: 7px 6px;
    white-space: nowrap;
  }
  .origin-manifest-badge > span strong { white-space: nowrap; }
}
`;
    document.head.appendChild(style);
  }

  function wrapRenderers() {
    if (globalThis.__MS_ORIGIN_MANIFEST_RENDERERS_V1__) return;
    globalThis.__MS_ORIGIN_MANIFEST_RENDERERS_V1__ = true;
    const originalTableRow = tableRow;
    const originalCard = card;
    tableRow = function(row) {
      const html = originalTableRow(row);
      const badge = manifestBadge(row);
      return badge ? html.replace(/(<div class="route-plate">[\s\S]*?<\/div>)/, '$1' + badge) : html;
    };
    card = function(row) {
      const html = originalCard(row);
      const badge = manifestBadge(row);
      return badge ? html.replace('</p>', '</p>' + badge) : html;
    };
    if (typeof exportRow === 'function') {
      const originalExportRow = exportRow;
      exportRow = function(row) {
        const base = originalExportRow(row);
        if (typeof isOrigin === 'function' && isOrigin(row)) {
          base.manifestShippedParcels = row?.manifestShippedParcels ?? '';
          base.manifestWeightKg = row?.manifestWeightKg ?? '';
        }
        return base;
      };
    }
  }

  function parseResponseJson(entry) {
    try { return JSON.parse(entry?.response?.content?.text || ''); } catch { return null; }
  }

  function findStoreFrom(entries, hub, routeEntry) {
    try {
      const queryValue = new URL(routeEntry.request.url).searchParams.get('storeFrom');
      if (queryValue) return queryValue;
    } catch {}
    const hubNeedle = String(hub || '').toUpperCase();
    for (const entry of entries) {
      let path = '';
      try { path = new URL(entry?.request?.url || '').pathname; } catch {}
      if (path !== '/api/route/get_lh_store') continue;
      const payload = parseResponseJson(entry);
      const list = Array.isArray(payload?.data) ? payload.data : [];
      const found = list.find((item) => String(item?.name || '').toUpperCase().includes(hubNeedle + '_HUB') || String(item?.name || '').toUpperCase().includes(' ' + hubNeedle + '_'));
      if (found?.id) return String(found.id);
    }
    for (const entry of entries) {
      const payload = parseResponseJson(entry);
      const data = payload?.data;
      const storeName = String(data?.store_name || data?.department_name || '').toUpperCase();
      if (data?.organization_id && (!hubNeedle || storeName.includes(hubNeedle)))
        return String(data.organization_id);
    }
    return '';
  }

  function manifestCredentialsFromHar(har, hub) {
    const entries = har?.log?.entries || [];
    const routeEntry = entries.find((entry) => {
      try { return new URL(entry?.request?.url || '').pathname === '/api/route/route_outhouse'; } catch { return false; }
    });
    if (!routeEntry) throw new Error('ไฟล์นี้ไม่มีข้อมูลหน้า LH Manifest');
    const postData = routeEntry?.request?.postData || {};
    const postText = postData.text || (Array.isArray(postData.params)
      ? new URLSearchParams(postData.params.map((item) => [item?.name || '', item?.value || ''])).toString()
      : '');
    const params = new URLSearchParams(postText);
    const storeFrom = findStoreFrom(entries, hub, routeEntry);
    const credentials = {
      auth: params.get('auth') || '',
      lang: params.get('lang') || 'th',
      fbid: params.get('fbid') || '',
      time: params.get('time') || '',
      webSign: params.get('webSign') || 'hbi',
      _from: params.get('_from') || '',
      storeFrom,
    };
    if (!credentials.auth || !credentials.fbid || !credentials.time || !credentials.storeFrom)
      throw new Error('HAR LH Manifest ไม่มี Session หรือรหัส HUB ต้นทางครบถ้วน');
    return credentials;
  }

  async function loadManifestStatus() {
    const hubInput = document.getElementById('ms-har-hub');
    const node = document.querySelector('[data-source-status="originManifest"] span');
    if (!hubInput || !node || !state?.auth) return;
    try {
      const result = await apiGet('msOriginManifestStatus', { branch: hubInput.value.trim().toUpperCase() });
      node.className = result?.configured ? 'source-ok' : 'source-missing';
      node.textContent = result?.configured
        ? 'พร้อมใช้งาน · Shared refresh ทุก 5 นาที · 0 data writes'
        : 'ยังไม่ได้อัปโหลด';
    } catch (error) {
      node.className = 'source-error';
      node.textContent = 'ตรวจสถานะไม่ได้ · ' + error.message;
    }
  }

  async function saveManifest(button) {
    const errorEl = document.getElementById('ms-connection-error');
    const input = document.getElementById('ms-har-origin-manifest');
    const hub = document.getElementById('ms-har-hub')?.value.trim().toUpperCase();
    try {
      button.disabled = true;
      const file = input?.files?.[0];
      if (!file || file.size > 100 * 1024 * 1024) throw new Error('กรุณาเลือกไฟล์ HAR LH Manifest ขนาดไม่เกิน 100 MB');
      const har = JSON.parse(await file.text());
      const credentials = manifestCredentialsFromHar(har, hub);
      const result = await apiPost('saveMsOriginManifestConnection', { hub, credentials });
      errorEl?.classList.add('hidden');
      toast('เชื่อม LH Manifest ' + hub + ' สำเร็จ · พบ ' + nf.format(result.total || 0) + ' เที่ยว');
      await loadManifestStatus();
      await loadData();
    } catch (error) {
      if (errorEl) {
        errorEl.textContent = error.message;
        errorEl.classList.remove('hidden');
      }
    } finally {
      button.disabled = false;
    }
  }

  function installConnectionUi() {
    if (document.getElementById('ms-har-origin-manifest')) return;
    const details = document.querySelector('#ms-connection-form details.setup-fallback');
    const statusBox = document.getElementById('connection-source-status');
    const links = details?.querySelector('.setup-source-links');
    const list = details?.querySelector('.har-source-list');
    if (!details || !statusBox || !list) return;
    const summary = details.querySelector('summary');
    if (summary) summary.textContent = 'อัปโหลด HAR ทั้ง 4 แหล่ง';
    statusBox.insertAdjacentHTML('beforeend', '<div data-source-status="originManifest"><b>4. LH Manifest (พัสดุออกจริง / น้ำหนัก)</b><span>กำลังตรวจสอบ…</span></div>');
    if (links) links.insertAdjacentHTML('beforeend', '<a class="btn btn-header setup-link" href="https://hbi-v3.flashexpress.com/lh-manifest" target="_blank" rel="noopener">4. LH Manifest</a>');
    list.insertAdjacentHTML('beforeend', '<label><span>4. HAR LH Manifest · พัสดุออกจริง + น้ำหนัก Kg</span><input id="ms-har-origin-manifest" type="file" accept=".har,application/json" /></label><button class="btn btn-accent" id="ms-har-origin-manifest-save" type="button">ทดสอบและบันทึก</button>');
    document.getElementById('ms-har-origin-manifest-save').onclick = (event) => saveManifest(event.currentTarget);
    document.getElementById('ms-connection-btn')?.addEventListener('click', () => {
      const input = document.getElementById('ms-har-origin-manifest');
      if (input) input.value = '';
      setTimeout(loadManifestStatus, 0);
    });
    if (document.getElementById('ms-connection-dialog')?.open) loadManifestStatus();
  }

  const manifestCache = new Map();
  const lastAttemptAt = new Map();
  let syncInFlight = null;

  function cacheKey(hub) { return 'ms_origin_manifest_v1_' + String(hub || '').toUpperCase(); }

  function loadBrowserCache(hub) {
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey(hub)) || 'null');
      if (!cached || !Array.isArray(cached.rows)) return null;
      if (Date.now() - Number(cached.savedAt || 0) >= 5 * 60 * 1000) return null;
      return cached;
    } catch { return null; }
  }

  function saveBrowserCache(hub, rows, refreshedAt) {
    const value = { rows, refreshedAt: refreshedAt || '', savedAt: Date.now() };
    manifestCache.set(String(hub || '').toUpperCase(), value);
    try { localStorage.setItem(cacheKey(hub), JSON.stringify(value)); } catch {}
    return value;
  }

  function activeOriginDaysLocal() {
    const days = new Set();
    for (const row of state?.currentRows || []) {
      if (!isOrigin(row) || !String(row?.proofId || '').trim()) continue;
      if (row?.actualDepartureAt || row?.queueCancelledAt) continue;
      if (typeof queueInfo === 'function' && !queueInfo(row).active) continue;
      const day = typeof bangkokDateValue === 'function'
        ? bangkokDateValue(row?.estimatedDepartureAt || row?.estimatedArrivalAt || new Date())
        : '';
      if (day) days.add(day);
    }
    return [...days].sort().slice(-2);
  }

  function applyCachedManifest() {
    const hub = String(state?.branch || '').toUpperCase();
    if (!hub || !Array.isArray(state?.currentRows)) return;
    let cached = manifestCache.get(hub);
    if (!cached) {
      cached = loadBrowserCache(hub);
      if (cached) manifestCache.set(hub, cached);
    }
    if (!cached?.rows?.length) return;
    const byProof = new Map(cached.rows.map((item) => [String(item?.proofId || '').trim().toUpperCase().replace(/\s+/g, ''), item]));
    const patch = (row) => {
      if (!isOrigin(row)) return row;
      const item = byProof.get(String(row?.proofId || '').trim().toUpperCase().replace(/\s+/g, ''));
      return item ? { ...row, ...item } : row;
    };
    const previous = state.currentRows;
    state.currentRows = previous.map(patch);
    if (!state.archiveView || state.rows === previous) state.rows = state.currentRows;
  }

  function wrapRender() {
    if (globalThis.__MS_ORIGIN_MANIFEST_RENDER_WRAP_V1__ || typeof render !== 'function') return;
    globalThis.__MS_ORIGIN_MANIFEST_RENDER_WRAP_V1__ = true;
    const originalRender = render;
    render = function(...args) {
      applyCachedManifest();
      return originalRender.apply(this, args);
    };
  }

  async function maybeSyncManifest(force = false) {
    if (!state?.auth || syncInFlight) return;
    const hub = String(state?.branch || '').toUpperCase();
    if (!hub) return;
    const days = activeOriginDaysLocal();
    if (!days.length) return;

    const browserCached = loadBrowserCache(hub);
    if (!force && browserCached) {
      manifestCache.set(hub, browserCached);
      applyCachedManifest();
      return;
    }

    const last = Number(lastAttemptAt.get(hub) || 0);
    if (!force && Date.now() - last < 5 * 60 * 1000) return;
    lastAttemptAt.set(hub, Date.now());
    syncInFlight = (async () => {
      try {
        const result = await apiGet('msOriginManifestLive', { branch: hub, days: days.join(',') });
        const rows = Array.isArray(result?.rows) ? result.rows : [];
        saveBrowserCache(hub, rows, result?.refreshedAt || '');
        applyCachedManifest();
        if (typeof render === 'function') render();
      } catch (error) {
        console.warn(marker, error?.message || error);
      } finally {
        syncInFlight = null;
      }
    })();
    await syncInFlight;
  }

  function installManifestScheduler() {
    setTimeout(() => void maybeSyncManifest(false), 350);
    setInterval(() => void maybeSyncManifest(false), 10_000);
    window.addEventListener('storage', (event) => {
      const hub = String(state?.branch || '').toUpperCase();
      if (!hub || event.key !== cacheKey(hub)) return;
      const cached = loadBrowserCache(hub);
      if (cached) {
        manifestCache.set(hub, cached);
        if (typeof render === 'function') render();
      }
    });
  }

  function init() {
    installStyle();
    wrapRenderers();
    wrapRender();
    installConnectionUi();
    installManifestScheduler();
    if (typeof render === 'function' && state?.auth) render();
    globalThis.__MS_ORIGIN_MANIFEST_MARKER__ = marker;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();`;
