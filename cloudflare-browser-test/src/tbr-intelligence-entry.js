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

function improvePageHtml(htmlValue, shadow, intelligence) {
  let html = String(htmlValue || "");
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
  const base = tbrIntelligencePage(shadow, intelligence);
  const html = improvePageHtml(await base.text(), shadow, intelligence);
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
