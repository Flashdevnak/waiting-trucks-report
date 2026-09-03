import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stageWorker } from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const frontend = await readFile(new URL("ms.js", root), "utf8");
const html = await readFile(new URL("ms.html", root), "utf8");
const workerBase = await readFile(new URL("worker/src/index.js", root), "utf8");
const worker = stageWorker(workerBase);

test("daily metrics stay on today/live rows until a dated history search is requested", () => {
  assert.match(frontend, /function metricSourceRows\(\)/);
  assert.match(frontend, /state\.currentRows\.filter\(\(row\) => rowBusinessDay\(row\) === today\)/);
  assert.match(frontend, /setMetric\("metric-archive", metricRows\.length\)/);
  assert.match(frontend, /pollMs:\s*4000/);
  assert.match(frontend, /DEV: archive stays lazy; live polling must never auto-read msArchive/);
  assert.doesNotMatch(frontend, /if \(!state\.archiveTotalLoaded\) void ensureArchiveTotalLoaded\(\)/);
  assert.doesNotMatch(frontend, /apiGet\("msArchive",/);
});

test("date inputs do not read history until Search and Search uses the daily Turso endpoint", () => {
  const setupStart = frontend.indexOf("function setupDateInput(id)");
  const setupEnd = frontend.indexOf("function renderFreshness", setupStart);
  assert.ok(setupStart >= 0 && setupEnd > setupStart);
  const setup = frontend.slice(setupStart, setupEnd);
  assert.match(setup, /เลือกวันอย่างเดียวไม่อ่านฐานข้อมูล จนกว่าจะกดค้นหา/);
  assert.match(setup, /input\.oninput = \(\) => \{\};/);
  assert.match(setup, /input\.onchange = \(\) => \{\};/);

  const rangeStart = frontend.indexOf("async function loadRange()");
  const rangeEnd = frontend.indexOf("let rangeTimer", rangeStart);
  assert.ok(rangeStart >= 0 && rangeEnd > rangeStart);
  const range = frontend.slice(rangeStart, rangeEnd);
  assert.match(range, /apiGet\("msDailyArchive"/);
  assert.doesNotMatch(range, /apiGet\("msRange"/);
  assert.match(range, /result\?\.complete === false \|\| rows\.length !== total/);
});

test("daily-history Worker read is complete, database-only and bounded to 31 days", () => {
  const start = worker.indexOf("async function msDailyArchive(env, actor, hub, startValue, endValue)");
  const end = worker.indexOf("async function msArchiveTotal", start);
  assert.ok(start >= 0 && end > start);
  const section = worker.slice(start, end);
  assert.match(section, /31 \* 86400000/);
  assert.match(section, /DATE_RANGE_TOO_LARGE/);
  assert.match(section, /FROM ms_route_registry r/);
  assert.match(section, /ms_route_history/);
  assert.match(section, /upstreamMsCalls:\s*0/);
  assert.match(section, /historyWrites:\s*0/);
  assert.doesNotMatch(section, /readMsRoutes\(|syncMs\(/);
  assert.doesNotMatch(section, /\b(?:INSERT|UPDATE|DELETE)\b/i);
});

test("daily UI no longer offers lifetime accumulated export", () => {
  assert.match(html, /รายการรายวัน/);
  assert.match(html, /วันนี้ หรือช่วงวันที่ที่กดค้นหา/);
  assert.match(html, /Export ช่วงวันที่/);
  assert.doesNotMatch(html, />\s*Export ทั้งหมด\s*</);
  assert.match(html, /ms\.js\?v=20260903-04/);
});
