import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stageFrontend, stageStyle, stageWorker } from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const [frontSource, styleSource, workerSource] = await Promise.all([
  readFile(new URL("ms.js", root), "utf8"),
  readFile(new URL("style.css", root), "utf8"),
  readFile(new URL("worker/src/index.js", root), "utf8"),
]);
const front = stageFrontend(frontSource);
const style = stageStyle(styleSource);
const worker = stageWorker(workerSource);

test("system arrival moved into Plan/Actual and completion truth occupies status column", () => {
  assert.match(front, /scheduleHtml\}\$\{arrivalSources\(row\)\}/);
  assert.match(front, /queueText\)\}<\/small>\$\{unloadCompletionCard\(row\)\}/);
  assert.match(front, /เวลาลงรถเสร็จจริง/);
  assert.doesNotMatch(front, /queueText\)\}<\/small>\$\{arrivalSources\(row\)\}/);
});

test("completion card and overtime filter are truth-safe derived UI", () => {
  assert.match(front, /const completed = Number\(row\.unloadingState\) === 2/);
  assert.match(front, /completed && durationMinutes !== null && durationMinutes > standard/);
  assert.match(front, /state\.summary === "unload-overtime" && isCompletedUnloadOverStandard\(row\)/);
  assert.match(front, /data-summary-status="unload-overtime"/);
  assert.match(front, /scheduleUnloadingStartedAt/);
  assert.doesNotMatch(front, /row\.unloadingState\s*=/);
});

test("responsive completion UI adds no network, polling or horizontal overflow", () => {
  assert.match(style, /MS_UNLOAD_COMPLETION_UI_V1/);
  assert.match(style, /@media\(max-width:900px\)/);
  assert.match(style, /grid-template-columns:1fr/);
  assert.match(front, /pollMs:\s*4000/);
  assert.doesNotMatch(front, /unloadCompletionCard[\s\S]{0,800}(fetch|apiGet|apiPost)\(/);
});

test("Schedule S piggybacks on the existing BusTime response and coordinator", () => {
  assert.match(worker, /parseScheduleUnloadingStart\(item\.fleet_unloading_time\)/);
  assert.match(worker, /readBusTimeData\(env, branch\)/);
  assert.match(worker, /MS_REFRESH_COORDINATOR/);
  assert.doesNotMatch(worker, /d1_databases/);
});
