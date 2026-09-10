import intelligenceEntry from "./tbr-intelligence-entry.js";
import { readTbrShadowReport } from "./tbr-shadow.js";
import { readTbrIntelligenceReport } from "./tbr-intelligence.js";

// TBR_INTELLIGENCE_PIGGYBACK_GATE_V1
// Read Browser KV only, then attach one compact health flag to the existing
// Route-shadow connectorSync request. The Bus split is left untouched so each
// HUB sends the gate once per cron, with zero extra MS polling or Turso access.
const GATE_MAX_AGE_MS = 3 * 60 * 1000;
const GATE_FUTURE_TOLERANCE_MS = 90 * 1000;
const READY_STATES = new Set(["ADVISORY_READY", "PRODUCTION_CANDIDATE"]);

function cleanHub(value) {
  const hub = String(value || "NE1").trim().toUpperCase();
  return /^[A-Z0-9_-]{2,20}$/.test(hub) ? hub : "NE1";
}

function validTime(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : null;
}

export function compactTbrIntelligenceGate(shadow, intelligence, nowValue = Date.now()) {
  const now = Number(nowValue) || Date.now();
  const readiness = intelligence?.readiness || {};
  const observedAt = String(shadow?.lastObservedAt || shadow?.healthUpdatedAt || "");
  const observedMs = validTime(observedAt);
  const ageMs = observedMs === null ? null : now - observedMs;
  const fresh =
    ageMs !== null &&
    ageMs >= -GATE_FUTURE_TOLERANCE_MS &&
    ageMs <= GATE_MAX_AGE_MS;
  const observerLive = shadow?.observerStatus === "LIVE";
  const sourceAvailable = shadow?.sourceAvailable === true;
  const routeFallback = shadow?.routeFallback === true;
  const readinessOk =
    READY_STATES.has(String(readiness.status || "")) &&
    readiness.advisoryAllowedNow === true;
  const allowed = Boolean(
    fresh && observerLive && sourceAvailable && !routeFallback && readinessOk,
  );
  let reason = "READY";
  if (!readinessOk) reason = "INTELLIGENCE_NOT_READY";
  else if (!observerLive) reason = "OBSERVER_NOT_LIVE";
  else if (!sourceAvailable) reason = "SOURCE_UNAVAILABLE";
  else if (routeFallback) reason = "ROUTE_FALLBACK";
  else if (!fresh) reason = "STALE_HEALTH";
  return {
    version: 1,
    hub: cleanHub(shadow?.hub || intelligence?.hub || "NE1"),
    allowed,
    reason,
    observedAt,
    observerStatus: String(shadow?.observerStatus || ""),
    sourceAvailable,
    routeFallback,
    readinessStatus: String(readiness.status || ""),
    readinessScore: Number.isFinite(Number(readiness.score)) ? Number(readiness.score) : null,
    advisoryAllowedNow: readiness.advisoryAllowedNow === true,
    extraMsPolling: 0,
    tursoReads: 0,
    tursoWrites: 0,
  };
}

function withPiggybackHealth(env, nowValue = Date.now()) {
  if (!env?.DEV_API?.fetch) return env;
  const gateCache = new Map();
  const original = env.DEV_API;
  const wrappedDevApi = {
    async fetch(request) {
      let body = null;
      try {
        body = await request.clone().json();
      } catch {}
      if (
        body?.action === "connectorSync" &&
        body?.shadowOnly === true &&
        body?.shadowPart === "routes"
      ) {
        const hub = cleanHub(body.hub);
        if (!gateCache.has(hub)) {
          gateCache.set(
            hub,
            (async () => {
              const shadow = await readTbrShadowReport(env, hub);
              const intelligence = await readTbrIntelligenceReport(
                env,
                hub,
                shadow,
                nowValue,
              );
              return compactTbrIntelligenceGate(shadow, intelligence, nowValue);
            })(),
          );
        }
        body.tbrIntelligenceHealth = await gateCache.get(hub);
        return original.fetch(
          new Request(request, {
            body: JSON.stringify(body),
          }),
        );
      }
      return original.fetch(request);
    },
  };
  return Object.assign({}, env, { DEV_API: wrappedDevApi });
}

export default {
  fetch(request, env, ctx) {
    return intelligenceEntry.fetch(request, env, ctx);
  },
  scheduled(controller, env, ctx) {
    return intelligenceEntry.scheduled(
      controller,
      withPiggybackHealth(env, Date.now()),
      ctx,
    );
  },
};

export const TBR_INTELLIGENCE_PIGGYBACK_POLICY = Object.freeze({
  maxAgeMs: GATE_MAX_AGE_MS,
  healthPushesPerHubCron: 1,
  extraMsPolling: 0,
  extraServiceRequests: 0,
  tursoReads: 0,
  tursoWrites: 0,
  browserKvReadOnly: true,
  failClosed: true,
});
