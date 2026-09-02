import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`DEV realtime recovery patch failed: ${label}`);
  return output.replace(from, to);
}

function replaceFetchInsideFunction(output, functionName) {
  const marker = `async function ${functionName}(`;
  const start = output.indexOf(marker);
  if (start < 0)
    throw new Error(`DEV realtime recovery patch failed: missing ${functionName}`);
  const next = output.indexOf("\nasync function ", start + marker.length);
  const end = next < 0 ? output.length : next;
  const segment = output.slice(start, end);
  const needle = "await fetch(url, {";
  const first = segment.indexOf(needle);
  const last = segment.lastIndexOf(needle);
  if (first < 0 || first !== last)
    throw new Error(
      `DEV realtime recovery patch failed: ${functionName} fetch target`,
    );
  return (
    output.slice(0, start) +
    segment.replace(needle, "await fetchWithTimeout(url, {") +
    output.slice(end)
  );
}

export function patchDevRealtimeFrontend(source) {
  let output = String(source || "");
  output = replaceUnique(
    output,
    "  staleMs: 15000,\n};",
    "  staleMs: 15000,\n  requestTimeoutMs: 22000,\n};",
    "frontend request timeout config",
  );
  output = replaceUnique(
    output,
    '  const json = await (await fetch(url, { cache: "no-store" })).json();',
    `  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    CONFIG.requestTimeoutMs,
  );
  let json;
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    json = await response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(
        "การเชื่อมต่อข้อมูลใช้เวลานานเกินไป ระบบจะลองใหม่อัตโนมัติ",
      );
      timeoutError.code = "REQUEST_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }`,
    "frontend apiGet abort recovery",
  );
  return output;
}

export function patchDevRealtimeWorker(source) {
  let output = String(source || "");
  output = replaceUnique(
    output,
    "const CONNECTOR_HEARTBEAT_MS = 60 * 60 * 1000;\n",
    "const CONNECTOR_HEARTBEAT_MS = 60 * 60 * 1000;\nconst UPSTREAM_FETCH_TIMEOUT_MS = 6000;\n",
    "worker upstream timeout config",
  );
  output = replaceUnique(
    output,
    "async function readMsRoutes(credentials, wantedStart, wantedEnd) {",
    `async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = UPSTREAM_FETCH_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(
        \`ระบบต้นทางตอบช้าเกิน \${Math.ceil(timeoutMs / 1000)} วินาที\`,
      );
      timeoutError.code = "UPSTREAM_TIMEOUT";
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readMsRoutes(credentials, wantedStart, wantedEnd) {`,
    "worker timeout helper",
  );
  for (const functionName of ["readMsPage", "readPreEntryPage", "readBusPage"])
    output = replaceFetchInsideFunction(output, functionName);
  return output;
}

const invokedPath = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (invokedPath) {
  const frontendTarget = process.argv[2];
  const workerTarget = process.argv[3];
  if (!frontendTarget || !workerTarget)
    throw new Error(
      "Usage: node patch-ms-realtime-recovery.mjs <staged-ms.js> <worker-index.js>",
    );
  const frontend = await readFile(frontendTarget, "utf8");
  const worker = await readFile(workerTarget, "utf8");
  await writeFile(frontendTarget, patchDevRealtimeFrontend(frontend), "utf8");
  await writeFile(workerTarget, patchDevRealtimeWorker(worker), "utf8");
  console.log(`Patched DEV frontend request recovery: ${frontendTarget}`);
  console.log(`Patched DEV upstream request recovery: ${workerTarget}`);
}
