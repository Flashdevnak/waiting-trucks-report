import fs from "node:fs";
import { fileURLToPath } from "node:url";

const MARKER = "TBR_INTELLIGENCE_V1";
const BOOTSTRAP_MARKER = "TBR_INTELLIGENCE_BOOTSTRAP_V2";
const MODULE_MARKER = "TBR_INTELLIGENCE_UX_V2";

function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last) throw new Error(`TBR Intelligence patch failed: ${label}`);
  return output.replace(from, to);
}

export function patchTbrIntelligenceModuleV2(source) {
  let output = String(source || "");
  if (output.includes(MODULE_MARKER)) return output;

  output = replaceUnique(
    output,
`function metric(value, suffix = "") {
  return value == null ? "-" : \`${esc(value)}\${suffix}\`;
}`,
`function metric(value, suffix = "") {
  return value == null ? "-" : \`${esc(value)}\${suffix}\`;
}

// ${MODULE_MARKER}: make first-run Intelligence truthful and easier to read without changing data authority.
function displayBangkok(value) {
  const ms = validTime(value);
  if (ms === null) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ms)).replace(",", "");
}

function readinessLabel(status) {
  if (status === "PRODUCTION_CANDIDATE") return "ผู้สมัคร Production";
  if (status === "ADVISORY_READY") return "พร้อมใช้ช่วยตัดสินใจ";
  if (status === "SHADOW_LEARNING") return "กำลังเรียนรู้";
  if (status === "SHADOW_COLLECTING") return "กำลังเก็บข้อมูล";
  return String(status || "-");
}

function sourceRateOrNow(value, shadow, mode) {
  if (value != null) return \`${esc(value)}%\`;
  if (mode === "fallback") return shadow?.routeFallback ? "ON ตอนนี้" : "OFF ตอนนี้";
  if (mode === "clean") return shadow?.sourceAvailable === true && !shadow?.routeFallback ? "LIVE ตอนนี้" : "-";
  return shadow?.sourceAvailable === true ? "LIVE ตอนนี้" : "WAITING";
}`,
    "add readable Intelligence helpers",
  );

  output = replaceUnique(
    output,
`    return \`<tr><td><code>\${esc(item.id)}</code></td><td>\${esc(item.attendanceType || "-")}</td><td>\${esc(label)}</td><td>\${esc(item.tbrAt || "-")}</td><td>\${esc(item.routeActualArrivalAt || "-")}</td><td>\${item.leadMinutes == null ? "-" : \`\${esc(item.leadMinutes)} นาที\`}</td></tr>\`;`,
`    return \`<tr><td><code>\${esc(item.id)}</code></td><td>\${esc(item.attendanceType || "-")}</td><td>\${esc(label)}</td><td>\${esc(displayBangkok(item.tbrAt))}</td><td>\${esc(displayBangkok(item.routeActualArrivalAt))}</td><td>\${item.leadMinutes == null ? "-" : \`\${esc(item.leadMinutes)} นาที\`}</td></tr>\`;`,
    "display Shadow timestamps in Bangkok time",
  );

  output = replaceUnique(
    output,
`.card b{display:block;font-size:24px;margin-top:6px}`,
`.card b{display:block;font-size:24px;margin-top:6px;overflow-wrap:anywhere}.card .ready-value{font-size:18px;line-height:1.2}`,
    "prevent readiness overflow",
  );

  output = replaceUnique(
    output,
`<div class="grid"><div class="card">Readiness<b class="\${readinessClass}">\${esc(ready.status || "-")}</b></div><div class="card">คะแนนความพร้อม<b>\${metric(ready.score,"/100")}</b></div><div class="card">ตัวอย่าง 14 วัน<b>\${metric(m.resolved)}</b></div><div class="card">ยืนยันกับ Route<b>\${metric(m.confirmationRate,"%")}</b></div><div class="card">P50 รู้ล่วงหน้า<b>\${metric(m.p50LeadMinutes," นาที")}</b></div><div class="card">P90 รู้ล่วงหน้า<b>\${metric(m.p90LeadMinutes," นาที")}</b></div></div>`,
`<div class="grid"><div class="card">Readiness<b class="ready-value \${readinessClass}">\${esc(readinessLabel(ready.status))}</b></div><div class="card">คะแนนความพร้อม<b>\${metric(ready.score,"/100")}</b></div><div class="card">ตัวอย่าง 14 วัน<b>\${metric(m.resolved)}</b></div><div class="card">ยืนยันกับ Route<b>\${metric(m.confirmationRate,"%")}</b></div><div class="card">P50 รู้ล่วงหน้า<b>\${metric(m.p50LeadMinutes," นาที")}</b></div><div class="card">P90 รู้ล่วงหน้า<b>\${metric(m.p90LeadMinutes," นาที")}</b></div></div>`,
    "render localized readiness",
  );

  output = replaceUnique(
    output,
`<div class="grid"><div class="card">P95<b>\${metric(m.p95LeadMinutes," นาที")}</b></div><div class="card">Source available<b>\${metric(m.sourceAvailableRate,"%")}</b></div><div class="card">Clean LIVE<b>\${metric(m.cleanLiveRate,"%")}</b></div><div class="card">Fallback time<b>\${metric(m.fallbackRate,"%")}</b></div><div class="card">Expired<b>\${metric(m.expiredRate,"%")}</b></div><div class="card">Observation days<b>\${metric(m.observationDays)}</b></div></div>`,
`<div class="grid"><div class="card">P95<b>\${metric(m.p95LeadMinutes," นาที")}</b></div><div class="card">Source available<b>\${sourceRateOrNow(m.sourceAvailableRate,s,"source")}</b></div><div class="card">Clean LIVE<b>\${sourceRateOrNow(m.cleanLiveRate,s,"clean")}</b></div><div class="card">Fallback time<b>\${sourceRateOrNow(m.fallbackRate,s,"fallback")}</b></div><div class="card">Expired<b>\${metric(m.expiredRate,"%")}</b></div><div class="card">Observation days<b>\${metric(m.observationDays)}</b></div></div>`,
    "show current source state before first health checkpoint",
  );

  return output;
}

export function patchTbrIntelligenceV1(source) {
  let output = String(source || "");
  if (output.includes(BOOTSTRAP_MARKER)) return output;

  if (!output.includes(MARKER)) {
    output = replaceUnique(
      output,
`import {
  observeTbrShadow,
  readTbrShadowReport,
  tbrShadowPage,
} from "./tbr-shadow.js";`,
`import {
  observeTbrShadow,
  readTbrShadowReport,
  tbrShadowPage,
} from "./tbr-shadow.js";
// ${MARKER}: Browser-KV-only rolling intelligence; no extra MS polling and no Turso writes.
import {
  readTbrIntelligenceReport,
  recordTbrRepairEvent,
  shouldAttemptTbrAutoRepair,
  shouldUpdateTbrIntelligence,
  tbrIntelligencePage,
  updateTbrIntelligence,
} from "./tbr-intelligence.js";

// ${BOOTSTRAP_MARKER}: one KV write at most on a new Intelligence state. Existing Shadow records are
// backfilled idempotently so the dashboard never shows zero samples while confirmed Shadow rows exist.
async function ensureTbrIntelligenceReport(env, hub, shadow) {
  const current = await readTbrIntelligenceReport(env, hub, shadow);
  if (current?.createdAt) return current;
  return updateTbrIntelligence(env, hub, shadow, { bootstrap: true }, {}, { now: Date.now() });
}`,
      "import intelligence module and bootstrap helper",
    );

    output = replaceUnique(
      output,
`    // TBR_SHADOW_REPORT_V1: KV-only readout for the hidden TBR shadow test.
    if (url.pathname === "/shadow-tbr")
      return tbrShadowPage(
        await readTbrShadowReport(env, url.searchParams.get("hub") || "NE1"),
      );
    if (url.pathname === "/api/shadow-tbr")
      return reply(
        await readTbrShadowReport(env, url.searchParams.get("hub") || "NE1"),
      );`,
`    // TBR_SHADOW_REPORT_V1: upgraded in-place to TBR Intelligence while keeping the read-only Shadow API.
    if (url.pathname === "/shadow-tbr") {
      const hub = url.searchParams.get("hub") || "NE1";
      const shadow = await readTbrShadowReport(env, hub);
      const intelligence = await ensureTbrIntelligenceReport(env, hub, shadow);
      return tbrIntelligencePage(shadow, intelligence);
    }
    if (url.pathname === "/api/shadow-tbr")
      return reply(
        await readTbrShadowReport(env, url.searchParams.get("hub") || "NE1"),
      );
    if (url.pathname === "/api/tbr-intelligence") {
      const hub = url.searchParams.get("hub") || "NE1";
      const shadow = await readTbrShadowReport(env, hub);
      return reply(await ensureTbrIntelligenceReport(env, hub, shadow));
    }`,
      "upgrade shadow routes with one-time Intelligence bootstrap",
    );

    output = replaceUnique(
      output,
`        if (!connectorToken && env.CONNECTOR_BOOTSTRAP_SECRET) {
          const candidate = randomConnectorToken();
          if (await registerConnectorForCutover(env, hub, candidate)) {
            connectorToken = candidate;
            await rememberConnector(env, hub, connectorToken);
          }
        }`,
`        if (!connectorToken && env.CONNECTOR_BOOTSTRAP_SECRET && shouldAttemptTbrAutoRepair()) {
          const candidate = randomConnectorToken();
          if (await registerConnectorForCutover(env, hub, candidate)) {
            connectorToken = candidate;
            await rememberConnector(env, hub, connectorToken);
            await recordTbrRepairEvent(env, hub, "connector_bootstrap");
          }
        }`,
      "throttle connector bootstrap self-repair",
    );

    output = replaceUnique(
      output,
`        if (
          response.status === 401 &&
          env.CONNECTOR_BOOTSTRAP_SECRET &&
          payload?.code === "INVALID_CONNECTOR"
        ) {
          if (await registerConnectorForCutover(env, hub, connectorToken)) {
            response = await sendConnectorSync(env, hub, connectorToken);
            payload = await response.clone().json().catch(() => ({}));
          }
        }`,
`        if (
          response.status === 401 &&
          env.CONNECTOR_BOOTSTRAP_SECRET &&
          payload?.code === "INVALID_CONNECTOR" &&
          shouldAttemptTbrAutoRepair()
        ) {
          if (await registerConnectorForCutover(env, hub, connectorToken)) {
            await recordTbrRepairEvent(env, hub, "connector_reregister");
            response = await sendConnectorSync(env, hub, connectorToken);
            payload = await response.clone().json().catch(() => ({}));
          }
        }`,
      "throttle invalid connector self-repair",
    );

    output = replaceUnique(
      output,
`            if (failedShadow?.sourceChanged) {
              const failureCode = String(payload?.code || \`HTTP_\${response.status}\`);
              const failureSource = failureCode.includes("BUS") ? "busTime" : "routes";
              await recordConnectionErrorKv(env, {
                hub, source: failureSource, code: failureCode,
                message: payload?.message || \`DEV Shadow ตอบกลับ HTTP \${response.status}\`,
              });
            }`,
`            if (failedShadow?.sourceChanged) {
              const failureCode = String(payload?.code || \`HTTP_\${response.status}\`);
              const failureSource = failureCode.includes("BUS") ? "busTime" : "routes";
              await recordConnectionErrorKv(env, {
                hub, source: failureSource, code: failureCode,
                message: payload?.message || \`DEV Shadow ตอบกลับ HTTP \${response.status}\`,
              });
            }
            if (shouldUpdateTbrIntelligence(failedShadow)) {
              const shadowReport = await readTbrShadowReport(env, hub);
              await updateTbrIntelligence(env, hub, shadowReport, failedShadow, {}, {
                sourceError: {
                  code: String(payload?.code || \`HTTP_\${response.status}\`),
                  message: String(payload?.message || "source unavailable"),
                },
              });
            }`,
      "record source failure intelligence",
    );

    output = replaceUnique(
      output,
`            } else if (observedShadow?.sourceChanged || observedShadow?.routeFallbackChanged) {
              await recordConnectionRecoveredKv(env, { hub });
            }`,
`            } else if (observedShadow?.sourceChanged || observedShadow?.routeFallbackChanged) {
              await recordConnectionRecoveredKv(env, { hub });
            }
            if (shouldUpdateTbrIntelligence(observedShadow)) {
              const shadowReport = await readTbrShadowReport(env, hub);
              await updateTbrIntelligence(env, hub, shadowReport, observedShadow, payload?.data || {});
            }`,
      "record live intelligence checkpoint",
    );
  } else if (!output.includes(BOOTSTRAP_MARKER)) {
    throw new Error("TBR Intelligence V1 already materialized without V2 bootstrap marker; materialize V2 explicitly before deploy");
  }

  return output;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2] || "src/index.js";
  const source = fs.readFileSync(target, "utf8");
  const patched = patchTbrIntelligenceV1(source);
  fs.writeFileSync(target, patched);

  const moduleTarget = fileURLToPath(new URL("../src/tbr-intelligence.js", import.meta.url));
  const moduleSource = fs.readFileSync(moduleTarget, "utf8");
  const modulePatched = patchTbrIntelligenceModuleV2(moduleSource);
  fs.writeFileSync(moduleTarget, modulePatched);

  console.log(`TBR_INTELLIGENCE_V1_PATCHED=${patched.includes(MARKER)}`);
  console.log(`TBR_INTELLIGENCE_BOOTSTRAP_V2=${patched.includes(BOOTSTRAP_MARKER)}`);
  console.log(`TBR_INTELLIGENCE_UX_V2=${modulePatched.includes(MODULE_MARKER)}`);
}
