import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { patchTbrIntelligenceV1 } from "./patch-tbr-intelligence-v1.mjs";

const MODULE_MARKER = "TBR_INTELLIGENCE_UX_V2";

function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last) throw new Error(`TBR Intelligence V2 apply failed: ${label}`);
  return output.replace(from, to);
}

export function patchTbrIntelligenceModuleV2(source) {
  let output = String(source || "");
  if (output.includes(MODULE_MARKER)) return output;

  const metricAnchor = 'function metric(value, suffix = "") {\n  return value == null ? "-" : `${esc(value)}${suffix}`;\n}';
  const metricReplacement = metricAnchor + '\n\n' +
    '// ' + MODULE_MARKER + ': readable first-run state; presentation only, no authority change.\n' +
    'function displayBangkok(value) {\n' +
    '  const ms = validTime(value);\n' +
    '  if (ms === null) return "-";\n' +
    '  return new Intl.DateTimeFormat("en-GB", {\n' +
    '    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",\n' +
    '    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,\n' +
    '  }).format(new Date(ms)).replace(",", "");\n' +
    '}\n\n' +
    'function readinessLabel(status) {\n' +
    '  if (status === "PRODUCTION_CANDIDATE") return "ผู้สมัคร Production";\n' +
    '  if (status === "ADVISORY_READY") return "พร้อมใช้ช่วยตัดสินใจ";\n' +
    '  if (status === "SHADOW_LEARNING") return "กำลังเรียนรู้";\n' +
    '  if (status === "SHADOW_COLLECTING") return "กำลังเก็บข้อมูล";\n' +
    '  return String(status || "-");\n' +
    '}\n\n' +
    'function sourceRateOrNow(value, shadow, mode) {\n' +
    '  if (value != null) return String(esc(value)) + "%";\n' +
    '  if (mode === "fallback") return shadow?.routeFallback ? "ON ตอนนี้" : "OFF ตอนนี้";\n' +
    '  if (mode === "clean") return shadow?.sourceAvailable === true && !shadow?.routeFallback ? "LIVE ตอนนี้" : "-";\n' +
    '  return shadow?.sourceAvailable === true ? "LIVE ตอนนี้" : "WAITING";\n' +
    '}';
  output = replaceUnique(output, metricAnchor, metricReplacement, "add readable helpers");

  const rowAnchor = '    return `<tr><td><code>${esc(item.id)}</code></td><td>${esc(item.attendanceType || "-")}</td><td>${esc(label)}</td><td>${esc(item.tbrAt || "-")}</td><td>${esc(item.routeActualArrivalAt || "-")}</td><td>${item.leadMinutes == null ? "-" : `${esc(item.leadMinutes)} นาที`}</td></tr>`;';
  const rowReplacement = '    return `<tr><td><code>${esc(item.id)}</code></td><td>${esc(item.attendanceType || "-")}</td><td>${esc(label)}</td><td>${esc(displayBangkok(item.tbrAt))}</td><td>${esc(displayBangkok(item.routeActualArrivalAt))}</td><td>${item.leadMinutes == null ? "-" : `${esc(item.leadMinutes)} นาที`}</td></tr>`;';
  output = replaceUnique(output, rowAnchor, rowReplacement, "display Bangkok timestamps");

  output = replaceUnique(
    output,
    '.card b{display:block;font-size:24px;margin-top:6px}',
    '.card b{display:block;font-size:24px;margin-top:6px;overflow-wrap:anywhere}.card .ready-value{font-size:18px;line-height:1.2}',
    "prevent readiness overflow",
  );

  const readyAnchor = '<div class="grid"><div class="card">Readiness<b class="${readinessClass}">${esc(ready.status || "-")}</b></div><div class="card">คะแนนความพร้อม<b>${metric(ready.score,"/100")}</b></div><div class="card">ตัวอย่าง 14 วัน<b>${metric(m.resolved)}</b></div><div class="card">ยืนยันกับ Route<b>${metric(m.confirmationRate,"%")}</b></div><div class="card">P50 รู้ล่วงหน้า<b>${metric(m.p50LeadMinutes," นาที")}</b></div><div class="card">P90 รู้ล่วงหน้า<b>${metric(m.p90LeadMinutes," นาที")}</b></div></div>';
  const readyReplacement = '<div class="grid"><div class="card">Readiness<b class="ready-value ${readinessClass}">${esc(readinessLabel(ready.status))}</b></div><div class="card">คะแนนความพร้อม<b>${metric(ready.score,"/100")}</b></div><div class="card">ตัวอย่าง 14 วัน<b>${metric(m.resolved)}</b></div><div class="card">ยืนยันกับ Route<b>${metric(m.confirmationRate,"%")}</b></div><div class="card">P50 รู้ล่วงหน้า<b>${metric(m.p50LeadMinutes," นาที")}</b></div><div class="card">P90 รู้ล่วงหน้า<b>${metric(m.p90LeadMinutes," นาที")}</b></div></div>';
  output = replaceUnique(output, readyAnchor, readyReplacement, "localized readiness");

  const healthAnchor = '<div class="grid"><div class="card">P95<b>${metric(m.p95LeadMinutes," นาที")}</b></div><div class="card">Source available<b>${metric(m.sourceAvailableRate,"%")}</b></div><div class="card">Clean LIVE<b>${metric(m.cleanLiveRate,"%")}</b></div><div class="card">Fallback time<b>${metric(m.fallbackRate,"%")}</b></div><div class="card">Expired<b>${metric(m.expiredRate,"%")}</b></div><div class="card">Observation days<b>${metric(m.observationDays)}</b></div></div>';
  const healthReplacement = '<div class="grid"><div class="card">P95<b>${metric(m.p95LeadMinutes," นาที")}</b></div><div class="card">Source available<b>${sourceRateOrNow(m.sourceAvailableRate,s,"source")}</b></div><div class="card">Clean LIVE<b>${sourceRateOrNow(m.cleanLiveRate,s,"clean")}</b></div><div class="card">Fallback time<b>${sourceRateOrNow(m.fallbackRate,s,"fallback")}</b></div><div class="card">Expired<b>${metric(m.expiredRate,"%")}</b></div><div class="card">Observation days<b>${metric(m.observationDays)}</b></div></div>';
  output = replaceUnique(output, healthAnchor, healthReplacement, "current source state before first checkpoint");

  return output;
}

const target = process.argv[2] || "src/index.js";
const source = fs.readFileSync(target, "utf8");
const patched = patchTbrIntelligenceV1(source);
fs.writeFileSync(target, patched);

const moduleTarget = fileURLToPath(new URL("../src/tbr-intelligence.js", import.meta.url));
const moduleSource = fs.readFileSync(moduleTarget, "utf8");
const modulePatched = patchTbrIntelligenceModuleV2(moduleSource);
fs.writeFileSync(moduleTarget, modulePatched);

console.log(`TBR_INTELLIGENCE_V1_PATCHED=${patched.includes("TBR_INTELLIGENCE_V1")}`);
console.log(`TBR_INTELLIGENCE_BOOTSTRAP_V2=${patched.includes("TBR_INTELLIGENCE_BOOTSTRAP_V2")}`);
console.log(`TBR_INTELLIGENCE_UX_V2=${modulePatched.includes(MODULE_MARKER)}`);
