const VERSION = 2;
const CURRENT_TTL_SECONDS = 7 * 24 * 60 * 60;
const HISTORY_TTL_SECONDS = 30 * 24 * 60 * 60;
const HISTORY_RETENTION_MS = HISTORY_TTL_SECONDS * 1000;
const HISTORY_LIMIT = 80;
const PAGE_REFRESH_SECONDS = 60;

const ALLOWED_ORIGINS = new Set([
  "https://waiting-trucks-report-api-dev.26nak-testdev.workers.dev",
  "https://flashdevnak.github.io",
  "https://waiting-trucks-ms-browser-test.26nak-testdev.workers.dev",
]);

function clean(value, max = 240) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

function normalizeHub(value) {
  const hub = clean(value, 20).toUpperCase();
  return /^[A-Z0-9_-]{2,20}$/.test(hub) ? hub : "";
}

function normalizeSource(value) {
  const source = clean(value, 20);
  return ["routes", "preEntry", "busTime"].includes(source) ? source : "unknown";
}

function currentKey(hub) {
  // Keep v1 key for backward compatibility with the existing Browser KV state.
  return `connection:error:v1:${hub}`;
}

function historyKey(hub) {
  return `connection:history:v2:${hub}`;
}

function corsHeaders(request) {
  const origin = String(request.headers.get("origin") || "");
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    vary: "Origin",
  };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-methods"] = "GET,POST,OPTIONS";
    headers["access-control-allow-headers"] = "content-type";
  }
  return headers;
}

function json(request, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(request),
  });
}

function allowedWrite(request) {
  return ALLOWED_ORIGINS.has(String(request.headers.get("origin") || ""));
}

function classify(codeValue, messageValue) {
  const code = clean(codeValue, 40);
  const message = clean(messageValue, 240);
  const text = `${code} ${message}`;
  if (/429|rate.?limit|too many requests|request\s+exceeds\s+the\s+limit|exceed(?:ed|s)?\s+(?:the\s+)?limit/i.test(text))
    return { code: "RATE_LIMIT", label: "MS จำกัดคำขอชั่วคราว", severity: "HIGH", family: "quota" };
  if (/REQUEST_TIMEOUT|timeout|หมดเวลา/i.test(text))
    return { code: code || "TIMEOUT", label: "การเชื่อมต่อใช้เวลานานเกินไป", severity: "MEDIUM", family: "transport" };
  if (/MS_SESSION_EXPIRED|session.*หมดอายุ/i.test(text))
    return { code: code || "SESSION", label: "Session MS หมดอายุ", severity: "HIGH", family: "session" };
  if (/INVALID_CONNECTOR|connector/i.test(text))
    return { code: code || "CONNECTOR", label: "Connector ใช้งานไม่ได้", severity: "HIGH", family: "session" };
  if (/INVALID_HAR|HAR/i.test(text))
    return { code: code || "HAR", label: "ไฟล์ HAR ไม่ผ่านการตรวจสอบ", severity: "MEDIUM", family: "har" };
  if (/502|503|504|bad gateway|service unavailable|gateway timeout/i.test(text))
    return { code: code || "UPSTREAM", label: "MS upstream สะดุดชั่วคราว", severity: "MEDIUM", family: "transport" };
  return { code: code || "ERROR", label: "การเชื่อมต่อมีปัญหา", severity: "MEDIUM", family: "unknown" };
}

function repairPolicy(classified, source) {
  if (classified.family === "quota") {
    return {
      mode: "QUOTA_GUARD",
      auto: true,
      action: "หยุดยิง source ที่โดนจำกัด ใช้ cache ล่าสุด และรอ cooldown ก่อน probe ใหม่",
      safeFallback: true,
    };
  }
  if (classified.family === "transport") {
    return {
      mode: source === "routes" ? "RETRY_THEN_ROUTE_FALLBACK" : "RETRY_THEN_CACHE",
      auto: true,
      action: source === "routes"
        ? "retry แบบจำกัด 1 ครั้ง แล้วใช้ Route snapshot ล่าสุดชั่วคราว"
        : "retry แบบจำกัด 1 ครั้ง แล้วคงข้อมูล cache ล่าสุด",
      safeFallback: true,
    };
  }
  if (classified.family === "session") {
    return {
      mode: "CONNECTOR_RECOVERY",
      auto: true,
      action: "พยายามกู้ connector/session ตาม recovery path โดยไม่เพิ่มรอบ polling",
      safeFallback: true,
    };
  }
  if (classified.family === "har") {
    return {
      mode: "WAIT_NEW_HAR",
      auto: false,
      action: "รอ HAR/session ใหม่ที่ถูกต้อง ไม่ยิงซ้ำด้วย credential ที่ใช้ไม่ได้",
      safeFallback: true,
    };
  }
  return {
    mode: "OBSERVE_AND_FALLBACK",
    auto: true,
    action: "ใช้ retry/fallback ที่มีอยู่และติดตามการฟื้นตัวจาก cron เดิม",
    safeFallback: true,
  };
}

function makeIncidentId(now, source, code) {
  const suffix = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${now.toString(36)}-${source}-${code}-${suffix}`.slice(0, 120);
}

function normalizedRecord(data) {
  if (!data || typeof data !== "object") return null;
  const source = normalizeSource(data.source);
  const classified = classify(data.code, data.message);
  const policy = repairPolicy(classified, source);
  return {
    ...data,
    version: Number(data.version || VERSION),
    hub: normalizeHub(data.hub) || clean(data.hub, 20),
    source,
    code: classified.code,
    label: classified.label,
    severity: data.severity || classified.severity,
    family: data.family || classified.family,
    autoHealMode: data.autoHealMode || policy.mode,
    autoHealEligible: data.autoHealEligible ?? policy.auto,
    autoHealAction: data.autoHealAction || policy.action,
    safeFallback: data.safeFallback ?? policy.safeFallback,
    incidentId: clean(data.incidentId, 120),
    occurredAt: String(data.occurredAt || ""),
    recoveredAt: String(data.recoveredAt || ""),
  };
}

function parseJson(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

function pruneHistory(items, now = Date.now()) {
  const cutoff = now - HISTORY_RETENTION_MS;
  return (Array.isArray(items) ? items : [])
    .map(normalizedRecord)
    .filter(Boolean)
    .filter((item) => {
      const occurred = Date.parse(String(item.occurredAt || ""));
      return Number.isFinite(occurred) && occurred >= cutoff;
    })
    .sort((a, b) => Date.parse(b.occurredAt || 0) - Date.parse(a.occurredAt || 0))
    .slice(0, HISTORY_LIMIT);
}

async function readCurrent(env, hub) {
  const raw = await env.STATE.get(currentKey(hub));
  return normalizedRecord(parseJson(raw, null));
}

async function readHistory(env, hub, now = Date.now()) {
  const raw = await env.STATE.get(historyKey(hub));
  return pruneHistory(parseJson(raw, []), now);
}

async function writeCurrent(env, hub, record) {
  await env.STATE.put(currentKey(hub), JSON.stringify(record), { expirationTtl: CURRENT_TTL_SECONDS });
}

async function writeHistory(env, hub, items) {
  await env.STATE.put(historyKey(hub), JSON.stringify(pruneHistory(items)), { expirationTtl: HISTORY_TTL_SECONDS });
}

function mergeHistory(items, ...records) {
  const history = [...(Array.isArray(items) ? items : [])];
  for (const value of records) {
    const record = normalizedRecord(value);
    if (!record) continue;
    const index = record.incidentId
      ? history.findIndex((item) => item.incidentId === record.incidentId)
      : -1;
    if (index >= 0) history[index] = record;
    else history.unshift(record);
  }
  return pruneHistory(history);
}

function sameOpenIncident(current, source, classified, message) {
  return Boolean(
    current && !current.recoveredAt &&
    current.source === source &&
    current.code === classified.code &&
    current.label === classified.label &&
    current.message === message,
  );
}

function buildIncident(hub, source, codeValue, messageValue, now = Date.now()) {
  const classified = classify(codeValue, messageValue);
  const policy = repairPolicy(classified, source);
  return {
    version: VERSION,
    incidentId: makeIncidentId(now, source, classified.code),
    hub,
    source,
    code: classified.code,
    label: classified.label,
    severity: classified.severity,
    family: classified.family,
    message: clean(messageValue, 240),
    occurredAt: new Date(now).toISOString(),
    recoveredAt: "",
    autoHealMode: policy.mode,
    autoHealEligible: policy.auto,
    autoHealAction: policy.action,
    safeFallback: policy.safeFallback,
  };
}

function healthSummary(current, history, now = Date.now()) {
  const active = Boolean(current && !current.recoveredAt);
  const recovered = history.filter((item) => item.recoveredAt);
  const rateLimited = history.filter((item) => item.code === "RATE_LIMIT").length;
  const autoHealed = recovered.filter((item) => item.autoHealEligible !== false).length;
  const durations = recovered
    .map((item) => {
      const a = Date.parse(item.occurredAt || "");
      const b = Date.parse(item.recoveredAt || "");
      return Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : null;
    })
    .filter((value) => value !== null);
  const avgRecoverySeconds = durations.length
    ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length / 1000)
    : null;
  const activeAgeSeconds = active
    ? Math.max(0, Math.round((now - Date.parse(current.occurredAt || now)) / 1000))
    : 0;
  const attention = !active ? "NORMAL" : activeAgeSeconds >= 15 * 60 ? "CRITICAL" : activeAgeSeconds >= 5 * 60 ? "ATTENTION" : "WATCHING";
  return {
    status: active ? "ACTIVE" : current?.recoveredAt ? "RECOVERED" : "HEALTHY",
    attention,
    activeAgeSeconds,
    incidents30d: history.length,
    recovered30d: recovered.length,
    rateLimit30d: rateLimited,
    autoHealed30d: autoHealed,
    avgRecoverySeconds,
  };
}

export async function readConnectionIncidentReport(env, hubValue, now = Date.now()) {
  const hub = normalizeHub(hubValue);
  if (!hub || !env?.STATE) return { ok: false, hub: hub || "", data: null, history: [] };
  const [current, storedHistory] = await Promise.all([
    readCurrent(env, hub),
    readHistory(env, hub, now),
  ]);
  const history = [...storedHistory];
  if (current && !history.some((item) => item.incidentId && item.incidentId === current.incidentId)) {
    history.unshift(current);
  }
  const pruned = pruneHistory(history, now);
  return {
    ok: true,
    hub,
    data: current,
    history: pruned,
    summary: healthSummary(current, pruned, now),
    quotaPolicy: CONNECTION_INTELLIGENCE_POLICY,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function displayTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function sourceLabel(value) {
  if (value === "routes") return "Route";
  if (value === "preEntry") return "Pre-entry";
  if (value === "busTime") return "TBR / BusTime";
  return value ? String(value) : "-";
}

function durationLabel(startValue, endValue) {
  const start = Date.parse(String(startValue || ""));
  const end = Date.parse(String(endValue || ""));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "-";
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds} วินาที`;
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return remain ? `${minutes} นาที ${remain} วินาที` : `${minutes} นาที`;
}

function secondsLabel(value) {
  if (value == null) return "-";
  const seconds = Math.max(0, Number(value) || 0);
  if (seconds < 60) return `${Math.round(seconds)} วินาที`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} นาที`;
}

function wantsHtml(request) {
  return String(request.headers.get("accept") || "").toLowerCase().includes("text/html");
}

// INTELLIGENCE_HUB_FILTER_V3: compatibility marker; V4 below is the active implementation.
// INTELLIGENCE_HUB_FILTER_V4: merge every Browser-KV-known HUB without Turso/MS reads.
// The discovery list is cached in-memory for 10 minutes; the page remains read-only.
const HUB_CATALOG_CACHE_MS = 10 * 60 * 1000;
let hubCatalogCache = { until: 0, hubs: [] };
async function connectedHubCatalog(env, currentHub = "") {
  const hubs = [];
  const add = (value) => {
    const hub = normalizeHub(value);
    if (hub && !hubs.includes(hub)) hubs.push(hub);
  };
  add(currentHub);
  const now = Date.now();
  if (hubCatalogCache.until > now) {
    for (const value of hubCatalogCache.hubs) add(value);
    return hubs.sort((a, b) => a.localeCompare(b));
  }
  try {
    const stored = parseJson((await env.STATE.get("hubs")) || "[]", []);
    for (const value of Array.isArray(stored) ? stored : []) add(value);
  } catch {}
  for (const value of String(env?.CONNECTOR_BOOTSTRAP_HUBS || "").split(",")) add(value);
  try {
    const prefixes = ["connector:", "connection:error:v1:", "connection:history:v2:", "shadow:tbr:v1:"];
    const pages = await Promise.all(prefixes.map((prefix) => env.STATE.list({ prefix, limit: 1000 })));
    pages.forEach((page, index) => {
      const prefix = prefixes[index];
      for (const item of page?.keys || []) add(String(item?.name || "").slice(prefix.length));
    });
  } catch {}
  hubCatalogCache = { until: now + HUB_CATALOG_CACHE_MS, hubs: [...hubs] };
  return hubs.sort((a, b) => a.localeCompare(b));
}

function connectionHubToolbar(hub, hubs = []) {
  const current = normalizeHub(hub) || "NE1";
  const values = [...new Set([current, ...(Array.isArray(hubs) ? hubs : []).map(normalizeHub).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
  const options = values.map((value) => '<option value="/api/connection-error?hub=' + encodeURIComponent(value) + '"' + (value === current ? ' selected' : '') + '>' + escapeHtml(value) + '</option>').join('');
  return '<section class="hub-toolbar"><div class="hub-filter"><span class="hub-filter-label">HUB ในระบบ</span><select aria-label="เลือก HUB" onchange="location.href=this.value">' + options + '</select><span class="hub-filter-note">ดูข้อมูลเท่านั้น · ไม่สร้าง polling เพิ่ม</span></div><nav class="intel-tabs" aria-label="Intelligence pages"><a class="active" href="/api/connection-error?hub=' + encodeURIComponent(current) + '">Error Intelligence</a><a href="/shadow-tbr?hub=' + encodeURIComponent(current) + '">TBR Intelligence</a></nav></section>';
}

function connectionErrorPage(report, hubs = []) {
  const hub = report.hub;
  const data = report.data;
  const history = report.history || [];
  const summary = report.summary || {};
  const active = Boolean(data && !data.recoveredAt);
  const recovered = Boolean(data?.recoveredAt);
  const statusClass = active ? "bad" : "good";
  const statusTitle = active
    ? "ACTIVE · พบปัญหาและกำลังเฝ้าซ่อม"
    : recovered
      ? "RECOVERED · การเชื่อมต่อกลับมาแล้ว"
      : "LIVE · ยังไม่พบ Error ที่บันทึก";
  const statusDetail = active
    ? `${sourceLabel(data?.source)} · ${data?.label || "การเชื่อมต่อมีปัญหา"}`
    : recovered
      ? `${sourceLabel(data?.source)} · Error ล่าสุดถูกกู้คืนแล้ว`
      : "Browser KV ยังไม่มี connection error สำหรับ HUB นี้";
  const rows = history.slice(0, HISTORY_LIMIT).map((item) => {
    const state = item.recoveredAt ? "RECOVERED" : "ACTIVE";
    return `<tr><td>${escapeHtml(state)}</td><td>${escapeHtml(sourceLabel(item.source))}</td><td><code>${escapeHtml(item.code || "-")}</code></td><td>${escapeHtml(item.severity || "-")}</td><td class="message">${escapeHtml(item.message || "-")}</td><td class="message">${escapeHtml(item.autoHealAction || "-")}</td><td>${escapeHtml(displayTime(item.occurredAt))}</td><td>${escapeHtml(displayTime(item.recoveredAt))}</td><td>${escapeHtml(durationLabel(item.occurredAt, item.recoveredAt))}</td></tr>`;
  }).join("") || '<tr><td colspan="9" class="empty">ยังไม่มี Incident History ที่บันทึกใน Browser KV</td></tr>';

  return new Response(
    `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="${PAGE_REFRESH_SECONDS}"><title>Connection Intelligence ${escapeHtml(hub)}</title><style>
    *{box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#f5f7fb;color:#18212f}.wrap{max-width:1380px;margin:28px auto;padding:0 16px}.head{display:flex;justify-content:space-between;gap:16px;align-items:end;flex-wrap:wrap}.sub{color:#667085}.health{margin:14px 0;padding:12px 14px;border-radius:12px;background:#fff;border:1px solid #e5e7eb;line-height:1.65}.health b{display:inline-block;margin-right:8px}.good{color:#067647}.bad{color:#b42318;background:#fff7f6;border-color:#fecdca}.cards{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:10px;margin:18px 0}.card{background:white;border:1px solid #e5e7eb;border-radius:12px;padding:14px;min-width:0}.card b{display:block;font-size:20px;margin-top:6px;overflow-wrap:anywhere}.panel{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px;margin:14px 0}.panel h3{margin:0 0 8px}.panel p{margin:6px 0;color:#475467;line-height:1.55}.table{overflow:auto;background:white;border:1px solid #e5e7eb;border-radius:12px}table{border-collapse:collapse;width:100%;min-width:1180px}th,td{padding:11px 12px;border-bottom:1px solid #eef1f5;text-align:center;font-size:13px;vertical-align:top}th{background:#f8fafc}.message{text-align:left;max-width:340px;overflow-wrap:anywhere}.empty{padding:28px;color:#667085;text-align:center}.safe{font-size:13px;color:#067647;background:#ecfdf3;border-radius:999px;padding:7px 10px}.foot{margin-top:12px;color:#667085;font-size:13px;line-height:1.6}@media(max-width:900px){.cards{grid-template-columns:repeat(2,1fr)}.wrap{margin-top:18px}}
    </style><style>
    body{background:radial-gradient(circle at top left,#eef6ff 0,#f7f9fc 34%,#f4f6fa 72%)}.wrap{max-width:1400px}.hub-toolbar{display:flex;justify-content:space-between;gap:14px;align-items:center;margin-bottom:16px;padding:12px 14px;border:1px solid #dbe5f0;border-radius:14px;background:rgba(255,255,255,.88);box-shadow:0 8px 28px rgba(31,41,55,.06);backdrop-filter:blur(10px)}.hub-filter{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.hub-filter-label{font-weight:800;color:#344054}.hub-filter select{min-width:120px;height:40px;padding:0 34px 0 12px;border:1px solid #cfd8e3;border-radius:10px;background:#fff;color:#101828;font-weight:800;outline:none}.hub-filter select:focus{border-color:#84adff;box-shadow:0 0 0 3px rgba(46,111,235,.12)}.hub-filter-note{font-size:12px;color:#667085}.intel-tabs{display:flex;gap:6px;padding:4px;border-radius:11px;background:#eef2f7}.intel-tabs a{padding:8px 11px;border-radius:8px;text-decoration:none;color:#475467;font-size:13px;font-weight:800}.intel-tabs a.active{background:#fff;color:#155eef;box-shadow:0 1px 4px rgba(31,41,55,.08)}.head h1{letter-spacing:-.02em}.health{box-shadow:0 8px 24px rgba(31,41,55,.05)}.cards{gap:12px}.card{position:relative;overflow:hidden;box-shadow:0 8px 22px rgba(31,41,55,.045)}.card:before{content:"";position:absolute;left:0;top:0;right:0;height:3px;background:linear-gradient(90deg,#2e6feb,#57c4ff)}.panel,.table{box-shadow:0 10px 28px rgba(31,41,55,.05)}th{position:sticky;top:0;z-index:1}.safe{font-weight:800}@media(max-width:760px){.hub-toolbar{align-items:stretch;flex-direction:column}.hub-filter{display:grid;grid-template-columns:1fr 1fr}.hub-filter-note{grid-column:1/-1}.intel-tabs{width:100%}.intel-tabs a{flex:1;text-align:center}.cards{grid-template-columns:repeat(2,1fr)}.card b{font-size:18px}}@media(max-width:440px){.hub-filter{grid-template-columns:1fr}.hub-filter-note{grid-column:auto}.cards{grid-template-columns:1fr 1fr}.wrap{padding:0 10px}}
    </style></head><body><div class="wrap">${connectionHubToolbar(hub, hubs)}<div class="head"><div><h1>Connection Intelligence · ${escapeHtml(hub)}</h1><div class="sub">Incident History + Smart Diagnosis + Auto-Heal visibility · ไม่กระทบคิวจริง</div></div><div class="safe">Turso 0/0 · Extra MS polling 0 · Duplicate writes 0</div></div><div class="health ${statusClass}"><b>${escapeHtml(statusTitle)}</b> · ${escapeHtml(statusDetail)}${data ? ` · เกิดล่าสุด ${escapeHtml(displayTime(data.occurredAt))}${data.recoveredAt ? ` · กู้คืน ${escapeHtml(displayTime(data.recoveredAt))}` : ""}` : ""}</div><div class="cards"><div class="card">สถานะ<b>${escapeHtml(summary.status || "HEALTHY")}</b></div><div class="card">ระดับเฝ้าระวัง<b>${escapeHtml(summary.attention || "NORMAL")}</b></div><div class="card">Incident 30 วัน<b>${escapeHtml(summary.incidents30d ?? 0)}</b></div><div class="card">กู้คืนแล้ว<b>${escapeHtml(summary.recovered30d ?? 0)}</b></div><div class="card">Rate limit<b>${escapeHtml(summary.rateLimit30d ?? 0)}</b></div><div class="card">เฉลี่ยกู้คืน<b>${escapeHtml(secondsLabel(summary.avgRecoverySeconds))}</b></div></div><div class="panel"><h3>Smart diagnosis / Self-healing</h3><p><b>Mode:</b> ${escapeHtml(data?.autoHealMode || "MONITOR")}</p><p><b>Action:</b> ${escapeHtml(data?.autoHealAction || "ยังไม่มีเหตุการณ์ที่ต้องซ่อม")}</p><p>ระบบไม่สร้าง MS polling เพิ่มเพื่อทำรายงานนี้, Error เดิมที่ยัง active จะถูก dedupe และไม่เขียน KV ซ้ำ, ประวัติเก็บแบบ rolling 30 วัน สูงสุด ${HISTORY_LIMIT} เหตุการณ์/HUB</p></div><div class="table"><table><thead><tr><th>สถานะ</th><th>Source</th><th>Code</th><th>ระดับ</th><th>ข้อความ</th><th>Auto-heal / การจัดการ</th><th>เกิดเมื่อ</th><th>กู้คืนเมื่อ</th><th>ใช้เวลา</th></tr></thead><tbody>${rows}</tbody></table></div><div class="foot">ข้อมูลมาจาก Browser KV เท่านั้น · หน้าอ่านอย่างเดียวและรีเฟรชทุก ${PAGE_REFRESH_SECONDS} วินาที · ประวัติใหม่เขียนเฉพาะตอน Incident เปิด/ปิด ไม่เขียนทุก cron · API JSON ยังเก็บ field data เดิมเพื่อ backward compatibility และเพิ่ม history/summary/quotaPolicy</div></div></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

// CONNECTION_INTELLIGENCE_V2: event-driven history. Same active error = zero KV writes.
export async function recordConnectionErrorKv(env, input = {}) {
  const hub = normalizeHub(input.hub);
  if (!hub || !env?.STATE) return { changed: false, data: null };
  const source = normalizeSource(input.source);
  const classified = classify(input.code, input.message);
  const message = clean(input.message, 240);
  const current = await readCurrent(env, hub);
  if (sameOpenIncident(current, source, classified, message)) {
    return { changed: false, data: current, deduped: true };
  }
  const record = buildIncident(hub, source, classified.code, message);
  const history = mergeHistory(await readHistory(env, hub), current, record);
  await Promise.all([
    writeCurrent(env, hub, record),
    writeHistory(env, hub, history),
  ]);
  return { changed: true, data: record, deduped: false };
}

export async function recordConnectionRecoveredKv(env, input = {}) {
  const hub = normalizeHub(input.hub);
  if (!hub || !env?.STATE) return { changed: false, data: null };
  const source = normalizeSource(input.source);
  const record = await readCurrent(env, hub);
  if (!record || record.recoveredAt) return { changed: false, data: record };
  if (source !== "unknown" && record.source !== source) return { changed: false, data: record };
  record.recoveredAt = new Date().toISOString();
  record.recoveryState = "RECOVERED";
  const history = mergeHistory(await readHistory(env, hub), record);
  await Promise.all([
    writeCurrent(env, hub, record),
    writeHistory(env, hub, history),
  ]);
  return { changed: true, data: record };
}

export async function handleConnectionErrorRequest(request, env, url) {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders(request) });

  const hub = normalizeHub(url.searchParams.get("hub"));
  if (!hub) return json(request, { ok: false, message: "Invalid HUB" }, 400);

  if (request.method === "GET") {
    const report = await readConnectionIncidentReport(env, hub);
    if (wantsHtml(request)) {
      const hubs = await connectedHubCatalog(env, hub);
      return connectionErrorPage(report, hubs);
    }
    return json(request, report);
  }

  if (request.method !== "POST")
    return json(request, { ok: false, message: "Method not allowed" }, 405);
  if (!allowedWrite(request))
    return json(request, { ok: false, message: "Origin not allowed" }, 403);

  const body = await request.json().catch(() => ({}));
  const event = clean(body?.event, 20);
  const source = normalizeSource(body?.source);
  if (event === "error") {
    const result = await recordConnectionErrorKv(env, { hub, source, code: body?.code, message: body?.message });
    return json(request, { ok: true, ...result });
  }
  if (event === "recovered") {
    const result = await recordConnectionRecoveredKv(env, { hub, source });
    return json(request, { ok: true, ...result });
  }
  return json(request, { ok: false, message: "Unknown event" }, 400);
}

export const CONNECTION_INTELLIGENCE_POLICY = Object.freeze({
  version: VERSION,
  storage: "Browser KV",
  historyDays: 30,
  maxHistoryPerHub: HISTORY_LIMIT,
  reportRefreshSeconds: PAGE_REFRESH_SECONDS,
  tursoReads: 0,
  tursoWrites: 0,
  extraMsPolling: 0,
  duplicateActiveErrorWrites: 0,
  maxKvWritesPerIncidentLifecycle: 4,
  preservesRealtimeRouteCadence: true,
  queueAuthority: false,
});
