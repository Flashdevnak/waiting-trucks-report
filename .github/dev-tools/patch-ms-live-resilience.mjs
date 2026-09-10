import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const MARKER = "LIVE_RESILIENCE_V1";
const TBR_PROVISIONAL_MARKER = "TBR_PROVISIONAL_ARRIVAL_V1";
const TBR_HARDENING_MARKER = "TBR_INTELLIGENCE_FRONTEND_GATE_V2";
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

  if (!output.includes(MARKER)) {
    output = replaceUnique(
      output,
      'CONFIG.apiUrl = `${window.location.hostname.endsWith("github.io") ? "https://waiting-trucks-report-api-dev.26nak-testdev.workers.dev" : window.location.origin}/api`;',
      `// ${MARKER}: every frontend host uses the promoted Turso Worker.\nCONFIG.apiUrl = "${PROMOTED_API}";`,
      "pin promoted API across frontend hosts",
    );

    output = replaceUnique(
      output,
      `  archiveView: false,\n  cancelledRouteIds: new Set(),`,
      `  archiveView: false,\n  cancelledRouteIds: new Set(),\n  transportLastOkAt: 0,\n  transportFailures: 0,\n  tbrIntelligenceHealth: null,`,
      "add transport and TBR health state",
    );

    output = replaceUnique(
      output,
      `    state.syncError = result?.syncError || "";\n    fillFilters();`,
      `    state.syncError = result?.syncError || "";\n    state.transportLastOkAt = Date.now();\n    state.transportFailures = 0;\n    state.tbrIntelligenceHealth = result?.tbrIntelligenceHealth || null;\n    fillFilters();`,
      "record successful transport poll and piggyback TBR health",
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
  }

  if (output.includes(TBR_HARDENING_MARKER)) return output;

  // Canonical ms.js already carries LIVE_RESILIENCE_V1, so consume the compact
  // health field in the DEV staging pass even when the base resilience patch is
  // already present in source.
  if (!output.includes("tbrIntelligenceHealth: null")) {
    output = replaceUnique(
      output,
      `  transportFailures: 0,`,
      `  transportFailures: 0,\n  tbrIntelligenceHealth: null,`,
      "add TBR health state to already-resilient frontend",
    );
  }
  if (!output.includes("state.tbrIntelligenceHealth = result?.tbrIntelligenceHealth || null;")) {
    output = replaceUnique(
      output,
      `    state.transportFailures = 0;\n    fillFilters();`,
      `    state.transportFailures = 0;\n    state.tbrIntelligenceHealth = result?.tbrIntelligenceHealth || null;\n    fillFilters();`,
      "consume piggyback TBR health on existing msRoutes poll",
    );
  }

  if (!output.includes(TBR_PROVISIONAL_MARKER)) {
    output = replaceUnique(
      output,
      `function confirmedEffectiveArrival(row) {\n  return parseDate(row.actualArrivalAt) ? effectiveArrival(row) : null;\n}`,
      `function confirmedEffectiveArrival(row) {\n  return parseDate(row.actualArrivalAt) ? effectiveArrival(row) : null;\n}\n\n// ${TBR_PROVISIONAL_MARKER}: operational arrival may start from the TBR candidate\n// already present on the same Route row. Route remains final confirmation.\n// ${TBR_HARDENING_MARKER}: provisional admission is fail-closed and requires the\n// same HUB's fresh, LIVE, source-available Intelligence gate piggybacked on msRoutes.\n// No extra API request, MS polling, Turso read/write or client timer is created.\nconst TBR_INTELLIGENCE_HEALTH_MAX_AGE_MS = 3 * 60 * 1000;\nconst TBR_INTELLIGENCE_HEALTH_FUTURE_MS = 90 * 1000;\nfunction tbrIntelligenceAllowsProvisional(row, now = new Date()) {\n  const health = state.tbrIntelligenceHealth;\n  if (!health || health.allowed !== true) return false;\n  const branch = String(state.branch || \"\").trim().toUpperCase();\n  const rowHub = String(row?.hub || branch).trim().toUpperCase();\n  const healthHub = String(health.hub || \"\").trim().toUpperCase();\n  if (!branch || rowHub !== branch || healthHub !== branch) return false;\n  if (![\"ADVISORY_READY\", \"PRODUCTION_CANDIDATE\"].includes(String(health.readinessStatus || \"\"))) return false;\n  if (health.advisoryAllowedNow !== true) return false;\n  if (String(health.observerStatus || \"\") !== \"LIVE\") return false;\n  if (health.sourceAvailable !== true || health.routeFallback === true) return false;\n  const observed = parseDate(health.observedAt);\n  const nowDate = parseDate(now) || new Date();\n  if (!observed) return false;\n  const ageMs = nowDate.getTime() - observed.getTime();\n  return ageMs >= -TBR_INTELLIGENCE_HEALTH_FUTURE_MS && ageMs <= TBR_INTELLIGENCE_HEALTH_MAX_AGE_MS;\n}\nfunction tbrProvisionalArrival(row, now = new Date()) {\n  if (!(isDestination(row) || isDrop(row))) return null;\n  if (!tbrIntelligenceAllowsProvisional(row, now)) return null;\n  if (parseDate(row.actualArrivalAt) || row.queueCancelledAt) return null;\n  if (!String(row.proofId || \"\").trim()) return null;\n  const tbr = parseDate(row.scheduleTbrArrivalAt);\n  if (!tbr) return null;\n  const nowDate = parseDate(now) || new Date();\n  if (tbr.getTime() > nowDate.getTime() + 90 * 1000) return null;\n  const planned = parseDate(row.estimatedArrivalAt);\n  if (planned && Math.abs(tbr.getTime() - planned.getTime()) > 18 * 60 * 60 * 1000) return null;\n  const kit = parseDate(row.scheduleKitArrivalAt);\n  if (kit && Math.abs(kit.getTime() - tbr.getTime()) > 15 * 60 * 1000) return null;\n  return tbr;\n}\nfunction operationalArrival(row, now = new Date()) {\n  return parseDate(row.actualArrivalAt)\n    ? effectiveArrival(row)\n    : tbrProvisionalArrival(row, now);\n}\nfunction operationalArrivalAuthority(row, now = new Date()) {\n  if (parseDate(row.actualArrivalAt)) return \"ROUTE_CONFIRMED\";\n  return tbrProvisionalArrival(row, now) ? \"TBR_PROVISIONAL\" : \"NONE\";\n}`,
      "add health-gated truth-safe TBR provisional arrival policy",
    );

    output = replaceUnique(
      output,
      `function routeState(row, now = new Date()) {\n  const eta = parseDate(row.estimatedArrivalAt);\n  const routeArrival = parseDate(row.actualArrivalAt);\n  const arrival = routeArrival ? effectiveArrival(row) : null;`,
      `function routeState(row, now = new Date()) {\n  const eta = parseDate(row.estimatedArrivalAt);\n  const routeArrival = parseDate(row.actualArrivalAt);\n  const arrival = operationalArrival(row, now);`,
      "allow TBR provisional state before Route confirmation",
    );

    output = replaceUnique(
      output,
      `  if (routeArrival)\n    return {\n      key: "arrived",\n      label: "มาถึงแล้ว",`,
      `  if (arrival)\n    return {\n      key: "arrived",\n      label: routeArrival ? "มาถึงแล้ว" : "TBR รอ Route",`,
      "label provisional arrival without claiming Route truth",
    );

    output = replaceUnique(
      output,
      `function queueInfo(row, now = new Date()) {\n  const routeArrival = parseDate(row.actualArrivalAt),\n    arrival = routeArrival ? effectiveArrival(row) : null,\n    ageHours = arrival ? (now - arrival) / 36e5 : 0;`,
      `function queueInfo(row, now = new Date()) {\n  const routeArrival = parseDate(row.actualArrivalAt),\n    arrival = operationalArrival(row, now),\n    ageHours = arrival ? (now - arrival) / 36e5 : 0;`,
      "start queue age from operational arrival",
    );

    output = replaceUnique(
      output,
      `    active = Boolean(routeArrival) && !done && !cancelled && ageHours <= 12;`,
      `    active = Boolean(arrival) && !done && !cancelled && ageHours <= 12;`,
      "admit trusted TBR provisional rows to queue",
    );

    output = replaceUnique(
      output,
      `    expired: Boolean(routeArrival) && !done && !cancelled && ageHours > 12,`,
      `    expired: Boolean(arrival) && !done && !cancelled && ageHours > 12,`,
      "expire provisional queue rows by same 12-hour policy",
    );

    output = replaceUnique(
      output,
      `function waitInfo(row) {\n  const start = confirmedEffectiveArrival(row),`,
      `function waitInfo(row) {\n  const start = operationalArrival(row),`,
      "start waiting timer from provisional TBR arrival",
    );

    output = replaceUnique(
      output,
      `function dropOperation(row) {\n  const unloadingState = Number(row.unloadingState);\n  const arrival = parseDate(row.actualArrivalAt);`,
      `function dropOperation(row) {\n  const unloadingState = Number(row.unloadingState);\n  const arrival = operationalArrival(row);`,
      "show drop arrival from the same provisional policy",
    );

    output = replaceUnique(
      output,
      `      const aTime = (confirmedEffectiveArrival(a) || parseDate(a.estimatedArrivalAt))?.getTime() || 0;\n      const bTime = (confirmedEffectiveArrival(b) || parseDate(b.estimatedArrivalAt))?.getTime() || 0;`,
      `      const aTime = (operationalArrival(a) || parseDate(a.estimatedArrivalAt))?.getTime() || 0;\n      const bTime = (operationalArrival(b) || parseDate(b.estimatedArrivalAt))?.getTime() || 0;`,
      "sort live queue by operational arrival",
    );
  }

  output = replaceUnique(
    output,
    `  // MS_SLA_EARLIEST_ARRIVAL_V2: Route confirms arrival; SLA uses earliest matched Route/KIT/TBR.\n  const arrival = confirmedEffectiveArrival(row);`,
    `  // MS_SLA_EARLIEST_ARRIVAL_V2: completed/confirmed truth stays Route-backed.\n  // While TBR is provisionally admitted, this local timing value is used only for\n  // the visible wait timer; \"SLA Route\" remains blank until Route confirms.\n  const arrival = completed\n    ? confirmedEffectiveArrival(row)\n    : operationalArrival(row, now);`,
    "let provisional card timer use operational arrival without altering completed truth",
  );

  output = replaceUnique(
    output,
    `    const summary = unloadSlaSummary(timing);\n    const currentSlaOver = timing.standard !== null && timing.slaMinutes !== null && timing.slaMinutes > timing.standard;\n    const headline = done ? timing.finish ? "ลงรถเสร็จ" : "ลงรถเสร็จ รอยืนยันเวลา" : active ? "กำลังลงรถ" : timing.arrival ? "รอเริ่มลงรถ" : "รอรถถึงคลัง";\n    const statusClass = currentSlaOver ? "is-danger" : active ? "is-working" : done ? "is-done" : "is-waiting";`,
    `    const summary = unloadSlaSummary(timing);\n    const provisional = !active && !done && operationalArrivalAuthority(row) === "TBR_PROVISIONAL";\n    const provisionalElapsed = provisional && timing.slaMinutes !== null\n      ? Math.max(0, timing.slaMinutes)\n      : null;\n    const provisionalDelta = provisional && timing.standard !== null && provisionalElapsed !== null\n      ? provisionalElapsed - timing.standard\n      : null;\n    const visibleSummary = provisional\n      ? provisionalElapsed === null\n        ? { text: "กำลังนับเวลารอจาก TBR", severity: "neutral" }\n        : provisionalDelta !== null && provisionalDelta > 0\n          ? { text: \`เกินมาตรฐาน \${nf.format(provisionalDelta)} นาที\`, severity: "danger" }\n          : { text: \`รอมาแล้ว \${nf.format(provisionalElapsed)} นาที\`, severity: "neutral" }\n      : summary;\n    const currentSlaOver = timing.standard !== null && timing.slaMinutes !== null && timing.slaMinutes > timing.standard;\n    const headline = provisional\n      ? "รอ Route ยืนยันถึงคลัง"\n      : done\n        ? timing.finish ? "ลงรถเสร็จ" : "ลงรถเสร็จ รอยืนยันเวลา"\n        : active\n          ? "กำลังลงรถ"\n          : timing.arrival ? "รอเริ่มลงรถ" : "รอรถถึงคลัง";\n    const statusClass = provisional ? "is-waiting" : currentSlaOver ? "is-danger" : active ? "is-working" : done ? "is-done" : "is-waiting";`,
    "show explicit provisional headline and local wait summary",
  );

  output = replaceUnique(
    output,
    `      classicOperationFact("SLA Route", timing.slaMinutes === null ? "-" : \`\${nf.format(timing.slaMinutes)} นาที\`),`,
    `      classicOperationFact("SLA Route", provisional || timing.slaMinutes === null ? "-" : \`\${nf.format(timing.slaMinutes)} นาที\`),`,
    "keep SLA Route blank until Route confirms",
  );

  output = replaceUnique(
    output,
    `    return \`<div class="classic-operation operation-compact destination \${statusClass}"><div class="classic-operation-center"><span class="classic-status-chip">\${headline}</span></div>\${classicOperationFacts(facts)}\${classicOperationSummary(done ? "สรุป" : "สถานะ", summary.text, summary.severity)}</div>\`;`,
    `    return \`<div class="classic-operation operation-compact destination \${statusClass}"><div class="classic-operation-center"><span class="classic-status-chip">\${headline}</span></div>\${classicOperationFacts(facts)}\${classicOperationSummary(done ? "สรุป" : "สถานะ", visibleSummary.text, visibleSummary.severity)}</div>\`;`,
    "render provisional elapsed/over-standard text in bottom status row",
  );

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
