import puppeteer from "@cloudflare/puppeteer";
import {
  observeTbrShadow,
  readTbrShadowReport,
  tbrShadowPage,
} from "./tbr-shadow.js";
import {
  handleConnectionErrorRequest,
  recordConnectionErrorKv,
  recordConnectionRecoveredKv,
} from "./connection-error.js";

const MS_URL = "https://ms.flashexpress.com/#/sendoutlets/storeLineAttendance";
const API_URL =
  "https://ms-api.flashexpress.com/gw/nws/staff/ms/store/line/task";
const MAIN_API =
  "https://waiting-trucks-report-api-dev.26nak-testdev.workers.dev/api";

// TBR_ROUTE_STALE_FALLBACK_V6: preserve the last successful compact Route snapshot
// in Browser KV. A transient 502/503/504 can use it for up to 30 minutes while
// the current Bus/TBR feed continues. Snapshot writes are throttled to 5 minutes.
const TBR_ROUTE_CACHE_VERSION = 1;
const TBR_ROUTE_CACHE_HEARTBEAT_MS = 5 * 60 * 1000;
const TBR_ROUTE_CACHE_MAX_AGE_MS = 30 * 60 * 1000;
const TBR_ROUTE_CACHE_TTL_SECONDS = 2 * 60 * 60;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") return page(url);
    if (url.pathname === "/api/config")
      return reply({ ok: true, pinConfigured: Boolean(env.TEST_PIN) });
    // TBR_SHADOW_REPORT_V1: KV-only readout for the hidden TBR shadow test.
    if (url.pathname === "/shadow-tbr")
      return tbrShadowPage(
        await readTbrShadowReport(env, url.searchParams.get("hub") || "NE1"),
      );
    if (url.pathname === "/api/shadow-tbr")
      return reply(
        await readTbrShadowReport(env, url.searchParams.get("hub") || "NE1"),
      );
    // MS_CONNECTION_ERROR_KV_V1: HAR/MS connection errors live in Browser KV only.
    if (url.pathname === "/api/connection-error")
      return handleConnectionErrorRequest(request, env, url);
    if (!url.pathname.startsWith("/api/"))
      return reply({ ok: false, message: "Not found" }, 404);
    try {
      if (url.pathname === "/api/bootstrap-connector" && request.method === "POST") {
        const body = await request.json();
        return reply(await bootstrapBrowserConnector(env, body));
      }
      if (url.pathname === "/api/start" && request.method === "POST") {
        const body = await request.json();
        return reply(await start(env, body));
      }
      if (url.pathname === "/api/status" && request.method === "POST") {
        const body = await request.json();
        return reply(await status(env, String(body.sessionId || ""), body));
      }
      if (url.pathname === "/api/stop" && request.method === "POST") {
        const body = await request.json();
        return reply(await stop(env, String(body.sessionId || "")));
      }
      return reply({ ok: false, message: "Not found" }, 404);
    } catch (error) {
      const limited =
        Number(error?.status) === 429 ||
        /429|rate limit|time limit/i.test(String(error?.message || ""));
      return reply(
        {
          ok: false,
          code: limited ? "BROWSER_DAILY_LIMIT" : "BROWSER_TEST_FAILED",
          message: limited
            ? "โควตา Cloud Browser ฟรีวันนี้ครบแล้ว เปิดได้อีกครั้งหลัง 07:00 น. ระบบจะไม่กินโควตาค้างเหมือนเดิมแล้ว"
            : error?.message || "ทดสอบไม่สำเร็จ",
        },
        limited ? 429 : 500,
      );
    }
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(syncConfiguredHubs(env));
  },
};

async function start(env, body) {
  const { pairing } = requirePairing(body);
  const remembered = await env.STATE.get(`browser:${pairing}`);
  if (remembered) {
    try {
      const active = await puppeteer.connect(env.BROWSER, remembered);
      const pages = await active.pages(),
        tab = pages[0];
      const result = tab ? await inspect(tab, null) : null;
      active.disconnect();
      if (result)
        return {
          ok: true,
          sessionId: remembered,
          ...result,
          message: "ใช้หน้าสแกน MS รอบเดิม",
        };
    } catch (_) {
      await env.STATE.delete(`browser:${pairing}`);
    }
  }
  const browser = await puppeteer.launch(env.BROWSER, { keep_alive: 120000 });
  const sessionId = browser.sessionId();
  await env.STATE.put(`browser:${pairing}`, sessionId, { expirationTtl: 180 });
  const pages = await browser.pages();
  const tab = pages[0] || (await browser.newPage());
  await tab.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await tab.goto(MS_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await wait(4000);
  const result = await inspect(tab, null);
  browser.disconnect();
  return {
    ok: true,
    sessionId,
    ...result,
    message: "เปิด MS ใน Cloud Browser แล้ว",
  };
}

async function status(env, sessionId, body) {
  const { pairing, hub } = requirePairing(body);
  if (!sessionId) throw new Error("ไม่พบรหัสรอบทดสอบ กรุณากดเริ่มใหม่");
  const browser = await puppeteer.connect(env.BROWSER, sessionId);
  const pages = await browser.pages();
  const tab = pages[0];
  if (!tab) throw new Error("ไม่พบหน้า MS ใน Cloud Browser");
  let credentials = null;
  tab.on("request", (request) => {
    if (!request.url().startsWith("https://ms-api.flashexpress.com/")) return;
    const headers = request.headers();
    const session = headers["x-fle-session-id"];
    const device = headers["x-device-id"];
    if (session && device)
      credentials = { sessionId: session, deviceId: device };
  });
  await tab.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
  await wait(3500);
  const probe = credentials ? await probeMs(credentials) : null;
  const result = await inspect(tab, probe);
  if (probe?.ok && credentials) {
    const saved = await saveToMain(env, pairing, hub, credentials);
    await rememberConnector(env, hub, saved.connectorToken);
    result.savedToMain = true;
    result.apiMessage = `บันทึก Session ของ ${hub} เข้าระบบจริงแล้ว`;
    await env.STATE.delete(`browser:${pairing}`);
    await browser.close();
    return { ok: true, sessionId, ...result };
  }
  browser.disconnect();
  return { ok: true, sessionId, ...result };
}

function requirePairing(body) {
  const pairing = String(body?.pairing || ""),
    hub = String(body?.hub || "").toUpperCase();
  if (
    !/^[A-Za-z0-9_-]{20,100}$/.test(pairing) ||
    !/^[A-Z0-9_-]{2,20}$/.test(hub)
  )
    throw new Error("กรุณาเริ่มเชื่อมต่อจากปุ่มในหน้าเว็บหลัก");
  return { pairing, hub };
}

// BROWSER_DEV_SERVICE_BINDING_V1: Browser TEST calls DEV Worker through a service binding.
// Same-account Worker-to-Worker public workers.dev fetches are intentionally avoided.
async function mainApiFetch(env, payload) {
  if (!env?.DEV_API?.fetch) throw new Error("DEV service binding missing");
  const request = new Request(MAIN_API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return env.DEV_API.fetch(request);
}

async function saveToMain(env, pairing, hub, credentials) {
  const response = await mainApiFetch(env, {
    action: "completeMsPairing",
    pairing,
    hub,
    ...credentials,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false || !json.data?.connectorToken)
    throw new Error(json.message || "บันทึก Session เข้าระบบหลักไม่สำเร็จ");
  return json.data;
}

async function sameBootstrapSecret(left, right) {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(left || ""))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(right || ""))),
  ]);
  const av = new Uint8Array(a), bv = new Uint8Array(b);
  let diff = av.length ^ bv.length;
  for (let i = 0; i < Math.max(av.length, bv.length); i++)
    diff |= (av[i] || 0) ^ (bv[i] || 0);
  return diff === 0;
}

async function bootstrapBrowserConnector(env, body) {
  const configured = String(env.CONNECTOR_BOOTSTRAP_SECRET || "");
  const supplied = String(body?.bootstrapSecret || "");
  if (!configured || !supplied || !(await sameBootstrapSecret(configured, supplied)))
    throw new Error("ยืนยันการย้ายตัวเชื่อมต่อ Browser ไม่สำเร็จ");
  const hub = String(body?.hub || "").trim().toUpperCase();
  const connectorToken = String(body?.connectorToken || "").trim();
  if (!/^[A-Z0-9_-]{2,20}$/.test(hub) || connectorToken.length < 20)
    throw new Error("ข้อมูลตัวเชื่อมต่อ Browser ไม่ถูกต้อง");
  await rememberConnector(env, hub, connectorToken);
  return { ok: true, hub, stored: true };
}

async function rememberConnector(env, hub, connectorToken) {
  const hubs = JSON.parse((await env.STATE.get("hubs")) || "[]");
  if (!hubs.includes(hub)) hubs.push(hub);
  await Promise.all([
    env.STATE.put("hubs", JSON.stringify(hubs)),
    env.STATE.put(`connector:${hub}`, connectorToken),
  ]);
}

function randomConnectorToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function registerConnectorForCutover(env, hub, connectorToken) {
  if (!env.CONNECTOR_BOOTSTRAP_SECRET) return false;
  const response = await mainApiFetch(env, {
    action: "bootstrapConnector",
    hub,
    connectorToken,
    bootstrapSecret: env.CONNECTOR_BOOTSTRAP_SECRET,
  });
  return response.ok;
}

// TBR_INBOUND_QUOTA_V1: Browser TEST requests the DEV read-only shadow snapshot only.
// TBR_STALE_SPLIT_BROWSER_V2: Route and TBR/BusTime use separate DEV Worker invocations.
// This prevents one growing operating day from hitting a single-invocation subrequest ceiling.
async function sendConnectorPart(env, hub, connectorToken, shadowPart, extraBody = {}) {
  return mainApiFetch(env, {
    action: "connectorSync",
    hub, connectorToken, shadowOnly: true, shadowPart, ...extraBody,
  });
}

async function connectorPartPayload(response) {
  return response.clone().json().catch(() => ({}));
}

function connectorPartError(part, response, payload) {
  const originalCode = String(payload?.code || "");
  const code = originalCode === "INVALID_CONNECTOR"
    ? originalCode
    : originalCode || `TBR_${part.toUpperCase()}_HTTP_${response.status}`;
  const message = String(payload?.message || `${part} source ตอบกลับ HTTP ${response.status}`);
  return { code, message, sourcePart: part, status: response.status || 503 };
}

function connectorPartFailure(part, response, payload) {
  const error = connectorPartError(part, response, payload);
  return new Response(JSON.stringify({ ok: false, code: error.code, message: error.message, sourcePart: part }), {
    status: error.status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// TBR_ROUTE_503_RETRY_V1 / TBR_BUS_503_RETRY_V7: retry transient Route/Bus transport failures once; steady state remains one call per part.
async function sendConnectorPartResilient(env, hub, connectorToken, part, extraBody = {}) {
  let attempts = 1;
  let response = await sendConnectorPart(env, hub, connectorToken, part, extraBody);
  let payload = await connectorPartPayload(response);
  if (["routes", "bus"].includes(part) && [502, 503, 504].includes(response.status)) {
    await wait(450);
    attempts = 2;
    response = await sendConnectorPart(env, hub, connectorToken, part, extraBody);
    payload = await connectorPartPayload(response);
  }
  return { response, payload, attempts };
}

function tbrRouteCacheKey(hub) {
  return `shadow:tbr:route-source:v1:${hub}`;
}

function parseTbrRouteCache(raw, hub) {
  try {
    const data = JSON.parse(raw || "null");
    if (data?.version === TBR_ROUTE_CACHE_VERSION && data?.hub === hub && Array.isArray(data?.rows)) return data;
  } catch {}
  return null;
}

async function readTbrRouteCache(env, hub, now = Date.now()) {
  if (!env?.STATE) return null;
  const data = parseTbrRouteCache(await env.STATE.get(tbrRouteCacheKey(hub)), hub);
  const lastSuccess = Date.parse(String(data?.lastSuccessAt || ""));
  if (!data || !Number.isFinite(lastSuccess)) return null;
  const ageMs = Math.max(0, now - lastSuccess);
  if (ageMs > TBR_ROUTE_CACHE_MAX_AGE_MS) return null;
  return { rows: data.rows, lastSuccessAt: data.lastSuccessAt, ageSeconds: Math.round(ageMs / 1000) };
}

async function refreshTbrRouteCache(env, hub, rows, now = Date.now()) {
  if (!env?.STATE || !Array.isArray(rows)) return { written: false };
  const key = tbrRouteCacheKey(hub);
  const current = parseTbrRouteCache(await env.STATE.get(key), hub);
  const previousAt = Date.parse(String(current?.lastSuccessAt || ""));
  if (Number.isFinite(previousAt) && now - previousAt < TBR_ROUTE_CACHE_HEARTBEAT_MS)
    return { written: false, lastSuccessAt: current.lastSuccessAt };
  const lastSuccessAt = new Date(now).toISOString();
  await env.STATE.put(key, JSON.stringify({ version: TBR_ROUTE_CACHE_VERSION, hub, lastSuccessAt, rows }), {
    expirationTtl: TBR_ROUTE_CACHE_TTL_SECONDS,
  });
  return { written: true, lastSuccessAt };
}

// TBR_BUS_DAILY_SPLIT_V9: after midnight the operating window needs yesterday + today.
// Run one Bus day per DEV invocation so each Turso/Worker request stays inside the CPU budget.
// Upstream Bus polling cadence is unchanged; days are processed sequentially to avoid burst load.
function bangkokSourceDay(nowMs, offsetDays = 0) {
  const shifted = Number(nowMs) + 7 * 60 * 60 * 1000 + Number(offsetDays) * 86400000;
  return new Date(shifted).toISOString().slice(0, 10);
}

export function tbrBusSourceDays(nowMs = Date.now()) {
  const bangkokHour = new Date(Number(nowMs) + 7 * 60 * 60 * 1000).getUTCHours();
  return bangkokHour < 12
    ? [bangkokSourceDay(nowMs, -1), bangkokSourceDay(nowMs, 0)]
    : [bangkokSourceDay(nowMs, 0)];
}

function mergeTbrBusFeeds(results) {
  const merged = new Map();
  for (const result of results) {
    const feed = Array.isArray(result?.payload?.data?.tbrShadowFeed)
      ? result.payload.data.tbrShadowFeed : [];
    for (const item of feed) {
      const key = String(item?.proofId || "") || JSON.stringify(item || {});
      merged.set(key, item);
    }
  }
  return [...merged.values()];
}

export async function sendConnectorSync(env, hub, connectorToken, nowMs = Date.now()) {
  const routePromise = sendConnectorPartResilient(env, hub, connectorToken, "routes");
  const busDays = tbrBusSourceDays(nowMs);
  const busResults = [];
  for (const day of busDays) {
    busResults.push(await sendConnectorPartResilient(env, hub, connectorToken, "bus", { shadowDay: day }));
  }
  const routeResult = await routePromise;
  const routeResponse = routeResult.response, routePayload = routeResult.payload;
  let rows = [];
  let routeFallback = null;
  let routeSourceError = null;
  if (routeResponse.ok) {
    rows = Array.isArray(routePayload?.data?.rows) ? routePayload.data.rows : [];
    await refreshTbrRouteCache(env, hub, rows);
  } else {
    routeSourceError = connectorPartError("routes", routeResponse, routePayload);
    routeFallback = await readTbrRouteCache(env, hub);
    if (!routeFallback) return connectorPartFailure("routes", routeResponse, routePayload);
    rows = routeFallback.rows;
  }
  const busFailure = busResults.find((result) => !result.response.ok);
  if (busFailure) return connectorPartFailure("bus", busFailure.response, busFailure.payload);
  const tbrShadowFeed = mergeTbrBusFeeds(busResults);
  const pointReads = 2 * (
    Number(routeResult.attempts || 1) +
    busResults.reduce((sum, result) => sum + Number(result.attempts || 1), 0)
  );
  const currentSteadyStateReads = 2 * (1 + busDays.length);
  return new Response(JSON.stringify({
    ok: true,
    data: {
      status: routeFallback ? "shadow_readonly_split_route_fallback" : "shadow_readonly_split",
      syncedAt: new Date().toISOString(),
      changes: 0, rows, tbrShadowFeed,
      routeFallback: Boolean(routeFallback),
      routeFallbackAt: routeFallback?.lastSuccessAt || "",
      routeFallbackAgeSeconds: routeFallback?.ageSeconds ?? null,
      routeSourceError: routeSourceError ? { code: routeSourceError.code, message: routeSourceError.message } : null,
      shadowQuota: {
        mode: "SHADOW_READONLY_SPLIT_V2_BUS_DAILY_V9",
        normalTursoPointReadsPerCron: 4,
        currentSteadyStateTursoPointReadsPerCron: currentSteadyStateReads,
        earlyWindowTursoPointReadsPerCron: 6,
        busSourceDays: busDays.length,
        tursoPointReadsPerCron: pointReads, tursoWritesPerCron: 0,
        browserKvRouteCacheReadsPerCron: 1, browserKvRouteCacheWritesMaxPerDay: 288,
        routeTableReads: 0, routeTableWrites: 0,
        historyReads: 0, historyWrites: 0,
        liveCacheReads: 0, liveCacheWrites: 0, preEntryCalls: 0,
      },
    },
  }), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
}

async function syncConfiguredHubs(env) {
  const storedHubs = JSON.parse((await env.STATE.get("hubs")) || "[]");
  const bootstrapHubs = env.CONNECTOR_BOOTSTRAP_SECRET
    ? String(env.CONNECTOR_BOOTSTRAP_HUBS || "NE1")
        .split(",")
        .map((hub) => hub.trim().toUpperCase())
        .filter((hub) => /^[A-Z0-9_-]{2,20}$/.test(hub))
    : [];
  const hubs = [...new Set([...storedHubs, ...bootstrapHubs])];

  await Promise.all(
    hubs.map(async (hub) => {
      try {
        let connectorToken = await env.STATE.get(`connector:${hub}`);
        if (!connectorToken && env.CONNECTOR_BOOTSTRAP_SECRET) {
          const candidate = randomConnectorToken();
          if (await registerConnectorForCutover(env, hub, candidate)) {
            connectorToken = candidate;
            await rememberConnector(env, hub, connectorToken);
          }
        }
        if (!connectorToken) return;

        let response = await sendConnectorSync(env, hub, connectorToken);
        let payload = await response.clone().json().catch(() => ({}));
        if (
          response.status === 401 &&
          env.CONNECTOR_BOOTSTRAP_SECRET &&
          payload?.code === "INVALID_CONNECTOR"
        ) {
          if (await registerConnectorForCutover(env, hub, connectorToken)) {
            response = await sendConnectorSync(env, hub, connectorToken);
            payload = await response.clone().json().catch(() => ({}));
          }
        }
        if (
          response.status === 401 &&
          !env.CONNECTOR_BOOTSTRAP_SECRET &&
          payload?.code === "INVALID_CONNECTOR"
        ) {
          await env.STATE.delete(`connector:${hub}`);
        } else if (!response.ok) {
          console.error(
            JSON.stringify({
              event: "connector_sync_blocked",
              hub,
              status: response.status,
              code: payload?.code || "UNKNOWN",
            }),
          );
        }
        if (!response.ok) {
          try {
            const failedShadow = await observeTbrShadow(env, hub, {});
            if (failedShadow?.sourceChanged) {
              const failureCode = String(payload?.code || `HTTP_${response.status}`);
              const failureSource = failureCode.includes("BUS") ? "busTime" : "routes";
              await recordConnectionErrorKv(env, {
                hub, source: failureSource, code: failureCode,
                message: payload?.message || `DEV Shadow ตอบกลับ HTTP ${response.status}`,
              });
            }
          } catch (healthError) {
            console.error(JSON.stringify({ event: "tbr_shadow_failure_health_error", hub, message: healthError?.message || String(healthError) }));
          }
        }
        // TBR_SHADOW_OBSERVER_V1: observe the combined read-only source only.
        if (response.ok) {
          try {
            const observedShadow = await observeTbrShadow(env, hub, payload?.data || {});
            if (payload?.data?.routeFallback) {
              const routeError = payload?.data?.routeSourceError || {};
              await recordConnectionErrorKv(env, {
                hub, source: "routes", code: routeError.code || "TBR_ROUTES_FALLBACK",
                message: routeError.message || "Route source สะดุดชั่วคราว · ใช้ snapshot ล่าสุด",
              });
              console.warn(JSON.stringify({ event: "tbr_route_snapshot_fallback", hub, cachedAt: payload?.data?.routeFallbackAt || "" }));
            } else if (observedShadow?.sourceChanged || observedShadow?.routeFallbackChanged) {
              await recordConnectionRecoveredKv(env, { hub });
            }
          } catch (shadowError) {
            console.error(
              JSON.stringify({
                event: "tbr_shadow_error",
                hub,
                message: shadowError?.message || String(shadowError),
              }),
            );
          }
        }
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "connector_sync_error",
            hub,
            message: error?.message || String(error),
          }),
        );
      }
    }),
  );
}

async function stop(env, sessionId) {
  if (!sessionId) return { ok: true };
  try {
    const browser = await puppeteer.connect(env.BROWSER, sessionId);
    await browser.close();
  } catch (_) {}
  return { ok: true, message: "ปิดรอบทดสอบแล้ว" };
}

async function inspect(tab, probe) {
  const currentUrl = tab.url();
  const title = await tab.title();
  const text = (await tab.evaluate(() => document.body?.innerText || "")).slice(
    0,
    1000,
  );
  const screenshot = await tab.screenshot({ type: "jpeg", quality: 72 });
  const signedIn =
    Boolean(probe?.ok) ||
    /บันทึกสถานะเส้นทางเดินรถ|การจัดการเส้นทาง/.test(text);
  return {
    currentUrl,
    title,
    signedIn,
    apiConnected: Boolean(probe?.ok),
    total: probe?.total ?? null,
    apiMessage: probe?.message || "",
    screenshot: "data:image/jpeg;base64," + toBase64(screenshot),
  };
}

async function probeMs(credentials) {
  const nowThai = Date.now() + 7 * 3600000;
  const start = Math.floor(nowThai / 86400000) * 86400000 - 7 * 3600000;
  const end = start + 86400000 - 1000;
  const url = new URL(API_URL);
  const query = {
    currentStore: "",
    startTime: String(Math.floor(start / 1000)),
    endTime: String(Math.floor(end / 1000)),
    originStore: "",
    passStore: "",
    targetStore: "",
    pageSize: "1",
    pageNum: "1",
    sortingNo: "",
    fleetId: "",
    plateNumber: "",
    lineType: "",
    _t: String(Date.now()),
  };
  Object.entries(query).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );
  const response = await fetch(url, {
    headers: {
      Accept: "application/json, text/plain, */*",
      Origin: "https://ms.flashexpress.com",
      Referer: "https://ms.flashexpress.com/",
      "X-DEVICE-ID": credentials.deviceId,
      "X-FH-MS-EQUIPMENT-TYPE": "5",
      "X-FLE-SESSION-ID": credentials.sessionId,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.code !== 1)
    return { ok: false, message: data.message || "MS ไม่ยอมรับ Session" };
  return {
    ok: true,
    total: Number(data.data?.pagination?.total_count) || 0,
    message: "Session ใช้ดึง API ได้จริง",
  };
}

function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function page(url) {
  const pairing = url.searchParams.get("pairing") || "",
    hub = url.searchParams.get("hub") || "";
  return new Response(
    HTML.replace(
      'let sid="";',
      `let sid="";const pairing=${JSON.stringify(pairing)},hub=${JSON.stringify(hub)};`,
    )
      .replace('call("/api/start")', 'call("/api/start",{pairing,hub})')
      .replace(
        'call("/api/status",{sessionId:sid})',
        'call("/api/status",{sessionId:sid,pairing,hub})',
      )
      .replace(
        "ทดลอง Cloud Browser เชื่อมต่อ MS",
        "เชื่อมต่อ MS กับระบบรถรอลงงาน",
      )
      .replace(
        "ระบบทดสอบแยก — ไม่กระทบเว็บจริง",
        `กำลังเชื่อมต่อ HUB ${hub || "-"}`,
      )
      .replace(
        "เชื่อมต่อสำเร็จ ดึงข้อมูลจริงได้ ",
        "เชื่อมต่อระบบจริงสำเร็จ ดึงข้อมูลได้ ",
      ),
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}

const HTML =
  '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ทดลองเชื่อมต่อ MS</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f5f2;color:#171717;font-family:system-ui,sans-serif}.top{background:#151515;color:#fff;border-bottom:4px solid #ffd400;padding:18px 24px}.top b{font-size:22px}.wrap{max-width:980px;margin:24px auto;padding:0 16px}.card{background:#fff;border:1px solid #ddd;border-radius:14px;padding:20px;box-shadow:0 8px 28px #0000000d}.row{display:flex;gap:10px;flex-wrap:wrap}input,button{min-height:46px;border-radius:9px;font-size:16px}input{flex:1;min-width:220px;border:1px solid #bbb;padding:0 14px}button{border:1px solid #222;background:#222;color:#fff;font-weight:700;padding:0 18px;cursor:pointer}button.primary{background:#ffd400;color:#111}.status{margin:16px 0;padding:14px;border-radius:10px;background:#f1f3f5}.ok{background:#e7f7ee;color:#096b39}.bad{background:#fff0f0;color:#a31313}.shot{width:100%;margin-top:14px;border:1px solid #ccc;border-radius:10px;display:none}.hint{color:#666;font-size:14px;line-height:1.6}@media(max-width:600px){button,input{width:100%}.top{padding:14px 16px}.wrap{margin:16px auto}}</style></head><body><div class="top"><b>ทดลอง Cloud Browser เชื่อมต่อ MS</b><div>ระบบทดสอบแยก — ไม่กระทบเว็บจริง</div></div><main class="wrap"><section class="card"><p class="hint">กดเริ่มเปิด MS แล้วใช้โทรศัพท์สแกน QR ที่ปรากฏในภาพ หากเปิดจากโทรศัพท์เครื่องเดียว ต้องใช้อีกอุปกรณ์หนึ่งสแกน</p><div class="row"><button class="primary" id="start">เริ่มเปิด MS</button><button id="check">ตรวจหลังสแกน</button><button id="stop">หยุดทดสอบ</button></div><div id="status" class="status">ยังไม่ได้เริ่มทดสอบ</div><img id="shot" class="shot" alt="หน้าจอ MS Cloud Browser"></section></main><script>let sid="";const q=id=>document.getElementById(id),show=(d,bad=false)=>{q("status").className="status "+(bad?"bad":d.apiConnected?"ok":"");q("status").textContent=d.apiConnected?("เชื่อมต่อสำเร็จ ดึงข้อมูลจริงได้ "+d.total+" รายการ"):(d.message||d.apiMessage||"รอสแกน QR แล้วกดตรวจหลังสแกน");if(d.screenshot){q("shot").src=d.screenshot;q("shot").style.display="block"}};async function call(path,body={}){q("status").textContent="กำลังทำงาน...";const r=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.message||"ไม่สำเร็จ");return d}q("start").onclick=async()=>{try{const d=await call("/api/start");sid=d.sessionId;show(d)}catch(e){show({message:e.message},true)}};q("check").onclick=async()=>{try{show(await call("/api/status",{sessionId:sid}))}catch(e){show({message:e.message},true)}};q("stop").onclick=async()=>{try{const d=await call("/api/stop",{sessionId:sid});sid="";show(d)}catch(e){show({message:e.message},true)}}</script></body></html>';
