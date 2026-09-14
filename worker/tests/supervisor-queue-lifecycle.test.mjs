import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { stageFrontend, stageWorker } from "../../.github/dev-tools/stage-dev-runtime.mjs";
import { deriveHubView, deriveLifecycleView, deriveOverview } from "../../supervisor-view.js";

const root = new URL("../../", import.meta.url);
const [canonicalWorker, msSource, supervisorFront] = await Promise.all([
  readFile(new URL("src/index.js", new URL("../", import.meta.url)), "utf8"),
  readFile(new URL("ms.js", root), "utf8"),
  readFile(new URL("supervisor.js", root), "utf8"),
]);
const stagedWorker = stageWorker(canonicalWorker);
const stagedFrontend = stageFrontend(msSource);

function between(text, startLabel, endLabel) {
  const start = text.indexOf(startLabel);
  const end = text.indexOf(endLabel, start + startLabel.length);
  assert.ok(start >= 0 && end > start, `missing block ${startLabel}`);
  return text.slice(start, end);
}

function waitingRuntime() {
  const source = between(
    stagedFrontend,
    "function routeState(row, now = new Date())",
    "function dropOperation(row)",
  );
  const context = {
    Date,
    state: { cancelledRouteIds: new Set() },
    nf: new Intl.NumberFormat("th-TH"),
    parseDate(value) {
      if (!value) return null;
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    },
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.stage = inboundOperationalStage; this.expiry = operationalExpiry12h;`, context);
  return { stage: context.stage, expiry: context.expiry, source };
}

function supervisorRuntime() {
  const source = between(
    stagedWorker,
    "// SUPERVISOR_QUEUE_LIFECYCLE_V1:",
    "// SUPERVISOR_SOURCE_HEALTH_V1:",
  );
  const context = { Date };
  vm.createContext(context);
  vm.runInContext(
    `${source}\nthis.stage = supervisorLifecycleStage; this.expired = supervisorLifecycleExpired12h; this.telemetry = supervisorLifecycleTelemetry;`,
    context,
  );
  return { stage: context.stage, expired: context.expired, telemetry: context.telemetry, source };
}

const nowMs = Date.parse("2026-09-14T12:00:00.000Z");
const fixtures = [
  {
    name: "destination waiting from TBR admission",
    row: { id: "w1", attendanceType: "ปลายทาง", scheduleTbrArrivalAt: "2026-09-14T10:00:00.000Z", unloadingState: 0 },
    stage: "waiting",
  },
  {
    name: "destination Route state 1 remains unloading without arrival",
    row: { id: "u1", attendanceType: "ปลายทาง", unloadingState: 1, unloadingStartedObservedAt: "2026-09-14T11:30:00.000Z" },
    stage: "unloading",
  },
  {
    name: "destination state 2 is complete",
    row: { id: "c1", attendanceType: "ปลายทาง", actualArrivalAt: "2026-09-14T10:00:00.000Z", unloadingState: 2 },
    stage: "none",
  },
  {
    name: "Drop state 2 remains active until Route departure",
    row: { id: "d1", attendanceType: "จุดดรอป", actualArrivalAt: "2026-09-14T10:00:00.000Z", unloadingState: 2, scheduleUnloadingCompletedAt: "2026-09-14T11:00:00.000Z" },
    stage: "unloading",
  },
  {
    name: "Drop Route departure is final even when state 1 is stale",
    row: { id: "d2", attendanceType: "จุดดรอป", actualArrivalAt: "2026-09-14T10:00:00.000Z", actualDepartureAt: "2026-09-14T11:00:00.000Z", unloadingState: 1 },
    stage: "none",
  },
  {
    name: "cancelled row is excluded",
    row: { id: "x1", attendanceType: "ปลายทาง", actualArrivalAt: "2026-09-14T10:00:00.000Z", queueCancelledAt: "2026-09-14T11:00:00.000Z", unloadingState: 0 },
    stage: "none",
  },
  {
    name: "exact 12h admission boundary is expired",
    row: { id: "e1", attendanceType: "ปลายทาง", scheduleTbrArrivalAt: "2026-09-14T00:00:00.000Z", unloadingState: 0 },
    stage: "none",
    expired: true,
  },
  {
    name: "proven unload start can expire without arrival",
    row: { id: "e2", attendanceType: "ปลายทาง", unloadingState: 1, unloadingStartedObservedAt: "2026-09-13T23:00:00.000Z" },
    stage: "none",
    expired: true,
  },
  {
    name: "Origin never enters inbound queue",
    row: { id: "o1", attendanceType: "ต้นทาง", scheduleTbrArrivalAt: "2026-09-14T10:00:00.000Z", unloadingState: 0 },
    stage: "none",
  },
];

test("SUP-07 Supervisor lifecycle stage matches the staged Waiting Trucks predicate", () => {
  const waiting = waitingRuntime();
  const supervisor = supervisorRuntime();
  for (const fixture of fixtures) {
    const expected = waiting.stage(fixture.row, new Date(nowMs));
    assert.equal(expected, fixture.stage, `${fixture.name}: staged Waiting Trucks fixture changed`);
    assert.equal(supervisor.stage(fixture.row, nowMs), expected, `${fixture.name}: Supervisor drifted`);
    if (fixture.expired === true) {
      assert.ok(waiting.expiry(fixture.row, new Date(nowMs)), `${fixture.name}: staged expiry missing`);
      assert.equal(supervisor.expired(fixture.row, nowMs), true, `${fixture.name}: Supervisor expiry drifted`);
    }
  }
});

test("SUP-07 aggregate is bounded to accepted current rows and internally consistent", () => {
  const supervisor = supervisorRuntime();
  const telemetry = supervisor.telemetry(fixtures.map((fixture) => fixture.row), "2026-09-14T12:00:00.000Z", nowMs);
  assert.deepEqual(JSON.parse(JSON.stringify(telemetry)), {
    state: "AVAILABLE",
    observedAt: "2026-09-14T12:00:00.000Z",
    basis: "ACCEPTED_CURRENT_ROWS",
    policy: "MS_OPERATIONAL_STAGE_SHARED_V1",
    rowsObserved: 9,
    waiting: 1,
    unloading: 2,
    active: 3,
    destinationActive: 2,
    dropActive: 1,
    awaitingRelease: 1,
    expired12h: 2,
    cancelledObserved: 1,
  });
  assert.equal(telemetry.active, telemetry.waiting + telemetry.unloading);
  assert.equal(telemetry.active, telemetry.destinationActive + telemetry.dropActive);
});

test("SUP-07 helper is pure and adds no source, DB, timer, subscription, or AI path", () => {
  const { source } = supervisorRuntime();
  assert.doesNotMatch(source, /env\.DB|\.prepare\s*\(|\bfetch\s*\(|apiGet\s*\(|apiPost\s*\(|readMsRoutes\s*\(|readPreEntryCounts\s*\(|readBusTimeData\s*\(|setInterval\s*\(|setTimeout\s*\(|new\s+WebSocket|EventSource|AI\s*call/i);
  assert.match(stagedWorker, /lifecycleTelemetry: Array\.isArray\(result\?\.rows\)/);
  assert.match(stagedWorker, /basis: "ACCEPTED_CURRENT_ROWS"/);
  assert.match(stagedWorker, /policy: "MS_OPERATIONAL_STAGE_SHARED_V1"/);
});

test("SUP-07 view rejects malformed telemetry and marks old queue facts STALE", () => {
  const fresh = deriveLifecycleView({
    state: "AVAILABLE",
    observedAt: "2026-09-14T11:59:00.000Z",
    basis: "ACCEPTED_CURRENT_ROWS",
    policy: "MS_OPERATIONAL_STAGE_SHARED_V1",
    rowsObserved: 9,
    active: 3,
    waiting: 1,
    unloading: 2,
    destinationActive: 2,
    dropActive: 1,
    awaitingRelease: 1,
    expired12h: 2,
    cancelledObserved: 1,
  }, nowMs);
  assert.equal(fresh.state, "AVAILABLE");
  assert.equal(fresh.freshness, "FRESH");

  const stale = deriveLifecycleView({ ...fresh, state: "AVAILABLE", observedAt: "2026-09-14T11:00:00.000Z" }, nowMs);
  assert.equal(stale.state, "STALE");

  const malformed = deriveLifecycleView({ ...fresh, state: "AVAILABLE", active: 99 }, nowMs);
  assert.equal(malformed.state, "UNKNOWN");
});

test("SUP-07 HUB and overview expose lifecycle coverage without calling it healthy", () => {
  const lifecycle = {
    state: "AVAILABLE",
    observedAt: "2026-09-14T11:59:00.000Z",
    basis: "ACCEPTED_CURRENT_ROWS",
    policy: "MS_OPERATIONAL_STAGE_SHARED_V1",
    rowsObserved: 9,
    active: 3,
    waiting: 1,
    unloading: 2,
    destinationActive: 2,
    dropActive: 1,
    awaitingRelease: 1,
    expired12h: 2,
    cancelledObserved: 1,
  };
  const hub = deriveHubView({ hub: "ZX9", health: "HEALTHY", accepted: { state: "AVAILABLE", rows: 9 }, lifecycle }, nowMs);
  assert.equal(hub.queueHealth, "AVAILABLE");
  assert.equal(hub.queueLifecycle.awaitingRelease, 1);

  const snapshot = { availability: "AVAILABLE", modules: { waitingTrucks: { hubs: [{ hub: "ZX9", health: "HEALTHY", accepted: { state: "AVAILABLE", rows: 9 }, lifecycle }] } }, contracts: { additionalUpstreamPolls: 0, databaseReads: 0, databaseWrites: 0, aiCalls: 0 } };
  const overview = deriveOverview(snapshot, { health: { state: "HEALTHY" }, metrics: [] }, { moduleCount: 1, workerReachable: true, nowMs });
  assert.equal(overview.map.queue, "AVAILABLE");
  assert.equal(overview.queueLifecycle.active, 3);
  assert.equal(overview.cards.find((card) => card.id === "queue-lifecycle").value, "AVAILABLE");
});

test("SUP-07 frontend remains one-shot Supervisor snapshot only", () => {
  assert.equal((supervisorFront.match(/\bfetch\s*\(/g) || []).length, 1);
  assert.match(supervisorFront, /fetch\("\/api\/supervisor\/snapshot"/);
  assert.doesNotMatch(supervisorFront, /setInterval|setTimeout|new\s+WebSocket|new\s+EventSource/);
  assert.match(supervisorFront, /accepted current rows/i);
  assert.match(supervisorFront, /SUPERVISOR_QUEUE_LIFECYCLE_V1/);
});
