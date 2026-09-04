import fs from 'node:fs';

const indexFile = process.argv[2] || 'src/index.js';
const shadowFile = process.argv[3] || 'src/tbr-shadow.js';
const errorFile = process.argv[4] || 'src/connection-error.js';
let indexSource = fs.readFileSync(indexFile, 'utf8');
let shadowSource = fs.readFileSync(shadowFile, 'utf8');
let errorSource = fs.readFileSync(errorFile, 'utf8');
const MARKER = 'TBR_STALE_SPLIT_BROWSER_V2';

if (!errorSource.includes(MARKER)) {
  const anchor = 'export async function handleConnectionErrorRequest(request, env, url) {';
  if (!errorSource.includes(anchor)) throw new Error('connection error helper anchor not found');
  const helper = `// ${MARKER}: internal Browser TEST error state helpers. Same-error repeats do not write KV.\nexport async function recordConnectionErrorKv(env, input = {}) {\n  const hub = normalizeHub(input.hub);\n  if (!hub || !env?.STATE) return { changed: false, data: null };\n  const source = normalizeSource(input.source);\n  const classified = classify(input.code, input.message);\n  const message = clean(input.message, 240);\n  const key = keyFor(hub);\n  let current = null;\n  try { current = JSON.parse((await env.STATE.get(key)) || \"null\"); } catch {}\n  if (\n    current && !current.recoveredAt &&\n    current.source === source && current.code === classified.code &&\n    current.label === classified.label && current.message === message\n  ) return { changed: false, data: current };\n  const record = {\n    version: VERSION, hub, source, code: classified.code, label: classified.label,\n    message, occurredAt: new Date().toISOString(), recoveredAt: \"\",\n  };\n  await env.STATE.put(key, JSON.stringify(record), { expirationTtl: TTL_SECONDS });\n  return { changed: true, data: record };\n}\n\nexport async function recordConnectionRecoveredKv(env, input = {}) {\n  const hub = normalizeHub(input.hub);\n  if (!hub || !env?.STATE) return { changed: false, data: null };\n  const key = keyFor(hub);\n  let record = null;\n  try { record = JSON.parse((await env.STATE.get(key)) || \"null\"); } catch {}\n  if (!record || record.recoveredAt) return { changed: false, data: record };\n  record.recoveredAt = new Date().toISOString();\n  await env.STATE.put(key, JSON.stringify(record), { expirationTtl: TTL_SECONDS });\n  return { changed: true, data: record };\n}\n\n${anchor}`;
  errorSource = errorSource.replace(anchor, helper);
}

if (!indexSource.includes(MARKER)) {
  const importOld = 'import { handleConnectionErrorRequest } from "./connection-error.js";';
  const importNew = `import {\n  handleConnectionErrorRequest,\n  recordConnectionErrorKv,\n  recordConnectionRecoveredKv,\n} from \"./connection-error.js\";`;
  if (!indexSource.includes(importOld)) throw new Error('connection error import anchor not found');
  indexSource = indexSource.replace(importOld, importNew);

  const syncStart = indexSource.indexOf('async function sendConnectorSync(env, hub, connectorToken) {');
  const syncEnd = indexSource.indexOf('\n}\n\nasync function syncConfiguredHubs', syncStart);
  if (syncStart < 0 || syncEnd <= syncStart) throw new Error('sendConnectorSync function not found');
  const syncReplacement = `// ${MARKER}: Route and TBR/BusTime use separate DEV Worker invocations.\n// This prevents one growing operating day from hitting a single-invocation subrequest ceiling.\nasync function sendConnectorPart(env, hub, connectorToken, shadowPart) {\n  return mainApiFetch(env, {\n    action: \"connectorSync\",\n    hub, connectorToken, shadowOnly: true, shadowPart,\n  });\n}\n\nasync function connectorPartPayload(response) {\n  return response.clone().json().catch(() => ({}));\n}\n\nfunction connectorPartFailure(part, response, payload) {\n  const originalCode = String(payload?.code || \"\");\n  const code = originalCode === \"INVALID_CONNECTOR\"\n    ? originalCode\n    : originalCode || \`TBR_\${part.toUpperCase()}_HTTP_\${response.status}\`;\n  const message = String(payload?.message || \`\${part} source ตอบกลับ HTTP \${response.status}\`);\n  return new Response(JSON.stringify({ ok: false, code, message, sourcePart: part }), {\n    status: response.status || 503,\n    headers: { \"content-type\": \"application/json; charset=utf-8\" },\n  });\n}\n\nasync function sendConnectorSync(env, hub, connectorToken) {\n  const [routeResponse, busResponse] = await Promise.all([\n    sendConnectorPart(env, hub, connectorToken, \"routes\"),\n    sendConnectorPart(env, hub, connectorToken, \"bus\"),\n  ]);\n  const [routePayload, busPayload] = await Promise.all([\n    connectorPartPayload(routeResponse),\n    connectorPartPayload(busResponse),\n  ]);\n  if (!routeResponse.ok) return connectorPartFailure(\"routes\", routeResponse, routePayload);\n  if (!busResponse.ok) return connectorPartFailure(\"bus\", busResponse, busPayload);\n  const rows = Array.isArray(routePayload?.data?.rows) ? routePayload.data.rows : [];\n  const tbrShadowFeed = Array.isArray(busPayload?.data?.tbrShadowFeed)\n    ? busPayload.data.tbrShadowFeed : [];\n  return new Response(JSON.stringify({\n    ok: true,\n    data: {\n      status: \"shadow_readonly_split\",\n      syncedAt: new Date().toISOString(),\n      changes: 0, rows, tbrShadowFeed,\n      shadowQuota: {\n        mode: \"SHADOW_READONLY_SPLIT_V2\",\n        tursoPointReadsPerCron: 4, tursoWritesPerCron: 0,\n        routeTableReads: 0, routeTableWrites: 0,\n        historyReads: 0, historyWrites: 0,\n        liveCacheReads: 0, liveCacheWrites: 0, preEntryCalls: 0,\n      },\n    },\n  }), { status: 200, headers: { \"content-type\": \"application/json; charset=utf-8\" } });\n}\n`;
  indexSource = indexSource.slice(0, syncStart) + syncReplacement + indexSource.slice(syncEnd + 2);

  const observerAnchor = `        // TBR_SHADOW_OBSERVER_V1: observe the already-returned BusTime feed only.\n        // This writes event changes to Browser KV and never writes Turso.\n        if (response.ok) {\n          try {\n            await observeTbrShadow(env, hub, payload?.data || {});\n          } catch (shadowError) {`;
  const observerReplacement = `        if (!response.ok) {\n          try {\n            const failedShadow = await observeTbrShadow(env, hub, {});\n            if (failedShadow?.sourceChanged) {\n              const failureCode = String(payload?.code || \`HTTP_\${response.status}\`);\n              const failureSource = failureCode.includes(\"BUS\") ? \"busTime\" : \"routes\";\n              await recordConnectionErrorKv(env, {\n                hub, source: failureSource, code: failureCode,\n                message: payload?.message || \`DEV Shadow ตอบกลับ HTTP \${response.status}\`,\n              });\n            }\n          } catch (healthError) {\n            console.error(JSON.stringify({ event: \"tbr_shadow_failure_health_error\", hub, message: healthError?.message || String(healthError) }));\n          }\n        }\n        // TBR_SHADOW_OBSERVER_V1: observe the combined read-only source only.\n        if (response.ok) {\n          try {\n            const observedShadow = await observeTbrShadow(env, hub, payload?.data || {});\n            if (observedShadow?.sourceChanged)\n              await recordConnectionRecoveredKv(env, { hub });\n          } catch (shadowError) {`;
  if (!indexSource.includes(observerAnchor)) throw new Error('observer status anchor not found');
  indexSource = indexSource.replace(observerAnchor, observerReplacement);
}

if (!shadowSource.includes(MARKER)) {
  const constantAnchor = 'const SHADOW_HEALTH_WRITE_MS = 5 * 60 * 1000;';
  if (!shadowSource.includes(constantAnchor)) throw new Error('stale constant anchor not found');
  shadowSource = shadowSource.replace(constantAnchor, `${constantAnchor}\nconst SHADOW_STALE_MS = 7 * 60 * 1000; // ${MARKER}`);

  const observerAnchor = `function observerStatus(state) {\n  if (state?.sourceAvailable === true) return \"LIVE\";\n  if (state?.sourceAvailable === false) return \"WAITING_SOURCE\";\n  return \"NEVER_OBSERVED\";\n}`;
  const observerBlock = `${observerAnchor}\n\nfunction reportObserverStatus(state, now = Date.now()) {\n  const lastAttempt = validTime(state?.lastAttemptAt);\n  if (lastAttempt !== null && now - lastAttempt > SHADOW_STALE_MS) return \"STALE\";\n  return observerStatus(state);\n}\n\nfunction staleMinutes(state, now = Date.now()) {\n  const lastAttempt = validTime(state?.lastAttemptAt);\n  return lastAttempt === null ? null : Math.max(0, Math.floor((now - lastAttempt) / 60000));\n}`;
  if (!shadowSource.includes(observerAnchor)) throw new Error('observerStatus anchor not found');
  shadowSource = shadowSource.replace(observerAnchor, observerBlock);

  shadowSource = shadowSource.replace(
    `  if (status === \"LIVE\") return \"LIVE · รับข้อมูลจาก DEV แล้ว\";\n  if (status === \"WAITING_SOURCE\") return \"รอ source จาก DEV\";`,
    `  if (status === \"LIVE\") return \"LIVE · รับข้อมูลจาก DEV แล้ว\";\n  if (status === \"STALE\") return \"STALE · ข้อมูลหยุดอัปเดตเกิน 7 นาที\";\n  if (status === \"WAITING_SOURCE\") return \"รอ source จาก DEV\";`,
  );
  shadowSource = shadowSource.replace('observerStatus: observerStatus(state),', 'observerStatus: reportObserverStatus(state),');
  const sourceLine = '    sourceAvailable: state.sourceAvailable ?? null,';
  if (!shadowSource.includes(sourceLine)) throw new Error('report stale minute anchor not found');
  shadowSource = shadowSource.replace(sourceLine, `${sourceLine}\n    staleMinutes: staleMinutes(state),`);
  shadowSource = shadowSource.replace(
    `const statusClass = status === \"LIVE\" ? \"live\" : status === \"WAITING_SOURCE\" ? \"wait\" : \"never\";`,
    `const statusClass = status === \"LIVE\" ? \"live\" : status === \"STALE\" ? \"stale\" : status === \"WAITING_SOURCE\" ? \"wait\" : \"never\";`,
  );
  shadowSource = shadowSource.replace('.live{color:#067647}.wait{color:#b54708}.never{color:#667085}', '.live{color:#067647}.stale{color:#b42318;background:#fff7f6;border-color:#fecdca}.wait{color:#b54708}.never{color:#667085}');

  const stateAnchor = '  const state = parseState(await env.STATE.get(key), hub);\n  const feedAvailable';
  if (!shadowSource.includes(stateAnchor)) throw new Error('sourceChanged state anchor not found');
  shadowSource = shadowSource.replace(stateAnchor, '  const state = parseState(await env.STATE.get(key), hub);\n  const previousSourceAvailable = state.sourceAvailable;\n  const feedAvailable');
  shadowSource = shadowSource.replace(
    '      sourceAvailable: false,\n      skipped: "source_unavailable",',
    '      sourceAvailable: false,\n      sourceChanged: previousSourceAvailable !== false,\n      skipped: "source_unavailable",',
  );
  shadowSource = shadowSource.replace(
    '      sourceAvailable: true,\n      ...result,',
    '      sourceAvailable: true,\n      sourceChanged: previousSourceAvailable !== true,\n      ...result,',
  );
  shadowSource = shadowSource.replace(
    '    sourceAvailable: true,\n    ...summary(state),',
    '    sourceAvailable: true,\n    sourceChanged: previousSourceAvailable !== true,\n    ...summary(state),',
  );
}

fs.writeFileSync(indexFile, indexSource);
fs.writeFileSync(shadowFile, shadowSource);
fs.writeFileSync(errorFile, errorSource);
console.log('TBR_STALE_SPLIT_BROWSER_V2=PASS');
