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
const TBR_HEALTH_MARKER = "TBR_INTELLIGENCE_HEALTH_GATE_V1";

export function patchDevDurableCoordinator(source) {
  let output = String(source || "");

  if (!output.includes('from "./origin-manifest-v1.js"')) {
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
      `  async fetch(request, env) {\n    try {\n      // MS_ORIGIN_LH_MANIFEST_V1: wrap DEV assets only; no Production path is changed.\n      env = wrapOriginManifestAssets(env);\n      const url = new URL(request.url);`,
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

  if (!output.includes(TBR_HEALTH_MARKER)) {
    output = replaceUnique(
      output,
      `      msStatus: live.status,\n      syncError: live.error || "",`,
      `      msStatus: live.status,\n      syncError: live.error || "",\n      // ${TBR_HEALTH_MARKER}: compact per-HUB health rides inside the existing msRoutes payload.\n      // It never triggers an Intelligence/API/MS/DB request from the browser.\n      tbrIntelligenceHealth:\n        live.tbrIntelligenceHealth ||\n        { hub: branch, allowed: false, reason: "NO_INTELLIGENCE_HEALTH" },`,
      "piggyback TBR health into existing msRoutes response",
    );

    output = replaceUnique(
      output,
      `  const result = await refreshMsIfStale(env, { username: "MS_CRON", role: "admin", branches: ["*"] }, hub);`,
      `  const result = await refreshMsIfStale(\n    env,\n    { username: "MS_CRON", role: "admin", branches: ["*"] },\n    hub,\n    false,\n    body.tbrIntelligenceHealth,\n  );`,
      "piggyback Browser Intelligence health through existing connector refresh",
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
      `// ${TBR_HEALTH_MARKER}: fail-closed, per-HUB Intelligence gate. The Browser Worker\n// supplies this compact object on connectorSync calls that already exist. It is\n// kept only in the per-HUB Durable Object memory: zero Turso writes and zero new\n// Worker/MS polling. A DO restart simply falls back to Route until the next cron.\nconst TBR_INTELLIGENCE_HEALTH_MAX_AGE_MS = 3 * 60 * 1000;\nconst TBR_INTELLIGENCE_HEALTH_FUTURE_MS = 90 * 1000;\nfunction normalizeTbrIntelligenceHealth(value, branch, nowMs = Date.now()) {\n  const hub = text(branch, 80).toUpperCase();\n  const source = value && typeof value === "object" ? value : {};\n  const sourceHub = text(source.hub, 80).toUpperCase();\n  const observedAt = text(source.observedAt, 100);\n  const observedMs = Date.parse(observedAt);\n  const ageMs = Number.isFinite(observedMs) ? nowMs - observedMs : null;\n  const fresh =\n    ageMs !== null &&\n    ageMs >= -TBR_INTELLIGENCE_HEALTH_FUTURE_MS &&\n    ageMs <= TBR_INTELLIGENCE_HEALTH_MAX_AGE_MS;\n  const readinessStatus = text(source.readinessStatus, 80);\n  const readinessOk = ["ADVISORY_READY", "PRODUCTION_CANDIDATE"].includes(readinessStatus);\n  const observerLive = text(source.observerStatus, 40) === "LIVE";\n  const sourceAvailable = source.sourceAvailable === true;\n  const routeFallback = source.routeFallback === true;\n  const hubMatches = Boolean(hub && sourceHub === hub);\n  const allowed = Boolean(\n    source.allowed === true &&\n    source.advisoryAllowedNow === true &&\n    hubMatches &&\n    fresh &&\n    readinessOk &&\n    observerLive &&\n    sourceAvailable &&\n    !routeFallback\n  );\n  let reason = text(source.reason, 80) || "NO_INTELLIGENCE_HEALTH";\n  if (!hubMatches) reason = "HUB_MISMATCH";\n  else if (!readinessOk || source.advisoryAllowedNow !== true) reason = "INTELLIGENCE_NOT_READY";\n  else if (!observerLive) reason = "OBSERVER_NOT_LIVE";\n  else if (!sourceAvailable) reason = "SOURCE_UNAVAILABLE";\n  else if (routeFallback) reason = "ROUTE_FALLBACK";\n  else if (!fresh) reason = "STALE_HEALTH";\n  else if (allowed) reason = "READY";\n  return {\n    version: 1,\n    hub,\n    allowed,\n    reason,\n    observedAt,\n    observerStatus: text(source.observerStatus, 40),\n    sourceAvailable,\n    routeFallback,\n    readinessStatus,\n    readinessScore: numberOrNull(source.readinessScore),\n    advisoryAllowedNow: source.advisoryAllowedNow === true,\n    extraMsPolling: 0,\n    tursoReads: 0,\n    tursoWrites: 0,\n  };\n}\n\nasync function refreshMsIfStale(\n  env,\n  actor,\n  branch,\n  force = false,\n  tbrIntelligenceHealth = null,\n) {\n  if (!access(branch, actor)) return { status: "forbidden" };\n  const nowMs = Date.now(), recent = recentMsSync.get(branch);\n  if (!force && recent?.until > nowMs && !tbrIntelligenceHealth) return recent.result;\n  if (activeMsSync.has(branch) && !tbrIntelligenceHealth) return activeMsSync.get(branch);\n\n  if (env.MS_REFRESH_COORDINATOR) {\n    const id = env.MS_REFRESH_COORDINATOR.idFromName(branch);\n    const stub = env.MS_REFRESH_COORDINATOR.get(id);\n    const url = new URL("https://ms-refresh.internal/refresh");\n    url.searchParams.set("branch", branch);\n    if (force) url.searchParams.set("force", "1");\n    const response = tbrIntelligenceHealth\n      ? await stub.fetch(\n          new Request(url, {\n            method: "POST",\n            headers: { "content-type": "application/json" },\n            body: JSON.stringify({ tbrIntelligenceHealth }),\n          }),\n        )\n      : await stub.fetch(new Request(url));\n    if (!response.ok) {\n      const error = new Error("ตัวประสานการอัปเดต MS ตอบกลับผิดพลาด");\n      error.code = "MS_COORDINATOR_ERROR";\n      throw error;\n    }\n    const result = await response.json();\n    recentMsSync.set(branch, { until: Date.now() + MS_SYNC_TTL, result });\n    return result;\n  }\n\n  const task = runMsRefresh(env, branch).finally(() => activeMsSync.delete(branch));\n  activeMsSync.set(branch, task);\n  return task;\n}\n\nexport class MsRefreshCoordinator {\n  constructor(ctx, env) {\n    this.ctx = ctx;\n    this.env = env;\n    this.active = null;\n    this.lastResult = null;\n    this.recentUntil = 0;\n    this.lastSourceAt = 0;\n    this.tbrIntelligenceHealth = null;\n    this.originManifest = new OriginManifestCoordinator(ctx, env);\n  }\n\n  async fetch(request) {\n    const url = new URL(request.url);\n    if (url.pathname.startsWith("/origin-manifest/"))\n      return this.originManifest.fetch(request);\n    const branch = String(url.searchParams.get("branch") || "").trim().toUpperCase();\n    const force = url.searchParams.get("force") === "1";\n    const cron = url.searchParams.get("cron") === "1";\n    if (!branch)\n      return Response.json(\n        { status: "error", error: "missing branch" },\n        { status: 400 },\n      );\n    if (request.method === "POST") {\n      const body = await request.json().catch(() => ({}));\n      if (body?.tbrIntelligenceHealth)\n        this.tbrIntelligenceHealth = normalizeTbrIntelligenceHealth(\n          body.tbrIntelligenceHealth,\n          branch,\n        );\n    }\n    const result = await this.refresh(branch, force, cron);\n    return Response.json({\n      ...result,\n      tbrIntelligenceHealth: this.currentTbrIntelligenceHealth(branch),\n    });\n  }\n\n  currentTbrIntelligenceHealth(branch, nowMs = Date.now()) {\n    return normalizeTbrIntelligenceHealth(\n      this.tbrIntelligenceHealth,\n      branch,\n      nowMs,\n    );\n  }\n\n  async refresh(branch, force = false, cron = false) {\n    const nowMs = Date.now();\n    if (\n      cron &&\n      this.lastResult &&\n      nowMs - this.lastSourceAt < MS_CRON_ACTIVE_SKIP_MS\n    )\n      return { ...this.lastResult, cronSkipped: true };\n    if (!force && this.lastResult && this.recentUntil > nowMs)\n      return this.lastResult;\n\n    if (this.active) {\n      if (!force && this.lastResult) return this.lastResult;\n      try {\n        await this.active;\n      } catch {}\n      if (!force && this.lastResult && this.recentUntil > Date.now())\n        return this.lastResult;\n    }\n\n    const task = runMsRefresh(this.env, branch)\n      .then((result) => {\n        this.lastResult = result;\n        this.lastSourceAt = Date.now();\n        this.recentUntil = Date.now() + MS_SYNC_TTL;\n        return result;\n      })\n      .finally(() => {\n        if (this.active === task) this.active = null;\n      });\n    this.active = task;\n    return task;\n  }\n}`,
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
