import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { stageFrontend, stageWorker } from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const rawFront = await readFile(new URL("ms.js", root), "utf8");
const rawWorker = await readFile(new URL("worker/src/index.js", root), "utf8");
const front = stageFrontend(rawFront);
const worker = stageWorker(rawWorker);

function between(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing staged block ${start}`);
  return text.slice(from, to);
}

function thaiDayForValue(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

test("completed daily truth uses trusted completion day across Bangkok midnight", () => {
  const src = between(
    worker,
    "function msCompletedRowBusinessDay(row) {",
    "\nfunction isCompletedForThaiDay(row, day) {",
  );
  const ctx = { Date, Number, String, thaiDayForValue };
  vm.createContext(ctx);
  vm.runInContext(`${src};globalThis.day=msCompletedRowBusinessDay`, ctx);
  const row = {
    attendanceType: "ปลายทาง",
    unloadingState: 2,
    estimatedArrivalAt: "2026-09-17T17:30:00.000Z",
    scheduleUnloadingCompletedAt: "2026-09-17T16:50:00.000Z",
    completionSource: "SCHEDULE",
  };
  assert.equal(thaiDayForValue(row.estimatedArrivalAt), "2026-09-18");
  assert.equal(ctx.day(row), "2026-09-17");
});

test("untrusted timestamp-less state 2 is not fabricated into a daily bucket", () => {
  const src = between(
    worker,
    "function msCompletedRowBusinessDay(row) {",
    "\nfunction isCompletedForThaiDay(row, day) {",
  );
  const ctx = { Date, Number, String, thaiDayForValue };
  vm.createContext(ctx);
  vm.runInContext(`${src};globalThis.day=msCompletedRowBusinessDay`, ctx);
  assert.equal(ctx.day({ attendanceType: "ปลายทาง", unloadingState: 2 }), "");
});

test("lower cards preserve active filters and share status context", () => {
  const summary = between(
    front,
    "function renderFilterSummary(rows) {",
    "\nasync function applyMetricFilter(metric) {",
  );
  const context = between(
    front,
    "function matchesLowerCardContext(row, day) {",
    "\nfunction classicOperationRow",
  );
  assert.match(front, /MS_LOWER_CARD_FILTER_TRUTH_V1/);
  assert.match(context, /const statusMatch =/);
  assert.match(context, /state\.status === "unload-overtime" && isOperationalOvertime\(row\)/);
  assert.match(
    front,
    /completedTodayDatasetRows\(\)\s*\.filter\(matchesCompletedContext\)/,
  );
  assert.match(summary, /Preserve active filters/);
  assert.doesNotMatch(summary, /state\.query = "";/);
  assert.doesNotMatch(summary, /state\.status = "all";/);
});

test("awaiting-release Origin rows sort by earliest planned departure", () => {
  const filtered = between(
    front,
    "function filteredRows(ignoreSummary = false, queueMode = state.queue) {",
    "\nasync function loadRange()",
  );
  assert.match(filtered, /state\.summary === "origin"/);
  assert.match(filtered, /parseDate\(a\.estimatedDepartureAt\)/);
  assert.match(filtered, /Number\.POSITIVE_INFINITY/);
  assert.ok(
    filtered.indexOf("estimatedDepartureAt") < filtered.indexOf("confirmedEffectiveArrival(a)"),
    "origin release order must take precedence over generic arrival order",
  );
});

test("completedToday cache is invalidated from v6 to v7", () => {
  assert.match(worker, /MS_COMPLETED_CALENDAR_DAY_TRUTH_V2/);
  assert.match(worker, /cache\?\.format === 7/);
  assert.match(worker, /cache\?\.format !== 7/);
  assert.match(worker, /version:\s*7,/);
  assert.doesNotMatch(worker, /cache\?\.format === 6/);
});
