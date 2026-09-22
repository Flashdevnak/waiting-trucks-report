import {
  aggregateTbrDiagnosticRollup,
  projectTbrDiagnosticRollup,
} from "./tbr-diagnostic-rollup.js";

const INTELLIGENCE_VERSION = 1;
const INTELLIGENCE_DAYS = 14;

function cleanHub(value) {
  const hub = String(value || "NE1").trim().toUpperCase();
  return /^[A-Z0-9_-]{2,20}$/.test(hub) ? hub : "NE1";
}

function sharedProjection(shadowReport, now) {
  const value = shadowReport?.diagnosticRollup;
  if (value?.owner === "TBR_SHADOW_OBSERVER" && value?.version === 1) return value;
  return projectTbrDiagnosticRollup(value, now);
}

function readiness(metrics, current, coverage) {
  const accuracy = metrics.confirmationRate ?? 0;
  const uptime = metrics.sourceAvailableRate ?? 0;
  const fallback = metrics.fallbackRate ?? 100;
  const sampleScore = Math.min(100, (metrics.resolved / 500) * 100);
  const leadScore = Math.min(100, ((metrics.p50LeadMinutes ?? 0) / 10) * 100);
  const fallbackScore = Math.max(0, 100 - fallback * 5);
  const score = Math.round(accuracy * 0.35 + uptime * 0.25 + sampleScore * 0.2 + leadScore * 0.1 + fallbackScore * 0.1);
  const coverageReady = coverage?.coverageComplete14d === true && coverage?.coverageState === "COMPLETE" && coverage?.integrityState === "OK";
  let status = coverage?.integrityState === "FAILED"
    ? "SHADOW_INTEGRITY_FAILURE"
    : coverageReady
      ? metrics.resolved < 20 ? "SHADOW_COLLECTING" : "SHADOW_LEARNING"
      : "SHADOW_COVERAGE_INCOMPLETE";
  if (coverageReady) {
    if (metrics.resolved >= 500 && metrics.observationDays >= 7 && accuracy >= 97 && uptime >= 99 && fallback <= 2 && score >= 90)
      status = "PRODUCTION_CANDIDATE";
    else if (metrics.resolved >= 100 && accuracy >= 90 && uptime >= 95 && fallback <= 10 && score >= 75)
      status = "ADVISORY_READY";
  }
  const healthyNow = current?.observerStatus === "LIVE" && current?.sourceAvailable === true && !current?.routeFallback;
  return {
    status,
    reason: coverage?.integrityState === "FAILED"
      ? String(coverage.integrityReason || "ROLLUP_INTEGRITY_FAILURE")
      : coverageReady ? "POLICY_EVALUATED" : String(coverage?.coverageReason || "ROLLING_14_COVERAGE_INCOMPLETE"),
    score,
    coverageReady,
    advisoryAllowedNow: Boolean(coverageReady && healthyNow && ["ADVISORY_READY", "PRODUCTION_CANDIDATE"].includes(status)),
    queueAuthority: false,
    providerAuthority: false,
    freshnessAuthority: false,
    completenessAuthority: false,
    lifecycleAuthority: false,
    historyAuthority: false,
    businessDayAuthority: false,
    canonicalActualArrival: "ROUTE_READ_ONLY",
  };
}

function selfHealingSummary(current, rolling14) {
  let status = "HEALTHY";
  if (current?.observerStatus === "STALE") status = "DEGRADED_STALE";
  else if (current?.routeFallback) status = "DEGRADED_ROUTE_FALLBACK";
  else if (current?.sourceAvailable !== true) status = "REPAIRING_SOURCE";
  return {
    status,
    connectorRepairIntervalMinutes: 0,
    intelligenceCheckpointMinutes: 0,
    routeTransientRetryAttempts: 1,
    routeFallbackMaxMinutes: 30,
    maxScheduledIntelligenceWritesPerDayPerHub: 0,
    extraMsPolling: 0,
    tursoWrites: 0,
    otherPersistentWrites: 0,
    repairEvents: 0,
    recoveries: Number(rolling14?.recoveries || 0),
    sourceOutages: Number(rolling14?.sourceOutages || 0),
    routeFallbackEvents: Number(rolling14?.routeFallbackEvents || 0),
    stateResets: 0,
    lastRepairAt: "",
    lastRepairAction: "",
    nextRepairWindowAt: "",
  };
}

export function shouldCheckpointTbrIntelligence() { return false; }
export function shouldAttemptTbrAutoRepair() { return false; }
export function shouldUpdateTbrIntelligence() { return false; }

function reportForShadow(hubValue, shadowReport, now) {
  const hub = cleanHub(hubValue);
  const coverage = sharedProjection(shadowReport, now);
  const today = aggregateTbrDiagnosticRollup(coverage, 1, now);
  const rolling7 = aggregateTbrDiagnosticRollup(coverage, 7, now);
  const rolling14 = aggregateTbrDiagnosticRollup(coverage, 14, now);
  return {
    ok: true,
    intelligenceVersion: INTELLIGENCE_VERSION,
    hub,
    shadowOnly: true,
    sharedRollupOwner: "TBR_SHADOW_OBSERVER",
    queueAuthority: false,
    providerAuthority: false,
    freshnessAuthority: false,
    completenessAuthority: false,
    lifecycleAuthority: false,
    historyAuthority: false,
    businessDayAuthority: false,
    enrichmentScheduler: false,
    providerScheduler: false,
    canonicalActualArrival: "ROUTE_READ_ONLY",
    providerUpstreamCalls: 0,
    routeUpstreamCalls: 0,
    preEntryUpstreamCalls: 0,
    otherPersistentWrites: 0,
    tursoReads: 0,
    tursoWrites: 0,
    persistence: "NONE",
    createdAt: String(coverage.coverageStartAt || ""),
    updatedAt: String(coverage.coverageEndAt || ""),
    coverage,
    today,
    rolling7,
    rolling14,
    readiness: readiness(rolling14, shadowReport, coverage),
    selfHealing: selfHealingSummary(shadowReport, rolling14),
  };
}

export async function updateTbrIntelligence(_env, hubValue, shadowReport, _observed = {}, _live = {}, options = {}) {
  return reportForShadow(hubValue, shadowReport, Number(options.now ?? Date.now()));
}

export async function readTbrIntelligenceReport(_env, hubValue = "NE1", shadowReport = null, nowValue = Date.now()) {
  return reportForShadow(hubValue, shadowReport, Number(nowValue));
}

export async function recordTbrRepairEvent(_env, hubValue, action) {
  return { ok: true, hub: cleanHub(hubValue), action: String(action || "repair").slice(0, 80), persisted: false };
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function metric(value, suffix = "") {
  return value == null ? "-" : `${esc(value)}${suffix}`;
}

export function tbrIntelligencePage(shadowReport, intelligence) {
  const r = intelligence || {};
  const s = shadowReport || {};
  const m = r.rolling14 || {};
  const h = r.selfHealing || {};
  const ready = r.readiness || {};
  const coverage = r.coverage || {};
  const rows = (s.records || []).slice(0, 80).map((item) => {
    const label = item.status === "confirmed" ? "ยืนยันแล้ว" : item.status === "expired" ? "หมดเวลา/ต้องตรวจ" : item.routeSeen ? "รอเวลามาถึงจริง" : "รอ Route";
    return `<tr><td><code>${esc(item.id)}</code></td><td>${esc(item.attendanceType || "-")}</td><td>${esc(label)}</td><td>${esc(item.tbrAt || "-")}</td><td>${esc(item.routeActualArrivalAt || "-")}</td><td>${item.leadMinutes == null ? "-" : `${esc(item.leadMinutes)} นาที`}</td></tr>`;
  }).join("") || '<tr><td colspan="6" class="empty">ยังไม่มี candidate ที่ต้องแสดง</td></tr>';
  const readinessClass = ready.status === "PRODUCTION_CANDIDATE" || ready.status === "ADVISORY_READY" ? "good" : "warn";
  const healthClass = h.status === "HEALTHY" ? "good" : "warn";
  const coverageLabel = coverage.coverageState === "COMPLETE" ? "COMPLETE" : coverage.coverageState || "INCOMPLETE";
  return new Response(`<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="60"><title>TBR Intelligence ${esc(s.hub || r.hub || "")}</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f4f6f8;color:#18212f;font-family:system-ui,-apple-system,sans-serif}.wrap{max-width:1240px;margin:24px auto;padding:0 16px}.top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap}.top h1{margin:0 0 5px}.muted{color:#667085}.pill{padding:7px 10px;border-radius:999px;background:#ecfdf3;color:#067647;font-size:13px;font-weight:700}.banner{margin:14px 0;padding:13px 15px;border:1px solid #e5e7eb;border-radius:12px;background:#fff}.good{color:#067647}.warn{color:#b54708}.danger{color:#b42318}.grid{display:grid;grid-template-columns:repeat(6,minmax(130px,1fr));gap:10px;margin:14px 0}.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px}.card b{display:block;font-size:24px;margin-top:6px}.section{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-top:14px}.split{display:grid;grid-template-columns:1fr 1fr;gap:14px}.kv{display:grid;grid-template-columns:1fr auto;gap:7px 12px;font-size:14px}.kv span:nth-child(even){font-weight:700;text-align:right}.table{overflow:auto}table{border-collapse:collapse;width:100%;min-width:760px}th,td{padding:10px 11px;border-bottom:1px solid #eef1f5;text-align:center;font-size:13px}th{background:#f8fafc}.empty{padding:24px;color:#667085}.foot{margin:14px 0;color:#667085;font-size:12px;line-height:1.6}@media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}.split{grid-template-columns:1fr}}@media(max-width:520px){.grid{grid-template-columns:1fr 1fr}.card b{font-size:20px}}
  </style></head><body><main class="wrap"><div class="top"><div><h1>TBR Intelligence · ${esc(s.hub || r.hub || "-")}</h1><div class="muted">Shadow → Intelligence V1 · Read-only diagnostic จาก shared Shadow rollup</div></div><div class="pill">Turso 0/0 · Extra MS polling 0 · Queue authority OFF</div></div>
  <div class="banner ${healthClass}"><b>Diagnostic: ${esc(h.status || "-")}</b> · Observer ${esc(s.observerStatus || "-")} · Source ${s.sourceAvailable === true ? "LIVE" : "WAITING"} · Route fallback ${s.routeFallback ? "ON" : "OFF"} · 14-day coverage ${esc(coverageLabel)}</div>
  <div class="grid"><div class="card">Readiness<b class="${readinessClass}">${esc(ready.status || "-")}</b></div><div class="card">Coverage<b>${esc(coverageLabel)}</b></div><div class="card">ตัวอย่างที่สะสม<b>${metric(m.resolved)}</b></div><div class="card">ยืนยันกับ Route<b>${metric(m.confirmationRate,"%")}</b></div><div class="card">P50 รู้ล่วงหน้า<b>${metric(m.p50LeadMinutes," นาที")}</b></div><div class="card">P90 รู้ล่วงหน้า<b>${metric(m.p90LeadMinutes," นาที")}</b></div></div>
  <div class="grid"><div class="card">P95<b>${metric(m.p95LeadMinutes," นาที")}</b></div><div class="card">Source available<b>${metric(m.sourceAvailableRate,"%")}</b></div><div class="card">Clean LIVE<b>${metric(m.cleanLiveRate,"%")}</b></div><div class="card">Fallback time<b>${metric(m.fallbackRate,"%")}</b></div><div class="card">Expired<b>${metric(m.expiredRate,"%")}</b></div><div class="card">Observation days<b>${metric(m.observationDays)}</b></div></div>
  <div class="split"><section class="section"><h3>7 วัน</h3><div class="kv"><span>Candidate</span><span>${metric(r.rolling7?.candidates)}</span><span>Confirmed</span><span>${metric(r.rolling7?.confirmed)}</span><span>Expired</span><span>${metric(r.rolling7?.expired)}</span><span>Confirmation</span><span>${metric(r.rolling7?.confirmationRate,"%")}</span><span>P50 / P90 / P95</span><span>${metric(r.rolling7?.p50LeadMinutes)} / ${metric(r.rolling7?.p90LeadMinutes)} / ${metric(r.rolling7?.p95LeadMinutes)} นาที</span></div></section>
  <section class="section"><h3>Diagnostic / Quota Guard</h3><div class="kv"><span>Provider upstream calls</span><span>${metric(r.providerUpstreamCalls)}</span><span>Route upstream calls</span><span>${metric(r.routeUpstreamCalls)}</span><span>PreEntry upstream calls</span><span>${metric(r.preEntryUpstreamCalls)}</span><span>Intelligence persistent writes</span><span>${metric(r.otherPersistentWrites)}</span><span>Persistence</span><span>${esc(r.persistence || "NONE")}</span></div></section></div>
  <section class="section"><h3>รายการ Shadow ล่าสุด</h3><div class="table"><table><thead><tr><th>Shadow ID</th><th>ประเภทงาน</th><th>สถานะ</th><th>TBR</th><th>Route actual</th><th>รู้ล่วงหน้า</th></tr></thead><tbody>${rows}</tbody></table></div></section>
  <div class="foot">TBR Shadow Test compatibility · Read-only Advisory เท่านั้น · rolling metrics มีผลตาม coverage ที่แสดง · ไม่มีสิทธิ์เปลี่ยน Queue, lifecycle, completeness, freshness หรือ business day · ไม่เขียน persistence และไม่เรียก provider</div>
  </main></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export const TBR_INTELLIGENCE_POLICY = Object.freeze({
  version: INTELLIGENCE_VERSION,
  checkpointMinutes: 0,
  autoRepairMinutes: 0,
  retentionDays: INTELLIGENCE_DAYS,
  sharedRollupOwner: "TBR_SHADOW_OBSERVER",
  extraMsPolling: 0,
  tursoWrites: 0,
  otherPersistentWrites: 0,
  queueAuthority: false,
  providerAuthority: false,
  freshnessAuthority: false,
  completenessAuthority: false,
  lifecycleAuthority: false,
  historyAuthority: false,
  businessDayAuthority: false,
  enrichmentScheduler: false,
  providerScheduler: false,
});
