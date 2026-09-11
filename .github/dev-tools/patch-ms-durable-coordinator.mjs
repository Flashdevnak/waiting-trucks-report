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
      `async function refreshMsIfStale(env, actor, branch, force = false) {\n  if (!access(branch, actor)) return { status: "forbidden" };\n  const nowMs = Date.now(), recent = recentMsSync.get(branch);\n  if (!force && recent?.until > nowMs) return recent.result;\n  if (activeMsSync.has(branch)) return activeMsSync.get(branch);\n\n  if (env.MS_REFRESH_COORDINATOR) {\n    const id = env.MS_REFRESH_COORDINATOR.idFromName(branch);\n    const stub = env.MS_REFRESH_COORDINATOR.get(id);\n    const url = new URL("https://ms-refresh.internal/refresh");\n    url.searchParams.set("branch", branch);\n    if (force) url.searchParams.set("force", "1");\n    const response = await stub.fetch(new Request(url));\n    if (!response.ok) {\n      const error = new Error("ตัวประสานการอัปเดต MS ตอบกลับผิดพลาด");\n      error.code = "MS_COORDINATOR_ERROR";\n      throw error;\n    }\n    const result = await response.json();\n    recentMsSync.set(branch, { until: Date.now() + MS_SYNC_TTL, result });\n    return result;\n  }\n\n  const task = runMsRefresh(env, branch).finally(() => activeMsSync.delete(branch));\n  activeMsSync.set(branch, task);\n  return task;\n}\n\nexport class MsRefreshCoordinator {\n  constructor(ctx, env) {\n    this.ctx = ctx;\n    this.env = env;\n    this.active = null;\n    this.lastResult = null;\n    this.recentUntil = 0;\n    this.lastSourceAt = 0;\n    this.originManifest = new OriginManifestCoordinator(ctx, env);\n  }\n\n  async fetch(request) {\n    const url = new URL(request.url);\n    if (url.pathname.startsWith("/origin-manifest/"))\n      return this.originManifest.fetch(request);\n    const branch = String(url.searchParams.get("branch") || "").trim().toUpperCase();\n    const force = url.searchParams.get("force") === "1";\n    const cron = url.searchParams.get("cron") === "1";\n    if (!branch)\n      return Response.json(\n        { status: "error", error: "missing branch" },\n        { status: 400 },\n      );\n    return Response.json(await this.refresh(branch, force, cron));\n  }\n\n  async refresh(branch, force = false, cron = false) {\n    const nowMs = Date.now();\n    if (\n      cron &&\n      this.lastResult &&\n      nowMs - this.lastSourceAt < MS_CRON_ACTIVE_SKIP_MS\n    )\n      return { ...this.lastResult, cronSkipped: true };\n    if (!force && this.lastResult && this.recentUntil > nowMs)\n      return this.lastResult;\n\n    if (this.active) {\n      if (!force && this.lastResult) return this.lastResult;\n      try {\n        await this.active;\n      } catch {}\n      if (!force && this.lastResult && this.recentUntil > Date.now())\n        return this.lastResult;\n    }\n\n    const task = runMsRefresh(this.env, branch)\n      .then((result) => {\n        this.lastResult = result;\n        this.lastSourceAt = Date.now();\n        this.recentUntil = Date.now() + MS_SYNC_TTL;\n        return result;\n      })\n      .finally(() => {\n        if (this.active === task) this.active = null;\n      });\n    this.active = task;\n    return task;\n  }\n}`,
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
