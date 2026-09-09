import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stageFrontend, stageStyle, stageWorker } from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const [htmlSource, frontSource, styleSource, workerSource, sw] = await Promise.all([
  readFile(new URL("ms.html", root), "utf8"),
  readFile(new URL("ms.js", root), "utf8"),
  readFile(new URL("style.css", root), "utf8"),
  readFile(new URL("worker/src/index.js", root), "utf8"),
  readFile(new URL("sw.js", root), "utf8"),
]);
const front = stageFrontend(frontSource);
const style = stageStyle(styleSource);
const worker = stageWorker(workerSource);
const visual = style.split("MS_LOWER_REFERENCE_V7")[1] || "";

function section(source, start, end) {
  return source.split(start)[1]?.split(end)[0] || "";
}

test("1 lower filter summary remains exactly eight cards", () => {
  assert.equal((front.match(/data-summary-status=/g) || []).length, 8);
  for (const label of ["ทั้งหมดตามตัวกรอง", "รอลงรถ", "กำลังลงรถ", "ลงรถเสร็จ", "รอปล่อยรถ", "ลงรถเกินเวลา", "จุดดรอป", "ยกเลิกรถแล้ว"])
    assert.match(front, new RegExp(label));
});

test("2 lower counts and click/filter behavior retain the existing contracts", () => {
  const summary = section(front, "function renderFilterSummary(rows)", "function isCompletedAccumulated");
  for (const marker of ["counts.waiting++", "counts.unloading++", "counts.origin++", "counts.drop++", "counts.unloadOvertime", "button.dataset.summaryStatus", "state.summary = value"])
    assert.ok(summary.includes(marker), `missing ${marker}`);
  assert.match(summary, /querySelectorAll\("button"\)/);
});

test("3 destination work type is approved yellow", () => {
  assert.match(visual, /type-badge\.inbound\{border-color:#efd17c;background:#fff1b8;color:#725000\}/);
  assert.match(visual, /type-badge\.inbound::before\{content:"เข้า • "\}/);
});

test("4 origin work type is approved violet", () => {
  assert.match(visual, /type-badge\.outbound\{border-color:#cdbcf2;background:#eee7ff;color:#6543ac\}/);
  assert.match(visual, /type-badge\.outbound::before\{content:"ออก • "\}/);
});

test("5 drop work type is approved blue", () => {
  assert.match(visual, /type-badge\.drop\{border-color:#acd8f5;background:#dff2ff;color:#126ba8\}/);
  assert.match(visual, /summary-drop\{--lower-accent:#1683d2;--lower-soft:#eaf5ff\}/);
});

test("6 drop work subtitle is เข้าจุดดรอป", () => {
  assert.match(front, /if \(isDrop\(row\)\) return "เข้าจุดดรอป"/);
});

test("7 rejected old drop subtitle is absent", () => {
  assert.doesNotMatch(front, /รอเข้าจุดดรอป/);
});

test("8 drop status presentation is blue", () => {
  assert.match(visual, /drop-operation[^}]*--op-accent:#1683d2;--op-soft:#e9f5ff/);
  assert.match(front, /warehouse:/);
});

test("9 purple drop status is absent from the active V7 layer", () => {
  const dropRules = visual.match(/[^\n]*drop-operation[^\n]*/g)?.join("\n") || "";
  assert.doesNotMatch(dropRules, /#7652a2|#77509a|#795396|f4effc|f5eef9/);
});

test("10 desktop table cells share the centered alignment contract", () => {
  assert.match(visual, /tbody td\{[^}]*text-align:center;vertical-align:middle/);
  assert.match(visual, /route-meta-grid[^}]*text-align:center/);
  assert.match(visual, /route-summary\{[^}]*margin:auto[^}]*text-align:left/);
});

test("11 arrival card is centered and Route-authored", () => {
  const schedule = section(front, "function scheduleSection(row, mode)", "function queueInfo");
  assert.match(schedule, /\? row\.actualArrivalAt/);
  assert.doesNotMatch(schedule, /confirmedEffectiveArrival/);
  assert.match(style, /schedule-heading[^}]*text-align:center/);
  assert.match(style, /schedule-values > span[^}]*text-align: center/);
});

test("12 KIT TBR and ใช้เวลา remain a compact three-column footer", () => {
  const arrivals = section(front, "function arrivalSources(row)", "function arrivalSourceDateTime");
  assert.match(arrivals, /<em>KIT<\/em>/);
  assert.match(arrivals, /<em>TBR<\/em>/);
  assert.match(arrivals, /<em>ใช้เวลา<\/em>/);
  assert.match(style, /arrival-system-row>div\{grid-template-columns:repeat\(3,minmax\(86px,1fr\)\)/);
});

test("13 status timeline remains horizontal on desktop", () => {
  assert.match(front, /operation-timeline stages-\$\{stages\.length\}/);
  assert.match(visual, /operation-timeline\.stages-2/);
  assert.match(visual, /operation-timeline\.stages-3/);
  assert.match(visual, /operation-timeline i\{height:2px/);
});

test("14 destination waiting timer starts only from Route actualArrivalAt", () => {
  const timing = section(front, "function unloadTiming(row, now = new Date())", "function isCompletedUnloadOverStandard");
  assert.match(timing, /const arrival = parseDate\(row\.actualArrivalAt\)/);
  assert.match(timing, /const slaEnd = finish \|\| \(!completed && arrival \? now : null\)/);
  assert.doesNotMatch(timing, /scheduleKitArrivalAt|scheduleTbrArrivalAt|effectiveArrival/);
});

test("15 origin active loading can never be presented as complete", () => {
  const origin = section(front, "function renderOriginOperation(row)", "function renderDropOperation(row)");
  assert.match(origin, /const routeStillLoading = Number\(row\.unloadingState\) === 1/);
  assert.match(origin, /loadingComplete = !released && !routeStillLoading/);
  assert.match(origin, /routeStillLoading[\s\S]*vehicleStatus/);
});

test("16 arrival-to-trusted-completion overtime and S-to-E duration are unchanged", () => {
  const timing = section(front, "function unloadTiming(row, now = new Date())", "function isCompletedUnloadOverStandard");
  assert.match(timing, /workMinutes = start && workEnd && workEnd >= start/);
  assert.match(timing, /slaMinutes = arrival && slaEnd && slaEnd >= arrival/);
  assert.match(timing, /completed && standard !== null && slaMinutes !== null && slaMinutes > standard/);
  assert.match(front, /ใช้เวลาลงจริง/);
});

test("17 operation card has no external duplicate status badge", () => {
  const row = section(front, "function tableRow(row)", "function card(row)");
  assert.match(row, /operationHtml \|\|/);
  assert.doesNotMatch(row, /<div class="work-badge[^\n]*\$\{operationHtml\}/);
});

test("18 renderers add no per-row timers or animation loops", () => {
  const renderers = section(front, "function operationIcon(kind)", "const CODE128_PATTERNS");
  assert.doesNotMatch(renderers, /setInterval\(|setTimeout\(|requestAnimationFrame\(/);
});

test("19 presentation adds no duplicate polling or upstream reads", () => {
  const renderers = section(front, "function arrivalSources(row)", "const CODE128_PATTERNS");
  assert.doesNotMatch(renderers, /fetch\(|apiGet\(|apiPost\(|syncMs\(/);
  assert.match(front, /pollMs:\s*4000/);
  assert.match(worker, /MS_REFRESH_COORDINATOR/);
});

test("20 service worker revision serves source assets without runtime hotfix layers", () => {
  assert.match(sw, /20260909-03-lower-reference/);
  assert.match(sw, /url\.searchParams\.set\("__fresh", VERSION\)/);
  assert.doesNotMatch(sw, /MS_JS_HOTFIX|MS_CSS_HOTFIX|appendPatch|String\.raw/);
});

test("21 desktop 1280-1920 uses the six-column reference table", () => {
  assert.equal((htmlSource.match(/<col class="col-/g) || []).length, 6);
  assert.equal((htmlSource.match(/<th>/g) || []).length, 6);
  assert.match(visual, /@media \(min-width:1025px\)/);
  assert.match(visual, /col\.col-status\{width:26%\}/);
});

test("22 tablet 768-1024 uses compact two-column truck cards", () => {
  assert.match(front, /matchMedia\("\(max-width: 1024px\)"\)/);
  assert.match(visual, /@media \(max-width:1024px\)/);
  assert.match(visual, /mobile-cards\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(visual, /compact-card\{display:block/);
});

test("23 mobile 375-430 uses one compact truck card and two summary columns", () => {
  assert.match(visual, /@media \(max-width:700px\)[\s\S]*mobile-cards\{grid-template-columns:1fr/);
  assert.match(style, /@media \(max-width:700px\)\{\.ms-page \.filter-summary\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(visual, /@media\(max-width:430px\)/);
});

test("24 responsive lower presentation prevents horizontal overflow", () => {
  assert.match(visual, /ms-table\{width:100%;min-width:0;table-layout:fixed\}/);
  assert.match(visual, /compact-card\{display:block;min-width:0/);
  assert.match(visual, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\);overflow:visible/);
});

test("frozen upper KPI markup remains byte-for-byte unchanged", () => {
  const upper = htmlSource.split('<section class="metric-grid ms-metrics">')[1].split("</section>")[0];
  assert.equal(createHash("sha256").update(`<section class="metric-grid ms-metrics">${upper}</section>`).digest("hex"), "9ff963382c03e4830a304bc1c95740049b964a0c4cfdf45569a5806eb3f38312");
  assert.doesNotMatch(visual, /\.metric-card|\.ms-metrics|data-metric/);
});

test("Schedule S and trusted E still reuse the existing data pipeline", () => {
  assert.match(worker, /parseScheduleUnloadingStart\(item\.fleet_unloading_time\)/);
  assert.match(worker, /readBusTimeData\(env, branch\)/);
  assert.doesNotMatch(visual, /fetch\(|apiGet\(|apiPost\(|setInterval\(|requestAnimationFrame\(/);
});
