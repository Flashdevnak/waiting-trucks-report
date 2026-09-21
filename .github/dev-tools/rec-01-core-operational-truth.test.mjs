import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { stageFrontend, stageWorker } from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const [frontendSource, workerSource] = await Promise.all([
  readFile(new URL("ms.js", root), "utf8"),
  readFile(new URL("worker/src/index.js", root), "utf8"),
]);
const stagedFrontend = stageFrontend(frontendSource);
const stagedWorker = stageWorker(workerSource);

function between(source, startLabel, endLabel) {
  const start = source.indexOf(startLabel);
  const end = source.indexOf(endLabel, start + startLabel.length);
  assert.ok(start >= 0 && end > start, `missing staged block ${startLabel}`);
  return source.slice(start, end);
}

function frontendRuntime() {
  const source = between(
    stagedFrontend,
    "function routeState(row, now = new Date())",
    "function renderFilterSummary(rows)",
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
  vm.runInContext(
    `${source}\nthis.api = { queueAdmissionArrival, queueAdmissionSource, queueInfo, operationalExpiryAnchor, operationalExpiry12h, inboundOperationalStage, routeState };`,
    context,
  );
  return { ...context.api, source };
}

function unloadingStartRuntime() {
  const source = between(
    stagedWorker,
    "// MS_UNLOADING_START_TRUTH_V2",
    "async function syncMs(body, actor, env)",
  );
  const context = { Date };
  vm.createContext(context);
  vm.runInContext(
    `${source}\nthis.resolve = resolveUnloadingStartTruth;`,
    context,
  );
  return { resolve: context.resolve, source };
}

const HOUR = 36e5;
const anchor = "2026-09-14T00:00:00.000Z";
const at = (offsetMs) => new Date(Date.parse(anchor) + offsetMs);

test("REC-01 inbound and KIT/TBR authority stay exact without fabricating missing TBR", () => {
  const { queueAdmissionArrival, queueAdmissionSource, inboundOperationalStage, source } =
    frontendRuntime();
  const kit = "2026-09-14T10:00:00.000Z";
  const earlierTbr = "2026-09-14T09:30:00.000Z";
  const scheduleKit = "2026-09-14T08:00:00.000Z";

  for (const attendanceType of ["ปลายทาง", "จุดดรอป"]) {
    const row = {
      attendanceType,
      actualArrivalAt: kit,
      scheduleTbrArrivalAt: earlierTbr,
      scheduleKitArrivalAt: scheduleKit,
      unloadingState: 0,
    };
    assert.equal(queueAdmissionSource(row), "TBR");
    assert.equal(queueAdmissionArrival(row).toISOString(), earlierTbr);
    assert.equal(
      inboundOperationalStage(row, new Date("2026-09-14T10:30:00.000Z")),
      "waiting",
    );
  }

  const tie = {
    attendanceType: "ปลายทาง",
    actualArrivalAt: kit,
    scheduleTbrArrivalAt: kit,
    scheduleKitArrivalAt: scheduleKit,
  };
  assert.equal(queueAdmissionSource(tie), "KIT");
  assert.equal(queueAdmissionArrival(tie).toISOString(), kit);

  const kitOnly = { attendanceType: "ปลายทาง", actualArrivalAt: kit };
  assert.equal(queueAdmissionSource(kitOnly), "KIT");
  assert.equal(kitOnly.scheduleTbrArrivalAt, undefined);
  assert.equal(
    queueAdmissionArrival({ attendanceType: "ปลายทาง", scheduleKitArrivalAt: scheduleKit }),
    null,
  );
  assert.equal(
    inboundOperationalStage(
      { attendanceType: "ต้นทาง", scheduleTbrArrivalAt: earlierTbr, unloadingState: 0 },
      new Date("2026-09-14T10:30:00.000Z"),
    ),
    "none",
  );
  assert.doesNotMatch(
    between(source, "function confirmedEffectiveArrival(row)", "function queueAdmissionSource(row)"),
    /scheduleKitArrivalAt/,
  );
});

test("REC-01 unloading start follows Schedule S, persisted effective start, then first state-1 observation", () => {
  const { resolve, source } = unloadingStartRuntime();
  const observedAt = "2026-09-14T10:05:00.000Z";
  const effectiveAt = "2026-09-14T10:04:00.000Z";
  const scheduleAt = "2026-09-14T10:03:00.000Z";

  const observed = resolve(null, 1, "", observedAt);
  assert.equal(observed.at, observedAt);
  assert.equal(observed.source, "ROUTE_OBSERVED");

  const persisted = resolve(
    {
      unloadingStartedAt: effectiveAt,
      unloadingStartedObservedAt: observedAt,
      unloadingStartSource: "ROUTE_OBSERVED",
    },
    1,
    "",
    "2026-09-14T10:06:00.000Z",
  );
  assert.equal(persisted.at, effectiveAt);

  const scheduled = resolve(
    {
      unloadingStartedAt: effectiveAt,
      unloadingStartedObservedAt: observedAt,
      unloadingStartSource: "ROUTE_OBSERVED",
    },
    2,
    scheduleAt,
    "2026-09-14T10:07:00.000Z",
  );
  assert.equal(scheduled.at, scheduleAt);
  assert.equal(scheduled.source, "SCHEDULE");

  const noStart = resolve(
    {
      actualArrivalAt: "2026-09-14T09:00:00.000Z",
      scheduleTbrArrivalAt: "2026-09-14T08:55:00.000Z",
      estimatedArrivalAt: "2026-09-14T08:50:00.000Z",
    },
    0,
    "",
    "2026-09-14T10:08:00.000Z",
  );
  assert.equal(noStart.at, "");
  assert.doesNotMatch(source, /actualArrivalAt|scheduleTbrArrivalAt|estimatedArrivalAt|scheduleKitArrivalAt/);
});

test("REC-01 Route state 2 owns completion and only actual departure releases Drop", () => {
  const { queueInfo, inboundOperationalStage } = frontendRuntime();
  const now = new Date("2026-09-14T11:00:00.000Z");
  const base = {
    attendanceType: "ปลายทาง",
    actualArrivalAt: "2026-09-14T10:00:00.000Z",
    scheduleUnloadingStartedAt: "2026-09-14T10:10:00.000Z",
  };

  const scheduleOnly = queueInfo(
    { ...base, unloadingState: 1, scheduleUnloadingCompletedAt: "2026-09-14T10:45:00.000Z" },
    now,
  );
  assert.equal(scheduleOnly.unloadFinished, false);
  assert.equal(scheduleOnly.done, false);

  const destinationDone = queueInfo({ ...base, unloadingState: 2 }, now);
  assert.equal(destinationDone.unloadFinished, true);
  assert.equal(destinationDone.done, true);
  assert.equal(inboundOperationalStage({ ...base, unloadingState: 2 }, now), "none");

  const drop = { ...base, attendanceType: "จุดดรอป", unloadingState: 2 };
  const awaitingRelease = queueInfo(drop, now);
  assert.equal(awaitingRelease.unloadFinished, true);
  assert.equal(awaitingRelease.awaitingRelease, true);
  assert.equal(awaitingRelease.active, true);
  assert.equal(inboundOperationalStage(drop, now), "unloading");

  const released = { ...drop, actualDepartureAt: "2026-09-14T10:50:00.000Z" };
  assert.equal(queueInfo(released, now).released, true);
  assert.equal(queueInfo(released, now).active, false);
  assert.equal(inboundOperationalStage(released, now), "none");
});

test("REC-01 exact >=12h expiry covers waiting, unloading, and Drop awaiting release", () => {
  const { operationalExpiry12h } = frontendRuntime();
  const rows = [
    { attendanceType: "ปลายทาง", actualArrivalAt: anchor, unloadingState: 0 },
    { attendanceType: "ปลายทาง", actualArrivalAt: anchor, unloadingState: 1 },
    { attendanceType: "จุดดรอป", actualArrivalAt: anchor, unloadingState: 2 },
  ];
  for (const row of rows) {
    assert.equal(operationalExpiry12h(row, at(12 * HOUR - 1)), null);
    assert.ok(operationalExpiry12h(row, at(12 * HOUR)));
    assert.ok(operationalExpiry12h(row, at(12 * HOUR + 1)));
  }
});

test("REC-01 expiry uses earliest KIT/TBR or proven unloading start, never ETA or schedule KIT", () => {
  const { operationalExpiryAnchor, operationalExpiry12h } = frontendRuntime();
  const arrivalWins = {
    attendanceType: "ปลายทาง",
    actualArrivalAt: "2026-09-14T02:00:00.000Z",
    scheduleTbrArrivalAt: "2026-09-14T01:00:00.000Z",
    scheduleUnloadingStartedAt: anchor,
    unloadingState: 1,
  };
  assert.equal(operationalExpiryAnchor(arrivalWins).at.toISOString(), "2026-09-14T01:00:00.000Z");
  assert.equal(operationalExpiry12h(arrivalWins, at(12 * HOUR)), null);

  for (const field of [
    "scheduleUnloadingStartedAt",
    "unloadingStartedAt",
    "unloadingStartedObservedAt",
  ]) {
    const row = { attendanceType: "ปลายทาง", unloadingState: 1, [field]: anchor };
    assert.equal(operationalExpiryAnchor(row).at.toISOString(), anchor);
    assert.ok(operationalExpiry12h(row, at(12 * HOUR)));
  }

  const forbidden = {
    attendanceType: "ปลายทาง",
    unloadingState: 0,
    estimatedArrivalAt: anchor,
    scheduleKitArrivalAt: anchor,
  };
  assert.equal(operationalExpiryAnchor(forbidden), null);
  assert.equal(operationalExpiry12h(forbidden, at(24 * HOUR)), null);
});

test("REC-01 active list, summary, and cards share the canonical operational stage", () => {
  const { inboundOperationalStage, source } = frontendRuntime();
  const now = new Date("2026-09-14T12:00:00.000Z");
  const rows = [
    { attendanceType: "ปลายทาง", scheduleTbrArrivalAt: "2026-09-14T10:00:00.000Z", unloadingState: 0 },
    { attendanceType: "ปลายทาง", unloadingState: 1, unloadingStartedObservedAt: "2026-09-14T11:00:00.000Z" },
    { attendanceType: "จุดดรอป", actualArrivalAt: "2026-09-14T10:00:00.000Z", unloadingState: 2 },
    { attendanceType: "ปลายทาง", actualArrivalAt: "2026-09-14T10:00:00.000Z", unloadingState: 2 },
    { attendanceType: "ต้นทาง", scheduleTbrArrivalAt: "2026-09-14T10:00:00.000Z", unloadingState: 0 },
  ];
  const stages = rows.map((row) => inboundOperationalStage(row, now));
  assert.deepEqual(stages, ["waiting", "unloading", "unloading", "none", "none"]);
  assert.equal(stages.filter((stage) => stage !== "none").length, 3);
  assert.equal(stages.filter((stage) => stage === "waiting").length, 1);
  assert.equal(stages.filter((stage) => stage === "unloading").length, 2);

  assert.match(
    stagedFrontend,
    /state\.summary === "waiting" &&\s*inboundOperationalStage\(row\) === "waiting"/,
  );
  assert.match(
    stagedFrontend,
    /state\.summary === "unloading" &&\s*inboundOperationalStage\(row\) === "unloading"/,
  );
  assert.match(stagedFrontend, /const lowerCardOperationalStage = inboundOperationalStage\(row\)/);
  assert.match(stagedFrontend, /state\.currentRows\.filter\(\s*\(row\) => inboundOperationalStage\(row\) === "unloading"/);
  const stageStart = source.indexOf("function inboundOperationalStage(row, now = new Date())");
  assert.ok(stageStart >= 0, "missing staged inboundOperationalStage helper");
  const lifecycleHelpers = [
    between(source, "function confirmedEffectiveArrival(row)", "function attendanceLabel(row)"),
    between(source, "function queueInfo(row, now = new Date())", "function expired12hCurrentRows"),
    source.slice(stageStart),
  ].join("\n");
  assert.doesNotMatch(
    lifecycleHelpers,
    /env\.DB|\.prepare\s*\(|\bfetch\s*\(|apiGet\s*\(|apiPost\s*\(/,
  );
});
