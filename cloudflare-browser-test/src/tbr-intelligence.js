const INTELLIGENCE_VERSION = 1;
const INTELLIGENCE_TTL_SECONDS = 21 * 24 * 60 * 60;
const INTELLIGENCE_DAYS = 14;
const SEEN_RECORD_TTL_MS = 4 * 24 * 60 * 60 * 1000;
const HEALTH_GAP_STALE_MS = 45 * 60 * 1000;
const HEALTH_PRIOR_MAX_MS = 30 * 60 * 1000;
const CHECKPOINT_MINUTES = 30;
const AUTO_REPAIR_MINUTES = 5;
const LEAD_BIN_MAX = 120;

function cleanHub(value) {
  const hub = String(value || "NE1").trim().toUpperCase();
  return /^[A-Z0-9_-]{2,20}$/.test(hub) ? hub : "NE1";
}

function intelligenceKey(hub) {
  return `shadow:tbr:intel:v1:${cleanHub(hub)}`;
}

function validTime(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : null;
}

function iso(ms) {
  return Number.isFinite(Number(ms)) ? new Date(Number(ms)).toISOString() : "";
}

function bangkokDay(ms) {
  return new Date(Number(ms) + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function nextBangkokMidnight(ms) {
  const shifted = new Date(Number(ms) + 7 * 60 * 60 * 1000);
  return Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
  ) - 7 * 60 * 60 * 1000;
}

function emptyLeadBins() {
  return Array.from({ length: LEAD_BIN_MAX + 2 }, () => 0);
}

function freshDay() {
  return {
    candidates: 0,
    confirmed: 0,
    expired: 0,
    leadCount: 0,
    leadSum: 0,
    leadMax: null,
    leadBins: emptyLeadBins(),
    health: { live: 0, fallback: 0, waiting: 0, stale: 0 },
    sourceOutages: 0,
    recoveries: 0,
    routeFallbackEvents: 0,
    repairEvents: 0,
    sourceErrors: {},
  };
}

function freshIntelligence(hub) {
  return {
    version: INTELLIGENCE_VERSION,
    hub: cleanHub(hub),
    createdAt: "",
    updatedAt: "",
    lastCheckpointAt: "",
    lastHealthAt: "",
    healthMode: "unknown",
    days: {},
    seen: {},
    selfHealing: {
      repairEvents: 0,
      recoveries: 0,
      sourceOutages: 0,
      routeFallbackEvents: 0,
      stateResets: 0,
      lastRepairAt: "",
      lastRepairAction: "",
    },
  };
}

function normalizeDay(day) {
  const base = freshDay();
  if (!day || typeof day !== "object") return base;
  for (const key of ["candidates", "confirmed", "expired", "leadCount", "leadSum", "sourceOutages", "recoveries", "routeFallbackEvents", "repairEvents"]) {
    base[key] = Number.isFinite(Number(day[key])) ? Math.max(0, Number(day[key])) : 0;
  }
  base.leadMax = day.leadMax == null || !Number.isFinite(Number(day.leadMax)) ? null : Number(day.leadMax);
  if (Array.isArray(day.leadBins)) {
    base.leadBins = emptyLeadBins();
    for (let i = 0; i < base.leadBins.length; i++) base.leadBins[i] = Math.max(0, Number(day.leadBins[i]) || 0);
  }
  if (day.health && typeof day.health === "object") {
    for (const key of ["live", "fallback", "waiting", "stale"]) base.health[key] = Math.max(0, Number(day.health[key]) || 0);
  }
  if (day.sourceErrors && typeof day.sourceErrors === "object") {
    base.sourceErrors = Object.fromEntries(
      Object.entries(day.sourceErrors)
        .filter(([key]) => key && key.length <= 80)
        .map(([key, value]) => [key, Math.max(0, Number(value) || 0)]),
    );
  }
  return base;
}

function parseIntelligence(raw, hub) {
  if (!raw) return freshIntelligence(hub);
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version === INTELLIGENCE_VERSION && parsed?.hub === cleanHub(hub)) {
      const state = freshIntelligence(hub);
      Object.assign(state, parsed);
      state.days = {};
      for (const [key, value] of Object.entries(parsed.days || {})) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(key)) state.days[key] = normalizeDay(value);
      }
      state.seen = parsed.seen && typeof parsed.seen === "object" ? parsed.seen : {};
      state.selfHealing = { ...freshIntelligence(hub).selfHealing, ...(parsed.selfHealing || {}) };
      return state;
    }
  } catch {}
  const state = freshIntelligence(hub);
  state.selfHealing.stateResets = 1;
  state.selfHealing.lastRepairAction = "intelligence_state_reset";
  return state;
}

function ensureDay(state, key) {
  if (!state.days[key]) state.days[key] = freshDay();
  else state.days[key] = normalizeDay(state.days[key]);
  return state.days[key];
}

function pruneState(state, now) {
  const keepDays = new Set();
  for (let offset = 0; offset < INTELLIGENCE_DAYS; offset++) {
    keepDays.add(bangkokDay(now - offset * 86400000));
  }
  for (const key of Object.keys(state.days || {})) {
    if (!keepDays.has(key)) delete state.days[key];
  }
  const seenCutoff = now - SEEN_RECORD_TTL_MS;
  for (const [key, value] of Object.entries(state.seen || {})) {
    const seenAt = validTime(value?.seenAt || value?.tbrAt);
    if (seenAt === null || seenAt < seenCutoff) delete state.seen[key];
  }
}

function allocateHealthMinutes(state, startMs, endMs, mode) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;
  const healthMode = ["live", "fallback", "waiting", "stale"].includes(mode) ? mode : "waiting";
  let cursor = startMs;
  while (cursor < endMs) {
    const boundary = Math.min(endMs, nextBangkokMidnight(cursor));
    const minutes = Math.max(0, (boundary - cursor) / 60000);
    ensureDay(state, bangkokDay(cursor)).health[healthMode] += minutes;
    cursor = boundary;
  }
}

function rollHealth(state, now, currentMode) {
  const previousAt = validTime(state.lastHealthAt);
  const previousMode = state.healthMode || "unknown";
  if (previousAt !== null && now > previousAt) {
    const elapsed = now - previousAt;
    if (elapsed <= HEALTH_GAP_STALE_MS) {
      allocateHealthMinutes(state, previousAt, now, previousMode);
    } else {
      const priorEnd = Math.min(now, previousAt + HEALTH_PRIOR_MAX_MS);
      allocateHealthMinutes(state, previousAt, priorEnd, previousMode);
      allocateHealthMinutes(state, priorEnd, now, "stale");
    }
  }
  state.lastHealthAt = iso(now);
  state.healthMode = currentMode;
}

function currentHealthMode(shadowReport, live) {
  const status = String(shadowReport?.observerStatus || "");
  if (status === "STALE") return "stale";
  if (Boolean(shadowReport?.routeFallback || live?.routeFallback)) return "fallback";
  if (shadowReport?.sourceAvailable === true) return "live";
  return "waiting";
}

function addLead(day, value) {
  const lead = Math.max(0, Math.round(Number(value) || 0));
  const bin = Math.min(LEAD_BIN_MAX + 1, lead);
  day.leadBins[bin] += 1;
  day.leadCount += 1;
  day.leadSum += lead;
  day.leadMax = day.leadMax == null ? lead : Math.max(day.leadMax, lead);
}

function recordTerminal(day, record) {
  if (record.status === "confirmed") {
    day.confirmed += 1;
    if (Number.isFinite(Number(record.leadMinutes))) addLead(day, record.leadMinutes);
  } else if (record.status === "expired") {
    day.expired += 1;
  }
}

function scanRecords(state, shadowReport, now) {
  for (const record of shadowReport?.records || []) {
    const tbrMs = validTime(record?.tbrAt);
    if (tbrMs === null) continue;
    const fingerprint = `${String(record?.id || "")}|${String(record?.tbrAt || "")}`;
    if (!fingerprint || fingerprint === "|") continue;
    const day = ensureDay(state, bangkokDay(tbrMs));
    let seen = state.seen[fingerprint];
    if (!seen) {
      day.candidates += 1;
      seen = { status: "pending", tbrAt: String(record.tbrAt || ""), seenAt: iso(now) };
      state.seen[fingerprint] = seen;
    }
    const status = String(record?.status || "");
    if (["confirmed", "expired"].includes(status) && seen.status !== status) {
      recordTerminal(day, record);
      seen.status = status;
      seen.resolvedAt = String(record.confirmedAt || record.expiredAt || iso(now));
    } else if (status === "pending" && !["confirmed", "expired"].includes(seen.status)) {
      seen.status = "pending";
    }
    seen.seenAt = iso(now);
  }
}

function noteError(day, live, options) {
  const error = options?.sourceError || live?.routeSourceError;
  const code = String(error?.code || "").trim().slice(0, 80);
  if (code) day.sourceErrors[code] = (day.sourceErrors[code] || 0) + 1;
}

function applyTransitions(state, shadowReport, observed, live, options, now) {
  const day = ensureDay(state, bangkokDay(now));
  if (observed?.sourceChanged) {
    if (shadowReport?.sourceAvailable === true) {
      day.recoveries += 1;
      state.selfHealing.recoveries += 1;
    } else {
      day.sourceOutages += 1;
      state.selfHealing.sourceOutages += 1;
      noteError(day, live, options);
    }
  }
  if (observed?.routeFallbackChanged && Boolean(shadowReport?.routeFallback || live?.routeFallback)) {
    day.routeFallbackEvents += 1;
    state.selfHealing.routeFallbackEvents += 1;
    noteError(day, live, options);
  }
}

function percentileFromBins(bins, percentile) {
  const total = (bins || []).reduce((sum, value) => sum + (Number(value) || 0), 0);
  if (!total) return null;
  const target = Math.max(1, Math.ceil((total * percentile) / 100));
  let cumulative = 0;
  for (let i = 0; i < bins.length; i++) {
    cumulative += Number(bins[i]) || 0;
    if (cumulative >= target) return i > LEAD_BIN_MAX ? LEAD_BIN_MAX + 1 : i;
  }
  return null;
}

function aggregateDays(state, daysBack, now) {
  const keys = [];
  for (let offset = daysBack - 1; offset >= 0; offset--) keys.push(bangkokDay(now - offset * 86400000));
  const total = {
    days: keys,
    observationDays: 0,
    candidates: 0,
    confirmed: 0,
    expired: 0,
    resolved: 0,
    leadCount: 0,
    leadSum: 0,
    leadMax: null,
    leadBins: emptyLeadBins(),
    health: { live: 0, fallback: 0, waiting: 0, stale: 0 },
    sourceOutages: 0,
    recoveries: 0,
    routeFallbackEvents: 0,
    repairEvents: 0,
    sourceErrors: {},
  };
  for (const key of keys) {
    const day = state.days?.[key];
    if (!day) continue;
    const normalized = normalizeDay(day);
    const healthMinutes = Object.values(normalized.health).reduce((sum, value) => sum + value, 0);
    if (normalized.candidates > 0 || healthMinutes > 0) total.observationDays += 1;
    for (const field of ["candidates", "confirmed", "expired", "leadCount", "leadSum", "sourceOutages", "recoveries", "routeFallbackEvents", "repairEvents"]) total[field] += normalized[field];
    total.leadMax = normalized.leadMax == null ? total.leadMax : total.leadMax == null ? normalized.leadMax : Math.max(total.leadMax, normalized.leadMax);
    for (let i = 0; i < total.leadBins.length; i++) total.leadBins[i] += normalized.leadBins[i] || 0;
    for (const key2 of ["live", "fallback", "waiting", "stale"]) total.health[key2] += normalized.health[key2] || 0;
    for (const [code, count] of Object.entries(normalized.sourceErrors || {})) total.sourceErrors[code] = (total.sourceErrors[code] || 0) + count;
  }
  total.resolved = total.confirmed + total.expired;
  total.confirmationRate = total.resolved ? Number(((100 * total.confirmed) / total.resolved).toFixed(1)) : null;
  total.expiredRate = total.resolved ? Number(((100 * total.expired) / total.resolved).toFixed(1)) : null;
  total.averageLeadMinutes = total.leadCount ? Math.round(total.leadSum / total.leadCount) : null;
  total.p50LeadMinutes = percentileFromBins(total.leadBins, 50);
  total.p90LeadMinutes = percentileFromBins(total.leadBins, 90);
  total.p95LeadMinutes = percentileFromBins(total.leadBins, 95);
  const healthTotal = Object.values(total.health).reduce((sum, value) => sum + value, 0);
  total.healthMinutes = Math.round(healthTotal);
  total.sourceAvailableRate = healthTotal ? Number((((total.health.live + total.health.fallback) * 100) / healthTotal).toFixed(1)) : null;
  total.cleanLiveRate = healthTotal ? Number(((total.health.live * 100) / healthTotal).toFixed(1)) : null;
  total.fallbackRate = healthTotal ? Number(((total.health.fallback * 100) / healthTotal).toFixed(1)) : null;
  for (const key2 of ["live", "fallback", "waiting", "stale"]) total.health[key2] = Math.round(total.health[key2]);
  delete total.leadBins;
  delete total.leadSum;
  return total;
}

function readiness(metrics, current) {
  const accuracy = metrics.confirmationRate ?? 0;
  const uptime = metrics.sourceAvailableRate ?? 0;
  const fallback = metrics.fallbackRate ?? 100;
  const sampleScore = Math.min(100, (metrics.resolved / 500) * 100);
  const leadScore = Math.min(100, ((metrics.p50LeadMinutes ?? 0) / 10) * 100);
  const fallbackScore = Math.max(0, 100 - fallback * 5);
  const score = Math.round(accuracy * 0.35 + uptime * 0.25 + sampleScore * 0.2 + leadScore * 0.1 + fallbackScore * 0.1);
  let status = metrics.resolved < 20 ? "SHADOW_COLLECTING" : "SHADOW_LEARNING";
  if (
    metrics.resolved >= 500 && metrics.observationDays >= 7 && accuracy >= 97 && uptime >= 99 && fallback <= 2 && score >= 90
  ) status = "PRODUCTION_CANDIDATE";
  else if (metrics.resolved >= 100 && accuracy >= 90 && uptime >= 95 && fallback <= 10 && score >= 75) status = "ADVISORY_READY";
  const healthyNow = current?.observerStatus === "LIVE" && current?.sourceAvailable === true && !current?.routeFallback;
  return {
    status,
    score,
    advisoryAllowedNow: Boolean(healthyNow && ["ADVISORY_READY", "PRODUCTION_CANDIDATE"].includes(status)),
    queueAuthority: false,
    actualArrivalAuthority: "ROUTE",
  };
}

function selfHealingSummary(state, current, now) {
  let status = "HEALTHY";
  if (current?.observerStatus === "STALE") status = "DEGRADED_STALE";
  else if (current?.routeFallback) status = "DEGRADED_ROUTE_FALLBACK";
  else if (current?.sourceAvailable !== true) status = "REPAIRING_SOURCE";
  return {
    status,
    connectorRepairIntervalMinutes: AUTO_REPAIR_MINUTES,
    intelligenceCheckpointMinutes: CHECKPOINT_MINUTES,
    routeTransientRetryAttempts: 1,
    routeFallbackMaxMinutes: 30,
    maxScheduledIntelligenceWritesPerDayPerHub: Math.ceil((24 * 60) / CHECKPOINT_MINUTES),
    extraMsPolling: 0,
    tursoWrites: 0,
    repairEvents: Number(state.selfHealing?.repairEvents || 0),
    recoveries: Number(state.selfHealing?.recoveries || 0),
    sourceOutages: Number(state.selfHealing?.sourceOutages || 0),
    routeFallbackEvents: Number(state.selfHealing?.routeFallbackEvents || 0),
    stateResets: Number(state.selfHealing?.stateResets || 0),
    lastRepairAt: String(state.selfHealing?.lastRepairAt || ""),
    lastRepairAction: String(state.selfHealing?.lastRepairAction || ""),
    nextRepairWindowAt: iso(Math.ceil(now / (AUTO_REPAIR_MINUTES * 60000)) * AUTO_REPAIR_MINUTES * 60000),
  };
}

export function shouldCheckpointTbrIntelligence(nowValue = Date.now()) {
  const now = new Date(Number(nowValue));
  return now.getUTCMinutes() % CHECKPOINT_MINUTES === 0;
}

export function shouldAttemptTbrAutoRepair(nowValue = Date.now()) {
  const now = new Date(Number(nowValue));
  return now.getUTCMinutes() % AUTO_REPAIR_MINUTES === 0;
}

export function shouldUpdateTbrIntelligence(observed, nowValue = Date.now()) {
  return Boolean(observed?.sourceChanged || observed?.routeFallbackChanged || shouldCheckpointTbrIntelligence(nowValue));
}

export async function updateTbrIntelligence(env, hubValue, shadowReport, observed = {}, live = {}, options = {}) {
  const hub = cleanHub(hubValue);
  if (!env?.STATE) return { ok: false, skipped: "missing_state" };
  const now = Number(options.now ?? Date.now());
  const key = intelligenceKey(hub);
  const state = parseIntelligence(await env.STATE.get(key), hub);
  if (!state.createdAt) state.createdAt = iso(now);
  rollHealth(state, now, currentHealthMode(shadowReport, live));
  scanRecords(state, shadowReport, now);
  applyTransitions(state, shadowReport, observed, live, options, now);
  pruneState(state, now);
  state.lastCheckpointAt = iso(now);
  state.updatedAt = iso(now);
  await env.STATE.put(key, JSON.stringify(state), { expirationTtl: INTELLIGENCE_TTL_SECONDS });
  return readTbrIntelligenceReportFromState(state, shadowReport, now);
}

export async function recordTbrRepairEvent(env, hubValue, action, nowValue = Date.now()) {
  const hub = cleanHub(hubValue);
  if (!env?.STATE) return { ok: false, skipped: "missing_state" };
  const now = Number(nowValue);
  const key = intelligenceKey(hub);
  const state = parseIntelligence(await env.STATE.get(key), hub);
  const day = ensureDay(state, bangkokDay(now));
  day.repairEvents += 1;
  state.selfHealing.repairEvents += 1;
  state.selfHealing.lastRepairAt = iso(now);
  state.selfHealing.lastRepairAction = String(action || "repair").slice(0, 80);
  state.updatedAt = iso(now);
  if (!state.createdAt) state.createdAt = iso(now);
  pruneState(state, now);
  await env.STATE.put(key, JSON.stringify(state), { expirationTtl: INTELLIGENCE_TTL_SECONDS });
  return { ok: true, action: state.selfHealing.lastRepairAction };
}

function readTbrIntelligenceReportFromState(state, shadowReport, now) {
  const today = aggregateDays(state, 1, now);
  const rolling7 = aggregateDays(state, 7, now);
  const rolling14 = aggregateDays(state, 14, now);
  return {
    ok: true,
    intelligenceVersion: INTELLIGENCE_VERSION,
    hub: state.hub,
    shadowOnly: true,
    queueAuthority: false,
    actualArrivalAuthority: "ROUTE",
    tursoReads: 0,
    tursoWrites: 0,
    browserKvKey: intelligenceKey(state.hub),
    createdAt: String(state.createdAt || ""),
    updatedAt: String(state.updatedAt || ""),
    today,
    rolling7,
    rolling14,
    readiness: readiness(rolling14, shadowReport),
    selfHealing: selfHealingSummary(state, shadowReport, now),
  };
}

export async function readTbrIntelligenceReport(env, hubValue = "NE1", shadowReport = null, nowValue = Date.now()) {
  const hub = cleanHub(hubValue);
  const raw = env?.STATE ? await env.STATE.get(intelligenceKey(hub)) : null;
  const state = parseIntelligence(raw, hub);
  return readTbrIntelligenceReportFromState(state, shadowReport, Number(nowValue));
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
  const rows = (s.records || []).slice(0, 80).map((item) => {
    const label = item.status === "confirmed" ? "ยืนยันแล้ว" : item.status === "expired" ? "หมดเวลา/ต้องตรวจ" : item.routeSeen ? "รอเวลามาถึงจริง" : "รอ Route";
    return `<tr><td><code>${esc(item.id)}</code></td><td>${esc(item.attendanceType || "-")}</td><td>${esc(label)}</td><td>${esc(item.tbrAt || "-")}</td><td>${esc(item.routeActualArrivalAt || "-")}</td><td>${item.leadMinutes == null ? "-" : `${esc(item.leadMinutes)} นาที`}</td></tr>`;
  }).join("") || '<tr><td colspan="6" class="empty">ยังไม่มี candidate ที่ต้องแสดง</td></tr>';
  const readinessClass = ready.status === "PRODUCTION_CANDIDATE" ? "good" : ready.status === "ADVISORY_READY" ? "good" : "warn";
  const healthClass = h.status === "HEALTHY" ? "good" : "warn";
  return new Response(`<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="60"><title>TBR Intelligence ${esc(s.hub || r.hub || "")}</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f4f6f8;color:#18212f;font-family:system-ui,-apple-system,sans-serif}.wrap{max-width:1240px;margin:24px auto;padding:0 16px}.top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap}.top h1{margin:0 0 5px}.muted{color:#667085}.pill{padding:7px 10px;border-radius:999px;background:#ecfdf3;color:#067647;font-size:13px;font-weight:700}.banner{margin:14px 0;padding:13px 15px;border:1px solid #e5e7eb;border-radius:12px;background:#fff}.good{color:#067647}.warn{color:#b54708}.danger{color:#b42318}.grid{display:grid;grid-template-columns:repeat(6,minmax(130px,1fr));gap:10px;margin:14px 0}.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px}.card b{display:block;font-size:24px;margin-top:6px}.section{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-top:14px}.split{display:grid;grid-template-columns:1fr 1fr;gap:14px}.kv{display:grid;grid-template-columns:1fr auto;gap:7px 12px;font-size:14px}.kv span:nth-child(even){font-weight:700;text-align:right}.table{overflow:auto}table{border-collapse:collapse;width:100%;min-width:760px}th,td{padding:10px 11px;border-bottom:1px solid #eef1f5;text-align:center;font-size:13px}th{background:#f8fafc}.empty{padding:24px;color:#667085}.foot{margin:14px 0;color:#667085;font-size:12px;line-height:1.6}@media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}.split{grid-template-columns:1fr}}@media(max-width:520px){.grid{grid-template-columns:1fr 1fr}.card b{font-size:20px}}
  </style></head><body><main class="wrap"><div class="top"><div><h1>TBR Intelligence · ${esc(s.hub || r.hub || "-")}</h1><div class="muted">Shadow → Intelligence V1 · วัดความแม่น ความเร็ว สุขภาพ source และความพร้อมก่อนมีผลกับคิวจริง</div></div><div class="pill">Turso 0/0 · Extra MS polling 0 · Queue authority OFF</div></div>
  <div class="banner ${healthClass}"><b>Auto Heal: ${esc(h.status || "-")}</b> · Observer ${esc(s.observerStatus || "-")} · Source ${s.sourceAvailable === true ? "LIVE" : "WAITING"} · Route fallback ${s.routeFallback ? "ON" : "OFF"} · checkpoint ${metric(h.intelligenceCheckpointMinutes," นาที")}</div>
  <div class="grid"><div class="card">Readiness<b class="${readinessClass}">${esc(ready.status || "-")}</b></div><div class="card">คะแนนความพร้อม<b>${metric(ready.score,"/100")}</b></div><div class="card">ตัวอย่าง 14 วัน<b>${metric(m.resolved)}</b></div><div class="card">ยืนยันกับ Route<b>${metric(m.confirmationRate,"%")}</b></div><div class="card">P50 รู้ล่วงหน้า<b>${metric(m.p50LeadMinutes," นาที")}</b></div><div class="card">P90 รู้ล่วงหน้า<b>${metric(m.p90LeadMinutes," นาที")}</b></div></div>
  <div class="grid"><div class="card">P95<b>${metric(m.p95LeadMinutes," นาที")}</b></div><div class="card">Source available<b>${metric(m.sourceAvailableRate,"%")}</b></div><div class="card">Clean LIVE<b>${metric(m.cleanLiveRate,"%")}</b></div><div class="card">Fallback time<b>${metric(m.fallbackRate,"%")}</b></div><div class="card">Expired<b>${metric(m.expiredRate,"%")}</b></div><div class="card">Observation days<b>${metric(m.observationDays)}</b></div></div>
  <div class="split"><section class="section"><h3>7 วัน</h3><div class="kv"><span>Candidate</span><span>${metric(r.rolling7?.candidates)}</span><span>Confirmed</span><span>${metric(r.rolling7?.confirmed)}</span><span>Expired</span><span>${metric(r.rolling7?.expired)}</span><span>Confirmation</span><span>${metric(r.rolling7?.confirmationRate,"%")}</span><span>P50 / P90 / P95</span><span>${metric(r.rolling7?.p50LeadMinutes)} / ${metric(r.rolling7?.p90LeadMinutes)} / ${metric(r.rolling7?.p95LeadMinutes)} นาที</span></div></section>
  <section class="section"><h3>Self-healing / Quota Guard</h3><div class="kv"><span>Connector repair cadence</span><span>${metric(h.connectorRepairIntervalMinutes," นาที")}</span><span>Route transient retry</span><span>${metric(h.routeTransientRetryAttempts," ครั้ง")}</span><span>Route fallback max</span><span>${metric(h.routeFallbackMaxMinutes," นาที")}</span><span>Periodic Intelligence writes max</span><span>${metric(h.maxScheduledIntelligenceWritesPerDayPerHub,"/วัน/HUB")}</span><span>Repair / Recovery</span><span>${metric(h.repairEvents)} / ${metric(h.recoveries)}</span><span>Source outage / fallback events</span><span>${metric(h.sourceOutages)} / ${metric(h.routeFallbackEvents)}</span></div></section></div>
  <section class="section"><h3>รายการ Shadow ล่าสุด</h3><div class="table"><table><thead><tr><th>Shadow ID</th><th>ประเภทงาน</th><th>สถานะ</th><th>TBR</th><th>Route actual</th><th>รู้ล่วงหน้า</th></tr></thead><tbody>${rows}</tbody></table></div></section>
  <div class="foot">TBR Shadow Test compatibility · หน้านี้ยังเป็น Read-only Advisory เท่านั้น · Actual Arrival authority = ROUTE · TBR ไม่มีสิทธิ์เปลี่ยน Queue · Aggregate 14 วันเก็บใน Browser KV เท่านั้นและเขียนตาม checkpoint 30 นาที/เหตุการณ์เปลี่ยน source ไม่ได้เขียนทุก cron</div>
  </main></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export const TBR_INTELLIGENCE_POLICY = Object.freeze({
  version: INTELLIGENCE_VERSION,
  checkpointMinutes: CHECKPOINT_MINUTES,
  autoRepairMinutes: AUTO_REPAIR_MINUTES,
  retentionDays: INTELLIGENCE_DAYS,
  extraMsPolling: 0,
  tursoWrites: 0,
  queueAuthority: false,
});
