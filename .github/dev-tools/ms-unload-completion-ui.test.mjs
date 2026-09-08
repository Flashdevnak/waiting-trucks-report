import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stageFrontend, stageStyle, stageWorker } from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const [htmlSource, frontSource, styleSource, workerSource] = await Promise.all([
  readFile(new URL("ms.html", root), "utf8"),
  readFile(new URL("ms.js", root), "utf8"),
  readFile(new URL("style.css", root), "utf8"),
  readFile(new URL("worker/src/index.js", root), "utf8"),
]);
const front = stageFrontend(frontSource);
const style = stageStyle(styleSource);
const worker = stageWorker(workerSource);

test("system arrival moved into Plan/Actual and completion truth occupies status column", () => {
  assert.match(front, /scheduleHtml\}\$\{arrivalSources\(row\)\}/);
  assert.match(front, /\$\{renderOperation\(row\)\}/);
  assert.match(front, /arrival-system-row/);
  assert.doesNotMatch(front, /queueText\)\}<\/small>\$\{arrivalSources\(row\)\}/);
});

test("upper summary cards remain byte-for-byte frozen and lower cards remain eight", () => {
  const upper = htmlSource.split('<section class="metric-grid ms-metrics">')[1].split('</section>')[0];
  assert.equal(createHash("sha256").update(`<section class="metric-grid ms-metrics">${upper}</section>`).digest("hex"), "9ff963382c03e4830a304bc1c95740049b964a0c4cfdf45569a5806eb3f38312");
  assert.equal((front.match(/data-summary-status=/g) || []).length, 8);
  assert.match(style, /#filter-summary/);
  assert.doesNotMatch(style.split("MS_LOWER_OPERATION_UI_V2")[1], /\.metric-card/);
});

test("card and status dropdown share arrival-to-completion overtime predicate", () => {
  assert.match(front, /const completed = Number\(row\.unloadingState\) === 2/);
  assert.match(front, /const arrival = parseDate\(row\.actualArrivalAt\)/);
  assert.match(front, /slaMinutes = arrival && slaEnd && slaEnd >= arrival/);
  assert.match(front, /completed && standard !== null && slaMinutes !== null && slaMinutes > standard/);
  assert.match(front, /state\.summary === "unload-overtime" && isCompletedUnloadOverStandard\(row\)/);
  assert.match(front, /state\.status === "unload-overtime" && isCompletedUnloadOverStandard\(row\)/);
  assert.match(front, /data-summary-status="unload-overtime"/);
  assert.match(htmlSource, /<option value="unload-overtime">ลงรถเกินเวลา<\/option>/);
  assert.match(front, /scheduleUnloadingStartedAt/);
  assert.doesNotMatch(front, /row\.unloadingState\s*=/);
});

test("S to E is informational unload work duration and is never the SLA", () => {
  assert.match(front, /workMinutes = start && workEnd && workEnd >= start/);
  assert.match(front, /ใช้เวลาลงจริง/);
  const arrival = new Date("2026-09-08T15:56:00.000Z");
  const start = new Date("2026-09-08T18:01:00.000Z");
  const finish = new Date("2026-09-08T18:47:00.000Z");
  assert.equal((finish - arrival) / 60000, 171);
  assert.equal((finish - arrival) / 60000 - 45, 126);
  assert.equal((finish - start) / 60000, 46);
  assert.doesNotMatch(front, /workMinutes\s*-\s*timing\.standard/);
});

test("destination, origin and drop use separate operation renderers", () => {
  assert.match(front, /function unloadCompletionCard\(row\)/);
  assert.match(front, /function renderOriginOperation\(row\)/);
  assert.match(front, /function renderDropOperation\(row\)/);
  assert.match(front, /if \(isDestination\(row\)\) return unloadCompletionCard\(row\)/);
  assert.match(front, /if \(isDrop\(row\)\) return renderDropOperation\(row\)/);
  assert.match(front, /โหลดพัสดุขึ้นรถแล้ว · รอปล่อยรถ/);
  assert.match(front, /ถึงจุดดรอปแล้ว/);
});

test("responsive completion UI adds no network, polling or horizontal overflow", () => {
  assert.match(style, /MS_LOWER_OPERATION_UI_V2/);
  assert.match(style, /@media\(max-width:900px\)/);
  assert.match(style, /grid-template-columns:1fr/);
  assert.match(front, /pollMs:\s*4000/);
  assert.doesNotMatch(front, /function renderOperation[\s\S]{0,400}(fetch|apiGet|apiPost|setInterval)\(/);
});

test("Schedule S piggybacks on the existing BusTime response and coordinator", () => {
  assert.match(worker, /parseScheduleUnloadingStart\(item\.fleet_unloading_time\)/);
  assert.match(worker, /readBusTimeData\(env, branch\)/);
  assert.match(worker, /MS_REFRESH_COORDINATOR/);
  assert.doesNotMatch(worker, /d1_databases/);
});
