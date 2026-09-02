import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`DEV connector adoption patch failed: ${label}`);
  return output.replace(from, to);
}

export function patchDevConnectorAdoption(source) {
  let output = String(source || "");

  output = replaceUnique(
    output,
    `  if (action === "connectorSync") return ok(await connectorSync(body, env));\n  const actor = await verify(body.token, env);`,
    `  if (action === "connectorSync") return ok(await connectorSync(body, env));\n  if (action === "bootstrapConnector")\n    return ok(await bootstrapConnector(body, env));\n  const actor = await verify(body.token, env);`,
    "bootstrap route before normal user authentication",
  );

  output = replaceUnique(
    output,
    `async function connectorSync(body, env) {`,
    `async function bootstrapConnector(body, env) {\n  const configuredSecret = String(env.CONNECTOR_BOOTSTRAP_SECRET || "");\n  if (!configuredSecret)\n    fail(\n      "ปิดการรับตัวเชื่อมต่อชั่วคราว",\n      "CONNECTOR_BOOTSTRAP_DISABLED",\n      404,\n    );\n\n  const suppliedSecret = String(body.bootstrapSecret || "");\n  if (\n    !suppliedSecret ||\n    !(await equal(\n      await sha256(suppliedSecret),\n      await sha256(configuredSecret),\n    ))\n  )\n    fail(\n      "ยืนยันการย้ายตัวเชื่อมต่อไม่สำเร็จ",\n      "INVALID_CONNECTOR_BOOTSTRAP",\n      401,\n    );\n\n  const hub = text(body.hub, 80).toUpperCase();\n  const connectorToken = text(body.connectorToken, 500);\n  if (!/^[A-Z0-9_-]{2,20}$/.test(hub) || connectorToken.length < 20)\n    fail(\n      "ข้อมูลตัวเชื่อมต่อไม่ถูกต้อง",\n      "INVALID_CONNECTOR_BOOTSTRAP",\n      400,\n    );\n\n  const connection = await env.DB.prepare(\n    "SELECT hub FROM ms_connections WHERE hub=?",\n  )\n    .bind(hub)\n    .first();\n  if (!connection)\n    fail(\n      "HUB นี้ยังไม่มี MS connection ที่ยืนยันแล้ว",\n      "MS_NOT_CONFIGURED",\n      409,\n    );\n\n  const tokenHash = await sha256(connectorToken);\n  const existing = await env.DB.prepare(\n    "SELECT token_hash,active FROM ms_connector_tokens WHERE hub=?",\n  )\n    .bind(hub)\n    .first();\n  if (Number(existing?.active) === 1) {\n    if (await equal(String(existing.token_hash || ""), tokenHash))\n      return { hub, adopted: false, alreadyRegistered: true };\n    fail(\n      "HUB นี้มีตัวเชื่อมต่อที่ใช้งานอยู่แล้ว",\n      "CONNECTOR_ALREADY_ACTIVE",\n      409,\n    );\n  }\n\n  const now = new Date().toISOString();\n  if (existing) {\n    await env.DB.prepare(\n      "UPDATE ms_connector_tokens SET token_hash=?,created_at=?,last_used_at='',active=1 WHERE hub=? AND active<>1",\n    )\n      .bind(tokenHash, now, hub)\n      .run();\n  } else {\n    await env.DB.prepare(\n      "INSERT OR IGNORE INTO ms_connector_tokens(hub,token_hash,created_at,last_used_at,active) VALUES(?,?,?,'',1)",\n    )\n      .bind(hub, tokenHash, now)\n      .run();\n  }\n\n  const registered = await env.DB.prepare(\n    "SELECT token_hash,active FROM ms_connector_tokens WHERE hub=?",\n  )\n    .bind(hub)\n    .first();\n  if (\n    Number(registered?.active) !== 1 ||\n    !(await equal(String(registered?.token_hash || ""), tokenHash))\n  )\n    fail(\n      "มีตัวเชื่อมต่ออื่นลงทะเบียนก่อนแล้ว",\n      "CONNECTOR_ALREADY_ACTIVE",\n      409,\n    );\n\n  return { hub, adopted: true, alreadyRegistered: false };\n}\n\nasync function connectorSync(body, env) {`,
    "one-time connector adoption helper",
  );

  return output;
}

const invokedPath = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (invokedPath) {
  const workerTarget = process.argv[2];
  if (!workerTarget)
    throw new Error(
      "Usage: node patch-ms-connector-adoption.mjs <worker-index.js>",
    );
  const worker = await readFile(workerTarget, "utf8");
  await writeFile(workerTarget, patchDevConnectorAdoption(worker), "utf8");
  console.log(`Patched DEV one-time connector adoption: ${workerTarget}`);
}
