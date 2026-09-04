import fs from 'node:fs';

const path = new URL('../src/index.js', import.meta.url);
let source = fs.readFileSync(path, 'utf8');

const oldScheduled = `  async scheduled(_controller, env, ctx) {\n    ctx.waitUntil(syncConfiguredHubs(env));\n  },`;
const newScheduled = `  async scheduled(_controller, env, ctx) {\n    ctx.waitUntil(runScheduledCycle(env));\n  },`;
if (!source.includes(oldScheduled)) throw new Error('scheduled() patch anchor not found');
source = source.replace(oldScheduled, newScheduled);

const routeAnchor = `    if (url.pathname === \"/api/connection-error\")\n      return handleConnectionErrorRequest(request, env, url);`;
const routeReplacement = `${routeAnchor}\n    if (url.pathname === \"/api/cron-health\")\n      return reply(await readCronHealth(env));`;
if (!source.includes(routeAnchor)) throw new Error('cron health route anchor not found');
source = source.replace(routeAnchor, routeReplacement);

const functionAnchor = `async function syncConfiguredHubs(env) {`;
const instrumentation = `async function readCronHealth(env) {\n  const raw = env?.STATE ? await env.STATE.get(\"cron:health:v1\") : null;\n  let health = {};\n  try { health = JSON.parse(raw || \"{}\"); } catch {}\n  let hubs = [];\n  try { hubs = JSON.parse((await env.STATE.get(\"hubs\")) || \"[]\"); } catch {}\n  if (!Array.isArray(hubs)) hubs = [];\n  const hasConnectorNE1 = Boolean(await env.STATE.get(\"connector:NE1\"));\n  return {\n    ok: true,\n    testOnly: true,\n    lastScheduledAt: String(health.lastScheduledAt || \"\"),\n    lastCompletedAt: String(health.lastCompletedAt || \"\"),\n    lastErrorAt: String(health.lastErrorAt || \"\"),\n    lastError: String(health.lastError || \"\").slice(0, 240),\n    runCount: Number(health.runCount || 0),\n    hubs: hubs.map((hub) => String(hub || \"\").toUpperCase()).filter(Boolean),\n    hasConnectorNE1,\n    connectorValuesExposed: 0,\n  };\n}\n\nasync function runScheduledCycle(env) {\n  const key = \"cron:health:v1\";\n  let health = {};\n  try { health = JSON.parse((await env.STATE.get(key)) || \"{}\"); } catch {}\n  const now = new Date().toISOString();\n  health.lastScheduledAt = now;\n  health.runCount = Number(health.runCount || 0) + 1;\n  health.lastError = \"\";\n  await env.STATE.put(key, JSON.stringify(health), { expirationTtl: 7 * 24 * 60 * 60 });\n  try {\n    await syncConfiguredHubs(env);\n    health.lastCompletedAt = new Date().toISOString();\n  } catch (error) {\n    health.lastErrorAt = new Date().toISOString();\n    health.lastError = error?.message || String(error);\n    throw error;\n  } finally {\n    await env.STATE.put(key, JSON.stringify(health), { expirationTtl: 7 * 24 * 60 * 60 });\n  }\n}\n\n${functionAnchor}`;
if (!source.includes(functionAnchor)) throw new Error('syncConfiguredHubs patch anchor not found');
source = source.replace(functionAnchor, instrumentation);

fs.writeFileSync(path, source);
console.log('CRON_HEALTH_PATCH=PASS');
