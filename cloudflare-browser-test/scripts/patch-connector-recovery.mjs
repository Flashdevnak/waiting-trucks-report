import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SHADOW_MARKER = "TBR_SHADOW_OBSERVER_V1";

function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`Browser connector patch failed: ${label}`);
  return output.replace(from, to);
}

function patchTbrShadowObserver(source) {
  let output = String(source || "");
  if (output.includes(SHADOW_MARKER)) return output;

  output = replaceUnique(
    output,
    `import puppeteer from "@cloudflare/puppeteer";`,
    `import puppeteer from "@cloudflare/puppeteer";\nimport { observeTbrShadow } from "./tbr-shadow.js";`,
    "add TBR shadow observer import",
  );

  const syncBlock = `        } else if (!response.ok) {\n          console.error(\n            JSON.stringify({\n              event: "connector_sync_blocked",\n              hub,\n              status: response.status,\n              code: payload?.code || "UNKNOWN",\n            }),\n          );\n        }`;

  output = replaceUnique(
    output,
    syncBlock,
    `${syncBlock}\n        // ${SHADOW_MARKER}: observe the already-returned BusTime feed only.\n        // This writes event changes to Browser KV and never writes Turso.\n        if (response.ok) {\n          try {\n            await observeTbrShadow(env, hub, payload?.data || {});\n          } catch (shadowError) {\n            console.error(\n              JSON.stringify({\n                event: "tbr_shadow_error",\n                hub,\n                message: shadowError?.message || String(shadowError),\n              }),\n            );\n          }\n        }`,
    "observe successful connector sync without another network call",
  );

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

  return patchTbrShadowObserver(output);
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
