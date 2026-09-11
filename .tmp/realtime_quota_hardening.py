from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)


# -----------------------------------------------------------------------------
# ms.js — WebSocket-first realtime at the same visible 4-second cadence.
# -----------------------------------------------------------------------------
ms_path = Path("ms.js")
ms = ms_path.read_text()
if "MS_REALTIME_WS_V1" in ms:
    raise SystemExit("MS_REALTIME_WS_V1 already exists; refusing duplicate source")

ms = replace_once(
    ms,
    'let completedTodayZeroProbedKey = "";\n',
    '''let completedTodayZeroProbedKey = "";\n\n// MS_REALTIME_WS_V1: keep the visible 4-second realtime cadence without one\n// HTTP Worker request per browser every 4 seconds. One visible client per HUB\n// leads refreshes; the shared Durable Object broadcasts the same accepted data.\nconst REALTIME_WS_RETRY_MS = 3000;\nconst REALTIME_AUTH_HEARTBEAT_MS = 60 * 1000;\nlet realtimeSocket = null;\nlet realtimeSocketKey = "";\nlet realtimeConnectStartedAt = 0;\nlet realtimeRetryAt = 0;\nlet realtimeIsLeader = null;\nlet realtimeLastSnapshotAt = 0;\nlet realtimeLastAuthSentAt = 0;\n''',
    "frontend realtime declarations",
)

ms = replace_once(
    ms,
    '''  el("branch-filter").onchange = (event) => {\n    state.branch = event.target.value;\n    state.summary = "all";\n    resetArchiveState();\n    loadData();\n  };''',
    '''  el("branch-filter").onchange = (event) => {\n    state.branch = event.target.value;\n    state.summary = "all";\n    resetArchiveState();\n    stopRealtimeTransport();\n    loadData().finally(() => restartRealtimeTransport());\n  };''',
    "branch realtime restart",
)
ms = replace_once(
    ms,
    '  setInterval(() => state.auth && loadData(true), CONFIG.pollMs);',
    '  setInterval(realtimeTick, CONFIG.pollMs);',
    "replace per-device HTTP interval",
)
ms = replace_once(
    ms,
    '''  loadData();\n  handleMsEntryHash();\n  window.addEventListener("hashchange", handleMsEntryHash);''',
    '''  loadData().finally(() => restartRealtimeTransport());\n  handleMsEntryHash();\n  window.addEventListener("hashchange", handleMsEntryHash);\n  document.addEventListener("visibilitychange", handleRealtimeVisibility);''',
    "startup realtime transport",
)

realtime_helpers = r'''function realtimeTransportKey() {
  if (!state.auth) return "";
  return `${state.branch}|${state.auth.username || ""}|${state.auth.expiresAt || ""}`;
}

function realtimeSocketUrl() {
  const url = new URL(CONFIG.apiUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("action", "msStream");
  url.searchParams.set("token", state.auth?.token || "");
  url.searchParams.set("branch", state.branch);
  return url.toString();
}

function stopRealtimeTransport() {
  const socket = realtimeSocket;
  realtimeSocket = null;
  realtimeSocketKey = "";
  realtimeConnectStartedAt = 0;
  realtimeIsLeader = null;
  realtimeLastSnapshotAt = 0;
  realtimeLastAuthSentAt = 0;
  if (!socket) return;
  try {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    if (socket.readyState === 0 || socket.readyState === 1)
      socket.close(1000, "client reset");
  } catch {}
}

function ensureRealtimeTransport() {
  if (!state.auth || document.hidden || typeof WebSocket === "undefined") return false;
  const key = realtimeTransportKey();
  if (
    realtimeSocket &&
    realtimeSocketKey === key &&
    (realtimeSocket.readyState === 0 || realtimeSocket.readyState === 1)
  ) return true;
  if (Date.now() < realtimeRetryAt) return false;

  stopRealtimeTransport();
  try {
    const socket = new WebSocket(realtimeSocketUrl());
    realtimeSocket = socket;
    realtimeSocketKey = key;
    realtimeConnectStartedAt = Date.now();
    socket.onopen = () => {
      if (socket !== realtimeSocket || realtimeSocketKey !== key) return;
      realtimeConnectStartedAt = 0;
      realtimeRetryAt = 0;
    };
    socket.onmessage = (event) => {
      if (socket !== realtimeSocket || realtimeSocketKey !== key) return;
      handleRealtimeMessage(event.data);
    };
    socket.onerror = () => {};
    socket.onclose = () => {
      if (socket !== realtimeSocket) return;
      realtimeSocket = null;
      realtimeSocketKey = "";
      realtimeConnectStartedAt = 0;
      realtimeIsLeader = null;
      realtimeRetryAt = Date.now() + REALTIME_WS_RETRY_MS;
    };
    return true;
  } catch {
    realtimeRetryAt = Date.now() + REALTIME_WS_RETRY_MS;
    return false;
  }
}

function restartRealtimeTransport() {
  stopRealtimeTransport();
  realtimeRetryAt = 0;
  ensureRealtimeTransport();
}

function handleRealtimeVisibility() {
  if (document.hidden) {
    stopRealtimeTransport();
    return;
  }
  if (state.auth)
    loadData(true).finally(() => restartRealtimeTransport());
}

function handleRealtimeMessage(raw) {
  let payload;
  try { payload = JSON.parse(String(raw || "{}")); }
  catch { return; }
  if (payload?.type === "role") {
    realtimeIsLeader = payload.leader === true;
    return;
  }
  if (payload?.type === "auth_error") {
    stopRealtimeTransport();
    invalidateSession();
    return;
  }
  if (payload?.type === "error") {
    state.syncError = payload.message || "Realtime stream ขัดข้องชั่วคราว";
    state.msStatus = "degraded";
    renderFreshness();
    return;
  }
  if (payload?.type !== "snapshot") return;
  realtimeLastSnapshotAt = Date.now();
  applyLiveResult(payload, true);
}

function realtimeTick() {
  if (!state.auth || document.hidden) return;
  const available = ensureRealtimeTransport();
  const socket = realtimeSocket;
  if (socket?.readyState === 1) {
    const now = Date.now();
    const staleFollower =
      realtimeIsLeader === false &&
      realtimeLastSnapshotAt > 0 &&
      now - realtimeLastSnapshotAt > CONFIG.staleMs;
    const shouldRefresh =
      realtimeIsLeader === true || realtimeIsLeader === null || staleFollower;
    const shouldAuth =
      !shouldRefresh &&
      now - realtimeLastAuthSentAt >= REALTIME_AUTH_HEARTBEAT_MS;
    if (shouldRefresh || shouldAuth) {
      try {
        socket.send(JSON.stringify({
          type: shouldRefresh ? "refresh" : "auth",
          token: state.auth.token,
        }));
        if (shouldAuth) realtimeLastAuthSentAt = now;
        return;
      } catch {}
    } else {
      return;
    }
  }
  const connectingFresh =
    socket?.readyState === 0 &&
    realtimeConnectStartedAt > 0 &&
    Date.now() - realtimeConnectStartedAt <= 5000;
  if (available && connectingFresh) return;
  if (socket?.readyState === 0) stopRealtimeTransport();
  void loadData(true).finally(() => ensureRealtimeTransport());
}

'''
ms = replace_once(ms, "function loadAuth() {\n", realtime_helpers + "function loadAuth() {\n", "insert realtime helpers")
ms = replace_once(
    ms,
    '''    await loadData();\n    handleMsEntryHash();\n    toast("เข้าสู่ระบบแล้ว");''',
    '''    await loadData();\n    restartRealtimeTransport();\n    handleMsEntryHash();\n    toast("เข้าสู่ระบบแล้ว");''',
    "login realtime restart",
)
ms = replace_once(ms, "function logout() {\n  state.auth = null;", "function logout() {\n  stopRealtimeTransport();\n  state.auth = null;", "logout closes stream")
ms = replace_once(ms, "function invalidateSession() {\n  state.auth = null;", "function invalidateSession() {\n  stopRealtimeTransport();\n  state.auth = null;", "invalid session closes stream")

load_start = ms.index("async function loadData(silent = false) {")
load_end = ms.index("\nfunction resetArchiveState()", load_start)
if load_start < 0 or load_end <= load_start:
    raise SystemExit("loadData section not found")
new_load = r'''async function loadData(silent = false) {
  if (!state.auth) {
    connection(false);
    empty("กรุณาเข้าสู่ระบบเพื่อดูข้อมูลเส้นทาง MS");
    return;
  }
  if (state.loading) return;
  state.loading = true;
  if (!silent) el("loading-state").classList.remove("hidden");
  try {
    const result = await apiGet("msRoutes", { branch: state.branch });
    applyLiveResult(result, false);
    ensureRealtimeTransport();
  } catch (error) {
    state.transportFailures = Number(state.transportFailures || 0) + 1;
    const recentlyHealthy =
      Number(state.transportLastOkAt || 0) > 0 &&
      Date.now() - Number(state.transportLastOkAt) <= CONFIG.staleMs;
    connection(Boolean(recentlyHealthy));
    if (!silent) {
      if (recentlyHealthy)
        toast(`เครือข่ายสะดุดชั่วคราว · ใช้ข้อมูลล่าสุดและกำลังลองใหม่: ${error.message}`, true);
      else empty(`โหลดข้อมูลไม่สำเร็จ: ${error.message}`);
    }
  } finally {
    state.loading = false;
  }
}

function applyLiveResult(result, fromStream = false) {
  resetLowerDailyViewOnBangkokDayChange();
  if (Array.isArray(result?.rows)) {
    state.currentRows = result.rows;
    for (const row of state.currentRows) {
      const routeId = String(row.id || row.proofId || "");
      if (routeId && row.queueCancelledAt) state.cancelledRouteIds.add(routeId);
    }
  }
  if (result?.completedToday !== undefined)
    state.completedToday = Number(result.completedToday) || 0;
  // MS_DAILY_HISTORY_V1: realtime transport never grows or reads historical rows.
  state.rows = state.archiveView ? state.archiveRows : state.currentRows;
  if (result?.branch) state.branch = result.branch;
  if (Array.isArray(result?.standards))
    state.standards = Object.fromEntries(
      result.standards.map((item) => [
        normalizeVehicle(item.type),
        Number(item.minutes) || 120,
      ]),
    );
  if (Array.isArray(result?.branches)) fillBranches(result.branches);
  if (result?.lastSync !== undefined) state.lastSync = result.lastSync || "";
  if (result?.msStatus !== undefined) state.msStatus = result.msStatus || "";
  if (result?.syncError !== undefined) state.syncError = result.syncError || "";
  state.transportLastOkAt = Date.now();
  state.transportFailures = 0;
  fillFilters();
  connection(state.msStatus !== "error" && state.msStatus !== "not_configured");
  if (!fromStream && state.syncError && state.msStatus !== "degraded")
    toast(state.syncError, true);
  el("last-refresh").textContent =
    state.msStatus === "degraded"
      ? "MS ตอบช้าชั่วคราว · แสดงข้อมูลล่าสุด · กำลังลองใหม่ทุก 4 วินาที"
      : `อัปเดตล่าสุด ${dtf.format(new Date())} น. · ตรวจสถานะใหม่ทุก 4 วินาที`;
  render();
  const zeroProbeKey = completedTodayDatasetKey();
  if (state.completedToday === 0 && completedTodayZeroProbedKey !== zeroProbeKey) {
    completedTodayZeroProbedKey = zeroProbeKey;
    const probeBranch = state.branch;
    void loadCompletedTodayRows(true)
      .then(() => {
        if (state.auth && state.branch === probeBranch) render();
      })
      .catch(() => {});
  }
  if (shouldHydrateCompletedTodayRows()) {
    const hydrationBranch = state.branch;
    void loadCompletedTodayRows(false)
      .then(() => {
        if (state.auth && state.branch === hydrationBranch) render();
      })
      .catch(() => {});
  }
  // DEV: completed-today detail hydrates only when the lightweight daily total changes.
  // DEV: archive stays lazy; realtime transport never auto-reads msArchive.
}
'''
ms = ms[:load_start] + new_load + ms[load_end:]
ms_path.write_text(ms)


# -----------------------------------------------------------------------------
# worker/src/index.js — settings cache/coalesce with immediate save invalidation.
# -----------------------------------------------------------------------------
worker_path = Path("worker/src/index.js")
worker = worker_path.read_text()
if "HUB_SETTINGS_CACHE_V1" in worker:
    raise SystemExit("HUB_SETTINGS_CACHE_V1 already exists; refusing duplicate source")
read_start = worker.index("async function readSettings(env, branch) {")
read_end = worker.index("\nasync function saveSettings(body, actor, env) {", read_start)
if read_start < 0 or read_end <= read_start:
    raise SystemExit("readSettings section not found")
new_settings = r'''// HUB_SETTINGS_CACHE_V1: settings do not change at realtime cadence.
// Cache/coalesce per HUB for 60 seconds and invalidate immediately on save.
const HUB_SETTINGS_CACHE_MS = 60 * 1000;
const hubSettingsCache = new Map();
const hubSettingsActive = new Map();
function invalidateHubSettings(branch) {
  hubSettingsCache.delete(String(branch || "").toUpperCase());
}

async function readSettings(env, branch) {
  const key = String(branch || "").toUpperCase();
  const now = Date.now();
  const cached = hubSettingsCache.get(key);
  if (cached?.until > now) return cached.value;
  if (cached) hubSettingsCache.delete(key);
  if (hubSettingsActive.has(key)) return hubSettingsActive.get(key);
  const task = (async () => {
    const rows = (
      await env.DB.prepare(
        "SELECT * FROM hub_settings WHERE branch=? AND enabled=1 ORDER BY category,setting_key",
      )
        .bind(key)
        .all()
    ).results;
    const central = CENTRAL_LIMITS[key] || [],
      queue = rows.filter((x) => x.category === "vehicle"),
      ms = rows.filter((x) => x.category === "ms_vehicle"),
      pauses = rows.filter((x) => x.category === "pause");
    return {
      branch: key,
      pauseWindows: pauses.length
        ? pauses.map((x) => ({
            key: x.setting_key,
            label: x.label,
            startHour: x.start_hour,
            endHour: x.end_hour,
          }))
        : rows.length
          ? []
          : PAUSES.map((x) => ({
              key: x[0], label: x[1], startHour: x[2], endHour: x[3],
            })),
      vehicleLimits: queue.length
        ? queue.map((x) => ({ type: x.setting_key, minutes: x.minutes }))
        : LIMITS.map((type) => ({ type, minutes: 120 })),
      msVehicleLimits: ms.length
        ? ms.map((x) => ({ type: x.setting_key, minutes: x.minutes }))
        : LIMITS.map((type, i) => ({ type, minutes: central[i] || 120 })),
    };
  })()
    .then((value) => {
      hubSettingsCache.set(key, { until: Date.now() + HUB_SETTINGS_CACHE_MS, value });
      return value;
    })
    .finally(() => hubSettingsActive.delete(key));
  hubSettingsActive.set(key, task);
  return task;
}
'''
worker = worker[:read_start] + new_settings + worker[read_end:]
worker = replace_once(
    worker,
    "  await env.DB.batch(s);\n  return readSettings(env, branch);",
    "  await env.DB.batch(s);\n  invalidateHubSettings(branch);\n  return readSettings(env, branch);",
    "settings cache invalidation",
)
worker_path.write_text(worker)


# -----------------------------------------------------------------------------
# proof-control.js — background unchanged cron = zero Turso writes.
# -----------------------------------------------------------------------------
proof_path = Path("worker/src/proof-control.js")
proof = proof_path.read_text()
if "PROOF_UNCHANGED_CRON_WRITE_ZERO_V1" in proof:
    raise SystemExit("proof quota guard already exists")
proof = replace_once(
    proof,
    "    const sourceHash = await sha(JSON.stringify(mapped));",
    "    // PROOF_SOURCE_HASH_V2: total-only changes count as source changes too.\n    const sourceHash = await sha(JSON.stringify({ total: upstream.total, rows: mapped }));",
    "proof source hash",
)
proof = replace_once(
    proof,
    """    if (current?.source_hash === sourceHash) {\n      await env.DB.prepare(\n        'UPDATE ms_proof_snapshots SET total_count=?,checked_at=? WHERE hub=? AND business_day=?',\n      ).bind(upstream.total, now, hub, day).run();\n      return {""",
    """    if (current?.source_hash === sourceHash) {\n      // PROOF_UNCHANGED_CRON_WRITE_ZERO_V1: background cron never writes an\n      // unchanged snapshot. Interactive reads keep checked_at for the existing\n      // 60-second shared proof freshness window.\n      if (!force)\n        await env.DB.prepare(\n          'UPDATE ms_proof_snapshots SET total_count=?,checked_at=? WHERE hub=? AND business_day=?',\n        ).bind(upstream.total, now, hub, day).run();\n      return {""",
    "proof unchanged write guard",
)
proof_path.write_text(proof)


# -----------------------------------------------------------------------------
# Existing DO generator — add hibernatable WebSocket to the existing coordinator.
# No additional runtime patch chain is introduced.
# -----------------------------------------------------------------------------
durable_path = Path(".github/dev-tools/patch-ms-durable-coordinator.mjs")
durable = durable_path.read_text()
if "MS_REALTIME_WS_V1" in durable:
    raise SystemExit("realtime websocket already exists in durable generator")

durable = replace_once(
    durable,
    '''      `  async fetch(request, env) {\\n    try {\\n      // MS_ORIGIN_LH_MANIFEST_V1: wrap DEV assets only; no Production path is changed.\\n      env = wrapOriginManifestAssets(env);\\n      const url = new URL(request.url);`,''',
    '''      `  async fetch(request, env) {\\n    try {\\n      // MS_ORIGIN_LH_MANIFEST_V1: wrap DEV assets only; no Production path is changed.\\n      env = wrapOriginManifestAssets(env);\\n      const url = new URL(request.url);\\n      // MS_REALTIME_WS_V1: upgrade before the normal JSON GET wrapper.\\n      if (request.method === "GET" && url.searchParams.get("action") === "msStream" && String(request.headers.get("Upgrade") || "").toLowerCase() === "websocket")\\n        return msRealtimeStream(request, url, env);`,''',
    "worker websocket route",
)

refresh_anchor = '''      `async function refreshMsIfStale(env, actor, branch, force = false) {\\n  if (!access(branch, actor)) return { status: "forbidden" };\\n  const nowMs = Date.now(), recent = recentMsSync.get(branch);\\n  if (!force && recent?.until > nowMs) return recent.result;\\n  if (activeMsSync.has(branch)) return activeMsSync.get(branch);\\n\\n  if (env.MS_REFRESH_COORDINATOR) {'''
stream_prefix = '''      `async function msRealtimeStream(request, url, env) {\\n  const actor = await verify(url.searchParams.get("token"), env);\\n  const branch = pickBranch(actor, url.searchParams.get("branch"));\\n  if (!env.MS_REFRESH_COORDINATOR) fail("Realtime coordinator ไม่พร้อมใช้งาน", "MS_STREAM_UNAVAILABLE", 503);\\n  const id = env.MS_REFRESH_COORDINATOR.idFromName(branch);\\n  const stub = env.MS_REFRESH_COORDINATOR.get(id);\\n  const target = new URL("https://ms-refresh.internal/stream");\\n  target.searchParams.set("branch", branch);\\n  return stub.fetch(new Request(target, request));\\n}\\n\\nasync function refreshMsIfStale(env, actor, branch, force = false) {\\n  if (!access(branch, actor)) return { status: "forbidden" };\\n  const nowMs = Date.now(), recent = recentMsSync.get(branch);\\n  if (!force && recent?.until > nowMs) return recent.result;\\n  if (activeMsSync.has(branch)) return activeMsSync.get(branch);\\n\\n  if (env.MS_REFRESH_COORDINATOR) {'''
durable = replace_once(durable, refresh_anchor, stream_prefix, "insert websocket stream handler")

durable = replace_once(
    durable,
    '''    if (url.pathname.startsWith("/origin-manifest/"))\\n      return this.originManifest.fetch(request);\\n    const branch = String(url.searchParams.get("branch") || "").trim().toUpperCase();''',
    '''    if (url.pathname.startsWith("/origin-manifest/"))\\n      return this.originManifest.fetch(request);\\n    const branch = String(url.searchParams.get("branch") || "").trim().toUpperCase();\\n    if (url.pathname === "/stream") return this.openStream(request, branch);''',
    "coordinator stream dispatch",
)

ws_methods = r'''  async openStream(request, branch) {
    if (!branch) return new Response("missing branch", { status: 400 });
    if (String(request.headers.get("Upgrade") || "").toLowerCase() !== "websocket")
      return new Response("expected websocket", { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const leader = this.ctx.getWebSockets().length === 0;
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ branch, leader });
    server.send(JSON.stringify({ type: "role", leader }));
    this.ctx.waitUntil(this.pushSnapshot(server, branch).catch((error) => {
      try {
        server.send(JSON.stringify({
          type: "error",
          code: error?.code || "MS_STREAM_ERROR",
          message: error?.message || "Realtime stream ขัดข้อง",
        }));
      } catch {}
    }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async streamPayload(branch) {
    const live = await this.refresh(branch, false, false);
    const settings = await readSettings(this.env, branch);
    return {
      type: "snapshot",
      rows: Array.isArray(live?.rows) ? live.rows : null,
      completedToday: Number(live?.completedToday) || 0,
      standards: settings.msVehicleLimits,
      lastSync: live?.syncedAt || "",
      msStatus: live?.status || "",
      syncError: live?.error || "",
      pollMs: 4000,
    };
  }

  async pushSnapshot(ws, branch) {
    ws.send(JSON.stringify(await this.streamPayload(branch)));
  }

  async broadcastSnapshot(branch) {
    const payload = JSON.stringify(await this.streamPayload(branch));
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment?.() || {};
      if (String(attachment.branch || "").toUpperCase() !== branch) continue;
      try { socket.send(payload); } catch {}
    }
  }

  async webSocketMessage(ws, message) {
    const attachment = ws.deserializeAttachment?.() || {};
    const branch = String(attachment.branch || "").trim().toUpperCase();
    if (!branch) {
      try { ws.close(1008, "missing branch"); } catch {}
      return;
    }
    let payload = {};
    try { payload = JSON.parse(String(message || "{}")); } catch {}
    try {
      const actor = await verify(payload?.token, this.env);
      if (!access(branch, actor)) fail("ไม่มีสิทธิ์ดูข้อมูล HUB นี้", "FORBIDDEN", 403);
      if (payload?.type === "auth") {
        ws.send(JSON.stringify({ type: "auth_ok" }));
        return;
      }
      if (payload?.type !== "refresh") return;
      await this.broadcastSnapshot(branch);
    } catch (error) {
      const code = error?.code || "MS_STREAM_ERROR";
      try {
        ws.send(JSON.stringify({
          type: code === "INVALID_SESSION" || code === "FORBIDDEN" ? "auth_error" : "error",
          code,
          message: error?.message || "Realtime stream ขัดข้อง",
        }));
      } catch {}
      if (code === "INVALID_SESSION" || code === "FORBIDDEN")
        try { ws.close(1008, "auth"); } catch {}
    }
  }

  webSocketClose(ws, code, reason) {
    const attachment = ws.deserializeAttachment?.() || {};
    const wasLeader = attachment.leader === true;
    try { ws.close(code, reason); } catch {}
    if (!wasLeader) return;
    const next = this.ctx.getWebSockets().find((socket) => socket !== ws);
    if (!next) return;
    const nextAttachment = next.deserializeAttachment?.() || {};
    nextAttachment.leader = true;
    next.serializeAttachment(nextAttachment);
    try { next.send(JSON.stringify({ type: "role", leader: true })); } catch {}
  }

  webSocketError(ws) {
    try { ws.close(1011, "stream error"); } catch {}
  }

'''.replace("\n", "\\n")
durable = replace_once(
    durable,
    '  async refresh(branch, force = false, cron = false) {\\n',
    ws_methods + '  async refresh(branch, force = false, cron = false) {\\n',
    "coordinator websocket methods",
)
durable_path.write_text(durable)


# -----------------------------------------------------------------------------
# Turso DEV wrapper must forward hibernated WebSocket events.
# -----------------------------------------------------------------------------
turso_path = Path("worker/src/turso-index.js")
turso = turso_path.read_text()
turso = replace_once(
    turso,
    '  fetch(request) { return this.inner.fetch(request); }\n}',
    '''  fetch(request) { return this.inner.fetch(request); }\n  webSocketMessage(ws, message) { return this.inner.webSocketMessage(ws, message); }\n  webSocketClose(ws, code, reason, wasClean) { return this.inner.webSocketClose(ws, code, reason, wasClean); }\n  webSocketError(ws, error) { return this.inner.webSocketError(ws, error); }\n}''',
    "Turso wrapper websocket proxy",
)
turso_path.write_text(turso)


# -----------------------------------------------------------------------------
# Permanent regression test and deploy/acceptance gates.
# -----------------------------------------------------------------------------
test_path = Path(".github/dev-tools/realtime-quota-hardening.test.mjs")
if test_path.exists():
    raise SystemExit("realtime quota hardening test already exists")
test_path.write_text(r'''import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { stageWorker } from "./stage-dev-runtime.mjs";

const worker = fs.readFileSync(new URL("../../worker/src/index.js", import.meta.url), "utf8");
const front = fs.readFileSync(new URL("../../ms.js", import.meta.url), "utf8");
const proof = fs.readFileSync(new URL("../../worker/src/proof-control.js", import.meta.url), "utf8");
const turso = fs.readFileSync(new URL("../../worker/src/turso-index.js", import.meta.url), "utf8");
const browser = fs.readFileSync(new URL("../../cloudflare-browser-test/src/index.js", import.meta.url), "utf8");
const staged = stageWorker(worker);

test("visible realtime stays four seconds while direct HTTP 4s polling is removed", () => {
  assert.match(front, /pollMs:\s*4000/);
  assert.match(front, /MS_REALTIME_WS_V1/);
  assert.match(front, /setInterval\(realtimeTick, CONFIG\.pollMs\)/);
  assert.doesNotMatch(front, /setInterval\(\(\) => state\.auth && loadData\(true\), CONFIG\.pollMs\)/);
  assert.match(front, /new WebSocket\(realtimeSocketUrl\(\)\)/);
  assert.match(front, /visibilitychange/);
  assert.match(front, /REALTIME_AUTH_HEARTBEAT_MS = 60 \* 1000/);
});

test("staged per-HUB coordinator uses hibernatable WebSocket broadcast", () => {
  assert.match(staged, /MS_REALTIME_WS_V1/);
  assert.match(staged, /msStream/);
  assert.match(staged, /this\.ctx\.acceptWebSocket\(server\)/);
  assert.match(staged, /server\.serializeAttachment\(\{ branch, leader \}\)/);
  assert.match(staged, /async webSocketMessage\(ws, message\)/);
  assert.match(staged, /await verify\(payload\?\.token, this\.env\)/);
  assert.match(staged, /async broadcastSnapshot\(branch\)/);
  assert.match(turso, /webSocketMessage\(ws, message\).*this\.inner\.webSocketMessage/s);
});

test("hub settings reads are cached/coalesced and save invalidates immediately", () => {
  assert.match(worker, /HUB_SETTINGS_CACHE_V1/);
  assert.match(worker, /HUB_SETTINGS_CACHE_MS = 60 \* 1000/);
  assert.match(worker, /hubSettingsActive\.has\(key\)/);
  assert.match(worker, /hubSettingsCache\.set\(key/);
  assert.match(worker, /invalidateHubSettings\(branch\);\s*return readSettings\(env, branch\);/);
});

test("unchanged proof background cron performs no Turso write", () => {
  assert.match(proof, /PROOF_UNCHANGED_CRON_WRITE_ZERO_V1/);
  assert.match(proof, /PROOF_SOURCE_HASH_V2/);
  assert.match(proof, /JSON\.stringify\(\{ total: upstream\.total, rows: mapped \}\)/);
  assert.match(proof, /if \(!force\)\s*await env\.DB\.prepare/);
});

test("TBR current source already uses one Bus cache call and dynamic accounting", () => {
  assert.match(browser, /TBR_BUS_SINGLE_CACHE_CALL_V11/);
  assert.match(browser, /return \[bangkokSourceDay\(nowMs, 0\)\]/);
  assert.match(browser, /const pointReads = 2 \* \(/);
  assert.match(browser, /currentSteadyStateTursoPointReadsPerCron: currentSteadyStateReads/);
  assert.match(browser, /tursoPointReadsPerCron: pointReads/);
});

test("HBI stays click-only and outside realtime refresh", () => {
  assert.match(worker, /HBI_PHOTO_ON_DEMAND_V1/);
  const refresh = staged.slice(staged.indexOf("async function runMsRefresh"), staged.indexOf("async function readMsLiveCache"));
  assert.doesNotMatch(refresh, /readHbiTruckPhotos|msTruckPhotos/);
  assert.match(front, /apiGetOnce\("msTruckPhotos"/);
});
''')

deploy_path = Path(".github/workflows/deploy-worker-dev.yml")
deploy = deploy_path.read_text()
deploy = replace_once(
    deploy,
    "      - run: node --test ../.github/dev-tools/ms-quota-safe-live.test.mjs\n",
    "      - run: node --test ../.github/dev-tools/ms-quota-safe-live.test.mjs\n      - run: node --test ../.github/dev-tools/realtime-quota-hardening.test.mjs\n",
    "deploy permanent quota test",
)
deploy_path.write_text(deploy)

accept_path = Path(".github/workflows/current-system-acceptance.yml")
accept = accept_path.read_text()
needle = "              if(!/pollMs:\\s*4000/.test(js)) throw new Error(`${name} polling is not 4000 ms`);\n"
replacement = needle + "              if(!js.includes('MS_REALTIME_WS_V1')) throw new Error(`${name} realtime WebSocket transport missing`);\n              if(!/setInterval\\(realtimeTick,\\s*CONFIG\\.pollMs\\)/.test(js)) throw new Error(`${name} realtime 4s ticker missing`);\n              if(/setInterval\\(\\(\\) => state\\.auth && loadData\\(true\\), CONFIG\\.pollMs\\)/.test(js)) throw new Error(`${name} still performs direct HTTP polling every 4s`);\n"
accept = replace_once(accept, needle, replacement, "acceptance realtime checks")
accept_path.write_text(accept)

print("REALTIME_QUOTA_SOURCE_TRANSFORM=PASS")
