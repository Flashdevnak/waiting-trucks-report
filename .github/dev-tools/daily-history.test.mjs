import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const fromRoot = (...parts) => join(ROOT, ...parts);

const [frontend, worker, html, sw, versionText, migration] = await Promise.all([
  readFile(fromRoot("ms.js"), "utf8"),
  readFile(fromRoot("worker", "src", "index.js"), "utf8"),
  readFile(fromRoot("ms.html"), "utf8"),
  readFile(fromRoot("sw.js"), "utf8"),
  readFile(fromRoot("version.json"), "utf8"),
  readFile(
    fromRoot("worker", "migrations", "0010_ms_daily_history_read_index.sql"),
    "utf8",
  ),
]);
const version = JSON.parse(versionText);

test("frontend daily history is explicit, database-only and keeps 4-second live polling", () => {
  assert.match(frontend, /MS_DAILY_HISTORY_V1/);
  assert.match(frontend, /pollMs:\s*4000/);
  assert.match(frontend, /apiGetOnce\("msDailyArchive"/);
  assert.doesNotMatch(frontend, /apiGet\("msDailyArchive"/);
  assert.doesNotMatch(frontend, /const result = await apiGet\("msRange"/);
  assert.match(frontend, /เลือกวันอย่างเดียวไม่อ่านฐานข้อมูล จนกว่าจะกดค้นหา/);
  assert.match(frontend, /MS_DAILY_HISTORY_MAX_7_DAYS_V1/);
  assert.match(frontend, /เลือกค้นหาได้ครั้งละไม่เกิน 7 วัน/);
  assert.match(frontend, /rangeEndMs - rangeStartMs > 6 \* 86400000/);
  assert.match(frontend, /function rowBusinessDay\(row\)/);
  assert.match(frontend, /function metricSourceRows\(\)/);
  assert.match(
    frontend,
    /state\.currentRows\.filter\(\(row\) => rowBusinessDay\(row\) === today\)/,
  );
  assert.match(frontend, /state\.rows = state\.archiveView \? state\.archiveRows : state\.currentRows/);
  assert.match(frontend, /Export ช่วงวันที่/);
});

test("worker daily history is read-only Turso history and never refreshes upstream MS", () => {
  assert.match(worker, /MS_DAILY_HISTORY_V1: read-only daily history/);
  assert.match(worker, /action === "msDailyArchive"/);
  assert.match(worker, /source:\s*"TURSO_DAILY_HISTORY"/);
  assert.match(worker, /upstreamMsCalls:\s*0/);
  assert.match(worker, /historyWrites:\s*0/);
  assert.match(worker, /FROM ms_route_registry r/);
  // Quota guard: the per-route latest snapshot lookup must be locked to the existing covering index.
  assert.match(worker, /INDEXED BY idx_ms_route_history_hub_route_snapshot/);

  const start = worker.indexOf("async function msDailyArchive");
  const end = worker.indexOf("async function msArchiveTotal", start);
  assert.ok(start >= 0 && end > start, "msDailyArchive function must exist before msArchiveTotal");
  const dailyArchive = worker.slice(start, end);
  assert.doesNotMatch(dailyArchive, /readMsRoutes\(|syncMs\(|refreshMsIfStale\(/);
  assert.match(dailyArchive, /MS_DAILY_HISTORY_MAX_7_DAYS_V1/);
  assert.match(dailyArchive, /6 \* 86400000/);
  assert.match(dailyArchive, /เลือกค้นหาข้อมูลย้อนหลังได้ครั้งละไม่เกิน 7 วัน/);
  assert.doesNotMatch(dailyArchive, /31 \* 86400000/);
});

test("daily history UI release and lower-reference SW revision are current", () => {
  assert.match(html, /รายการรายวัน/);
  assert.match(html, /วันนี้ หรือช่วงวันที่ที่กดค้นหา/);
  assert.match(html, /Export ช่วงวันที่/);
  assert.match(html, /ms\.js\?v=20260919-pno-line-copy-v1/);
  assert.equal(version.version, "20260904-01");
  // The data-release manifest remains frozen. The scoped MS asset revision
  // identifies the current lower presentation/freshness revision without changing pipelines.
  assert.match(sw, /20260911-02-mobile-schedule-status/);
  assert.doesNotMatch(sw, /MS_JS_HOTFIX|MS_CSS_HOTFIX|appendPatch/);
});

test("daily history read index is present", () => {
  assert.match(migration, /idx_ms_route_history_hub_route_snapshot/);
  assert.match(migration, /hub, route_id, snapshot_at DESC/);
});
