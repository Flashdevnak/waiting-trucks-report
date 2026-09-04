import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SHADOW_MARKER = "TBR_SHADOW_OBSERVER_V1";
const SHADOW_REPORT_MARKER = "TBR_SHADOW_REPORT_V1";
const CONNECTION_ERROR_MARKER = "MS_CONNECTION_ERROR_KV_V1";
const DEV_SERVICE_BINDING_MARKER = "BROWSER_DEV_SERVICE_BINDING_V1";

function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`Browser connector patch failed: ${label}`);
  return output.replace(from, to);
}

function ensureConnectionErrorRoute(source) {
  let output = String(source || "");
  if (output.includes(CONNECTION_ERROR_MARKER)) return output;

  if (!output.includes('import { handleConnectionErrorRequest } from "./connection-error.js";')) {
    const importAnchor = 'import { observeTbrShadow, readTbrShadowReport, tbrShadowPage } from "./tbr-shadow.js";';
    output = replaceUnique(
      output,
      importAnchor,
      `${importAnchor}\nimport { handleConnectionErrorRequest } from "./connection-error.js";`,
      "add Browser KV connection error import",
    );
  }

  const routeAnchor = `    if (url.pathname === "/api/shadow-tbr")\n      return reply(\n        await readTbrShadowReport(env, url.searchParams.get("hub") || "NE1"),\n      );\n    if (!url.pathname.startsWith("/api/"))`;
  const routeBlock = `    if (url.pathname === "/api/shadow-tbr")\n      return reply(\n        await readTbrShadowReport(env, url.searchParams.get("hub") || "NE1"),\n      );\n    // ${CONNECTION_ERROR_MARKER}: HAR/MS connection errors live in Browser KV only.\n    if (url.pathname === "/api/connection-error")\n      return handleConnectionErrorRequest(request, env, url);\n    if (!url.pathname.startsWith("/api/"))`;
  return replaceUnique(
    output,
    routeAnchor,
    routeBlock,
    "add Browser KV connection error route",
  );
}

function patchTbrShadowObserver(source) {
  let output = String(source || "");

  if (!output.includes(SHADOW_MARKER)) {
    output = replaceUnique(
      output,
      `import puppeteer from "@cloudflare/puppeteer";`,
      `import puppeteer from "@cloudflare/puppeteer";\nimport { observeTbrShadow, readTbrShadowReport, tbrShadowPage } from "./tbr-shadow.js";`,
      "add TBR shadow observer import",
    );

    const syncBlock = `        } else if (!response.ok) {\n          console.error(\n            JSON.stringify({\n              event: "connector_sync_blocked",\n              hub,\n              status: response.status,\n              code: payload?.code || "UNKNOWN",\n            }),\n          );\n        }`;

    output = replaceUnique(
      output,
      syncBlock,
      `${syncBlock}\n        // ${SHADOW_MARKER}: observe the already-returned BusTime feed only.\n        // This writes event changes to Browser KV and never writes Turso.\n        if (response.ok) {\n          try {\n            await observeTbrShadow(env, hub, payload?.data || {});\n          } catch (shadowError) {\n            console.error(\n              JSON.stringify({\n                event: "tbr_shadow_error",\n                hub,\n                message: shadowError?.message || String(shadowError),\n              }),\n            );\n          }\n        }`,
      "observe successful connector sync without another network call",
    );
  } else if (
    output.includes('import { observeTbrShadow } from "./tbr-shadow.js";')
  ) {
    output = output.replace(
      'import { observeTbrShadow } from "./tbr-shadow.js";',
      'import { observeTbrShadow, readTbrShadowReport, tbrShadowPage } from "./tbr-shadow.js";',
    );
  }

  if (!output.includes(SHADOW_REPORT_MARKER)) {
    const routeBlock = `    if (url.pathname === "/api/config")\n      return reply({ ok: true, pinConfigured: Boolean(env.TEST_PIN) });\n    if (!url.pathname.startsWith("/api/"))`;
    const reportBlock = `    if (url.pathname === "/api/config")\n      return reply({ ok: true, pinConfigured: Boolean(env.TEST_PIN) });\n    // ${SHADOW_REPORT_MARKER}: KV-only readout for the hidden TBR shadow test.\n    if (url.pathname === "/shadow-tbr")\n      return tbrShadowPage(\n        await readTbrShadowReport(env, url.searchParams.get("hub") || "NE1"),\n      );\n    if (url.pathname === "/api/shadow-tbr")\n      return reply(\n        await readTbrShadowReport(env, url.searchParams.get("hub") || "NE1"),\n      );\n    if (!url.pathname.startsWith("/api/"))`;
    output = replaceUnique(
      output,
      routeBlock,
      reportBlock,
      "add read-only TBR shadow report routes",
    );
  }

  return ensureConnectionErrorRoute(output);
}

function patchDevServiceBinding(source) {
  let output = String(source || "");
  if (output.includes(DEV_SERVICE_BINDING_MARKER)) return output;

  output = replaceUnique(
    output,
    `    const saved = await saveToMain(pairing, hub, credentials);`,
    `    const saved = await saveToMain(env, pairing, hub, credentials);`,
    "pass env into saveToMain",
  );

  const oldSave = `async function saveToMain(pairing, hub, credentials) {\n  const response = await fetch(MAIN_API, {\n    method: "POST",\n    headers: { "content-type": "application/json" },\n    body: JSON.stringify({\n      action: "completeMsPairing",\n      pairing,\n      hub,\n      ...credentials,\n    }),\n  });\n  const json = await response.json().catch(() => ({}));\n  if (!response.ok || json.ok === false || !json.data?.connectorToken)\n    throw new Error(json.message || "บันทึก Session เข้าระบบหลักไม่สำเร็จ");\n  return json.data;\n}`;
  const newSave = `// ${DEV_SERVICE_BINDING_MARKER}: Browser TEST calls DEV Worker through a service binding.\n// Same-account Worker-to-Worker public workers.dev fetches are intentionally avoided.\nasync function mainApiFetch(env, payload) {\n  if (!env?.DEV_API?.fetch) throw new Error("DEV service binding missing");\n  const request = new Request(MAIN_API, {\n    method: "POST",\n    headers: { "content-type": "application/json" },\n    body: JSON.stringify(payload),\n  });\n  return env.DEV_API.fetch(request);\n}\n\nasync function saveToMain(env, pairing, hub, credentials) {\n  const response = await mainApiFetch(env, {\n    action: "completeMsPairing",\n    pairing,\n    hub,\n    ...credentials,\n  });\n  const json = await response.json().catch(() => ({}));\n  if (!response.ok || json.ok === false || !json.data?.connectorToken)\n    throw new Error(json.message || "บันทึก Session เข้าระบบหลักไม่สำเร็จ");\n  return json.data;\n}`;
  output = replaceUnique(output, oldSave, newSave, "route saveToMain via DEV service binding");

  const oldRegister = `async function registerConnectorForCutover(env, hub, connectorToken) {\n  if (!env.CONNECTOR_BOOTSTRAP_SECRET) return false;\n  const response = await fetch(MAIN_API, {\n    method: "POST",\n    headers: { "content-type": "application/json" },\n    body: JSON.stringify({\n      action: "bootstrapConnector",\n      hub,\n      connectorToken,\n      bootstrapSecret: env.CONNECTOR_BOOTSTRAP_SECRET,\n    }),\n  });\n  return response.ok;\n}`;
  const newRegister = `async function registerConnectorForCutover(env, hub, connectorToken) {\n  if (!env.CONNECTOR_BOOTSTRAP_SECRET) return false;\n  const response = await mainApiFetch(env, {\n    action: "bootstrapConnector",\n    hub,\n    connectorToken,\n    bootstrapSecret: env.CONNECTOR_BOOTSTRAP_SECRET,\n  });\n  return response.ok;\n}`;
  output = replaceUnique(output, oldRegister, newRegister, "route bootstrapConnector via DEV service binding");

  const oldSync = `async function sendConnectorSync(hub, connectorToken) {\n  return fetch(MAIN_API, {\n    method: "POST",\n    headers: { "content-type": "application/json" },\n    body: JSON.stringify({ action: "connectorSync", hub, connectorToken }),\n  });\n}`;
  const newSync = `async function sendConnectorSync(env, hub, connectorToken) {\n  return mainApiFetch(env, { action: "connectorSync", hub, connectorToken });\n}`;
  output = replaceUnique(output, oldSync, newSync, "route connectorSync via DEV service binding");

  const callNeedle = "sendConnectorSync(hub, connectorToken)";
  const callCount = output.split(callNeedle).length - 1;
  if (callCount < 2)
    throw new Error("Browser connector patch failed: connectorSync call sites");
  output = output.replaceAll(callNeedle, "sendConnectorSync(env, hub, connectorToken)");

  return output;
}

export function patchConnectorRecovery(source) {
  const text = String(source || "");
  let output = text;
  if (
    !text.includes('payload?.code === "INVALID_CONNECTOR"') ||
    !text.includes('event: "connector_sync_blocked"')
  ) {
    const oldBlock = `        let response = await sendConnectorSync(hub, connectorToken);\n        if (response.status === 401 && env.CONNECTOR_BOOTSTRAP_SECRET) {\n          if (await registerConnectorForCutover(env, hub, connectorToken))\n            response = await sendConnectorSync(hub, connectorToken);\n        }\n        if (response.status === 401 && !env.CONNECTOR_BOOTSTRAP_SECRET)\n          await env.STATE.delete(\`connector:\${hub}\`);`;

    const newBlock = `        let response = await sendConnectorSync(hub, connectorToken);\n        let payload = await response.clone().json().catch(() => ({}));\n        if (\n          response.status === 401 &&\n          env.CONNECTOR_BOOTSTRAP_SECRET &&\n          payload?.code === "INVALID_CONNECTOR"\n        ) {\n          if (await registerConnectorForCutover(env, hub, connectorToken)) {\n            response = await sendConnectorSync(hub, connectorToken);\n            payload = await response.clone().json().catch(() => ({}));\n          }\n        }\n        if (\n          response.status === 401 &&\n          !env.CONNECTOR_BOOTSTRAP_SECRET &&\n          payload?.code === "INVALID_CONNECTOR"\n        ) {\n          await env.STATE.delete(\`connector:\${hub}\`);\n        } else if (!response.ok) {\n          console.error(\n            JSON.stringify({\n              event: "connector_sync_blocked",\n              hub,\n              status: response.status,\n              code: payload?.code || "UNKNOWN",\n            }),\n          );\n        }`;

    if (!output.includes(oldBlock))
      throw new Error("Browser connector recovery patch target not found");
    output = output.replace(oldBlock, newBlock);
  }

  return patchDevServiceBinding(patchTbrShadowObserver(output));
}

export async function patchConnectorRecoveryFile(target) {
  const source = await readFile(target, "utf8");
  const patched = patchConnectorRecovery(source);
  if (patched !== source) await writeFile(target, patched, "utf8");
  return patched !== source;
}

const invokedPath = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (invokedPath) {
  const target = process.argv[2] || new URL("../src/index.js", import.meta.url);
  const changed = await patchConnectorRecoveryFile(target);
  console.log(`BROWSER_CONNECTOR_RECOVERY_PATCH=${changed ? "APPLIED" : "ALREADY_PRESENT"}`);
}
