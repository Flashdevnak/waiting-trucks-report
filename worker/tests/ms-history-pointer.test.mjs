import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { msHistoryBusinessDay } from "../src/index.js";

const worker = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../migrations/0012_ms_route_latest_history.sql", import.meta.url), "utf8");

test("business day matches legacy Bangkok rule", () => {
  assert.equal(msHistoryBusinessDay({attendanceType:"ปลายทาง",estimatedArrivalAt:"2026-09-16T20:00:00.000Z"}), "2026-09-17");
  assert.equal(msHistoryBusinessDay({attendanceType:"ต้นทาง",estimatedDepartureAt:"2026-09-16T20:00:00.000Z"}), "2026-09-17");
  assert.equal(msHistoryBusinessDay({attendanceType:"ปลายทาง",estimatedArrivalAt:"",actualArrivalAt:"2026-09-16T01:00:00.000Z"}), "2026-09-16");
  assert.equal(msHistoryBusinessDay({}), "");
});

test("pointer schema is generic and indexed by HUB/day", () => {
  assert.match(migration, /ms_route_latest_history/);
  assert.match(migration, /PRIMARY KEY \(hub, route_id\)/);
  assert.match(migration, /idx_ms_route_latest_history_hub_day/);
  assert.match(migration, /ms_route_latest_history_meta/);
  assert.doesNotMatch(migration, /NE1|EA2|NAK/);
});

test("changed and removed routes both advance the latest pointer", () => {
  assert.match(worker, /MS_DAILY_HISTORY_POINTER_V1/);
  assert.match(worker, /msHistoryPointerUpsert\(env, branch, item\.id, historyId, item\.snapshot, now\)/);
  assert.match(worker, /msHistoryPointerUpsert\(env, branch, old\.id, historyId, snapshot, now\)/);
});

test("daily history uses pointer only after verified all-HUB backfill and keeps legacy fallback", () => {
  assert.match(worker, /all_hubs_backfill_v1/);
  assert.match(worker, /INDEXED BY idx_ms_route_latest_history_hub_day/);
  assert.match(worker, /JOIN ms_route_history h ON h\.history_id=p\.history_id/);
  assert.match(worker, /readLegacyMsDailyHistoryRows/);
  const start=worker.indexOf("async function msDailyArchive");
  const end=worker.indexOf("async function msArchiveTotal",start);
  const daily=worker.slice(start,end);
  assert.doesNotMatch(daily,/readMsRoutes\(|refreshMsIfStale\(|syncMs\(/);
});
