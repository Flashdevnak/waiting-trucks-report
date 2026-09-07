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
    output = replaceUnique(
      output,
      `  const actor = await verify(body.token, env);\n  if (action === "import") return ok(await importRows(body, actor, env));`,
      `  const actor = await verify(body.token, env);\n  if (action === "saveMsOriginManifestConnection")\n    return ok(await saveOriginManifestConnection(\n      env,\n      actor,\n      pickBranch(actor, body.hub),\n      body.credentials,\n    ));\n  if (action === "import") return ok(await importRows(body, actor, env));`,
      "origin manifest save action",
    );
  }

  if (!output.includes("export class MsRefreshCoordinator")) {
    output = replaceUnique(
      output,
      `async function refreshMsIfStale(env, actor, branch, force = false) {\n  if (!access(branch, actor)) return { status: "forbidden" };\n  const nowMs = Date.now(), recent = recentMsSync.get(branch);\n  if (!force && recent?.until > nowMs) return recent.result;\n  if (activeMsSync.has(branch)) return activeMsSync.get(branch);\n  const task = runMsRefresh(env, branch).finally(() => activeMsSync.delete(branch));\n  activeMsSync.set(branch, task);\n  return task;\n}`,
      `async function refreshMsIfStale(env, actor, branch, force = false) {\n  if (!access(branch, actor)) return { status: "forbidden" };\n  const nowMs = Date.now(), recent = recentMsSync.get(branch);\n  if (!force && recent?.until > nowMs) return recent.result;\n  if (activeMsSync.has(branch)) return activeMsSync.get(branch);\n\n  if (env.MS_REFRESH_COORDINATOR) {\n    const id = env.MS_REFRESH_COORDINATOR.idFromName(branch);\n    const stub = env.MS_REFRESH_COORDINATOR.get(id);\n    const url = new URL("https://ms-refresh.internal/refresh");\n    url.searchParams.set("branch", branch);\n    if (force) url.searchParams.set("force", "1");\n    const response = await stub.fetch(new Request(url));\n    if (!response.ok) {\n      const error = new Error("ตัวประสานการอัปเดต MS ตอบกลับผิดพลาด");\n      error.code = "MS_COORDINATOR_ERROR";\n      throw error;\n    }\n    const result = await response.json();\n    recentMsSync.set(branch, { until: Date.now() + MS_SYNC_TTL, result });\n    return result;\n  }\n\n  const task = runMsRefresh(env, branch).finally(() => activeMsSync.delete(branch));\n  activeMsSync.set(branch, task);\n  return task;\n}\n\nexport class MsRefreshCoordinator {\n  constructor(ctx, env) {\n    this.ctx = ctx;\n    this.env = env;\n    this.active = null;\n    this.lastResult = null;\n    this.recentUntil = 0;\n    this.originManifest = new OriginManifestCoordinator(ctx, env);\n  }\n\n  async fetch(request) {\n    const url = new URL(request.url);\n    if (url.pathname.startsWith("/origin-manifest/"))\n      return this.originManifest.fetch(request);\n    const branch = String(url.searchParams.get("branch") || "").trim().toUpperCase();\n    const force = url.searchParams.get("force") === "1";\n    if (!branch)\n      return Response.json(\n        { status: "error", error: "missing branch" },\n        { status: 400 },\n      );\n    return Response.json(await this.refresh(branch, force));\n  }\n\n  async refresh(branch, force = false) {\n    const nowMs = Date.now();\n    if (!force && this.lastResult && this.recentUntil > nowMs)\n      return this.lastResult;\n\n    if (this.active) {\n      if (!force && this.lastResult) return this.lastResult;\n      try {\n        await this.active;\n      } catch {}\n      if (!force && this.lastResult && this.recentUntil > Date.now())\n        return this.lastResult;\n    }\n\n    const task = runMsRefresh(this.env, branch)\n      .then((result) => {\n        this.lastResult = result;\n        this.recentUntil = Date.now() + MS_SYNC_TTL;\n        return result;\n      })\n      .finally(() => {\n        if (this.active === task) this.active = null;\n      });\n    this.active = task;\n    return task;\n  }\n}`,
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
