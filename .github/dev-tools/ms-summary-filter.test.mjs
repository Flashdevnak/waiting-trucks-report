import "./ms-summary-filter-base.test.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { stageFrontend } from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const source = await readFile(new URL("ms.js", root), "utf8");
const staged = stageFrontend(source);

function between(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing staged block ${start}`);
  return text.slice(from, to);
}

function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function loadOperationalTruth() {
  const expiryCode = between(
    staged,
    "function operationalExpiryAnchor",
    "function expired12hCurrentRows",
  );
  const stageCode = between(
    staged,
    "function inboundOperationalStage",
    "function renderFilterSummary",
  );
  const isDestination = (row) => row.attendanceType === "ปลายทาง";
  const isDrop = (row) => row.attendanceType === "จุดดรอป";
  const queueAdmissionArrival = (row) =>
    [row.actualArrivalAt, row.scheduleTbrArrivalAt]
      .map(parseDate)
      .filter(Boolean)
      .sort((a, b) => a - b)[0] || null;
  const context = {
    Date,
    Number,
    parseDate,
    isDestination,
    isDrop,
    queueAdmissionArrival,
    isCompletedTodayOvertime: () => false,
    queueInfo(row) {
      return {
        cancelled: Boolean(row.queueCancelledAt),
        done: Boolean(row.done),
        expired: false,
      };
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${expiryCode}\n${stageCode}\nglobalThis.expiry=operationalExpiry12h;globalThis.anchor=operationalExpiryAnchor;globalThis.stage=inboundOperationalStage`,
    context,
  );
  return context;
}

test("12h boundary uses persisted unload-start provenance when arrival is missing", () => {
  const truth = loadOperationalTruth();
  const now = new Date("2026-09-14T14:00:00.000Z");
  const base = {
    attendanceType: "ปลายทาง",
    unloadingState: 1,
  };

  const before = {
    ...base,
    unloadingStartedObservedAt: "2026-09-14T02:00:01.000Z",
  };
  assert.equal(truth.expiry(before, now), null);
  assert.equal(truth.stage(before, now), "unloading");

  const exact = {
    ...base,
    unloadingStartedObservedAt: "2026-09-14T02:00:00.000Z",
  };
  assert.equal(truth.expiry(exact, now)?.group, "unload-overtime");
  assert.equal(truth.expiry(exact, now)?.anchorSource, "ROUTE_OBSERVED");
  assert.equal(truth.stage(exact, now), "none");

  const after = {
    ...base,
    unloadingStartedObservedAt: "2026-09-14T01:59:59.000Z",
  };
  assert.equal(truth.expiry(after, now)?.group, "unload-overtime");
  assert.equal(truth.stage(after, now), "none");
});

test("expiry anchor is provenance-safe and never fabricates ETA/arrival truth", () => {
  const truth = loadOperationalTruth();
  const now = new Date("2026-09-14T14:00:00.000Z");

  const scheduleFallback = {
    attendanceType: "ปลายทาง",
    unloadingState: 1,
    actualArrivalAt: "not-a-date",
    scheduleUnloadingStartedAt: "2026-09-14T01:00:00.000Z",
  };
  assert.equal(truth.anchor(scheduleFallback)?.source, "SCHEDULE_UNLOAD_START");
  assert.equal(truth.expiry(scheduleFallback, now)?.group, "unload-overtime");

  const arrivalWins = {
    attendanceType: "ปลายทาง",
    unloadingState: 1,
    actualArrivalAt: "2026-09-14T03:00:00.000Z",
    unloadingStartedObservedAt: "2026-09-14T00:00:00.000Z",
  };
  assert.equal(truth.anchor(arrivalWins)?.source, "ARRIVAL");
  assert.equal(truth.expiry(arrivalWins, now), null);

  const noProvenance = {
    attendanceType: "ปลายทาง",
    unloadingState: 1,
    estimatedArrivalAt: "2026-09-13T00:00:00.000Z",
  };
  assert.equal(truth.anchor(noProvenance), null);
  assert.equal(truth.expiry(noProvenance, now), null);
  assert.equal(truth.stage(noProvenance, now), "unloading");
});

test("Drop actual departure remains final even when stale state 1 has an old fallback anchor", () => {
  const truth = loadOperationalTruth();
  const now = new Date("2026-09-14T14:00:00.000Z");
  const released = {
    attendanceType: "จุดดรอป",
    unloadingState: 1,
    unloadingStartedObservedAt: "2026-09-13T23:00:00.000Z",
    actualDepartureAt: "2026-09-14T12:00:00.000Z",
  };
  assert.equal(truth.expiry(released, now), null);
  assert.equal(truth.stage(released, now), "none");
});

test("overtime card, status filter and queue list share the same operational predicate", () => {
  assert.match(staged, /MS_OPERATIONAL_EXPIRY_ANCHOR_V2/);
  assert.match(staged, /MS_OPERATIONAL_OVERTIME_PREDICATE_V2/);
  assert.match(
    staged,
    /state\.status === "unload-overtime" && isOperationalOvertime\(row\)/,
  );
  assert.match(
    staged,
    /state\.summary === "unload-overtime" && isOperationalOvertime\(row\)/,
  );
  assert.match(
    staged,
    /queueMode === "queue" && inboundOperationalStage\(row\) !== "none"/,
  );
});

test("lower waiting and unloading cards share the same operational stage as the queue list", () => {
  assert.match(staged, /MS_LOWER_OPERATIONAL_STAGE_PREDICATE_V1/);
  assert.match(
    staged,
    /state\.summary === "waiting" &&\s*inboundOperationalStage\(row\) === "waiting"/,
  );
  assert.match(
    staged,
    /state\.summary === "unloading" &&\s*inboundOperationalStage\(row\) === "unloading"/,
  );
  assert.match(staged, /const operationalStage = inboundOperationalStage\(row\);/);
  assert.match(staged, /if \(operationalStage === "waiting"\) counts\.waiting\+\+;/);
  assert.match(staged, /if \(operationalStage === "unloading"\) counts\.unloading\+\+;/);
  assert.match(
    staged,
    /state\.currentRows\.filter\(\s*\(row\) => inboundOperationalStage\(row\) === "unloading",\s*\)\.length/,
  );

  const truth = loadOperationalTruth();
  const now = new Date("2026-09-14T14:00:00.000Z");
  const routeState1WithoutArrival = {
    attendanceType: "ปลายทาง",
    unloadingState: 1,
  };
  assert.equal(truth.stage(routeState1WithoutArrival, now), "unloading");
});
