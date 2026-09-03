import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export function patchConnectorRecovery(source) {
  const text = String(source || "");
  if (
    text.includes('payload?.code === "INVALID_CONNECTOR"') &&
    text.includes('event: "connector_sync_blocked"')
  ) {
    return text;
  }

  const oldBlock = `        let response = await sendConnectorSync(hub, connectorToken);\n        if (response.status === 401 && env.CONNECTOR_BOOTSTRAP_SECRET) {\n          if (await registerConnectorForCutover(env, hub, connectorToken))\n            response = await sendConnectorSync(hub, connectorToken);\n        }\n        if (response.status === 401 && !env.CONNECTOR_BOOTSTRAP_SECRET)\n          await env.STATE.delete(\`connector:\${hub}\`);`;

  const newBlock = `        let response = await sendConnectorSync(hub, connectorToken);\n        let payload = await response.clone().json().catch(() => ({}));\n        if (\n          response.status === 401 &&\n          env.CONNECTOR_BOOTSTRAP_SECRET &&\n          payload?.code === "INVALID_CONNECTOR"\n        ) {\n          if (await registerConnectorForCutover(env, hub, connectorToken)) {\n            response = await sendConnectorSync(hub, connectorToken);\n            payload = await response.clone().json().catch(() => ({}));\n          }\n        }\n        if (\n          response.status === 401 &&\n          !env.CONNECTOR_BOOTSTRAP_SECRET &&\n          payload?.code === "INVALID_CONNECTOR"\n        ) {\n          await env.STATE.delete(\`connector:\${hub}\`);\n        } else if (!response.ok) {\n          console.error(\n            JSON.stringify({\n              event: "connector_sync_blocked",\n              hub,\n              status: response.status,\n              code: payload?.code || "UNKNOWN",\n            }),\n          );\n        }`;

  if (!text.includes(oldBlock)) {
    throw new Error("Browser connector recovery patch target not found");
  }
  return text.replace(oldBlock, newBlock);
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
