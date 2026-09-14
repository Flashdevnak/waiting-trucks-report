import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const SUPERVISOR_SNAPSHOT_MARKER = "SUPERVISOR_SHARED_SNAPSHOT_V1";
export const SUPERVISOR_SOURCE_HEALTH_MARKER = "SUPERVISOR_SOURCE_HEALTH_V1";

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0 || first !== source.lastIndexOf(from))
    throw new Error(`Supervisor snapshot patch failed: ${label}`);
  return source.replace(from, to);
}

function replaceInsideAsyncFunction(source, functionName, from, to, label) {
  const marker = `async function ${functionName}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Supervisor snapshot patch failed: ${label} function`);
  const next = source.indexOf("\nasync function ", start + marker.length);
  const end = next < 0 ? source.length : next;
  const segment = source.slice(start, end);
  const first = segment.indexOf(from);
  if (first < 0 || first !== segment.lastIndexOf(from))
    throw new Error(`Supervisor snapshot patch failed: ${label}`);
  return source.slice(0, start) + segment.replace(from, to) + source.slice(end);
}

export function patchSupervisorSharedSnapshot(source) {
  let output = String(source || "");
  if (output.includes(SUPERVISOR_SOURCE_HEALTH_MARKER)) return output;

  if (!output.includes(SUPERVISOR_SNAPSHOT_MARKER)) {
    output = replaceOnce(
      output,
      `  async fetch(request) {\n    const url = new URL(request.url);\n    if (url.pathname.startsWith("/origin-manifest/"))`,
      `  async fetch(request) {\n    const url = new URL(request.url);\n    // ${SUPERVISOR_SNAPSHOT_MARKER}: internal-only shared runtime state. These\n    // paths never call an upstream source or database and never persist state.\n    if (url.pathname === "/supervisor/snapshot")\n      return Response.json(this.supervisorSnapshot());\n    if (url.pathname === "/supervisor/ingest") {\n      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });\n      const value = await request.json().catch(() => null);\n      return Response.json(this.ingestSupervisorSnapshot(value));\n    }\n    if (url.pathname.startsWith("/origin-manifest/"))`,
      "Durable Object internal snapshot routes",
    );

    output = replaceOnce(
      output,
      `  async openStream(request, branch) {`,
      `  ingestSupervisorSnapshot(value) {\n    const hub = String(value?.hub || "").trim().toUpperCase();\n    if (!/^[A-Z0-9_-]{2,20}$/.test(hub))\n      return { ok: false, code: "INVALID_HUB" };\n    if (!this.supervisorHubs) this.supervisorHubs = new Map();\n    const previous = this.supervisorHubs.get(hub) || null;\n    const result = value?.result && typeof value.result === "object" ? value.result : {};\n    const refreshState = String(result.status || "").toLowerCase();\n    const observedAt = typeof value?.observedAt === "string" ? value.observedAt : "";\n    const syncedAt = typeof result.syncedAt === "string" ? result.syncedAt : "";\n    const suppliedRows = Number(result.acceptedRows);\n    const acceptedRows = Number.isInteger(suppliedRows) && suppliedRows >= 0 ? suppliedRows : previous?.accepted?.rows ?? null;\n    const lastSuccessAt = refreshState === "synced" && syncedAt ? syncedAt : previous?.lastSuccessAt || null;\n    const health = refreshState === "synced" ? "HEALTHY" : refreshState === "degraded" ? "WARNING" : refreshState === "error" ? "ERROR" : "UNKNOWN";\n    const suppliedErrorCode = /^[A-Z0-9_:-]{2,80}$/.test(String(result.errorCode || "")) ? String(result.errorCode) : null;\n    const sourceInput = result?.sourceTelemetry && typeof result.sourceTelemetry === "object" ? result.sourceTelemetry : {};\n    const previousSources = previous?.sources && typeof previous.sources === "object" ? previous.sources : {};\n    const cleanTime = (input) => typeof input === "string" && Number.isFinite(Date.parse(input)) ? input : null;\n    const normalizeSource = (key, defaultMode = "REFRESH") => {\n      const item = sourceInput?.[key];\n      const prior = previousSources?.[key] && typeof previousSources[key] === "object" ? previousSources[key] : null;\n      if (!item || typeof item !== "object")\n        return prior || { state: "UNKNOWN", configured: null, lastSuccessAt: null, lastUsedAt: null, retryAt: null, errorCode: null, recovery: "UNKNOWN", mode: defaultMode, observed: false };\n      const rawState = String(item.state || "").toUpperCase();\n      const sourceState = ["HEALTHY", "WARNING", "CRITICAL", "STALE", "PARTIAL", "AUTH_REQUIRED", "ERROR", "BLOCKED", "UNKNOWN", "RECOVERED"].includes(rawState) ? rawState : "UNKNOWN";\n      const configured = typeof item.configured === "boolean" ? item.configured : prior?.configured ?? null;\n      const errorCode = /^[A-Z0-9_:-]{2,80}$/.test(String(item.errorCode || "")) ? String(item.errorCode) : null;\n      const recovery = /^[A-Z0-9_:-]{2,80}$/.test(String(item.recovery || "")) ? String(item.recovery) : prior?.recovery || "UNKNOWN";\n      const mode = String(item.mode || "").toUpperCase() === "CLICK_ONLY" ? "CLICK_ONLY" : prior?.mode || defaultMode;\n      const explicitSuccess = cleanTime(item.lastSuccessAt);\n      const fallbackSuccess = ["HEALTHY", "RECOVERED"].includes(sourceState) ? cleanTime(syncedAt) || cleanTime(observedAt) : null;\n      const sourceLastSuccessAt = explicitSuccess || fallbackSuccess || prior?.lastSuccessAt || null;\n      const sourceLastUsedAt = cleanTime(item.lastUsedAt) || (item.observed === true ? cleanTime(observedAt) : null) || prior?.lastUsedAt || null;\n      const retryAt = cleanTime(item.retryAt) || null;\n      return { state: sourceState, configured, lastSuccessAt: sourceLastSuccessAt, lastUsedAt: sourceLastUsedAt, retryAt, errorCode, recovery, mode, observed: item.observed === true };\n    };\n    const sources = {\n      route: normalizeSource("route"),\n      preEntry: normalizeSource("preEntry"),\n      busTime: normalizeSource("busTime"),\n      hbiPhotos: normalizeSource("hbiPhotos", "CLICK_ONLY"),\n    };\n    const next = {\n      hub,\n      health,\n      sourceState: refreshState || "unknown",\n      observedAt: observedAt || null,\n      lastSuccessAt,\n      accepted: {\n        state: Number.isInteger(acceptedRows) ? "AVAILABLE" : "UNKNOWN",\n        rows: Number.isInteger(acceptedRows) ? acceptedRows : null,\n        observedAt: lastSuccessAt,\n      },\n      sources,\n      errorCode: refreshState === "error" || refreshState === "degraded" ? suppliedErrorCode || "MS_REFRESH_ERROR" : null,\n    };\n    this.supervisorHubs.set(hub, next);\n    return { ok: true };\n  }\n\n  supervisorSnapshot() {\n    const hubs = [...(this.supervisorHubs?.values() || [])]\n      .sort((left, right) => left.hub.localeCompare(right.hub));\n    const observedAt = hubs.map((hub) => hub.observedAt).filter(Boolean).sort().at(-1) || null;\n    const hasError = hubs.some((hub) => hub.health === "ERROR");\n    return {\n      version: 1,\n      mode: "OBSERVE_ONLY",\n      source: "SHARED_RUNTIME_STATE",\n      availability: "AVAILABLE",\n      observedAt,\n      modules: {\n        waitingTrucks: {\n          health: {\n            state: hubs.length ? "PARTIAL" : "UNKNOWN",\n            observedAt,\n            evidence: hubs.length ? ["SHARED_MS_COORDINATOR_STATE"] : [],\n            impact: hasError ? "At least one observed HUB refresh is in error; accepted state may remain available." : "Only currently observed coordinator state is available.",\n          },\n          metrics: [\n            { id: "observed-hubs", value: hubs.length },\n            { id: "healthy-observed-hubs", value: hubs.filter((hub) => hub.health === "HEALTHY").length },\n          ],\n          incidents: [],\n          hubs,\n        },\n      },\n      contracts: {\n        additionalUpstreamPolls: 0,\n        databaseReads: 0,\n        databaseWrites: 0,\n        aiCalls: 0,\n      },\n    };\n  }\n\n  publishSupervisorSnapshot(branch, result) {\n    if (!this.env.MS_REFRESH_COORDINATOR) return Promise.resolve();\n    const id = this.env.MS_REFRESH_COORDINATOR.idFromName("__SUPERVISOR_SHARED_STATE_V1");\n    const stub = this.env.MS_REFRESH_COORDINATOR.get(id);\n    return stub.fetch(new Request("https://ms-refresh.internal/supervisor/ingest", {\n      method: "POST",\n      headers: { "Content-Type": "application/json" },\n      body: JSON.stringify({\n        hub: branch,\n        observedAt: new Date().toISOString(),\n        result: {\n          status: result?.status || "",\n          syncedAt: result?.syncedAt || "",\n          acceptedRows: Array.isArray(result?.rows) ? result.rows.length : null,\n          errorCode: result?.errorCode || "",\n          sourceTelemetry: result?.sourceTelemetry ? supervisorSanitizedSourceTelemetry(result.sourceTelemetry) : null,\n        },\n      }),\n    })).then(() => undefined);\n  }\n\n  async openStream(request, branch) {`,
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
      `async function readSharedSupervisorSnapshot(env) {\n  const unknown = {\n    version: 1,\n    mode: "OBSERVE_ONLY",\n    source: "SHARED_RUNTIME_STATE",\n    availability: "UNAVAILABLE",\n    observedAt: null,\n    modules: { waitingTrucks: { health: { state: "UNKNOWN", observedAt: null, evidence: [], impact: "Shared runtime state is unavailable." }, metrics: [], incidents: [], hubs: [] } },\n    contracts: { additionalUpstreamPolls: 0, databaseReads: 0, databaseWrites: 0, aiCalls: 0 },\n  };\n  if (!env.MS_REFRESH_COORDINATOR) return unknown;\n  try {\n    const id = env.MS_REFRESH_COORDINATOR.idFromName("__SUPERVISOR_SHARED_STATE_V1");\n    const response = await env.MS_REFRESH_COORDINATOR.get(id).fetch(\n      new Request("https://ms-refresh.internal/supervisor/snapshot"),\n    );\n    if (!response.ok) return unknown;\n    const snapshot = await response.json();\n    return snapshot?.version === 1 ? snapshot : unknown;\n  } catch {\n    return unknown;\n  }\n}\n\nasync function handleSupervisorAccess(request, url, env) {`,
      "shared snapshot reader",
    );

    output = replaceOnce(
      output,
      `  try {\n    const verified = await verifySupervisorSession(request, env);\n    if (\n      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&\n      String(request.headers.get("X-Supervisor-CSRF") || "") !== verified.session.csrf\n    ) return supervisorJson({ ok: false, code: "SUPERVISOR_CSRF_REQUIRED" }, 403);\n  } catch (error) {\n    return supervisorJson({ ok: false, code: error?.code || "SUPERVISOR_AUTH_REQUIRED", message: "Admin access required" }, Number(error?.status) === 503 ? 503 : 403);\n  }\n  return supervisorJson({ ok: false, code: "SUPERVISOR_API_NOT_FOUND" }, 404);`,
      `  try {\n    const verified = await verifySupervisorSession(request, env);\n    if (\n      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&\n      String(request.headers.get("X-Supervisor-CSRF") || "") !== verified.session.csrf\n    ) return supervisorJson({ ok: false, code: "SUPERVISOR_CSRF_REQUIRED" }, 403);\n    if (url.pathname === "/api/supervisor/snapshot") {\n      if (request.method !== "GET" && request.method !== "HEAD")\n        return supervisorJson({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, { Allow: "GET, HEAD" });\n      return supervisorJson({ ok: true, data: await readSharedSupervisorSnapshot(env) });\n    }\n  } catch (error) {\n    return supervisorJson({ ok: false, code: error?.code || "SUPERVISOR_AUTH_REQUIRED", message: "Admin access required" }, Number(error?.status) === 503 ? 503 : 403);\n  }\n  return supervisorJson({ ok: false, code: "SUPERVISOR_API_NOT_FOUND" }, 404);`,
      "authorized snapshot endpoint",
    );
  }

  output = replaceOnce(
    output,
    `async function runMsRefresh(env, branch) {`,
    `// ${SUPERVISOR_SOURCE_HEALTH_MARKER}: piggyback source outcomes already produced\n// by the existing shared refresh/coordinator. This block performs no source call,\n// DB read/write, timer, subscription, persistence, repair, or AI work.\nfunction supervisorSourceCode(value) {\n  return /^[A-Z0-9_:-]{2,80}$/.test(String(value || "")) ? String(value) : "";\n}\nfunction supervisorSourceNeedsAuth(code) {\n  return /(?:401|403|SESSION_EXPIRED|INVALID_SESSION|CREDENTIAL_ERROR|NEEDS_LOGIN)/.test(String(code || "").toUpperCase());\n}\nfunction supervisorRefreshSourceTelemetry(branch, credentials, rows, parcelCounts, busData) {\n  const routeError = rows?.routeSourceError || null;\n  const routeCode = supervisorSourceCode(routeError?.code || (!credentials ? "MS_NOT_CONFIGURED" : ""));\n  const routeConfigured = Boolean(credentials);\n  const routeState = !routeConfigured ? "UNKNOWN" : routeError ? (supervisorSourceNeedsAuth(routeCode) ? "AUTH_REQUIRED" : "ERROR") : "HEALTHY";\n\n  const preCode = supervisorSourceCode(parcelCounts?.sourceCode || "");\n  const preFailed = parcelCounts?.sourceFailed === true;\n  const preObservedSuccess = !preFailed && parcelCounts instanceof Map && parcelCounts.size > 0;\n  const preState = preFailed ? (supervisorSourceNeedsAuth(preCode) ? "AUTH_REQUIRED" : "ERROR") : preObservedSuccess ? "HEALTHY" : "UNKNOWN";\n\n  let bus = null;\n  try { if (typeof busTimeDiagnostics === "function") bus = busTimeDiagnostics(branch); } catch {}\n  const busCode = supervisorSourceCode(bus?.busLastError || busData?.sourceCode || "");\n  const busConfigured = busCode === "BUS_TIME_NOT_CONFIGURED" ? false : (bus?.busLastSuccessAt || busCode || busData?.size > 0 ? true : null);\n  const busNeedsLogin = bus?.busNeedsLogin === true || supervisorSourceNeedsAuth(busCode);\n  const busFailed = busData?.sourceFailed === true || busData?.sourceStale === true;\n  const busState = busConfigured === false ? "UNKNOWN" : busNeedsLogin ? "AUTH_REQUIRED" : busFailed ? (bus?.busLastSuccessAt ? "WARNING" : "ERROR") : bus?.busLastSuccessAt ? "HEALTHY" : "UNKNOWN";\n\n  let hbi = null;\n  try { hbi = hbiPhotoDiagnostics instanceof Map ? hbiPhotoDiagnostics.get(String(branch || "").toUpperCase()) || null : null; } catch {}\n  const hbiCode = supervisorSourceCode(hbi?.errorCode || "");\n  const hbiState = hbi?.state === "ready" ? "HEALTHY" : hbi?.state === "expired" ? "AUTH_REQUIRED" : hbi?.state === "error" ? "ERROR" : "UNKNOWN";\n\n  return {\n    route: { state: routeState, configured: routeConfigured, observed: routeConfigured, errorCode: routeCode, recovery: routeState === "AUTH_REQUIRED" ? "AUTH_REQUIRED" : routeState === "ERROR" ? "REVIEW_REQUIRED" : routeState === "HEALTHY" ? "OK" : routeConfigured ? "UNKNOWN" : "CONFIG_REQUIRED" },\n    preEntry: { state: preState, configured: null, observed: preFailed || preObservedSuccess, errorCode: preCode, recovery: preState === "AUTH_REQUIRED" ? "AUTH_REQUIRED" : preState === "ERROR" ? "REVIEW_REQUIRED" : preState === "HEALTHY" ? "OK" : "UNKNOWN" },\n    busTime: { state: busState, configured: busConfigured, observed: busConfigured === true, lastSuccessAt: bus?.busLastSuccessAt || "", retryAt: bus?.busCooldownUntil || busData?.retryAt || "", errorCode: busCode, recovery: busNeedsLogin ? "AUTH_REQUIRED" : (bus?.busCooldownUntil || busData?.retryAt) ? "RETRY_WAIT" : busState === "HEALTHY" ? "OK" : busState === "ERROR" ? "REVIEW_REQUIRED" : "UNKNOWN" },\n    hbiPhotos: { state: hbiState, configured: hbi ? true : null, observed: Boolean(hbi?.checkedAt), lastSuccessAt: hbi?.state === "ready" ? hbi.checkedAt || "" : "", lastUsedAt: hbi?.checkedAt || "", errorCode: hbiCode, recovery: hbiState === "AUTH_REQUIRED" ? "AUTH_REQUIRED" : hbiState === "ERROR" ? "REVIEW_REQUIRED" : hbiState === "HEALTHY" ? "OK" : "UNKNOWN", mode: "CLICK_ONLY" },\n  };\n}\nfunction supervisorSanitizedSourceTelemetry(value) {\n  const input = value && typeof value === "object" ? value : {};\n  const clean = (item, defaultMode = "REFRESH") => {\n    item = item && typeof item === "object" ? item : {};\n    const state = String(item.state || "").toUpperCase();\n    return {\n      state: ["HEALTHY", "WARNING", "CRITICAL", "STALE", "PARTIAL", "AUTH_REQUIRED", "ERROR", "BLOCKED", "UNKNOWN", "RECOVERED"].includes(state) ? state : "UNKNOWN",\n      configured: typeof item.configured === "boolean" ? item.configured : null,\n      observed: item.observed === true,\n      lastSuccessAt: typeof item.lastSuccessAt === "string" ? item.lastSuccessAt : "",\n      lastUsedAt: typeof item.lastUsedAt === "string" ? item.lastUsedAt : "",\n      retryAt: typeof item.retryAt === "string" ? item.retryAt : "",\n      errorCode: supervisorSourceCode(item.errorCode),\n      recovery: supervisorSourceCode(item.recovery) || "UNKNOWN",\n      mode: String(item.mode || "").toUpperCase() === "CLICK_ONLY" ? "CLICK_ONLY" : defaultMode,\n    };\n  };\n  return { route: clean(input.route), preEntry: clean(input.preEntry), busTime: clean(input.busTime), hbiPhotos: clean(input.hbiPhotos, "CLICK_ONLY") };\n}\n\nasync function runMsRefresh(env, branch) {`,
    "source health helper",
  );

  output = replaceOnce(
    output,
    `    const tbrShadowFeed = msTbrShadowFeed(busData);`,
    `    const tbrShadowFeed = msTbrShadowFeed(busData);\n    const supervisorSourceTelemetry = supervisorRefreshSourceTelemetry(branch, credentials, rows, parcelCounts, busData);`,
    "refresh source telemetry capture",
  );

  output = replaceOnce(
    output,
    `      completedToday: completedRows.length,\n      tbrShadowFeed,\n    };`,
    `      completedToday: completedRows.length,\n      tbrShadowFeed,\n      sourceTelemetry: supervisorSourceTelemetry,\n    };`,
    "successful refresh source telemetry",
  );

  output = replaceOnce(
    output,
    `          tbrShadowFeed,\n          routeSourceStatus:`,
    `          tbrShadowFeed,\n          sourceTelemetry: supervisorSourceTelemetry,\n          routeSourceStatus:`,
    "Route-degraded refresh source telemetry",
  );

  return output;
}

const invokedPath = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedPath) {
  const target = process.argv[2];
  if (!target) throw new Error("Usage: node patch-supervisor-shared-snapshot.mjs <worker-index.js>");
  await writeFile(target, patchSupervisorSharedSnapshot(await readFile(target, "utf8")), "utf8");
}
