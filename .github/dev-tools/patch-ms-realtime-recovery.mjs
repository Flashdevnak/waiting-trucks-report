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
    "  staleMs: 15000,\n  requestTimeoutMs: 32000,\n};",
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
  output = replaceUnique(
    output,
    `    if (state.syncError) toast(state.syncError, true);
    el("last-refresh").textContent =
      \`อัปเดตล่าสุด \${dtf.format(new Date())} น. · ตรวจสถานะใหม่ทุก 4 วินาที\`;`,
    `    if (state.syncError && state.msStatus !== "degraded")
      toast(state.syncError, true);
    el("last-refresh").textContent =
      state.msStatus === "degraded"
        ? "MS ตอบช้าชั่วคราว · แสดงข้อมูลล่าสุด · กำลังลองใหม่ทุก 4 วินาที"
        : \`อัปเดตล่าสุด \${dtf.format(new Date())} น. · ตรวจสถานะใหม่ทุก 4 วินาที\`;`,
    "frontend degraded cache status",
  );
  return output;
}

export function patchDevRealtimeWorker(source) {
  let output = String(source || "");
  output = replaceUnique(
    output,
    "const CONNECTOR_HEARTBEAT_MS = 60 * 60 * 1000;\n",
    "const CONNECTOR_HEARTBEAT_MS = 60 * 60 * 1000;\nconst UPSTREAM_FETCH_TIMEOUT_MS = 9000;\n",
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

  output = replaceUnique(
    output,
    `    const rows = await readMsRoutes(credentials);
    const parcelCounts = await readPreEntryCounts(env, branch);
    const busData = await readBusTimeData(env, branch);`,
    `    const rows = await readMsRoutes(credentials);
    const [parcelCounts, busData] = await Promise.all([
      readPreEntryCounts(env, branch),
      readBusTimeData(env, branch),
    ]);`,
    "parallel optional MS enrichment",
  );

  output = replaceUnique(
    output,
    `  if (!response.ok) fail(\`MS ตอบกลับ \${response.status}\`, "MS_HTTP_ERROR", 502);`,
    `  if (!response.ok) {
    const code =
      response.status === 401 || response.status === 403
        ? "MS_SESSION_EXPIRED"
        : "MS_HTTP_ERROR";
    fail(\`MS ตอบกลับ \${response.status}\`, code, 502);
  }`,
    "classify MS auth HTTP failures",
  );

  output = replaceUnique(
    output,
    `  } catch (error) {
    await safeStatusWrite(
      markConnectionError(env, "ms_connections", branch, error.message),
      "ms_connection_error_write_error",
      branch,
    );
    console.error(
      JSON.stringify({
        event: "ms_sync_error",
        code: error.code || "MS_SYNC_FAILED",
        message: error.message,
      }),
    );
    const result = {
      status: "error",
      error: error.message || "เชื่อมต่อ MS ไม่สำเร็จ",
    };
    recentMsSync.set(branch, { until: Date.now() + MS_SYNC_TTL, result });
    return result;
  }
}`,
    `  } catch (error) {
    const transient =
      error?.code === "UPSTREAM_TIMEOUT" ||
      error?.code === "MS_HTTP_ERROR" ||
      error instanceof TypeError;
    if (transient) {
      const fallback = await readMsLiveCache(env, branch);
      if (fallback?.rows) {
        console.warn(
          JSON.stringify({
            event: "ms_sync_degraded",
            branch,
            code: error.code || "MS_NETWORK_ERROR",
            message: error.message,
          }),
        );
        const result = {
          status: "degraded",
          changes: 0,
          rows: fallback.rows,
          completedToday:
            fallback.completedDay === thaiDay()
              ? fallback.completedRows.length
              : 0,
          error:
            "MS ตอบช้าชั่วคราว ระบบแสดงข้อมูลล่าสุดและจะลองใหม่อัตโนมัติ",
        };
        recentMsSync.set(branch, { until: Date.now() + MS_SYNC_TTL, result });
        return result;
      }
    }
    await safeStatusWrite(
      markConnectionError(env, "ms_connections", branch, error.message),
      "ms_connection_error_write_error",
      branch,
    );
    console.error(
      JSON.stringify({
        event: "ms_sync_error",
        code: error.code || "MS_SYNC_FAILED",
        message: error.message,
      }),
    );
    const result = {
      status: "error",
      error: error.message || "เชื่อมต่อ MS ไม่สำเร็จ",
    };
    recentMsSync.set(branch, { until: Date.now() + MS_SYNC_TTL, result });
    return result;
  }
}`,
    "serve live cache on transient upstream failure",
  );

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
