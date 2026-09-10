import assert from "node:assert/strict";
import {
  compactTbrIntelligenceGate,
  TBR_INTELLIGENCE_PIGGYBACK_POLICY,
} from "../src/tbr-intelligence-gated-entry.js";

const now = Date.parse("2026-09-11T03:10:00+07:00");
const healthyShadow = {
  hub: "NE1",
  observerStatus: "LIVE",
  sourceAvailable: true,
  routeFallback: false,
  lastObservedAt: "2026-09-11T03:09:20+07:00",
};
const readyIntelligence = {
  hub: "NE1",
  readiness: {
    status: "ADVISORY_READY",
    score: 88,
    advisoryAllowedNow: true,
  },
};

const ready = compactTbrIntelligenceGate(healthyShadow, readyIntelligence, now);
assert.equal(ready.allowed, true);
assert.equal(ready.reason, "READY");
assert.equal(ready.hub, "NE1");

const stale = compactTbrIntelligenceGate(
  { ...healthyShadow, lastObservedAt: "2026-09-11T03:05:00+07:00" },
  readyIntelligence,
  now,
);
assert.equal(stale.allowed, false);
assert.equal(stale.reason, "STALE_HEALTH");

const fallback = compactTbrIntelligenceGate(
  { ...healthyShadow, routeFallback: true },
  readyIntelligence,
  now,
);
assert.equal(fallback.allowed, false);
assert.equal(fallback.reason, "ROUTE_FALLBACK");

const learning = compactTbrIntelligenceGate(
  healthyShadow,
  {
    hub: "NE1",
    readiness: {
      status: "SHADOW_LEARNING",
      score: 82,
      advisoryAllowedNow: false,
    },
  },
  now,
);
assert.equal(learning.allowed, false);
assert.equal(learning.reason, "INTELLIGENCE_NOT_READY");

assert.deepEqual(
  {
    extraMsPolling: TBR_INTELLIGENCE_PIGGYBACK_POLICY.extraMsPolling,
    extraServiceRequests: TBR_INTELLIGENCE_PIGGYBACK_POLICY.extraServiceRequests,
    tursoReads: TBR_INTELLIGENCE_PIGGYBACK_POLICY.tursoReads,
    tursoWrites: TBR_INTELLIGENCE_PIGGYBACK_POLICY.tursoWrites,
    browserKvReadOnly: TBR_INTELLIGENCE_PIGGYBACK_POLICY.browserKvReadOnly,
    failClosed: TBR_INTELLIGENCE_PIGGYBACK_POLICY.failClosed,
  },
  {
    extraMsPolling: 0,
    extraServiceRequests: 0,
    tursoReads: 0,
    tursoWrites: 0,
    browserKvReadOnly: true,
    failClosed: true,
  },
);

console.log("TBR_INTELLIGENCE_PIGGYBACK_GATE=PASS");
console.log("TBR_INTELLIGENCE_FAIL_CLOSED=PASS");
console.log("TBR_INTELLIGENCE_EXTRA_MS_POLLING=0");
console.log("TBR_INTELLIGENCE_EXTRA_SERVICE_REQUESTS=0");
console.log("TBR_INTELLIGENCE_TURSO_READS=0");
console.log("TBR_INTELLIGENCE_TURSO_WRITES=0");
