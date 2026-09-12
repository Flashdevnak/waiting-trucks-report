import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const MARKER = "MS_ALL_HUB_SELF_HEAL_V1";

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0 || first !== source.lastIndexOf(from))
    throw new Error(`DEV self-healing supervisor patch failed: ${label}`);
  return source.replace(from, to);
}

export function patchMsSelfHealingSupervisor(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;

  output = replaceOnce(
    output,
    "export async function runMsScheduledRefresh(env) {",
    `// ${MARKER}: reuse the existing per-HUB refresh as the health probe.\n// Healthy operation adds zero Turso reads/writes and zero upstream calls.\nconst MS_REPAIR_TRANSIENT_BACKOFF_MS = [60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000];\nconst MS_REPAIR_SESSION_COOLDOWN_MS = 60 * 60_000;\nconst MS_REPAIR_CONCURRENCY = 4;\nconst MS_REPAIR_POLICY_VERSION = 4;\n\nasync function mapMsRepairLimit(items, limit, task) {\n  const result = new Array(items.length);\n  let cursor = 0;\n  async function worker() {\n    while (cursor < items.length) {\n      const index = cursor++;\n      result[index] = await task(items[index], index);\n    }\n  }\n  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length || 1) }, worker));\n  return result;\n}\n\nexport async function runMsScheduledRefresh(env) {`,
    "supervisor constants",
  );

  const oldLoop = `  const actor = { username: "MS_CRON", role: "admin", branches: ["*"] };\n  for (const row of rows.slice(0, 20)) {\n    const branch = text(row?.hub, 80).toUpperCase();\n    if (!branch) continue;\n    try {\n      if (env.MS_REFRESH_COORDINATOR) {\n        const id = env.MS_REFRESH_COORDINATOR.idFromName(branch);\n        const stub = env.MS_REFRESH_COORDINATOR.get(id);\n        const url = new URL("https://ms-refresh.internal/refresh");\n        url.searchParams.set("branch", branch);\n        url.searchParams.set("cron", "1");\n        const response = await stub.fetch(new Request(url));\n        if (!response.ok) {\n          const error = new Error("ตัวประสาน Cron MS ตอบกลับผิดพลาด");\n          error.code = "MS_CRON_COORDINATOR_ERROR";\n          throw error;\n        }\n      } else {\n        await refreshMsIfStale(env, actor, branch);\n      }\n    } catch (error) {\n      console.error(\n        JSON.stringify({\n          event: "ms_cron_sync_error",\n          hub: branch,\n          code: error.code || "MS_CRON_SYNC_FAILED",\n          message: error.message || String(error),\n        }),\n      );\n    }\n  }`;
  const newLoop = `  const actor = { username: "MS_CRON", role: "admin", branches: ["*"] };\n  await mapMsRepairLimit(rows, MS_REPAIR_CONCURRENCY, async (row) => {\n    const branch = text(row?.hub, 80).toUpperCase();\n    if (!branch) return;\n    try {\n      if (env.MS_REFRESH_COORDINATOR) {\n        const id = env.MS_REFRESH_COORDINATOR.idFromName(branch);\n        const stub = env.MS_REFRESH_COORDINATOR.get(id);\n        const url = new URL("https://ms-refresh.internal/refresh");\n        url.searchParams.set("branch", branch);\n        url.searchParams.set("cron", "1");\n        const response = await stub.fetch(new Request(url));\n        const result = await response.json().catch(() => ({}));\n        if (!response.ok || ["error", "not_configured"].includes(result?.status)) {\n          const error = new Error(result?.error || "ตัวประสาน Cron MS ตอบกลับผิดพลาด");\n          error.code = result?.repair?.code || result?.errorCode || "MS_CRON_COORDINATOR_ERROR";\n          throw error;\n        }\n      } else {\n        await refreshMsIfStale(env, actor, branch);\n      }\n    } catch (error) {\n      console.error(JSON.stringify({ event: "ms_cron_sync_error", hub: branch, code: error.code || "MS_CRON_SYNC_FAILED", message: error.message || String(error) }));\n    }\n  });`;
  output = replaceOnce(output, oldLoop, newLoop, "all-HUB bounded cron");

  output = replaceOnce(
    output,
    `  if (row) {\n    const value = {\n      sessionId: await decryptMs(row.session_cipher, env),\n      deviceId: await decryptMs(row.device_cipher, env),\n    };\n    msCredentialCache.set(key, { until: Date.now() + MS_CREDENTIAL_CACHE_MS, value });\n    return value;\n  }`,
    `  if (row) {\n    try {\n      const value = {\n        sessionId: await decryptMs(row.session_cipher, env),\n        deviceId: await decryptMs(row.device_cipher, env),\n      };\n      msCredentialCache.set(key, { until: Date.now() + MS_CREDENTIAL_CACHE_MS, value });\n      return value;\n    } catch (error) {\n      msCredentialCache.delete(key);\n      const credentialError = new Error("ข้อมูลเชื่อมต่อ MS ใช้งานไม่ได้ กรุณาอัปเดตเซสชันใหม่");\n      credentialError.code = "MS_CREDENTIAL_ERROR";\n      credentialError.cause = error;\n      throw credentialError;\n    }\n  }`,
    "credential decrypt classification",
  );

  output = replaceOnce(
    output,
    `async function runMsRefresh(env, branch) {\n  const credentials = await msCredentials(env, branch);\n  if (!credentials)\n    return {\n      status: "not_configured",\n      error: \`HUB \${branch} ยังไม่ได้อัปเดตเซสชัน MS\`,\n    };\n  try {`,
    `async function runMsRefresh(env, branch) {\n  let credentials;\n  try {\n    credentials = await msCredentials(env, branch);\n  } catch (error) {\n    const errorCode = error?.code === "MS_CREDENTIAL_ERROR"\n      ? "MS_CREDENTIAL_ERROR"\n      : "MS_CREDENTIAL_READ_ERROR";\n    const message = errorCode === "MS_CREDENTIAL_ERROR"\n      ? "ข้อมูลเชื่อมต่อ MS ใช้งานไม่ได้ กรุณาอัปเดตเซสชันใหม่"\n      : error?.message || "อ่านข้อมูลเชื่อมต่อ MS ไม่สำเร็จ";\n    await safeStatusWrite(\n      markConnectionError(env, "ms_connections", branch, message),\n      "ms_route_credential_error_write_error",\n      branch,\n    );\n    console.error(JSON.stringify({ event: "ms_route_credential_error", hub: branch, code: errorCode, message }));\n    return { status: "error", errorCode, error: message };\n  }\n  if (!credentials)\n    return {\n      status: "not_configured",\n      errorCode: "MS_NOT_CONFIGURED",\n      error: \`HUB \${branch} ยังไม่ได้อัปเดตเซสชัน MS\`,\n    };\n  try {`,
    "credential load inside refresh diagnosis",
  );

  output = replaceOnce(
    output,
    `    this.lastSourceAt = 0;\n    this.originManifest = new OriginManifestCoordinator(ctx, env);`,
    `    this.repairLoaded = false;\n    this.repair = { policyVersion: MS_REPAIR_POLICY_VERSION, state: "unknown", failures: 0, nextRetryAt: 0, code: "", message: "", changedAt: "" };\n    this.lastSourceAt = 0;\n    this.originManifest = new OriginManifestCoordinator(ctx, env);`,
    "coordinator repair state",
  );

  output = replaceOnce(
    output,
    `\n  async fetch(request) {\n    const url = new URL(request.url);`,
    `\n  async loadRepairState() {\n    if (this.repairLoaded) return this.repair;\n    this.repairLoaded = true;\n    try {\n      const saved = await this.ctx.storage.get("ms-repair-v1");\n      if (saved && typeof saved === "object" && Number(saved.policyVersion || 0) === MS_REPAIR_POLICY_VERSION)\n        this.repair = { ...this.repair, ...saved };\n      else if (saved && typeof saved === "object")\n        console.log(JSON.stringify({ event: "ms_repair_policy_reset", from: Number(saved.policyVersion || 0), to: MS_REPAIR_POLICY_VERSION }));\n    } catch (error) {\n      console.error(JSON.stringify({ event: "ms_repair_state_read_error", message: error?.message || String(error) }));\n    }\n    return this.repair;\n  }\n\n  repairView(nowMs = Date.now()) {\n    return { ...this.repair, retryInMs: Math.max(0, Number(this.repair?.nextRetryAt || 0) - nowMs), quotaMode: "PIGGYBACK_STATE_CHANGE_ONLY_V1", healthyExtraTursoReads: 0, healthyExtraTursoWrites: 0, healthyExtraUpstreamCalls: 0 };\n  }\n\n  async setRepairState(next) {\n    const previous = this.repair;\n    next = { ...next, policyVersion: MS_REPAIR_POLICY_VERSION };\n    this.repair = next;\n    const material = ["policyVersion", "state", "failures", "nextRetryAt", "code", "message"].some((key) => previous?.[key] !== next?.[key]);\n    if (!material) return;\n    try { await this.ctx.storage.put("ms-repair-v1", next); }\n    catch (error) { console.error(JSON.stringify({ event: "ms_repair_state_write_error", message: error?.message || String(error) })); }\n  }\n\n  async recordRepairResult(result, nowMs = Date.now()) {\n    const status = String(result?.status || "error");\n    if (status === "synced") {\n      if (this.repair?.state !== "healthy" || Number(this.repair?.failures || 0) !== 0)\n        await this.setRepairState({ state: "healthy", failures: 0, nextRetryAt: 0, code: "", message: "", changedAt: new Date(nowMs).toISOString() });\n      return;\n    }\n    const resultCode = String(result?.errorCode || "");\n    const message = String(result?.error || "MS refresh failed").slice(0, 300);\n    const previousFailures = Number(this.repair?.failures || 0);\n    const failures = Math.min(20, previousFailures + 1);\n    const credentialTerminal = resultCode === "MS_CREDENTIAL_ERROR" || resultCode === "MS_NOT_CONFIGURED";\n    const authSignal = resultCode === "MS_SESSION_EXPIRED" || resultCode === "INVALID_SESSION";\n    const confirmedAuthTerminal = authSignal && this.repair?.code === resultCode && previousFailures >= 1;\n    const terminal = credentialTerminal || confirmedAuthTerminal;\n    const terminalCode = resultCode || "MS_SESSION_EXPIRED";\n    const delay = terminal ? MS_REPAIR_SESSION_COOLDOWN_MS : MS_REPAIR_TRANSIENT_BACKOFF_MS[Math.min(failures - 1, MS_REPAIR_TRANSIENT_BACKOFF_MS.length - 1)];\n    await this.setRepairState({ state: terminal ? "needs_login" : "retry_wait", failures, nextRetryAt: nowMs + delay, code: terminal ? terminalCode : resultCode || "MS_TRANSIENT_FAILURE", message, changedAt: new Date(nowMs).toISOString() });\n  }\n\n  async fetch(request) {\n    const url = new URL(request.url);`,
    "coordinator repair methods",
  );

  output = replaceOnce(
    output,
    `    if (url.pathname === "/stream") return this.openStream(request, branch);\n    const force = url.searchParams.get("force") === "1";`,
    `    if (url.pathname === "/stream") return this.openStream(request, branch);\n    if (url.pathname === "/repair-health") {\n      await this.loadRepairState();\n      return Response.json({ branch, repair: this.repairView() });\n    }\n    const force = url.searchParams.get("force") === "1";`,
    "repair health route",
  );

  const oldRefreshStart = `  async refresh(branch, force = false, cron = false) {\n    const nowMs = Date.now();\n    if (`;
  const newRefreshStart = `  async refresh(branch, force = false, cron = false) {\n    const nowMs = Date.now();\n    await this.loadRepairState();\n    if (!force && Number(this.repair?.nextRetryAt || 0) > nowMs) {\n      if (this.lastResult) return { ...this.lastResult, repairPaused: true, repair: this.repairView(nowMs) };\n      if (cron) return { status: "degraded", repairPaused: true, repair: this.repairView(nowMs) };\n      const cachedRows = await readMsLiveCache(this.env, branch);\n      this.lastResult = { status: "degraded", rows: cachedRows || [], error: this.repair?.message || "กำลังรอรอบกู้คืน" };\n      return { ...this.lastResult, repairPaused: true, repair: this.repairView(nowMs) };\n    }\n    if (`;
  output = replaceOnce(output, oldRefreshStart, newRefreshStart, "repair cooldown");

  output = replaceOnce(
    output,
    `    const task = runMsRefresh(this.env, branch)\n      .then((result) => {\n        this.lastResult = result;\n        this.lastSourceAt = Date.now();\n        this.recentUntil = Date.now() + MS_SYNC_TTL;\n        return result;\n      })`,
    `    const task = runMsRefresh(this.env, branch)\n      .then((result) => {\n        this.lastResult = result;\n        this.lastSourceAt = Date.now();\n        this.recentUntil = Date.now() + MS_SYNC_TTL;\n        return result;\n      })\n      .then(async (result) => {\n        const repairAt = this.lastSourceAt || Date.now();\n        await this.recordRepairResult(result, repairAt);\n        return { ...result, repair: this.repairView(repairAt) };\n      })`,
    "record repair outcome",
  );

  output = replaceOnce(
  output,
  `  const actor = await verify(url.searchParams.get("token"), env);\n  if (action === "msOriginManifestStatus")`,
  `  if (action === "msRepairHealthDev") {\n    const branch = text(url.searchParams.get("branch"), 80).toUpperCase();\n    if (!branch) fail("missing branch", "INVALID_BRANCH", 400);\n    if (!env.MS_REFRESH_COORDINATOR) fail("coordinator unavailable", "MS_COORDINATOR_UNAVAILABLE", 503);\n    const id = env.MS_REFRESH_COORDINATOR.idFromName(branch);\n    const stub = env.MS_REFRESH_COORDINATOR.get(id);\n    const target = new URL("https://ms-refresh.internal/repair-health");\n    target.searchParams.set("branch", branch);\n    const response = await stub.fetch(new Request(target));\n    const data = await response.json().catch(() => ({}));\n    if (!response.ok) fail("repair state unavailable", "MS_REPAIR_STATE_UNAVAILABLE", 503);\n    const repair = data?.repair || {};\n    return ok({\n      branch,\n      repair: {\n        policyVersion: Number(repair.policyVersion || 0),\n        state: text(repair.state, 40),\n        failures: Number(repair.failures || 0),\n        nextRetryAt: Number(repair.nextRetryAt || 0),\n        code: text(repair.code, 80),\n        retryInMs: Math.max(0, Number(repair.retryInMs || 0)),\n      },\n      quota: { tursoReads: 0, tursoWrites: 0, upstreamCalls: 0 },\n    });\n  }\n  const actor = await verify(url.searchParams.get("token"), env);\n  if (action === "msOriginManifestStatus")`,
  "sanitized DEV repair health diagnostic",
);

  output = replaceOnce(
    output,
    `  if (action === "saveSettings") {`,
    `  if (action === "adminRepairAll") {\n    mustAdmin(actor);\n    return ok(await adminRepairAll(env));\n  }\n  if (action === "saveSettings") {`,
    "admin repair route",
  );

  output = replaceOnce(
    output,
    `async function saveUser(input, actor, env) {`,
    `async function adminRepairAll(env) {\n  const rows = (await env.DB.prepare("SELECT hub FROM ms_connections ORDER BY hub").all()).results || [];\n  const results = await mapMsRepairLimit(rows, MS_REPAIR_CONCURRENCY, async (row) => {\n    const hub = text(row?.hub, 80).toUpperCase();\n    if (!hub) return null;\n    try {\n      if (!env.MS_REFRESH_COORDINATOR) return { hub, ok: false, status: "coordinator_unavailable" };\n      const id = env.MS_REFRESH_COORDINATOR.idFromName(hub);\n      const stub = env.MS_REFRESH_COORDINATOR.get(id);\n      const url = new URL("https://ms-refresh.internal/refresh");\n      url.searchParams.set("branch", hub);\n      url.searchParams.set("force", "1");\n      const response = await stub.fetch(new Request(url));\n      const data = await response.json().catch(() => ({}));\n      return { hub, ok: response.ok && data?.status === "synced", status: data?.status || "error", error: data?.error || "", repair: data?.repair || null };\n    } catch (error) {\n      return { hub, ok: false, status: "error", error: error?.message || String(error) };\n    }\n  });\n  const compact = results.filter(Boolean);\n  return { checkedAt: new Date().toISOString(), total: compact.length, healthy: compact.filter((item) => item.ok).length, needsAttention: compact.filter((item) => !item.ok).length, results: compact, quota: { mode: "MANUAL_ONE_ATTEMPT_PER_HUB_V1", registryReads: rows.length, healthyBackgroundExtraReads: 0, healthyBackgroundExtraWrites: 0, healthyBackgroundExtraUpstreamCalls: 0 } };\n}\n\nasync function saveUser(input, actor, env) {`,
    "manual all-HUB repair",
  );

  output = replaceOnce(
    output,
    `await refreshMsIfStale(env, { username: "MS_QR", role: "admin", branches: ["*"] }, row.hub);`,
    `await refreshMsIfStale(env, { username: "MS_QR", role: "admin", branches: ["*"] }, row.hub, true);`,
    "new session bypasses cooldown",
  );

  return output;
}

const invokedPath = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedPath) {
  const target = process.argv[2];
  if (!target) throw new Error("Usage: node patch-ms-self-healing-supervisor.mjs <worker-index.js>");
  await writeFile(target, patchMsSelfHealingSupervisor(await readFile(target, "utf8")), "utf8");
}
