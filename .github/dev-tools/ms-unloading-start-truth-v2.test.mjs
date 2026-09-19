import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { stageFrontend, stageWorker } from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const frontSource = await readFile(new URL("ms.js", root), "utf8");
const workerSource = await readFile(new URL("worker/src/index.js", root), "utf8");
const front = stageFrontend(frontSource);
const worker = stageWorker(workerSource);

function between(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing block ${start}`);
  return text.slice(from, to);
}

function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function loadOperationalStage() {
  const code = between(front, "function inboundOperationalStage", "function renderFilterSummary");
  const context = {
    Date,
    parseDate,
    isDestination: (row) => row.attendanceType === "ปลายทาง",
    isDrop: (row) => row.attendanceType === "จุดดรอป",
    queueInfo: (row) => ({ cancelled: Boolean(row.queueCancelledAt) }),
    queueAdmissionArrival: (row) => parseDate(row.actualArrivalAt || row.scheduleTbrArrivalAt),
  };
  vm.createContext(context);
  vm.runInContext(`${code};globalThis.fn=inboundOperationalStage`, context);
  return context.fn;
}

test("Route unloadingState=1 stays in unloading even when admission enrichment is absent", () => {
  const stage = loadOperationalStage();
  assert.equal(stage({ attendanceType: "ปลายทาง", unloadingState: 1 }), "unloading");
  assert.equal(stage({ attendanceType: "จุดดรอป", unloadingState: 1 }), "unloading");
});

test("waiting admission remains separate and Drop keeps release lifecycle", () => {
  const stage = loadOperationalStage();
  const now = new Date("2026-09-13T14:00:00.000Z");
  assert.equal(stage({ attendanceType: "ปลายทาง", unloadingState: 0, actualArrivalAt: "2026-09-13T13:30:00.000Z" }, now), "waiting");
  assert.equal(stage({ attendanceType: "ปลายทาง", unloadingState: 2, actualArrivalAt: "2026-09-13T13:30:00.000Z" }, now), "none");
  assert.equal(stage({ attendanceType: "จุดดรอป", unloadingState: 2, actualArrivalAt: "2026-09-13T13:30:00.000Z" }, now), "unloading");
  assert.equal(stage({ attendanceType: "จุดดรอป", unloadingState: 2, actualDepartureAt: "2026-09-13T13:55:00.000Z" }, now), "none");
  assert.equal(stage({ attendanceType: "ต้นทาง", unloadingState: 1 }, now), "none");
  assert.equal(stage({ attendanceType: "ปลายทาง", unloadingState: 1, queueCancelledAt: "2026-09-13T13:40:00.000Z" }, now), "none");
});

test("Schedule S fallback still marks unloading without changing Route truth", () => {
  const stage = loadOperationalStage();
  assert.equal(stage({ attendanceType: "ปลายทาง", unloadingState: 0, scheduleUnloadingStartedAt: "2026-09-13T13:45:00.000Z" }), "unloading");
});

test("Schedule E and PreEntry progress never complete or advance unload lifecycle", () => {
  const stage = loadOperationalStage();
  const now = new Date("2026-09-13T14:00:00.000Z");
  const arrived = {
    attendanceType: "ปลายทาง",
    unloadingState: 0,
    actualArrivalAt: "2026-09-13T13:30:00.000Z",
    scheduleUnloadingCompletedAt: "2026-09-13T13:50:00.000Z",
    expectedParcels: 100,
  };

  assert.equal(stage({ ...arrived, enteredParcels: 90, pendingParcels: 10 }, now), "waiting");
  assert.equal(stage({ ...arrived, enteredParcels: 100, pendingParcels: 0 }, now), "waiting");
  assert.equal(stage({ ...arrived, unloadingState: 1, enteredParcels: 100, pendingParcels: 0 }, now), "unloading");
  assert.equal(stage({ ...arrived, unloadingState: 2, enteredParcels: 100, pendingParcels: 0 }, now), "none");

  const drop = { ...arrived, attendanceType: "จุดดรอป" };
  assert.equal(stage({ ...drop, enteredParcels: 100, pendingParcels: 0 }, now), "waiting");
  assert.equal(stage({ ...drop, unloadingState: 2, enteredParcels: 100, pendingParcels: 0 }, now), "unloading");
});

test("final staged operational lifecycle contains no Schedule E decision branch", () => {
  const code = between(front, "function inboundOperationalStage", "function renderFilterSummary");
  assert.match(code, /MS_ROUTE_UNLOAD_LIFECYCLE_TRUTH_V20/);
  assert.doesNotMatch(code, /scheduleEnd|scheduleUnloadingCompletedAt/);
});

test("Schedule parser scans tags in any order and derives S from E-D", () => {
  const code = between(worker, "// MS_SCHEDULE_UNLOAD_TIMING_PARSE_V2", "export function scheduleStoreMatchesHub")
    .replaceAll("export ", "");
  const context = {
    Date,
    msDate(value) {
      const raw = String(value || "").trim();
      const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
        ? raw.replace(" ", "T") + "+07:00"
        : raw;
      const d = new Date(normalized);
      return Number.isNaN(d.getTime()) ? "" : d.toISOString();
    },
  };
  vm.createContext(context);
  vm.runInContext(`${code};globalThis.start=parseScheduleUnloadingStart;globalThis.end=parseScheduleUnloadingEnd`, context);

  const reordered = [
    { value: "D: 00:02:13" },
    { value: "E: 2026-09-13 20:17:24" },
    { value: "W: 00:00:12" },
    { value: "S: 2026-09-13 20:15:11" },
  ];
  assert.equal(context.start(reordered), "2026-09-13T13:15:11.000Z");
  assert.equal(context.end(reordered), "2026-09-13T13:17:24.000Z");

  const endDurationOnly = [
    { value: "E: 2026-09-13 20:17:24" },
    { value: "D: 00:02:13" },
  ];
  assert.equal(context.start(endDurationOnly), "2026-09-13T13:15:11.000Z");
});

test("Route observed start is recorded once and Schedule S supersedes it", () => {
  const code = between(worker, "// MS_UNLOADING_START_TRUTH_V2", "async function syncMs(body, actor, env)");
  const context = { Date };
  vm.createContext(context);
  vm.runInContext(`${code};globalThis.resolve=resolveUnloadingStartTruth`, context);

  const observed = context.resolve(null, 1, "", "2026-09-13T13:15:14.446Z");
  assert.equal(observed.at, "2026-09-13T13:15:14.446Z");
  assert.equal(observed.source, "ROUTE_OBSERVED");

  const preserved = context.resolve({
    unloadingStartedAt: observed.at,
    unloadingStartedObservedAt: observed.observedAt,
    unloadingStartSource: observed.source,
  }, 1, "", "2026-09-13T13:16:00.000Z");
  assert.equal(preserved.at, observed.at);

  const schedule = context.resolve({
    unloadingStartedAt: observed.at,
    unloadingStartedObservedAt: observed.observedAt,
    unloadingStartSource: observed.source,
  }, 2, "2026-09-13T13:15:11.000Z", "2026-09-13T13:17:24.000Z");
  assert.equal(schedule.at, "2026-09-13T13:15:11.000Z");
  assert.equal(schedule.source, "SCHEDULE");
});

test("frontend timing and worker snapshots carry start provenance without new polling", () => {
  assert.match(front, /MS_UNLOADING_OPERATIONAL_TRUTH_V2/);
  assert.match(front, /parseDate\(row\.unloadingStartedAt\)/);
  assert.match(front, /parseDate\(row\.unloadingStartedObservedAt\)/);
  assert.match(worker, /unloadingStartedAt: unloadingStartTruth\.at/);
  assert.match(worker, /unloadingStartedObservedAt: unloadingStartTruth\.observedAt/);
  assert.match(worker, /unloadingStartSource: unloadingStartTruth\.source/);
  assert.match(front, /pollMs: 4000/);
});


test("operation cards display the effective unload start truth instead of Schedule-only dash", () => {
  const render = between(front, "function renderOperation(row) {", "// LOCAL_ROUTE_BARCODE_V1");
  assert.equal(
    (render.match(/shortDateTime\(timing\.start\)/g) || []).length,
    2,
    "Destination and Drop must both display effective timing.start",
  );
  assert.doesNotMatch(render, /shortDateTime\(row\.scheduleUnloadingStartedAt\)/);
});

test("active unload SLA exposes an orange warning band before red without changing vehicle standards", () => {
  const summary = between(front, "// MS_UNLOAD_SLA_WARNING_V26", "function renderOperation(row) {");
  assert.match(summary, /warningBand = Math\.max\(1, Math\.ceil\(timing\.standard \* 0\.2\)\)/);
  assert.match(summary, /severity: remaining <= warningBand \? "warning" : "safe"/);
  assert.match(summary, /if \(delta > 0\).*severity: "danger"/s);
  assert.match(summary, /function unloadRemainingMinutes\(row, now = new Date\(\)\)/);
});
