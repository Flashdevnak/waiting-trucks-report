import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const MARKER = "BROWSER_CRON_TRACE_V1";

function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last) throw new Error(`Cron trace patch failed: ${label}`);
  return output.replace(from, to);
}

export function patchCronTrace(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;

  output = replaceUnique(
    output,
    `    if (url.pathname === "/api/connection-error")\n      return handleConnectionErrorRequest(request, env, url);`,
    `    if (url.pathname === "/api/connection-error")\n      return handleConnectionErrorRequest(request, env, url);\n    // ${MARKER}: safe Browser TEST scheduled-cycle diagnostics. Never exposes connector values.\n    if (url.pathname === "/api/cron-health")\n      return reply(await readCronHealth(env));`,
    "add cron-health route",
  );

  output = replaceUnique(
    output,
    `  async scheduled(_controller, env, ctx) {\n    ctx.waitUntil(syncConfiguredHubs(env));\n  },`,
    `  async scheduled(_controller, env, ctx) {\n    ctx.waitUntil(runScheduledCycle(env));\n  },`,
    "wrap scheduled cycle",
  );

  const helperBlock = `const CRON_HEALTH_KEY = "cron:health:v2";\n\nasync function readCronHealthState(env) {\n  let state = {};\n  try { state = JSON.parse((await env.STATE.get(CRON_HEALTH_KEY)) || "{}"); } catch {}\n  return state && typeof state === "object" ? state : {};\n}\n\nasync function writeCronHealthState(env, state) {\n  await env.STATE.put(CRON_HEALTH_KEY, JSON.stringify(state), { expirationTtl: 7 * 24 * 60 * 60 });\n}\n\nasync function readCronHealth(env) {\n  const state = await readCronHealthState(env);\n  let hubs = [];\n  try { hubs = JSON.parse((await env.STATE.get("hubs")) || "[]"); } catch {}\n  if (!Array.isArray(hubs)) hubs = [];\n  const cleanHubs = hubs.map((hub) => String(hub || "").trim().toUpperCase()).filter(Boolean);\n  const hasConnector = {};\n  for (const hub of cleanHubs) hasConnector[hub] = Boolean(await env.STATE.get(\`connector:\${hub}\`));\n  return {\n    ok: true,\n    testOnly: true,\n    lastScheduledAt: String(state.lastScheduledAt || ""),\n    lastCompletedAt: String(state.lastCompletedAt || ""),\n    lastCycleError: String(state.lastCycleError || "").slice(0, 300),\n    runCount: Number(state.runCount || 0),\n    hubs: cleanHubs,\n    hasConnector,\n    hubTrace: state.hubTrace && typeof state.hubTrace === "object" ? state.hubTrace : {},\n    connectorValuesExposed: 0,\n  };\n}\n\nasync function traceHub(env, hub, patch) {\n  const state = await readCronHealthState(env);\n  state.hubTrace = state.hubTrace && typeof state.hubTrace === "object" ? state.hubTrace : {};\n  state.hubTrace[hub] = {\n    ...(state.hubTrace[hub] || {}),\n    ...patch,\n    at: new Date().toISOString(),\n  };\n  await writeCronHealthState(env, state);\n}\n\nasync function runScheduledCycle(env) {\n  const state = await readCronHealthState(env);\n  state.lastScheduledAt = new Date().toISOString();\n  state.runCount = Number(state.runCount || 0) + 1;\n  state.lastCycleError = "";\n  await writeCronHealthState(env, state);\n  try {\n    await syncConfiguredHubs(env);\n    const done = await readCronHealthState(env);\n    done.lastCompletedAt = new Date().toISOString();\n    await writeCronHealthState(env, done);\n  } catch (error) {\n    const failed = await readCronHealthState(env);\n    failed.lastCycleError = error?.message || String(error);\n    await writeCronHealthState(env, failed);\n    throw error;\n  }\n}\n\n`;

  output = replaceUnique(
    output,
    `async function syncConfiguredHubs(env) {`,
    `${helperBlock}async function syncConfiguredHubs(env) {`,
    "add cron health helpers",
  );

  output = replaceUnique(
    output,
    `        if (!connectorToken) return;\n\n        let response = await sendConnectorSync(env, hub, connectorToken);`,
    `        if (!connectorToken) {\n          await traceHub(env, hub, { phase: "NO_CONNECTOR", responseStatus: null, responseCode: "", responseOk: false, hasRows: false, hasTbrShadowFeed: false });\n          return;\n        }\n\n        await traceHub(env, hub, { phase: "SYNC_START", responseStatus: null, responseCode: "", responseOk: false, hasRows: false, hasTbrShadowFeed: false });\n        let response = await sendConnectorSync(env, hub, connectorToken);`,
    "trace connector presence",
  );

  output = replaceUnique(
    output,
    `        let payload = await response.clone().json().catch(() => ({}));`,
    `        let payload = await response.clone().json().catch(() => ({}));\n        await traceHub(env, hub, {\n          phase: "SYNC_RESPONSE",\n          responseStatus: response.status,\n          responseCode: String(payload?.code || payload?.data?.code || ""),\n          responseOk: response.ok && payload?.ok !== false,\n          hasRows: Array.isArray(payload?.data?.rows),\n          hasTbrShadowFeed: Array.isArray(payload?.data?.tbrShadowFeed),\n          rowCount: Array.isArray(payload?.data?.rows) ? payload.data.rows.length : null,\n          feedCount: Array.isArray(payload?.data?.tbrShadowFeed) ? payload.data.tbrShadowFeed.length : null,\n        });`,
    "trace connector response",
  );

  output = replaceUnique(
    output,
    `            await observeTbrShadow(env, hub, payload?.data || {});`,
    `            const shadowResult = await observeTbrShadow(env, hub, payload?.data || {});\n            await traceHub(env, hub, {\n              phase: "SHADOW_OBSERVED",\n              shadowStatus: String(shadowResult?.observerStatus || ""),\n              shadowSourceAvailable: shadowResult?.sourceAvailable === true,\n              shadowSkipped: String(shadowResult?.skipped || ""),\n            });`,
    "trace shadow result",
  );

  output = replaceUnique(
    output,
    `          } catch (shadowError) {\n            console.error(`,
    `          } catch (shadowError) {\n            await traceHub(env, hub, { phase: "SHADOW_ERROR", error: String(shadowError?.message || shadowError).slice(0, 300) });\n            console.error(`,
    "trace shadow error",
  );

  output = replaceUnique(
    output,
    `      } catch (error) {\n        console.error(\n          JSON.stringify({\n            event: "connector_sync_error",`,
    `      } catch (error) {\n        await traceHub(env, hub, { phase: "SYNC_ERROR", error: String(error?.message || error).slice(0, 300) });\n        console.error(\n          JSON.stringify({\n            event: "connector_sync_error",`,
    "trace sync error",
  );

  return output;
}

export async function patchCronTraceFile(target) {
  const source = await readFile(target, "utf8");
  const patched = patchCronTrace(source);
  if (patched !== source) await writeFile(target, patched, "utf8");
  return patched !== source;
}

const invokedPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (invokedPath) {
  const target = process.argv[2] || new URL("../src/index.js", import.meta.url);
  const changed = await patchCronTraceFile(target);
  console.log(`BROWSER_CRON_TRACE_PATCH=${changed ? "APPLIED" : "ALREADY_PRESENT"}`);
}
