import baseWorker from "./index.js";
import { readTbrShadowReport } from "./tbr-shadow.js";
import {
  readTbrIntelligenceReport,
  shouldCheckpointTbrIntelligence,
  tbrIntelligencePage,
  updateTbrIntelligence,
} from "./tbr-intelligence.js";

// TBR_INTELLIGENCE_STABLE_ENTRY_V3: this entrypoint is committed source, so Cloudflare Auto Build
// and GitHub staged deploy always expose the same Intelligence routes. It never calls MS itself.
const RECONCILE_MINUTES = 5;
const RECENT_CHECKPOINT_MS = 10 * 60 * 1000;

function cleanHub(value) {
  const hub = String(value || "NE1").trim().toUpperCase();
  return /^[A-Z0-9_-]{2,20}$/.test(hub) ? hub : "NE1";
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function validTime(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function currentMode(shadow) {
  if (shadow?.observerStatus === "STALE") return "stale";
  if (shadow?.routeFallback) return "fallback";
  if (shadow?.sourceAvailable === true) return "live";
  return "waiting";
}

function displayBangkok(value) {
  const ms = validTime(value);
  if (ms === null) return String(value || "-");
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

// INTELLIGENCE_HUB_FILTER_V3: the selector lists only already-configured Browser KV HUBs. It does not add HUBs to cron or request any upstream source.
function tbrHubToolbar(hubValue, hubs = []) {
  const current = cleanHub(hubValue || "NE1");
  const values = [...new Set([current, ...(Array.isArray(hubs) ? hubs : []).map(cleanHub)])].sort((a, b) => a.localeCompare(b));
  const options = values.map((value) => '<option value="/shadow-tbr?hub=' + encodeURIComponent(value) + '"' + (value === current ? ' selected' : '') + '>' + value + '</option>').join('');
  return '<section class="hub-toolbar"><div class="hub-filter"><span class="hub-filter-label">HUB ในระบบ</span><select aria-label="เลือก HUB" onchange="location.href=this.value">' + options + '</select><span class="hub-filter-note">อ่าน Intelligence ของ HUB ที่เชื่อมต่อแล้ว · ไม่เพิ่ม MS polling</span></div><nav class="intel-tabs" aria-label="Intelligence pages"><a href="/api/connection-error?hub=' + encodeURIComponent(current) + '">Error Intelligence</a><a class="active" href="/shadow-tbr?hub=' + encodeURIComponent(current) + '">TBR Intelligence</a></nav></section>';
}

function improvePageHtml(htmlValue, shadow, intelligence, hubs = []) {
  let html = String(htmlValue || "");
  const currentHub = cleanHub(shadow?.hub || intelligence?.hub || "NE1");
  html = html.replace(
    '<main class="wrap"><div class="top">',
    '<main class="wrap">' + tbrHubToolbar(currentHub, hubs) + '<div class="top">',
  );
  html = html.replace(
    '</style></head>',
    '.hub-toolbar{display:flex;justify-content:space-between;gap:14px;align-items:center;margin-bottom:16px;padding:12px 14px;border:1px solid #dbe5f0;border-radius:14px;background:rgba(255,255,255,.9);box-shadow:0 8px 28px rgba(31,41,55,.06);backdrop-filter:blur(10px)}.hub-filter{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.hub-filter-label{font-weight:800;color:#344054}.hub-filter select{min-width:120px;height:40px;padding:0 34px 0 12px;border:1px solid #cfd8e3;border-radius:10px;background:#fff;color:#101828;font-weight:800;outline:none}.hub-filter select:focus{border-color:#84adff;box-shadow:0 0 0 3px rgba(46,111,235,.12)}.hub-filter-note{font-size:12px;color:#667085}.intel-tabs{display:flex;gap:6px;padding:4px;border-radius:11px;background:#eef2f7}.intel-tabs a{padding:8px 11px;border-radius:8px;text-decoration:none;color:#475467;font-size:13px;font-weight:800}.intel-tabs a.active{background:#fff;color:#155eef;box-shadow:0 1px 4px rgba(31,41,55,.08)}body{background:radial-gradient(circle at top left,#eef6ff 0,#f7f9fc 34%,#f4f6fa 72%)}.wrap{max-width:1320px}.top h1{letter-spacing:-.02em}.banner,.section,.card{box-shadow:0 9px 26px rgba(31,41,55,.05)}.card{position:relative;overflow:hidden}.card:before{content:"";position:absolute;left:0;top:0;right:0;height:3px;background:linear-gradient(90deg,#2e6feb,#57c4ff)}.banner{border-left:4px solid #12b76a}.section h3{margin-top:0}th{position:sticky;top:0;z-index:1}@media(max-width:760px){.hub-toolbar{align-items:stretch;flex-direction:column}.hub-filter{display:grid;grid-template-columns:1fr 1fr}.hub-filter-note{grid-column:1/-1}.intel-tabs{width:100%}.intel-tabs a{flex:1;text-align:center}}@media(max-width:440px){.hub-filter{grid-template-columns:1fr}.hub-filter-note{grid-column:auto}.wrap{padding:0 10px}}' + '</style></head>',
  );
  for (const [from, to] of Object.entries({
    SHADOW_COLLECTING: "กำลังเก็บข้อมูล",
    SHADOW_LEARNING: "กำลังเรียนรู้",
    ADVISORY_READY: "พร้อมใช้ช่วยตัดสินใจ",
    PRODUCTION_CANDIDATE: "ผู้สมัคร Production",
  })) html = html.replaceAll(from, to);

  html = html.replace(
    ".card b{display:block;font-size:24px;margin-top:6px}",
    ".card b{display:block;font-size:24px;margin-top:6px;overflow-wrap:anywhere}.card .ready-value{font-size:18px;line-height:1.2}",
  );

  html = html.replace(
    />((?:20\d{2})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))</g,
    (_match, value) => `>${displayBangkok(value)}<`,
  );

  const metrics = intelligence?.rolling14 || {};
  if (metrics.sourceAvailableRate == null) {
    html = html.replace(
      '<div class="card">Source available<b>-</b></div>',
      `<div class="card">Source available<b>${shadow?.sourceAvailable === true ? "LIVE ตอนนี้" : "WAITING"}</b></div>`,
    );
  }
  if (metrics.cleanLiveRate == null) {
    html = html.replace(
      '<div class="card">Clean LIVE<b>-</b></div>',
      `<div class="card">Clean LIVE<b>${shadow?.sourceAvailable === true && !shadow?.routeFallback ? "LIVE ตอนนี้" : "-"}</b></div>`,
    );
  }
  if (metrics.fallbackRate == null) {
    html = html.replace(
      '<div class="card">Fallback time<b>-</b></div>',
      `<div class="card">Fallback time<b>${shadow?.routeFallback ? "ON ตอนนี้" : "OFF ตอนนี้"}</b></div>`,
    );
  }
  return html;
}

async function intelligenceForShadow(env, hub, shadow, now = Date.now()) {
  let report = await readTbrIntelligenceReport(env, hub, shadow, now);
  const records = Array.isArray(shadow?.records) ? shadow.records : [];
  const confirmed = records.filter((item) => item?.status === "confirmed").length;
  const missingBootstrap = !report?.createdAt;
  const missingCandidates = records.length > 0 && Number(report?.rolling14?.candidates || 0) === 0;
  const missingConfirmed = confirmed > 0 && Number(report?.rolling14?.confirmed || 0) === 0;
  if (missingBootstrap || missingCandidates || missingConfirmed) {
    report = await updateTbrIntelligence(
      env,
      hub,
      shadow,
      { bootstrap: true },
      {},
      { now },
    );
  }
  return report;
}

async function intelligencePage(env, hub) {
  const shadow = await readTbrShadowReport(env, hub);
  const intelligence = await intelligenceForShadow(env, hub, shadow);
  const hubs = await configuredHubs(env);
  const base = tbrIntelligencePage(shadow, intelligence);
  const html = improvePageHtml(await base.text(), shadow, intelligence, hubs);
  return new Response(html, {
    status: base.status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function intelligenceApi(env, hub) {
  const shadow = await readTbrShadowReport(env, hub);
  return json(await intelligenceForShadow(env, hub, shadow));
}

function shouldReconcile(now) {
  return new Date(now).getUTCMinutes() % RECONCILE_MINUTES === 0;
}

async function configuredHubs(env) {
  if (!env?.STATE) return [];
  try {
    const hubs = JSON.parse((await env.STATE.get("hubs")) || "[]");
    return [...new Set((Array.isArray(hubs) ? hubs : []).map(cleanHub))];
  } catch {
    return [];
  }
}

async function reconcileHub(env, hub, now) {
  const shadow = await readTbrShadowReport(env, hub);
  const key = `shadow:tbr:intel:v1:${cleanHub(hub)}`;
  let prior = null;
  try {
    prior = JSON.parse((await env.STATE.get(key)) || "null");
  } catch {}

  const mode = currentMode(shadow);
  const priorMode = String(prior?.healthMode || "unknown");
  const lastCheckpoint = validTime(prior?.lastCheckpointAt);
  const checkpointDue =
    shouldCheckpointTbrIntelligence(now) &&
    (lastCheckpoint === null || now - lastCheckpoint >= RECENT_CHECKPOINT_MS);
  const healthChanged = priorMode !== mode;
  const needsBootstrap = !prior?.createdAt;
  if (!needsBootstrap && !healthChanged && !checkpointDue) return { changed: false };

  const priorAvailable = priorMode === "live" || priorMode === "fallback";
  const currentAvailable = shadow?.sourceAvailable === true;
  const observed = {
    sourceChanged: priorMode !== "unknown" && priorAvailable !== currentAvailable,
    routeFallbackChanged:
      priorMode !== "unknown" &&
      (priorMode === "fallback") !== (mode === "fallback"),
    bootstrap: needsBootstrap,
  };
  await updateTbrIntelligence(
    env,
    hub,
    shadow,
    observed,
    {
      routeFallback: Boolean(shadow?.routeFallback),
      routeSourceError: shadow?.routeSourceError || null,
    },
    { now, sourceError: shadow?.routeSourceError || null },
  );
  return { changed: true, mode, checkpointDue, needsBootstrap };
}

async function reconcileConfiguredIntelligence(env, now = Date.now()) {
  if (!shouldReconcile(now)) return;
  const hubs = await configuredHubs(env);
  await Promise.all(hubs.map((hub) => reconcileHub(env, hub, now)));
}

async function runScheduled(controller, env, outerCtx) {
  const pending = [];
  const captureCtx = {
    waitUntil(promise) {
      pending.push(Promise.resolve(promise));
    },
    passThroughOnException() {
      outerCtx?.passThroughOnException?.();
    },
  };
  if (typeof baseWorker?.scheduled === "function") {
    await baseWorker.scheduled(controller, env, captureCtx);
  }
  if (pending.length) await Promise.allSettled(pending);
  await reconcileConfiguredIntelligence(env);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/shadow-tbr")
      return intelligencePage(env, cleanHub(url.searchParams.get("hub") || "NE1"));
    if (url.pathname === "/api/tbr-intelligence")
      return intelligenceApi(env, cleanHub(url.searchParams.get("hub") || "NE1"));
    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    const task = runScheduled(controller, env, ctx);
    if (ctx?.waitUntil) ctx.waitUntil(task);
    else await task;
  },
};

export const TBR_INTELLIGENCE_ENTRY_POLICY = Object.freeze({
  stableEntrypoint: true,
  reconcileMinutes: RECONCILE_MINUTES,
  extraMsPolling: 0,
  tursoWrites: 0,
  queueAuthority: false,
  actualArrivalAuthority: "ROUTE",
});
