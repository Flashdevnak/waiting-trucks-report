import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const MARKER = "LIVE_RESILIENCE_V1";
const PROMOTED_API = "https://waiting-trucks-report-api-dev.26nak-testdev.workers.dev/api";

function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS live resilience patch failed: ${label}`);
  return output.replace(from, to);
}

export function patchMsLiveResilienceFrontend(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;

  output = replaceUnique(
    output,
    'CONFIG.apiUrl = `${window.location.hostname.endsWith("github.io") ? "https://waiting-trucks-report-api-dev.26nak-testdev.workers.dev" : window.location.origin}/api`;',
    `// ${MARKER}: every frontend host uses the promoted Turso Worker.\nCONFIG.apiUrl = "${PROMOTED_API}";`,
    "pin promoted API across frontend hosts",
  );

  output = replaceUnique(
    output,
    `  archiveView: false,\n  cancelledRouteIds: new Set(),`,
    `  archiveView: false,\n  cancelledRouteIds: new Set(),\n  transportLastOkAt: 0,\n  transportFailures: 0,`,
    "add transport health state",
  );

  output = replaceUnique(
    output,
    `    state.syncError = result?.syncError || "";\n    fillFilters();`,
    `    state.syncError = result?.syncError || "";\n    state.transportLastOkAt = Date.now();\n    state.transportFailures = 0;\n    fillFilters();`,
    "record successful transport poll",
  );

  output = replaceUnique(
    output,
    `  } catch (error) {\n    connection(false);\n    if (!silent) empty(\`โหลดข้อมูลไม่สำเร็จ: \${error.message}\`);\n  } finally {`,
    `  } catch (error) {\n    state.transportFailures = Number(state.transportFailures || 0) + 1;\n    const recentlyHealthy =\n      Number(state.transportLastOkAt || 0) > 0 &&\n      Date.now() - Number(state.transportLastOkAt) <= CONFIG.staleMs;\n    connection(Boolean(recentlyHealthy));\n    if (!silent) {\n      if (recentlyHealthy)\n        toast(\`เครือข่ายสะดุดชั่วคราว · ใช้ข้อมูลล่าสุดและกำลังลองใหม่: \${error.message}\`, true);\n      else empty(\`โหลดข้อมูลไม่สำเร็จ: \${error.message}\`);\n    }\n  } finally {`,
    "avoid online badge flapping on one transient poll",
  );

  const oldApiGet = `async function apiGet(action, params = {}) {\n  const url = new URL(CONFIG.apiUrl);\n  url.searchParams.set("action", action);\n  url.searchParams.set("token", state.auth?.token || "");\n  Object.entries(params).forEach(\n    ([key, value]) =>\n      value !== undefined && value !== "" && url.searchParams.set(key, value),\n  );\n  const controller = new AbortController();\n  const timeout = setTimeout(\n    () => controller.abort(),\n    CONFIG.requestTimeoutMs,\n  );\n  let json;\n  try {\n    const response = await fetch(url, {\n      cache: "no-store",\n      signal: controller.signal,\n    });\n    json = await response.json();\n  } catch (error) {\n    if (error?.name === "AbortError") {\n      const timeoutError = new Error(\n        "การเชื่อมต่อข้อมูลใช้เวลานานเกินไป ระบบจะลองใหม่อัตโนมัติ",\n      );\n      timeoutError.code = "REQUEST_TIMEOUT";\n      throw timeoutError;\n    }\n    throw error;\n  } finally {\n    clearTimeout(timeout);\n  }\n  if (json.ok === false) {\n    const error = new Error(json.message);\n    error.code = json.code || "SERVER_ERROR";\n    if (error.code === "INVALID_SESSION") invalidateSession();\n    throw error;\n  }\n  return json.data ?? json;\n}`;

  const newApiGet = `async function apiGet(action, params = {}) {\n  const url = new URL(CONFIG.apiUrl);\n  url.searchParams.set("action", action);\n  url.searchParams.set("token", state.auth?.token || "");\n  Object.entries(params).forEach(\n    ([key, value]) =>\n      value !== undefined && value !== "" && url.searchParams.set(key, value),\n  );\n\n  let lastError = null;\n  for (let attempt = 1; attempt <= 3; attempt++) {\n    const controller = new AbortController();\n    const timeout = setTimeout(\n      () => controller.abort(),\n      CONFIG.requestTimeoutMs,\n    );\n    try {\n      const response = await fetch(url, {\n        cache: "no-store",\n        signal: controller.signal,\n        headers: { Accept: "application/json" },\n      });\n      const contentType = String(response.headers.get("content-type") || "").toLowerCase();\n      const text = await response.text();\n      let json;\n      try {\n        json = JSON.parse(text);\n      } catch {\n        const error = new Error(\n          contentType.includes("text/html") || /^\\s*</.test(text)\n            ? "API ตอบกลับเป็นหน้าเว็บแทน JSON · ระบบกำลังลองใหม่"\n            : "API ตอบกลับข้อมูลไม่สมบูรณ์ · ระบบกำลังลองใหม่",\n        );\n        error.code = "NON_JSON_RESPONSE";\n        error.retryable = response.status >= 500 || response.status === 404 || response.status === 200;\n        throw error;\n      }\n      if (json?.ok === false) {\n        const error = new Error(json.message || \`API error HTTP \${response.status}\`);\n        error.code = json.code || "SERVER_ERROR";\n        if (error.code === "INVALID_SESSION") invalidateSession();\n        error.retryable = response.status >= 500 || error.code === "REQUEST_TIMEOUT";\n        throw error;\n      }\n      if (!response.ok) {\n        const error = new Error(\`API HTTP \${response.status}\`);\n        error.code = \`HTTP_\${response.status}\`;\n        error.retryable = response.status >= 500 || response.status === 429;\n        throw error;\n      }\n      return json.data ?? json;\n    } catch (error) {\n      if (error?.name === "AbortError") {\n        const timeoutError = new Error(\n          "การเชื่อมต่อข้อมูลใช้เวลานานเกินไป ระบบจะลองใหม่อัตโนมัติ",\n        );\n        timeoutError.code = "REQUEST_TIMEOUT";\n        timeoutError.retryable = true;\n        lastError = timeoutError;\n      } else {\n        lastError = error;\n      }\n      const retryable =\n        lastError?.retryable === true ||\n        lastError?.code === "NON_JSON_RESPONSE" ||\n        lastError?.code === "REQUEST_TIMEOUT" ||\n        lastError instanceof TypeError;\n      if (!retryable || attempt === 3) throw lastError;\n      await new Promise((resolve) => setTimeout(resolve, 350 * attempt));\n    } finally {\n      clearTimeout(timeout);\n    }\n  }\n  throw lastError || new Error("โหลดข้อมูลไม่สำเร็จ");\n}`;

  output = replaceUnique(output, oldApiGet, newApiGet, "harden GET JSON transport");
  return output;
}

const invokedPath = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (invokedPath) {
  const target = process.argv[2];
  if (!target)
    throw new Error("Usage: node patch-ms-live-resilience.mjs <ms.js>");
  const source = await readFile(target, "utf8");
  await writeFile(target, patchMsLiveResilienceFrontend(source), "utf8");
  console.log(`Patched MS live resilience: ${target}`);
}
