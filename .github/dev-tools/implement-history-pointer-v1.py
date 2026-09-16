from pathlib import Path

p = Path("worker/src/index.js")
s = p.read_text()
anchor = "async function syncMs(body, actor, env) {"
helper = r'''// MS_DAILY_HISTORY_POINTER_V1: keep one tiny latest-history pointer per HUB/route.
// The business-day rule is intentionally identical to the legacy Turso JSON query.
export function msHistoryBusinessDay(row) {
  const source = String(row?.attendanceType || "").includes("ต้นทาง")
    ? row?.estimatedDepartureAt || row?.actualDepartureAt || row?.estimatedArrivalAt
    : row?.estimatedArrivalAt || row?.actualArrivalAt || row?.estimatedDepartureAt;
  const parsed = Date.parse(String(source || ""));
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed + 7 * 3600000).toISOString().slice(0, 10);
}

function msHistoryPointerUpsert(env, hub, routeId, historyId, row, updatedAt) {
  return env.DB.prepare(
    "INSERT INTO ms_route_latest_history(hub,route_id,history_id,business_day,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(hub,route_id) DO UPDATE SET history_id=excluded.history_id,business_day=excluded.business_day,updated_at=excluded.updated_at",
  ).bind(hub, routeId, historyId, msHistoryBusinessDay(row), updatedAt);
}

'''
if "MS_DAILY_HISTORY_POINTER_V1" not in s:
    assert anchor in s
    s = s.replace(anchor, helper + anchor, 1)

old = r'''      statements.push(
        env.DB.prepare(
          "INSERT INTO ms_route_history VALUES(?,?,?,?,?,?,?)",
        ).bind(
          crypto.randomUUID(),
          item.id,
          branch,
          old ? "UPDATED" : "FIRST_SEEN",
          now,
          JSON.stringify(item.snapshot),
          actor.username,
        ),
      );'''
new = r'''      const historyId = crypto.randomUUID();
      statements.push(
        env.DB.prepare(
          "INSERT INTO ms_route_history VALUES(?,?,?,?,?,?,?)",
        ).bind(
          historyId,
          item.id,
          branch,
          old ? "UPDATED" : "FIRST_SEEN",
          now,
          JSON.stringify(item.snapshot),
          actor.username,
        ),
      );
      statements.push(
        msHistoryPointerUpsert(env, branch, item.id, historyId, item.snapshot, now),
      );'''
if old in s:
    s = s.replace(old, new, 1)
elif "msHistoryPointerUpsert(env, branch, item.id, historyId" not in s:
    raise SystemExit("changed-route history block not found")

old_removed = r'''  for (const old of oldRows)
    if (removedIds.has(old.id))
      statements.push(
        env.DB.prepare(
          "INSERT INTO ms_route_history VALUES(?,?,?,?,?,?,?)",
        ).bind(
          crypto.randomUUID(),
          old.id,
          branch,
          "REMOVED",
          now,
          JSON.stringify(output(old)),
          actor.username,
        ),
        env.DB.prepare("DELETE FROM ms_routes WHERE id=?").bind(old.id),
      );'''
new_removed = r'''  for (const old of oldRows) {
    if (!removedIds.has(old.id)) continue;
    const historyId = crypto.randomUUID();
    const snapshot = output(old);
    statements.push(
      env.DB.prepare(
        "INSERT INTO ms_route_history VALUES(?,?,?,?,?,?,?)",
      ).bind(
        historyId,
        old.id,
        branch,
        "REMOVED",
        now,
        JSON.stringify(snapshot),
        actor.username,
      ),
      msHistoryPointerUpsert(env, branch, old.id, historyId, snapshot, now),
      env.DB.prepare("DELETE FROM ms_routes WHERE id=?").bind(old.id),
    );
  }'''
if old_removed in s:
    s = s.replace(old_removed, new_removed, 1)
elif "msHistoryPointerUpsert(env, branch, old.id, historyId" not in s:
    raise SystemExit("removed-route history block not found")

start = s.index("// MS_DAILY_HISTORY_V1: read-only daily history.")
fn = s.index("async function msDailyArchive", start)
qstart = s.index("  const [historyResult, cancellationResult] = await Promise.all([", fn)
qend = s.index("\n\n  const cancellations = new Map(", qstart)
legacy = s[qstart:qend]
hist_start = legacy.index("    env.DB.prepare(")
cancel_start = legacy.index("    env.DB.prepare(", hist_start + 1)
history_expr = legacy[hist_start:cancel_start].rstrip(",\n ")
legacy_helper = '''async function readLegacyMsDailyHistoryRows(env, hub, start, end) {\n  return ''' + history_expr.strip() + ''';\n}\n\nasync function readMsDailyHistoryRows(env, hub, start, end) {\n  try {\n    const ready = await env.DB.prepare(\n      "SELECT value FROM ms_route_latest_history_meta WHERE key='all_hubs_backfill_v1' LIMIT 1",\n    ).first();\n    if (ready?.value !== "complete") return readLegacyMsDailyHistoryRows(env, hub, start, end);\n    return env.DB.prepare(\n      `SELECT h.route_id,h.payload_json,h.snapshot_at,h.synced_by,h.event_type,p.business_day\n       FROM ms_route_latest_history p INDEXED BY idx_ms_route_latest_history_hub_day\n       JOIN ms_route_history h ON h.history_id=p.history_id\n       WHERE p.hub=? AND p.business_day>=? AND p.business_day<=?\n       ORDER BY p.business_day DESC,h.snapshot_at DESC`,\n    ).bind(hub, start, end).all();\n  } catch (error) {\n    if (!isMissingTableError(error, "ms_route_latest_history") &&\n        !isMissingTableError(error, "ms_route_latest_history_meta")) throw error;\n    return readLegacyMsDailyHistoryRows(env, hub, start, end);\n  }\n}\n\n'''
if "async function readMsDailyHistoryRows" not in s:
    s = s[:start] + legacy_helper + s[start:]
    fn = s.index("async function msDailyArchive")
    qstart = s.index("  const [historyResult, cancellationResult] = await Promise.all([", fn)
    qend = s.index("\n\n  const cancellations = new Map(", qstart)
replacement = '''  const [historyResult, cancellationResult] = await Promise.all([\n    readMsDailyHistoryRows(env, hub, start, end),\n    env.DB.prepare(\n      "SELECT route_id,cancelled_at,cancelled_by,reason FROM ms_route_cancellations WHERE hub=? AND active=1",\n    )\n      .bind(hub)\n      .all(),\n  ]);'''
s = s[:qstart] + replacement + s[qend:]
p.write_text(s)

Path("worker/migrations/0012_ms_route_latest_history.sql").write_text('''CREATE TABLE IF NOT EXISTS ms_route_latest_history (\n  hub TEXT NOT NULL,\n  route_id TEXT NOT NULL,\n  history_id TEXT NOT NULL,\n  business_day TEXT,\n  updated_at TEXT NOT NULL,\n  PRIMARY KEY (hub, route_id)\n);\nCREATE INDEX IF NOT EXISTS idx_ms_route_latest_history_hub_day\n  ON ms_route_latest_history(hub, business_day);\nCREATE TABLE IF NOT EXISTS ms_route_latest_history_meta (\n  key TEXT PRIMARY KEY NOT NULL,\n  value TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n);\n''')

Path("worker/tests/ms-history-pointer.test.mjs").write_text(r'''import test from "node:test";
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
''')

wf = Path(".github/workflows/deploy-worker-dev.yml")
t = wf.read_text()
test_line = "      - run: node --test ../.github/dev-tools/daily-history.test.mjs\n"
if "tests/ms-history-pointer.test.mjs" not in t:
    assert test_line in t
    t = t.replace(test_line, test_line + "      - run: node --test tests/ms-history-pointer.test.mjs\n", 1)
marker = "'MS_DAILY_HISTORY_V1: read-only daily history','MS_DAILY_HISTORY_MAX_7_DAYS_V1'"
if "'MS_DAILY_HISTORY_POINTER_V1'" not in t:
    assert marker in t
    t = t.replace(marker, "'MS_DAILY_HISTORY_V1: read-only daily history','MS_DAILY_HISTORY_POINTER_V1','MS_DAILY_HISTORY_MAX_7_DAYS_V1'", 1)
wf.write_text(t)
