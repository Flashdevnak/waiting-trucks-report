import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const SUPERVISOR_SNAPSHOT_MARKER = "SUPERVISOR_SHARED_SNAPSHOT_V1";

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0 || first !== source.lastIndexOf(from))
    throw new Error(`Supervisor snapshot patch failed: ${label}`);
  return source.replace(from, to);
}

export function patchSupervisorSharedSnapshot(source) {
  let output = String(source || "");
  if (output.includes(SUPERVISOR_SNAPSHOT_MARKER)) return output;

  output = replaceOnce(
    output,
    `  async fetch(request) {\n    const url = new URL(request.url);\n    if (url.pathname.startsWith("/origin-manifest/"))`,
    `  async fetch(request) {\n    const url = new URL(request.url);\n    // ${SUPERVISOR_SNAPSHOT_MARKER}: internal-only shared runtime state. These\n    // paths never call an upstream source or database and never persist state.\n    if (url.pathname === "/supervisor/snapshot")\n      return Response.json(this.supervisorSnapshot());\n    if (url.pathname === "/supervisor/ingest") {\n      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });\n      const value = await request.json().catch(() => null);\n      return Response.json(this.ingestSupervisorSnapshot(value));\n    }\n    if (url.pathname.startsWith("/origin-manifest/"))`,
    "Durable Object internal snapshot routes",
  );

  output = replaceOnce(
    output,
    `  async openStream(request, branch) {`,
    `  ingestSupervisorSnapshot(value) {\n    const hub = String(value?.hub || "").trim().toUpperCase();\n    if (!/^[A-Z0-9_-]{2,20}$/.test(hub))\n      return { ok: false, code: "INVALID_HUB" };\n    if (!this.supervisorHubs) this.supervisorHubs = new Map();\n    const previous = this.supervisorHubs.get(hub) || null;\n    const result = value?.result && typeof value.result === "object" ? value.result : {};\n    const sourceState = String(result.status || "").toLowerCase();\n    const observedAt = typeof value?.observedAt === "string" ? value.observedAt : "";\n    const syncedAt = typeof result.syncedAt === "string" ? result.syncedAt : "";\n    const acceptedRows = Array.isArray(result.rows) ? result.rows.length : previous?.accepted?.rows ?? null;\n    const lastSuccessAt = sourceState === "synced" && syncedAt ? syncedAt : previous?.lastSuccessAt || null;\n    const health = sourceState === "synced" ? "HEALTHY" : sourceState === "error" ? "ERROR" : "UNKNOWN";\n    const next = {\n      hub,\n      health,\n      sourceState: sourceState || "unknown",\n      observedAt: observedAt || null,\n      lastSuccessAt,\n      accepted: {\n        state: Number.isInteger(acceptedRows) ? "AVAILABLE" : "UNKNOWN",\n        rows: Number.isInteger(acceptedRows) ? acceptedRows : null,\n        observedAt: lastSuccessAt,\n      },\n      errorCode: sourceState === "error" ? "MS_REFRESH_ERROR" : null,\n    };\n    this.supervisorHubs.set(hub, next);\n    return { ok: true };\n  }\n\n  supervisorSnapshot() {\n    const hubs = [...(this.supervisorHubs?.values() || [])]\n      .sort((left, right) => left.hub.localeCompare(right.hub));\n    const observedAt = hubs.map((hub) => hub.observedAt).filter(Boolean).sort().at(-1) || null;\n    const hasError = hubs.some((hub) => hub.health === "ERROR");\n    return {\n      version: 1,\n      mode: "OBSERVE_ONLY",\n      source: "SHARED_RUNTIME_STATE",\n      observedAt,\n      modules: {\n        waitingTrucks: {\n          health: {\n            state: hubs.length ? "PARTIAL" : "UNKNOWN",\n            observedAt,\n            evidence: hubs.length ? ["SHARED_MS_COORDINATOR_STATE"] : [],\n            impact: hasError ? "At least one observed HUB refresh is in error; accepted state may remain available." : "Only currently observed coordinator state is available.",\n          },\n          metrics: [\n            { id: "observed-hubs", value: hubs.length },\n            { id: "healthy-observed-hubs", value: hubs.filter((hub) => hub.health === "HEALTHY").length },\n          ],\n          incidents: [],\n          hubs,\n        },\n      },\n      contracts: {\n        additionalUpstreamPolls: 0,\n        databaseReads: 0,\n        databaseWrites: 0,\n        aiCalls: 0,\n      },\n    };\n  }\n\n  publishSupervisorSnapshot(branch, result) {\n    if (!this.env.MS_REFRESH_COORDINATOR) return Promise.resolve();\n    const id = this.env.MS_REFRESH_COORDINATOR.idFromName("__SUPERVISOR_SHARED_STATE_V1");\n    const stub = this.env.MS_REFRESH_COORDINATOR.get(id);\n    return stub.fetch(new Request("https://ms-refresh.internal/supervisor/ingest", {\n      method: "POST",\n      headers: { "Content-Type": "application/json" },\n      body: JSON.stringify({ hub: branch, observedAt: new Date().toISOString(), result }),\n    })).then(() => undefined);\n  }\n\n  async openStream(request, branch) {`,
    "Durable Object snapshot methods",
  );

  output = replaceOnce(
    output,
    `      .then((result) => {\n        this.lastResult = result;\n        this.lastSourceAt = Date.now();\n        this.recentUntil = Date.now() + MS_SYNC_TTL;\n        return result;\n      })`,
    `      .then((result) => {\n        this.lastResult = result;\n        this.lastSourceAt = Date.now();\n        this.recentUntil = Date.now() + MS_SYNC_TTL;\n        // Side-car publication is non-blocking: Supervisor failure cannot fail\n        // or delay the Waiting Trucks refresh that produced this result.\n        this.ctx.waitUntil(this.publishSupervisorSnapshot(branch, result).catch(() => undefined));\n        return result;\n      })`,
    "non-blocking runtime publication",
  );

  output = replaceOnce(
    output,
    `async function handleSupervisorAccess(request, url, env) {`,
    `async function readSharedSupervisorSnapshot(env) {\n  const unknown = {\n    version: 1,\n    mode: "OBSERVE_ONLY",\n    source: "SHARED_RUNTIME_STATE",\n    observedAt: null,\n    modules: { waitingTrucks: { health: { state: "UNKNOWN", observedAt: null, evidence: [], impact: "Shared runtime state is unavailable." }, metrics: [], incidents: [], hubs: [] } },\n    contracts: { additionalUpstreamPolls: 0, databaseReads: 0, databaseWrites: 0, aiCalls: 0 },\n  };\n  if (!env.MS_REFRESH_COORDINATOR) return unknown;\n  try {\n    const id = env.MS_REFRESH_COORDINATOR.idFromName("__SUPERVISOR_SHARED_STATE_V1");\n    const response = await env.MS_REFRESH_COORDINATOR.get(id).fetch(\n      new Request("https://ms-refresh.internal/supervisor/snapshot"),\n    );\n    if (!response.ok) return unknown;\n    const snapshot = await response.json();\n    return snapshot?.version === 1 ? snapshot : unknown;\n  } catch {\n    return unknown;\n  }\n}\n\nasync function handleSupervisorAccess(request, url, env) {`,
    "shared snapshot reader",
  );

  output = replaceOnce(
    output,
    `  try {\n    const verified = await verifySupervisorSession(request, env);\n    if (\n      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&\n      String(request.headers.get("X-Supervisor-CSRF") || "") !== verified.session.csrf\n    ) return supervisorJson({ ok: false, code: "SUPERVISOR_CSRF_REQUIRED" }, 403);\n  } catch (error) {\n    return supervisorJson({ ok: false, code: error?.code || "SUPERVISOR_AUTH_REQUIRED", message: "Admin access required" }, Number(error?.status) === 503 ? 503 : 403);\n  }\n  return supervisorJson({ ok: false, code: "SUPERVISOR_API_NOT_FOUND" }, 404);`,
    `  try {\n    const verified = await verifySupervisorSession(request, env);\n    if (\n      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&\n      String(request.headers.get("X-Supervisor-CSRF") || "") !== verified.session.csrf\n    ) return supervisorJson({ ok: false, code: "SUPERVISOR_CSRF_REQUIRED" }, 403);\n    if (url.pathname === "/api/supervisor/snapshot") {\n      if (request.method !== "GET" && request.method !== "HEAD")\n        return supervisorJson({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, { Allow: "GET, HEAD" });\n      return supervisorJson({ ok: true, data: await readSharedSupervisorSnapshot(env) });\n    }\n  } catch (error) {\n    return supervisorJson({ ok: false, code: error?.code || "SUPERVISOR_AUTH_REQUIRED", message: "Admin access required" }, Number(error?.status) === 503 ? 503 : 403);\n  }\n  return supervisorJson({ ok: false, code: "SUPERVISOR_API_NOT_FOUND" }, 404);`,
    "authorized snapshot endpoint",
  );

  output = replaceOnce(
    output,
    `    const acceptedRows = Array.isArray(result.rows) ? result.rows.length : previous?.accepted?.rows ?? null;`,
    `    const suppliedRows = Number(result.acceptedRows);\n    const acceptedRows = Number.isInteger(suppliedRows) && suppliedRows >= 0 ? suppliedRows : previous?.accepted?.rows ?? null;`,
    "accepted row summary",
  );
  output = replaceOnce(
    output,
    `      body: JSON.stringify({ hub: branch, observedAt: new Date().toISOString(), result }),`,
    `      body: JSON.stringify({\n        hub: branch,\n        observedAt: new Date().toISOString(),\n        result: {\n          status: result?.status || "",\n          syncedAt: result?.syncedAt || "",\n          acceptedRows: Array.isArray(result?.rows) ? result.rows.length : null,\n        },\n      }),`,
    "lightweight publication payload",
  );
  return output;
}

const invokedPath = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedPath) {
  const target = process.argv[2];
  if (!target) throw new Error("Usage: node patch-supervisor-shared-snapshot.mjs <worker-index.js>");
  await writeFile(target, patchSupervisorSharedSnapshot(await readFile(target, "utf8")), "utf8");
}
