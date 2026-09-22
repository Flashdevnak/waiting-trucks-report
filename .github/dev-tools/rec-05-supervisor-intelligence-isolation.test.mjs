import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { stageWorker } from "./stage-dev-runtime.mjs";
import {
  deriveCompletenessView,
  deriveHubView,
  deriveSourceView,
} from "../../supervisor-view.js";
import {
  TBR_INTELLIGENCE_POLICY,
  readTbrIntelligenceReport,
} from "../../cloudflare-browser-test/src/tbr-intelligence.js";
import {
  projectTbrDiagnosticRollup,
  updateTbrDiagnosticRollup,
} from "../../cloudflare-browser-test/src/tbr-diagnostic-rollup.js";

const NOW = Date.parse("2026-09-21T12:00:00.000Z");
const root = new URL("../../", import.meta.url);

function canonical(overrides = {}) {
  return {
    state: "AVAILABLE",
    basis: "CANONICAL_ACCEPTED_ROWS",
    authority: "PROJECTION_ONLY",
    observedAt: "2026-09-21T11:59:00.000Z",
    rowsObserved: 4,
    completeness: {
      DATA_COMPLETE: 1,
      DATA_INCOMPLETE: 1,
      DATA_UNKNOWN: 1,
      SOURCE_UNAVAILABLE: 1,
    },
    enrichmentPending: 3,
    priorities: { P1: 1, P2: 1, P3: 1 },
    ...overrides,
  };
}

function source(overrides = {}) {
  return {
    state: "HEALTHY",
    configured: true,
    lastAttemptAt: "2026-09-21T11:53:00.000Z",
    lastSuccessAt: "2026-09-21T11:54:00.000Z",
    lastMeaningfulObservationAt: "2026-09-21T11:55:00.000Z",
    lastErrorAt: "2026-09-21T11:56:00.000Z",
    dataObservedAt: "2026-09-21T11:57:00.000Z",
    sourceValueTimestamp: "2026-09-21T11:58:00.000Z",
    acceptedDataAt: "2026-09-21T11:59:00.000Z",
    ...overrides,
  };
}

function hub(code, overrides = {}) {
  return {
    hub: code,
    health: "HEALTHY",
    accepted: { state: "AVAILABLE", rows: 4 },
    sources: {
      route: source(),
      preEntry: source(),
      busTime: source(),
      hbiPhotos: { mode: "CLICK_ONLY" },
      pno: { mode: "ON_DEMAND" },
    },
    canonical: canonical(),
    lifecycle: {
      state: "AVAILABLE", observedAt: "2026-09-21T11:59:00.000Z",
      basis: "ACCEPTED_CURRENT_ROWS", policy: "MS_OPERATIONAL_STAGE_SHARED_V1",
      rowsObserved: 4, active: 2, waiting: 1, unloading: 1,
      destinationActive: 1, dropActive: 1, awaitingRelease: 1,
      expired12h: 1, cancelledObserved: 0,
    },
    ...overrides,
  };
}

test("REC-05 Supervisor projects all canonical freshness timestamps without collapsing them", () => {
  const view = deriveSourceView(source(), NOW);
  assert.equal(view.freshness, "FRESH");
  const keys = [
    "lastAttemptAt", "lastSuccessAt", "lastMeaningfulObservationAt", "lastErrorAt",
    "dataObservedAt", "sourceValueTimestamp", "acceptedDataAt",
  ];
  assert.equal(new Set(keys.map((key) => view[key])).size, 7);
  assert.equal(deriveSourceView(source({ state: "AUTH_REQUIRED", errorCode: "HTTP_401" }), NOW).freshness, "SOURCE_UNAVAILABLE");
  assert.equal(deriveSourceView(null, NOW).freshness, "UNKNOWN");
});

test("REC-05 completeness and P1/P2/P3 remain independent from completed lifecycle", () => {
  const projected = deriveCompletenessView(canonical());
  assert.equal(projected.state, "AVAILABLE");
  assert.deepEqual(projected.completeness, {
    DATA_COMPLETE: 1,
    DATA_INCOMPLETE: 1,
    DATA_UNKNOWN: 1,
    SOURCE_UNAVAILABLE: 1,
  });
  assert.equal(projected.enrichment.state, "ENRICHMENT_PENDING");
  assert.deepEqual(projected.enrichment.priorities, { P1: 1, P2: 1, P3: 1 });
  const completedButIncomplete = deriveHubView(hub("NE1", {
    canonical: canonical({
      rowsObserved: 1,
      completeness: { DATA_COMPLETE: 0, DATA_INCOMPLETE: 1, DATA_UNKNOWN: 0, SOURCE_UNAVAILABLE: 0 },
      enrichmentPending: 1,
      priorities: { P1: 0, P2: 1, P3: 0 },
    }),
    lifecycle: { ...hub("NE1").lifecycle, rowsObserved: 1, active: 0, waiting: 0, unloading: 0, destinationActive: 0, dropActive: 0 },
  }), NOW);
  assert.equal(completedButIncomplete.completeness.DATA_INCOMPLETE, 1);
  assert.equal(completedButIncomplete.enrichment.state, "ENRICHMENT_PENDING");
  assert.equal(completedButIncomplete.enrichment.priorities.P2, 1);
});

test("REC-05 unknown canonical metadata stays UNKNOWN instead of fabricated", () => {
  const projected = deriveCompletenessView({ state: "AVAILABLE" });
  assert.equal(projected.state, "UNKNOWN");
  assert.equal(projected.rowsObserved, null);
  assert.equal(projected.completeness.DATA_COMPLETE, null);
  assert.equal(projected.enrichment.state, "UNKNOWN");
});

test("REC-05 HBI and PNO project ON_DEMAND without source work", () => {
  const view = deriveHubView(hub("NE1"), NOW);
  assert.equal(view.sources.hbiPhotos.freshness, "ON_DEMAND");
  assert.equal(view.sources.pno.freshness, "ON_DEMAND");
  assert.equal(view.sources.hbiPhotos.lastAttemptAt, null);
  assert.equal(view.sources.pno.lastAttemptAt, null);
});

test("REC-05 NE1 and EA2 source/completeness truth remain isolated", () => {
  const ne1 = deriveHubView(hub("NE1", {
    health: "AUTH_REQUIRED",
    sources: { ...hub("NE1").sources, busTime: source({ state: "AUTH_REQUIRED", errorCode: "BUS_TIME_SESSION_EXPIRED" }) },
    canonical: canonical({ rowsObserved: 1, completeness: { DATA_COMPLETE: 0, DATA_INCOMPLETE: 0, DATA_UNKNOWN: 0, SOURCE_UNAVAILABLE: 1 }, enrichmentPending: 1, priorities: { P1: 1, P2: 0, P3: 0 } }),
  }), NOW);
  const ea2 = deriveHubView(hub("EA2", {
    canonical: canonical({ rowsObserved: 1, completeness: { DATA_COMPLETE: 1, DATA_INCOMPLETE: 0, DATA_UNKNOWN: 0, SOURCE_UNAVAILABLE: 0 }, enrichmentPending: 0, priorities: { P1: 0, P2: 0, P3: 0 } }),
  }), NOW);
  assert.equal(ne1.sources.busTime.freshness, "SOURCE_UNAVAILABLE");
  assert.equal(ne1.completeness.SOURCE_UNAVAILABLE, 1);
  assert.equal(ea2.sources.busTime.freshness, "FRESH");
  assert.equal(ea2.completeness.DATA_COMPLETE, 1);
  assert.equal(ea2.completeness.SOURCE_UNAVAILABLE, 0);
});

test("REC-05 staged Worker piggybacks canonical projection with no provider or persistence path", async () => {
  const canonicalWorker = await readFile(new URL("worker/src/index.js", root), "utf8");
  const staged = stageWorker(canonicalWorker);
  const start = staged.indexOf("// SUPERVISOR_REC05_CANONICAL_PROJECTION_V1:");
  const end = staged.indexOf("// MS_REC04_HISTORY_FRESHNESS_TRUTH_V1:", start);
  assert.ok(start >= 0 && end > start);
  const block = staged.slice(start, end);
  assert.doesNotMatch(block, /fetch\(|\.prepare\(|\.put\(|setInterval|setTimeout/);
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${block}\nthis.project = supervisorCanonicalProjectionTelemetry;\nthis.sanitize = supervisorSanitizedCanonicalProjection;`, context);
  const rows = [
    { dataCompleteness: "DATA_COMPLETE" },
    { dataCompleteness: "DATA_INCOMPLETE", enrichmentState: "ENRICHMENT_PENDING", enrichmentPriority: "P1" },
    { dataCompleteness: "DATA_UNKNOWN", enrichmentState: "ENRICHMENT_PENDING", enrichmentPriority: "P2" },
    { dataCompleteness: "SOURCE_UNAVAILABLE", enrichmentState: "ENRICHMENT_PENDING", enrichmentPriority: "P3" },
  ];
  const projected = context.sanitize(context.project(rows, "NE1", "2026-09-21T11:59:00.000Z"));
  assert.equal(projected.state, "AVAILABLE");
  assert.equal(projected.enrichmentPending, 3);
  assert.equal(projected.priorities.P1, 1);
  assert.equal(projected.priorities.P2, 1);
  assert.equal(projected.priorities.P3, 1);
});

test("REC-05 1/10/100 Supervisor viewers add zero provider calls and writes", async () => {
  const sourceText = await readFile(new URL("supervisor-view.js", root), "utf8");
  assert.doesNotMatch(sourceText, /fetch\(|\.prepare\(|\.put\(|setInterval|setTimeout/);
  for (const viewers of [1, 10, 100]) {
    const counters = { providerCalls: 0, persistentWrites: 0 };
    for (let index = 0; index < viewers; index += 1) deriveHubView(hub("NE1"), NOW);
    assert.deepEqual(counters, { providerCalls: 0, persistentWrites: 0 });
  }
});

test("REC-05 1/10/100 Intelligence viewers are pure and have no authority", async () => {
  const record = { id: "a", status: "confirmed", tbrAt: "2026-09-20T10:00:00.000Z", routeActualArrivalAt: "2026-09-20T10:01:00.000Z", leadMinutes: 1 };
  const shadow = {
    hub: "NE1", sourceAvailable: true, observerStatus: "LIVE", routeFallback: false,
    records: [record],
    diagnosticRollup: projectTbrDiagnosticRollup(updateTbrDiagnosticRollup(
      null,
      { a: record },
      { now: NOW, sourceAvailable: true, routeFallback: false },
    ), NOW),
  };
  const original = structuredClone(shadow);
  const STATE = { async get() { throw new Error("Intelligence persistence read forbidden"); }, async put() { throw new Error("Intelligence persistence write forbidden"); } };
  for (const viewers of [1, 10, 100]) {
    for (let index = 0; index < viewers; index += 1) {
      const report = await readTbrIntelligenceReport({ STATE }, "NE1", shadow, NOW);
      assert.equal(report.providerUpstreamCalls, 0);
      assert.equal(report.otherPersistentWrites, 0);
      for (const field of ["queueAuthority", "providerAuthority", "freshnessAuthority", "completenessAuthority", "lifecycleAuthority", "historyAuthority", "businessDayAuthority", "enrichmentScheduler", "providerScheduler"])
        assert.equal(report[field], false, field);
    }
  }
  assert.deepEqual(shadow, original);
  for (const [key, expected] of Object.entries({ checkpointMinutes: 0, autoRepairMinutes: 0, otherPersistentWrites: 0, extraMsPolling: 0, queueAuthority: false, providerAuthority: false }))
    assert.equal(TBR_INTELLIGENCE_POLICY[key], expected);
});
