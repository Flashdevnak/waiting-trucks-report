import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`DEV Durable Object coordinator patch failed: ${label}`);
  return output.replace(from, to);
}

const ORIGIN_IMPORT = `import {\n  OriginManifestCoordinator,\n  originManifestLive,\n  originManifestStatus,\n  saveOriginManifestConnection,\n  wrapOriginManifestAssets,\n} from "./origin-manifest-v1.js";\n`;
const MS_CRON_MARKER = "MS_CRON_LIVE_REFRESH_V1";

export function patchDevDurableCoordinator(source) {
  let output = String(source || "");

  if (!output.includes("OriginManifestCoordinator")) {
    const firstImport = `import { canonicalMsSource, planMsChanges } from "./sync-policy.js";\n`;
    output = replaceUnique(
      output,
      firstImport,
      `${ORIGIN_IMPORT}${firstImport}`,
      "origin manifest module import",
    );
  }

  if (!output.includes("wrapOriginManifestAssets(env)")) {
    output = replaceUnique(
      output,
      `  async fetch(request, env) {\n    try {\n      const url = new URL(request.url);`,
      `  async fetch(request, env) {\n    try {\n      // MS_ORIGIN_LH_MANIFEST_V1: wrap DEV assets only; no Production path is changed.\n      env = wrapOriginManifestAssets(env);\n      const url = new URL(request.url);\n      // MS_REALTIME_WS_V1: upgrade before the normal JSON GET wrapper.\n      if (request.method === "GET" && url.searchParams.get("action") === "msStream" && String(request.headers.get("Upgrade") || "").toLowerCase() === "websocket")\n        return msRealtimeStream(request, url, env);`,
      "wrap staged MS frontend asset",
    );
  }

  if (!output.includes('action === "msOriginManifestStatus"')) {
    output = replaceUnique(
      output,
      `  const actor = await verify(url.searchParams.get("token"), env);\n  if (action === "list") return ok(await scoped(env, "active_trucks", actor));`,
      `  const actor = await verify(url.searchParams.get("token"), env);\n  if (action === "msOriginManifestStatus")\n    return ok(await originManifestStatus(\n      env,\n      actor,\n      pickBranch(actor, url.searchParams.get("branch")),\n    ));\n  if (action === "msOriginManifestLive")\n    return ok(await originManifestLive(\n      env,\n      actor,\n      pickBranch(actor, url.searchParams.get("branch")),\n      url.searchParams.get("days"),\n    ));\n  if (action === "list") return ok(await scoped(env, "active_trucks", actor));`,
      "origin manifest GET actions",
    );
  }

  if (!output.includes('action === "saveMsOriginManifestConnection"')) {
    // Keep the verify+import pair untouched because the route-cancellation patch
    // runs after this patch and deliberately anchors on that exact pair.
    output = replaceUnique(
      output,
      `  if (action === "import") return ok(await importRows(body, actor, env));\n  if (action === "start") return ok(await work(body.id, actor, env, true));`,
      `  if (action === "import") return ok(await importRows(body, actor, env));\n  if (action === "saveMsOriginManifestConnection")\n    return ok(await saveOriginManifestConnection(\n      env,\n      actor,\n      pickBranch(actor, body.hub),\n      body.credentials,\n    ));\n  if (action === "start") return ok(await work(body.id, actor, env, true));`,
      "origin manifest save action after import compatibility anchor",
    );
  }

  if (!output.includes(MS_CRON_MARKER)) {
    output = replaceUnique(
      output,
      `async function runMsRefresh(env, branch) {`,
      `// ${MS_CRON_MARKER}: the existing one-minute Worker cron keeps the main MS\n// route source alive even when every browser is closed. It reuses the same\n// per-HUB Durable Object, so an actively polling browser suppresses the cron\n// read for 45 seconds instead of causing a duplicate upstream MS request.\nconst MS_CRON_ACTIVE_SKIP_MS = 45 * 1000;\n\nexport async function runMsScheduledRefresh(env) {\n  let rows = [];\n  try {\n    rows = (\n      await env.DB.prepare("SELECT hub FROM ms_connections ORDER BY hub").all()\n    ).results || [];\n  } catch (error) {\n    console.error(\n      JSON.stringify({\n        event: "ms_cron_connection_list_error",\n        message: error.message || String(error),\n      }),\n    );\n    return;\n  }\n\n  const actor = { username: "MS_CRON", role: "admin", branches: ["*"] };\n  for (const row of rows.slice(0, 20)) {\n    const branch = text(row?.hub, 80).toUpperCase();\n    if (!branch) continue;\n    try {\n      if (env.MS_REFRESH_COORDINATOR) {\n        const id = env.MS_REFRESH_COORDINATOR.idFromName(branch);\n        const stub = env.MS_REFRESH_COORDINATOR.get(id);\n        const url = new URL("https://ms-refresh.internal/refresh");\n        url.searchParams.set("branch", branch);\n        url.searchParams.set("cron", "1");\n        const response = await stub.fetch(new Request(url));\n        if (!response.ok) {\n          const error = new Error("ตัวประสาน Cron MS ตอบกลับผิดพลาด");\n          error.code = "MS_CRON_COORDINATOR_ERROR";\n          throw error;\n        }\n      } else {\n        await refreshMsIfStale(env, actor, branch);\n      }\n    } catch (error) {\n      console.error(\n        JSON.stringify({\n          event: "ms_cron_sync_error",\n          hub: branch,\n          code: error.code || "MS_CRON_SYNC_FAILED",\n          message: error.message || String(error),\n        }),\n      );\n    }\n  }\n}\n\nasync function runMsRefresh(env, branch) {`,
      "one-minute browser-independent MS route cron",
    );
  }

  if (!output.includes("export class MsRefreshCoordinator")) {
    output = replaceUnique(
      output,
      `async function refreshMsIfStale(env, actor, branch, force = false) {\n  if (!access(branch, actor)) return { status: "forbidden" };\n  const nowMs = Date.now(), recent = recentMsSync.get(branch);\n  if (!force && recent?.until > nowMs) return recent.result;\n  if (activeMsSync.has(branch)) return activeMsSync.get(branch);\n  const task = runMsRefresh(env, branch).finally(() => activeMsSync.delete(branch));\n  activeMsSync.set(branch, task);\n  return task;\n}`,
      `async function msRealtimeStream(request, url, env) {\n  const actor = await verify(url.searchParams.get("token"), env);\n  const branch = pickBranch(actor, url.searchParams.get("branch"));\n  if (!env.MS_REFRESH_COORDINATOR) fail("Realtime coordinator ไม่พร้อมใช้งาน", "MS_STREAM_UNAVAILABLE", 503);\n  const id = env.MS_REFRESH_COORDINATOR.idFromName(branch);\n  const stub = env.MS_REFRESH_COORDINATOR.get(id);\n  const target = new URL("https://ms-refresh.internal/stream");\n  target.searchParams.set("branch", branch);\n  return stub.fetch(new Request(target, request));\n}\n\nasync function refreshMsIfStale(env, actor, branch, force = false) {\n  if (!access(branch, actor)) return { status: "forbidden" };\n  const nowMs = Date.now(), recent = recentMsSync.get(branch);\n  if (!force && recent?.until > nowMs) return recent.result;\n  if (activeMsSync.has(branch)) return activeMsSync.get(branch);\n\n  if (env.MS_REFRESH_COORDINATOR) {\n    const id = env.MS_REFRESH_COORDINATOR.idFromName(branch);\n    const stub = env.MS_REFRESH_COORDINATOR.get(id);\n    const url = new URL("https://ms-refresh.internal/refresh");\n    url.searchParams.set("branch", branch);\n    if (force) url.searchParams.set("force", "1");\n    const response = await stub.fetch(new Request(url));\n    if (!response.ok) {\n      const error = new Error("ตัวประสานการอัปเดต MS ตอบกลับผิดพลาด");\n      error.code = "MS_COORDINATOR_ERROR";\n      throw error;\n    }\n    const result = await response.json();\n    recentMsSync.set(branch, { until: Date.now() + MS_SYNC_TTL, result });\n    return result;\n  }\n\n  const task = runMsRefresh(env, branch).finally(() => activeMsSync.delete(branch));\n  activeMsSync.set(branch, task);\n  return task;\n}\n\nexport class MsRefreshCoordinator {\n  constructor(ctx, env) {\n    this.ctx = ctx;\n    this.env = env;\n    this.active = null;\n    this.lastResult = null;\n    this.recentUntil = 0;\n    this.lastSourceAt = 0;\n    this.originManifest = new OriginManifestCoordinator(ctx, env);\n  }\n\n  async fetch(request) {\n    const url = new URL(request.url);\n    if (url.pathname.startsWith("/origin-manifest/"))\n      return this.originManifest.fetch(request);\n    const branch = String(url.searchParams.get("branch") || "").trim().toUpperCase();\n    if (url.pathname === "/stream") return this.openStream(request, branch);\n    const force = url.searchParams.get("force") === "1";\n    const cron = url.searchParams.get("cron") === "1";\n    if (!branch)\n      return Response.json(\n        { status: "error", error: "missing branch" },\n        { status: 400 },\n      );\n    return Response.json(await this.refresh(branch, force, cron));\n  }\n\n  async openStream(request, branch) {\n    if (!branch) return new Response("missing branch", { status: 400 });\n    if (String(request.headers.get("Upgrade") || "").toLowerCase() !== "websocket")\n      return new Response("expected websocket", { status: 426 });\n    const pair = new WebSocketPair();\n    const [client, server] = Object.values(pair);\n    const leader = this.ctx.getWebSockets().length === 0;\n    this.ctx.acceptWebSocket(server);\n    server.serializeAttachment({ branch, leader });\n    server.send(JSON.stringify({ type: "role", leader }));\n    this.ctx.waitUntil(this.pushSnapshot(server, branch).catch((error) => {\n      try {\n        server.send(JSON.stringify({\n          type: "error",\n          code: error?.code || "MS_STREAM_ERROR",\n          message: error?.message || "Realtime stream ขัดข้อง",\n        }));\n      } catch {}\n    }));\n    return new Response(null, { status: 101, webSocket: client });\n  }\n\n  async streamPayload(branch) {\n    const live = await this.refresh(branch, false, false);\n    const settings = await readSettings(this.env, branch);\n    return {\n      type: "snapshot",\n      rows: Array.isArray(live?.rows) ? live.rows : null,\n      completedToday: Number(live?.completedToday) || 0,\n      standards: settings.msVehicleLimits,\n      lastSync: live?.syncedAt || "",\n      msStatus: live?.status || "",\n      syncError: live?.error || "",\n      pollMs: 4000,\n    };\n  }\n\n  async pushSnapshot(ws, branch) {\n    ws.send(JSON.stringify(await this.streamPayload(branch)));\n  }\n\n  async broadcastSnapshot(branch) {\n    const payload = JSON.stringify(await this.streamPayload(branch));\n    for (const socket of this.ctx.getWebSockets()) {\n      const attachment = socket.deserializeAttachment?.() || {};\n      if (String(attachment.branch || "").toUpperCase() !== branch) continue;\n      try { socket.send(payload); } catch {}\n    }\n  }\n\n  async webSocketMessage(ws, message) {\n    const attachment = ws.deserializeAttachment?.() || {};\n    const branch = String(attachment.branch || "").trim().toUpperCase();\n    if (!branch) {\n      try { ws.close(1008, "missing branch"); } catch {}\n      return;\n    }\n    let payload = {};\n    try { payload = JSON.parse(String(message || "{}")); } catch {}\n    try {\n      const actor = await verify(payload?.token, this.env);\n      if (!access(branch, actor)) fail("ไม่มีสิทธิ์ดูข้อมูล HUB นี้", "FORBIDDEN", 403);\n      if (payload?.type === "auth") {\n        ws.send(JSON.stringify({ type: "auth_ok" }));\n        return;\n      }\n      if (payload?.type !== "refresh") return;\n      await this.broadcastSnapshot(branch);\n    } catch (error) {\n      const code = error?.code || "MS_STREAM_ERROR";\n      try {\n        ws.send(JSON.stringify({\n          type: code === "INVALID_SESSION" || code === "FORBIDDEN" ? "auth_error" : "error",\n          code,\n          message: error?.message || "Realtime stream ขัดข้อง",\n        }));\n      } catch {}\n      if (code === "INVALID_SESSION" || code === "FORBIDDEN")\n        try { ws.close(1008, "auth"); } catch {}\n    }\n  }\n\n  webSocketClose(ws, code, reason) {\n    const attachment = ws.deserializeAttachment?.() || {};\n    const wasLeader = attachment.leader === true;\n    try { ws.close(code, reason); } catch {}\n    if (!wasLeader) return;\n    const next = this.ctx.getWebSockets().find((socket) => socket !== ws);\n    if (!next) return;\n    const nextAttachment = next.deserializeAttachment?.() || {};\n    nextAttachment.leader = true;\n    next.serializeAttachment(nextAttachment);\n    try { next.send(JSON.stringify({ type: "role", leader: true })); } catch {}\n  }\n\n  webSocketError(ws) {\n    try { ws.close(1011, "stream error"); } catch {}\n  }\n\n  async refresh(branch, force = false, cron = false) {\n    const nowMs = Date.now();\n    if (\n      cron &&\n      this.lastResult &&\n      nowMs - this.lastSourceAt < MS_CRON_ACTIVE_SKIP_MS\n    )\n      return { ...this.lastResult, cronSkipped: true };\n    if (!force && this.lastResult && this.recentUntil > nowMs)\n      return this.lastResult;\n\n    if (this.active) {\n      if (!force && this.lastResult) return this.lastResult;\n      try {\n        await this.active;\n      } catch {}\n      if (!force && this.lastResult && this.recentUntil > Date.now())\n        return this.lastResult;\n    }\n\n    const task = runMsRefresh(this.env, branch)\n      .then((result) => {\n        this.lastResult = result;\n        this.lastSourceAt = Date.now();\n        this.recentUntil = Date.now() + MS_SYNC_TTL;\n        return result;\n      })\n      .finally(() => {\n        if (this.active === task) this.active = null;\n      });\n    this.active = task;\n    return task;\n  }\n}`,
      "route refresh through a per-HUB Durable Object",
    );
  } else if (!output.includes("this.originManifest = new OriginManifestCoordinator")) {
    throw new Error("DEV Durable Object coordinator already staged without Origin Manifest V1");
  }

  return output;
}

const invokedPath = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (invokedPath) {
  const workerTarget = process.argv[2];
  if (!workerTarget)
    throw new Error(
      "Usage: node patch-ms-durable-coordinator.mjs <worker-index.js>",
    );
  const worker = await readFile(workerTarget, "utf8");
  await writeFile(workerTarget, patchDevDurableCoordinator(worker), "utf8");
  console.log(`Patched DEV Durable Object MS coordinator: ${workerTarget}`);
}
