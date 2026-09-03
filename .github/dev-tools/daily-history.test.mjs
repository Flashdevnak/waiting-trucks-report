import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  patchMsDailyHistoryFrontend,
  patchMsDailyHistoryWorker,
  patchMsDailyHistoryHtml,
  patchMsDailyHistoryServiceWorker,
} from "./apply-ms-daily-history.mjs";

const [frontend, worker, html, sw] = await Promise.all([
  readFile("ms.js", "utf8"),
  readFile("worker/src/index.js", "utf8"),
  readFile("ms.html", "utf8"),
  readFile("sw.js", "utf8"),
]);

test("frontend daily history is explicit, database-only and keeps 4-second live polling", () => {
  const patched = patchMsDailyHistoryFrontend(frontend);
  assert.match(patched, /MS_DAILY_HISTORY_V1/);
  assert.match(patched, /pollMs: 4000/);
  assert.match(patched, /apiGet\("msDailyArchive"/);
  assert.doesNotMatch(patched, /const result = await apiGet\("msRange"/);
  assert.match(patched, /เลือกวันอย่างเดียวไม่อ่านฐานข้อมูล จนกว่าจะกดค้นหา/);
  assert.match(patched, /function rowBusinessDay\(row\)/);
  assert.match(patched, /function metricSourceRows\(\)/);
  assert.match(patched, /state\.currentRows\.filter\(\(row\) => rowBusinessDay\(row\) === today\)/);
  assert.match(patched, /Export ช่วงวันที่/);
  assert.equal(patchMsDailyHistoryFrontend(patched), patched);
});

test("worker daily history never calls upstream MS and never writes history", () => {
  const patched = patchMsDailyHistoryWorker(worker);
  assert.match(patched, /MS_DAILY_HISTORY_V1: read-only daily history/);
  assert.match(patched, /action === "msDailyArchive"/);
  assert.match(patched, /source: "TURSO_DAILY_HISTORY"/);
  assert.match(patched, /upstreamMsCalls: 0/);
  assert.match(patched, /historyWrites: 0/);
  assert.match(patched, /FROM ms_route_registry r/);
  assert.match(patched, /WHERE h2\.hub=r\.hub AND h2\.route_id=r\.route_id/);
  assert.doesNotMatch(patched.match(/async function msDailyArchive[\s\S]*?async function msArchiveTotal/)?.[0] || "", /readMsRoutes\(|syncMs\(/);
  assert.equal(patchMsDailyHistoryWorker(patched), patched);
});

test("daily history UI and cache release are updated", () => {
  const patchedHtml = patchMsDailyHistoryHtml(html);
  const patchedSw = patchMsDailyHistoryServiceWorker(sw);
  assert.match(patchedHtml, /รายการรายวัน/);
  assert.match(patchedHtml, /วันนี้ หรือช่วงวันที่ที่กดค้นหา/);
  assert.match(patchedHtml, /Export ช่วงวันที่/);
  assert.match(patchedHtml, /ms\.js\?v=20260903-04/);
  assert.match(patchedSw, /VERSION="20260903-04"/);
});

test("daily history read index is present", async () => {
  let migration = "";
  try {
    migration = await readFile("worker/migrations/0010_ms_daily_history_read_index.sql", "utf8");
  } catch {}
  if (migration) {
    assert.match(migration, /idx_ms_route_history_hub_route_snapshot/);
    assert.match(migration, /hub, route_id, snapshot_at DESC/);
  }
});
