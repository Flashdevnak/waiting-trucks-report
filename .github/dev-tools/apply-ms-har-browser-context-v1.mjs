import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function write(path, content) { fs.writeFileSync(path, content); }
function replaceOnce(content, from, to, label) {
  const first = content.indexOf(from);
  if (first < 0) throw new Error(`missing patch anchor: ${label}`);
  if (content.indexOf(from, first + from.length) >= 0) throw new Error(`duplicate patch anchor: ${label}`);
  return content.slice(0, first) + to + content.slice(first + from.length);
}

let ms = read("ms.js");
const msOld = `    const header = (name) =>\n      entry.request.headers?.find((item) => item.name?.toLowerCase() === name)\n        ?.value || \"\";\n    const sessionId = header(\"x-fle-session-id\"),\n      deviceId = header(\"x-device-id\");\n    if (!sessionId || !deviceId)\n      throw new Error(\"ไฟล์ HAR ไม่มี Session ID หรือ Device ID\");\n    const result = await apiPost(\"saveMsConnection\", {\n      hub,\n      sessionId,\n      deviceId,\n    });`;
const msNew = `    // MS_HAR_BROWSER_CONTEXT_V1: preserve the minimal browser identity from the\n    // successful HAR request. Raw HAR is still parsed locally and never uploaded.\n    const header = (name) =>\n      entry.request.headers?.find((item) => item.name?.toLowerCase() === name)\n        ?.value || \"\";\n    const sessionId = header(\"x-fle-session-id\"),\n      deviceId = header(\"x-device-id\");\n    if (!sessionId || !deviceId)\n      throw new Error(\"ไฟล์ HAR ไม่มี Session ID หรือ Device ID\");\n    const browserContext = {};\n    for (const name of [\n      \"user-agent\",\n      \"accept\",\n      \"accept-language\",\n      \"cache-control\",\n      \"pragma\",\n      \"sec-ch-ua\",\n      \"sec-ch-ua-mobile\",\n      \"sec-ch-ua-platform\",\n      \"cookie\",\n      \"x-fh-ms-equipment-type\",\n    ]) {\n      const value = header(name);\n      if (value) browserContext[name] = value.slice(0, name === \"cookie\" ? 8000 : 1500);\n    }\n    const result = await apiPost(\"saveMsConnection\", {\n      hub,\n      sessionId,\n      deviceId,\n      browserContext,\n    });`;
ms = replaceOnce(ms, msOld, msNew, "ms.js HAR save payload");
write("ms.js", ms);

let worker = read("worker/src/index.js");
const readAnchor = `async function readMsPage(credentials, page, start, end) {`;
const helpers = `// MS_HAR_BROWSER_CONTEXT_V1: replay only an allowlisted, encrypted subset of\n// the browser context that produced a confirmed HTTP 200 HAR entry. This is\n// browser-agnostic and keeps old session/device-only credentials compatible.\nconst MS_BROWSER_CONTEXT_HEADERS = new Set([\n  \"user-agent\",\n  \"accept\",\n  \"accept-language\",\n  \"cache-control\",\n  \"pragma\",\n  \"sec-ch-ua\",\n  \"sec-ch-ua-mobile\",\n  \"sec-ch-ua-platform\",\n  \"cookie\",\n  \"x-fh-ms-equipment-type\",\n]);\nfunction normalizeMsBrowserContext(input) {\n  const source = input && typeof input === \"object\" && !Array.isArray(input) ? input : {};\n  const result = {};\n  for (const [rawName, rawValue] of Object.entries(source)) {\n    const name = String(rawName || \"\").trim().toLowerCase();\n    if (!MS_BROWSER_CONTEXT_HEADERS.has(name)) continue;\n    const value = text(rawValue, name === \"cookie\" ? 8000 : 1500);\n    if (value) result[name] = value;\n  }\n  return result;\n}\nfunction msBrowserRequestHeaders(credentials) {\n  const context = normalizeMsBrowserContext(credentials?.browserContext);\n  const headers = {\n    Accept: context.accept || \"application/json, text/plain, */*\",\n    \"Accept-Language\": context[\"accept-language\"] || \"th\",\n    \"Cache-Control\": context[\"cache-control\"] || \"no-cache\",\n    Origin: \"https://ms.flashexpress.com\",\n    Referer: \"https://ms.flashexpress.com/\",\n    \"User-Agent\": context[\"user-agent\"] || \"Mozilla/5.0\",\n    \"X-DEVICE-ID\": credentials.deviceId,\n    \"X-FH-MS-EQUIPMENT-TYPE\": context[\"x-fh-ms-equipment-type\"] || \"5\",\n    \"X-FLE-SESSION-ID\": credentials.sessionId,\n  };\n  for (const name of [\"pragma\", \"sec-ch-ua\", \"sec-ch-ua-mobile\", \"sec-ch-ua-platform\", \"cookie\"])\n    if (context[name]) headers[name] = context[name];\n  return headers;\n}\n\nasync function readMsPage(credentials, page, start, end) {`;
worker = replaceOnce(worker, readAnchor, helpers, "worker browser-context helpers");

const oldHeaders = `  const response = await fetch(url, {\n    headers: {\n      Accept: \"application/json, text/plain, */*\",\n      \"Accept-Language\": \"th\",\n      \"Cache-Control\": \"no-cache\",\n      Origin: \"https://ms.flashexpress.com\",\n      Referer: \"https://ms.flashexpress.com/\",\n      \"User-Agent\": \"Mozilla/5.0\",\n      \"X-DEVICE-ID\": credentials.deviceId,\n      \"X-FH-MS-EQUIPMENT-TYPE\": \"5\",\n      \"X-FLE-SESSION-ID\": credentials.sessionId,\n    },\n  });`;
const newHeaders = `  const response = await fetch(url, { headers: msBrowserRequestHeaders(credentials) });`;
worker = replaceOnce(worker, oldHeaders, newHeaders, "worker MS request headers");

const oldSave = `async function saveMsConnection(body, actor, env) {\n  const hub = canonicalHubCode(body.hub),\n    sessionId = text(body.sessionId, 2000),\n    deviceId = text(body.deviceId, 500);\n  if (!hub || !sessionId || !deviceId)\n    fail(\"ไฟล์ HAR ไม่มีข้อมูลเซสชัน MS ที่ต้องใช้\", \"INVALID_HAR\");\n  if (!access(hub, actor))\n    fail(\"บัญชีนี้ไม่มีสิทธิ์เชื่อมต่อ HUB ที่เลือก\", \"FORBIDDEN\", 403);\n  return persistMsConnection(hub, sessionId, deviceId, actor.username, env);\n}`;
const newSave = `async function saveMsConnection(body, actor, env) {\n  const hub = canonicalHubCode(body.hub),\n    sessionId = text(body.sessionId, 2000),\n    deviceId = text(body.deviceId, 500),\n    browserContext = normalizeMsBrowserContext(body.browserContext);\n  if (!hub || !sessionId || !deviceId)\n    fail(\"ไฟล์ HAR ไม่มีข้อมูลเซสชัน MS ที่ต้องใช้\", \"INVALID_HAR\");\n  if (!access(hub, actor))\n    fail(\"บัญชีนี้ไม่มีสิทธิ์เชื่อมต่อ HUB ที่เลือก\", \"FORBIDDEN\", 403);\n  return persistMsConnection(hub, sessionId, deviceId, actor.username, env, browserContext);\n}`;
worker = replaceOnce(worker, oldSave, newSave, "worker saveMsConnection");

worker = replaceOnce(
  worker,
  `async function persistMsConnection(hub, sessionId, deviceId, updatedBy, env) {`,
  `async function persistMsConnection(hub, sessionId, deviceId, updatedBy, env, browserContext = {}) {`,
  "persist signature",
);
worker = replaceOnce(
  worker,
  `  const test = await readMsPage({ sessionId, deviceId }, 1, start, end);`,
  `  const normalizedBrowserContext = normalizeMsBrowserContext(browserContext);\n  const test = await readMsPage({ sessionId, deviceId, browserContext: normalizedBrowserContext }, 1, start, end);`,
  "persist probe",
);
worker = replaceOnce(
  worker,
  `      await encryptMs(deviceId, env),`,
  `      await encryptMs(JSON.stringify({ v: 2, deviceId, browserContext: normalizedBrowserContext }), env),`,
  "persist encrypted device envelope",
);
worker = replaceOnce(
  worker,
  `    value: { sessionId, deviceId },`,
  `    value: { sessionId, deviceId, browserContext: normalizedBrowserContext },`,
  "persist credential cache",
);

const oldCredentials = `  if (row) {\n    const value = {\n      sessionId: await decryptMs(row.session_cipher, env),\n      deviceId: await decryptMs(row.device_cipher, env),\n    };\n    msCredentialCache.set(key, { until: Date.now() + MS_CREDENTIAL_CACHE_MS, value });\n    return value;\n  }`;
const newCredentials = `  if (row) {\n    const rawDevice = await decryptMs(row.device_cipher, env);\n    let deviceId = rawDevice, browserContext = {};\n    try {\n      const envelope = JSON.parse(rawDevice);\n      if (envelope?.v === 2 && typeof envelope.deviceId === \"string\" && envelope.deviceId) {\n        deviceId = envelope.deviceId;\n        browserContext = normalizeMsBrowserContext(envelope.browserContext);\n      }\n    } catch {}\n    const value = {\n      sessionId: await decryptMs(row.session_cipher, env),\n      deviceId,\n      browserContext,\n    };\n    msCredentialCache.set(key, { until: Date.now() + MS_CREDENTIAL_CACHE_MS, value });\n    return value;\n  }`;
worker = replaceOnce(worker, oldCredentials, newCredentials, "msCredentials envelope decode");
write("worker/src/index.js", worker);

const testPath = "worker/tests/ms-har-browser-context.test.mjs";
write(testPath, `import assert from \"node:assert/strict\";\nimport fs from \"node:fs\";\nimport test from \"node:test\";\n\nconst frontend = fs.readFileSync(new URL(\"../../ms.js\", import.meta.url), \"utf8\");\nconst worker = fs.readFileSync(new URL(\"../src/index.js\", import.meta.url), \"utf8\");\n\ntest(\"HAR upload preserves minimal browser context without uploading raw HAR\", () => {\n  assert.match(frontend, /MS_HAR_BROWSER_CONTEXT_V1/);\n  assert.match(frontend, /browserContext/);\n  for (const header of [\"user-agent\", \"accept-language\", \"sec-ch-ua\", \"cookie\"])\n    assert.ok(frontend.includes(\`\"\${header}\"\`), header);\n  assert.match(frontend, /apiPost\\(\"saveMsConnection\"/);\n});\n\ntest(\"DEV Worker replays allowlisted context and keeps old device-only rows compatible\", () => {\n  assert.match(worker, /MS_HAR_BROWSER_CONTEXT_V1/);\n  assert.match(worker, /normalizeMsBrowserContext/);\n  assert.match(worker, /msBrowserRequestHeaders/);\n  assert.match(worker, /JSON\\.stringify\\(\\{ v: 2, deviceId, browserContext: normalizedBrowserContext \\}\\)/);\n  assert.match(worker, /let deviceId = rawDevice, browserContext = \\{\\};/);\n  assert.match(worker, /context\\[\"user-agent\"\\] \\|\\| \"Mozilla\\/5\\.0\"/);\n});\n`);

let pkg = read("worker/package.json");
pkg = replaceOnce(
  pkg,
  `node --test tests/ms-owner-live-v8.test.mjs`,
  `node --test tests/ms-owner-live-v8.test.mjs tests/ms-har-browser-context.test.mjs`,
  "worker check includes browser-context test",
);
write("worker/package.json", pkg);

console.log("MS_HAR_BROWSER_CONTEXT_V1 patch applied");
