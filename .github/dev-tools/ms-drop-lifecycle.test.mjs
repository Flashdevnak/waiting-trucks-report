import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { stageFrontend } from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const source = await readFile(new URL("ms.js", root), "utf8");
const frontend = stageFrontend(source);

function between(text, startLabel, endLabel) {
  const start = text.indexOf(startLabel);
  const end = text.indexOf(endLabel, start + startLabel.length);
  assert.ok(start >= 0 && end > start, `missing block ${startLabel}`);
  return text.slice(start, end);
}

function runtime() {
  const helperSource = between(
    frontend,
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
  vm.runInContext(
    `${helperSource}\nthis.routeStateFn = routeState; this.queueInfoFn = queueInfo; this.queueSourceFn = queueAdmissionSource; this.queueArrivalFn = queueAdmissionArrival;`,
    context,
  );
  return {
    helperSource,
    routeState: context.routeStateFn,
    queueInfo: context.queueInfoFn,
    queueSource: context.queueSourceFn,
    queueArrival: context.queueArrivalFn,
  };
}

const now = new Date("2026-09-13T08:00:00.000Z");
const base = {
  id: "route-1",
  proofId: "GENERIC001",
  attendanceType: "จุดดรอป",
  scheduleTbrArrivalAt: "2026-09-13T06:00:00.000Z",
  actualArrivalAt: "",
  actualDepartureAt: "",
  unloadingState: null,
  scheduleUnloadingStartedAt: "",
  scheduleUnloadingCompletedAt: "",
};

test("KIT/TBR admission source is determined once by timestamp winner with KIT tie", () => {
  const { queueSource, queueArrival } = runtime();
  const cases = [
    [{ attendanceType: "ปลายทาง", scheduleTbrArrivalAt: "2026-09-13T06:00:00Z" }, "TBR", "2026-09-13T06:00:00.000Z"],
    [{ attendanceType: "ปลายทาง", actualArrivalAt: "2026-09-13T06:00:00Z" }, "KIT", "2026-09-13T06:00:00.000Z"],
    [{ attendanceType: "ปลายทาง", scheduleTbrArrivalAt: "2026-09-13T06:00:00Z", actualArrivalAt: "2026-09-13T06:05:00Z" }, "TBR", "2026-09-13T06:00:00.000Z"],
    [{ attendanceType: "ปลายทาง", actualArrivalAt: "2026-09-13T06:00:00Z", scheduleTbrArrivalAt: "2026-09-13T06:05:00Z" }, "KIT", "2026-09-13T06:00:00.000Z"],
    [{ attendanceType: "ปลายทาง", actualArrivalAt: "2026-09-13T06:00:00Z", scheduleTbrArrivalAt: "2026-09-13T06:00:00Z" }, "KIT", "2026-09-13T06:00:00.000Z"],
  ];
  for (const [row, sourceName, arrival] of cases) {
    assert.equal(queueSource(row), sourceName);
    assert.equal(queueArrival(row).toISOString(), arrival);
  }
});

test("scheduleKitArrivalAt is supplementary and Origin is never admitted by TBR", () => {
  const { queueSource, queueArrival, helperSource } = runtime();
  const inbound = {
    attendanceType: "ปลายทาง",
    scheduleKitArrivalAt: "2026-09-13T05:00:00Z",
    scheduleTbrArrivalAt: "2026-09-13T06:00:00Z",
  };
  assert.equal(queueSource(inbound), "TBR");
  assert.equal(queueArrival(inbound).toISOString(), "2026-09-13T06:00:00.000Z");
  assert.equal(queueArrival({ ...inbound, attendanceType: "ต้นทาง" }), null);
  const arrivalBlock = between(
    helperSource,
    "function confirmedEffectiveArrival(row)",
    "function queueAdmissionSource(row)",
  );
  assert.doesNotMatch(arrivalBlock, /scheduleKitArrivalAt/);
});

test("Drop follows waiting to unloading and stays active after unload completion", () => {
  const { queueInfo, routeState } = runtime();
  const waiting = queueInfo(base, now);
  assert.equal(waiting.active, true);
  assert.equal(waiting.started, false);
  assert.equal(waiting.awaitingRelease, false);
  assert.equal(routeState(base, now).key, "arrived");

  const startedRow = {
    ...base,
    scheduleUnloadingStartedAt: "2026-09-13T06:10:00.000Z",
  };
  const started = queueInfo(startedRow, now);
  assert.equal(started.active, true);
  assert.equal(started.started, true);
  assert.equal(routeState(startedRow, now).key, "unloading");

  for (const completedRow of [
    { ...startedRow, unloadingState: 2 },
    {
      ...startedRow,
      scheduleUnloadingCompletedAt: "2026-09-13T06:40:00.000Z",
    },
  ]) {
    const completed = queueInfo(completedRow, now);
    assert.equal(completed.active, true);
    assert.equal(completed.done, false);
    assert.equal(completed.unloadFinished, true);
    assert.equal(completed.awaitingRelease, true);
    assert.equal(completed.released, false);
    assert.equal(routeState(completedRow, now).key, "unloading");
  }
});

test("only real Route departure releases Drop into the Drop card state", () => {
  const { queueInfo, routeState } = runtime();
  const row = {
    ...base,
    unloadingState: 2,
    scheduleUnloadingCompletedAt: "2026-09-13T06:40:00.000Z",
    actualDepartureAt: "2026-09-13T06:50:00.000Z",
  };
  const queue = queueInfo(row, now);
  assert.equal(queue.active, false);
  assert.equal(queue.done, true);
  assert.equal(queue.awaitingRelease, false);
  assert.equal(queue.released, true);
  assert.equal(routeState(row, now).key, "drop");
});

test("Drop release display is one two-column box and keeps planned versus actual truth separate", () => {
  assert.match(frontend, /MS_DROP_RELEASE_PAIR_V1/);
  const displayBlock = between(
    frontend,
    "function classicDropReleasePair(row, release)",
    "function classicOperationFacts(items)",
  );
  assert.match(displayBlock, /const planned = shortDateTime\(release\?\.plan \|\| adjustedDropDeparturePlan\(row\)\?\.plan\);/);
  assert.match(displayBlock, /const actual = shortDateTime\(row\.actualDepartureAt\);/);
  assert.match(displayBlock, /classic-operation-facts drop-release-pair/);
  assert.match(displayBlock, /grid-column:1\/-1/);
  assert.match(displayBlock, /กำหนดปล่อยรถ/);
  assert.match(displayBlock, /ออกจากจุดดรอปจริง/);
  assert.doesNotMatch(displayBlock, /fetch\s*\(|apiGet\(|apiPost\(|env\.DB|\.prepare\(/);
  assert.match(
    frontend,
    /\(release\?\.plan \|\| parseDate\(row\.actualDepartureAt\)\) \? classicDropReleasePair\(row, release\) : ""/,
  );
});

test("lifecycle/source helpers add no DB, HTTP, or upstream path", () => {
  const { helperSource } = runtime();
  assert.doesNotMatch(helperSource, /env\.DB|\.prepare\(|fetch\s*\(|apiGet\(|apiPost\(/);
});
