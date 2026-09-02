import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  patchDevMsArchive,
  patchDevMsMobileStyle,
} from "../../worker/scripts/patch-dev-ms-archive.mjs";
import { patchDevRealtimeFrontend } from "../dev-tools/patch-ms-realtime-recovery.mjs";
import { patchDevSummaryFilter } from "../dev-tools/patch-ms-summary-filter.mjs";

export const OLD_API_ORIGIN =
  "https://waiting-trucks-report.alert-squid-6738.chatgpt.site";
export const PROMOTED_API_ORIGIN =
  "https://waiting-trucks-report-api-dev.26nak-testdev.workers.dev";

function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`Cutover preparation failed: ${label}`);
  return output.replace(from, to);
}

export function patchCutoverFrontend(msSource) {
  let output = patchDevMsArchive(msSource);
  output = patchDevRealtimeFrontend(output);
  output = patchDevSummaryFilter(output);
  output = replaceUnique(
    output,
    `CONFIG.apiUrl = \`${"${"}window.location.hostname.endsWith("github.io") ? "${OLD_API_ORIGIN}" : window.location.origin}/api\`;`,
    `CONFIG.apiUrl = \`${"${"}window.location.hostname.endsWith("github.io") ? "${PROMOTED_API_ORIGIN}" : window.location.origin}/api\`;`,
    "GitHub Pages API target",
  );
  return output;
}

export function patchCutoverBrowser(source) {
  let output = String(source || "");
  output = replaceUnique(
    output,
    `const MAIN_API =\n  "${OLD_API_ORIGIN}/api";`,
    `const MAIN_API =\n  "${PROMOTED_API_ORIGIN}/api";`,
    "Browser Worker API target",
  );

  const oldBlock = `async function syncConfiguredHubs(env) {\n  const hubs = JSON.parse((await env.STATE.get("hubs")) || "[]");\n  await Promise.all(\n    hubs.map(async (hub) => {\n      const connectorToken = await env.STATE.get(\`connector:\${hub}\`);\n      if (!connectorToken) return;\n      const response = await fetch(MAIN_API, {\n        method: "POST",\n        headers: { "content-type": "application/json" },\n        body: JSON.stringify({ action: "connectorSync", hub, connectorToken }),\n      });\n      if (response.status === 401) await env.STATE.delete(\`connector:\${hub}\`);\n    }),\n  );\n}`;

  const newBlock = `function randomConnectorToken() {\n  const bytes = crypto.getRandomValues(new Uint8Array(32));\n  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");\n}\n\nasync function registerConnectorForCutover(env, hub, connectorToken) {\n  if (!env.CONNECTOR_BOOTSTRAP_SECRET) return false;\n  const response = await fetch(MAIN_API, {\n    method: "POST",\n    headers: { "content-type": "application/json" },\n    body: JSON.stringify({\n      action: "bootstrapConnector",\n      hub,\n      connectorToken,\n      bootstrapSecret: env.CONNECTOR_BOOTSTRAP_SECRET,\n    }),\n  });\n  return response.ok;\n}\n\nasync function sendConnectorSync(hub, connectorToken) {\n  return fetch(MAIN_API, {\n    method: "POST",\n    headers: { "content-type": "application/json" },\n    body: JSON.stringify({ action: "connectorSync", hub, connectorToken }),\n  });\n}\n\nasync function syncConfiguredHubs(env) {\n  const storedHubs = JSON.parse((await env.STATE.get("hubs")) || "[]");\n  const bootstrapHubs = env.CONNECTOR_BOOTSTRAP_SECRET\n    ? String(env.CONNECTOR_BOOTSTRAP_HUBS || "NE1")\n        .split(",")\n        .map((hub) => hub.trim().toUpperCase())\n        .filter((hub) => /^[A-Z0-9_-]{2,20}$/.test(hub))\n    : [];\n  const hubs = [...new Set([...storedHubs, ...bootstrapHubs])];\n\n  await Promise.all(\n    hubs.map(async (hub) => {\n      try {\n        let connectorToken = await env.STATE.get(\`connector:\${hub}\`);\n        if (!connectorToken && env.CONNECTOR_BOOTSTRAP_SECRET) {\n          const candidate = randomConnectorToken();\n          if (await registerConnectorForCutover(env, hub, candidate)) {\n            connectorToken = candidate;\n            await rememberConnector(env, hub, connectorToken);\n          }\n        }\n        if (!connectorToken) return;\n\n        let response = await sendConnectorSync(hub, connectorToken);\n        if (response.status === 401 && env.CONNECTOR_BOOTSTRAP_SECRET) {\n          if (await registerConnectorForCutover(env, hub, connectorToken))\n            response = await sendConnectorSync(hub, connectorToken);\n        }\n        if (response.status === 401 && !env.CONNECTOR_BOOTSTRAP_SECRET)\n          await env.STATE.delete(\`connector:\${hub}\`);\n      } catch (error) {\n        console.error(\n          JSON.stringify({\n            event: "connector_sync_error",\n            hub,\n            message: error?.message || String(error),\n          }),\n        );\n      }\n    }),\n  );\n}`;

  return replaceUnique(
    output,
    oldBlock,
    newBlock,
    "Browser connector bootstrap and Cron sync",
  );
}

export function bumpServiceWorker(source, version) {
  const output = String(source || "");
  const matches = [...output.matchAll(/const VERSION="[^"]+"/g)];
  if (matches.length !== 1)
    throw new Error("Cutover preparation failed: service worker version marker");
  return output.replace(matches[0][0], `const VERSION="${version}"`);
}

export async function prepareCutover(rootDir, version) {
  if (!/^\d{8}-\d{2}$/.test(String(version || "")))
    throw new Error("CUTOVER_VERSION must match YYYYMMDD-NN");

  const msPath = join(rootDir, "ms.js");
  const stylePath = join(rootDir, "style.css");
  const browserPath = join(rootDir, "cloudflare-browser-test/src/index.js");
  const swPath = join(rootDir, "sw.js");
  const versionPath = join(rootDir, "version.json");

  const [ms, style, browser, sw] = await Promise.all([
    readFile(msPath, "utf8"),
    readFile(stylePath, "utf8"),
    readFile(browserPath, "utf8"),
    readFile(swPath, "utf8"),
  ]);

  await Promise.all([
    writeFile(msPath, patchCutoverFrontend(ms), "utf8"),
    writeFile(stylePath, patchDevMsMobileStyle(style), "utf8"),
    writeFile(browserPath, patchCutoverBrowser(browser), "utf8"),
    writeFile(swPath, bumpServiceWorker(sw, version), "utf8"),
    writeFile(
      versionPath,
      `${JSON.stringify({ version, updatedAt: new Date().toISOString() })}\n`,
      "utf8",
    ),
  ]);
}

const invokedPath = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (invokedPath) {
  const rootDir = process.argv[2] || process.cwd();
  const version = process.env.CUTOVER_VERSION || process.argv[3];
  await prepareCutover(rootDir, version);
  console.log(`Prepared coordinated cutover assets for ${version}`);
}
