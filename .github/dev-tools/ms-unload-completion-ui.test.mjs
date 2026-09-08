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
  assert.match(front, /operationTimeline\(stages, activeIndex\)/);
  assert.match(front, /ถึงปลายทางแล้ว · รอเริ่มลงรถ/);
  assert.match(front, /กำลังลงพัสดุ/);
  assert.match(front, /โหลดพัสดุลงรถเสร็จสิ้น/);
  assert.match(front, /กำลังโหลดพัสดุขึ้นรถ/);
  assert.match(front, /โหลดพัสดุขึ้นรถแล้ว · รอปล่อยรถ/);
  assert.match(front, /ออกจาก HUB แล้ว/);
  assert.match(front, /ถึงจุดดรอปแล้ว · รอเริ่มดำเนินการ/);
  assert.match(front, /กำลังดำเนินการที่จุดดรอป/);
  assert.match(front, /ออกต่อจากจุดดรอปแล้ว/);
  assert.match(front, /stages-\$\{stages\.length\}/);
});

test("operation labels stay within their destination, origin and drop renderers", () => {
  const destination = front.split("function unloadCompletionCard(row)")[1].split("function renderOriginOperation(row)")[0];
  const origin = front.split("function renderOriginOperation(row)")[1].split("function renderDropOperation(row)")[0];
  const drop = front.split("function renderDropOperation(row)")[1].split("function renderOperation(row)")[0];
  assert.doesNotMatch(destination, /โหลดพัสดุขึ้นรถ|รอปล่อยรถ|ออกจาก HUB|จุดดรอป|ออกต่อ/);
  assert.doesNotMatch(origin, /ลงพัสดุ|ลงรถ|ปลายทาง|จุดดรอป/);
  assert.doesNotMatch(drop, /ลงรถ|ลงพัสดุ|โหลดพัสดุขึ้นรถ|รอปล่อยรถ|ออกจาก HUB/);
  assert.match(destination, /มาถึง[\s\S]*รอเริ่มลง/);
  assert.match(origin, /เริ่มโหลด[\s\S]*กำลังโหลดขึ้นรถ/);
  assert.match(drop, /ถึงจุดดรอป[\s\S]*เริ่มดำเนินการ[\s\S]*ออกต่อ/);
});

test("responsive completion UI adds no network, polling or horizontal overflow", () => {
  assert.match(style, /MS_LOWER_OPERATION_UI_V2/);
  assert.match(style, /@media\(max-width:900px\)/);
  assert.match(style, /grid-template-columns:1fr/);
  assert.match(front, /pollMs:\s*4000/);
  assert.doesNotMatch(front, /function renderOperation[\s\S]{0,400}(fetch|apiGet|apiPost|setInterval)\(/);
});

test("visual acceptance V3 is premium, scoped, and does not touch frozen upper metrics", () => {
  const visual = style.split("MS_LOWER_VISUAL_ACCEPTANCE_V3")[1];
  assert.ok(visual, "visual acceptance marker missing");
  assert.match(visual, /#filter-summary button/);
  assert.match(visual, /border-radius:12px/);
  assert.match(visual, /linear-gradient/);
  assert.match(visual, /schedule-stack\.single/);
  assert.match(visual, /operation-timeline/);
  assert.match(visual, /destination-operation\.is-over/);
  assert.match(visual, /origin-operation/);
  assert.match(visual, /drop-operation/);
  assert.doesNotMatch(visual, /\.metric-card|\.ms-metrics|data-metric/);
  assert.doesNotMatch(visual, /fetch\(|apiGet\(|apiPost\(|setInterval\(/);
});

test("operation presentation V4 is centered, responsive and group-specific", () => {
  const visual = style.split("MS_OPERATION_PRESENTATION_V4")[1];
  assert.ok(visual, "operation presentation marker missing");
  assert.match(visual, /operation-timeline\.stages-2/);
  assert.match(visual, /operation-timeline\.stages-3/);
  assert.match(visual, /place-items:center/);
  assert.match(visual, /destination-operation/);
  assert.match(visual, /origin-operation\.is-wait-release/);
  assert.match(visual, /drop-operation\.is-released/);
  assert.match(visual, /@media\(max-width:900px\)/);
  assert.match(visual, /@media\(max-width:430px\)/);
  assert.doesNotMatch(visual, /\.metric-card|\.ms-metrics|data-metric/);
  assert.doesNotMatch(visual, /fetch\(|apiGet\(|apiPost\(|setInterval\(/);
});

test("Schedule S piggybacks on the existing BusTime response and coordinator", () => {
  assert.match(worker, /parseScheduleUnloadingStart\(item\.fleet_unloading_time\)/);
  assert.match(worker, /readBusTimeData\(env, branch\)/);
  assert.match(worker, /MS_REFRESH_COORDINATOR/);
  assert.doesNotMatch(worker, /d1_databases/);
});
