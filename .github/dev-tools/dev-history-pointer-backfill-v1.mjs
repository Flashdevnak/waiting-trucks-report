const platform = process.env.TURSO_PLATFORM_API_TOKEN;
const org = process.env.TURSO_ORG;
const database = process.env.TURSO_DATABASE;
if (!platform) throw new Error('TURSO_PLATFORM_API_TOKEN missing');
if (org !== 'flashdevnak') throw new Error('DEV org guard failed');
if (database !== 'waiting-trucks-dev-turso-20260902192750') throw new Error('DEV database guard failed');

const platformHeaders = { Authorization: `Bearer ${platform}` };
async function platformJson(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { ...platformHeaders, ...(init.headers || {}) } });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Turso platform HTTP ${response.status}: ${JSON.stringify(json).slice(0,600)}`);
  return json;
}
const dbJson = await platformJson(`https://api.turso.tech/v1/organizations/${org}/databases/${database}`);
const db = dbJson.database || dbJson;
const hostname = db.Hostname || db.hostname;
if (!hostname) throw new Error('DEV Turso hostname missing');
const tokenJson = await platformJson(
  `https://api.turso.tech/v1/organizations/${org}/databases/${database}/auth/tokens?expiration=30m&authorization=full-access`,
  { method: 'POST' },
);
if (!tokenJson.jwt) throw new Error('DEV Turso token missing');
console.log(`::add-mask::${tokenJson.jwt}`);

async function pipeline(requests) {
  const response = await fetch(`https://${hostname}/v2/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenJson.jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ requests: [...requests, { type: 'close' }] }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Turso SQL HTTP ${response.status}: ${JSON.stringify(body).slice(0,800)}`);
  for (const item of body.results || []) if (item?.type === 'error') throw new Error(`Turso SQL error: ${JSON.stringify(item.error).slice(0,800)}`);
  return body.results || [];
}
const resultOf = (item) => item?.response?.result || {};
const scalar = (cell) => cell?.type === 'null' || cell == null ? null : cell.value;
const rowsOf = (result) => (result.rows || []).map((row) => row.map(scalar));

const schema = [
  `CREATE TABLE IF NOT EXISTS ms_route_latest_history (
    hub TEXT NOT NULL,
    route_id TEXT NOT NULL,
    history_id TEXT NOT NULL,
    business_day TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (hub, route_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ms_route_latest_history_hub_day ON ms_route_latest_history(hub, business_day)`,
  `CREATE TABLE IF NOT EXISTS ms_route_latest_history_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
];
await pipeline(schema.map((sql) => ({ type: 'execute', stmt: { sql } })));
console.log('POINTER_SCHEMA=READY');

const markerResult = await pipeline([{ type: 'execute', stmt: { sql: `SELECT value FROM ms_route_latest_history_meta WHERE key='all_hubs_backfill_v1' LIMIT 1` } }]);
const alreadyComplete = rowsOf(resultOf(markerResult[0]))?.[0]?.[0] === 'complete';

const businessDay = `CASE
  WHEN COALESCE(json_extract(h.payload_json,'$.attendanceType'),'') LIKE '%ต้นทาง%' THEN
    date(datetime(COALESCE(
      NULLIF(json_extract(h.payload_json,'$.estimatedDepartureAt'),''),
      NULLIF(json_extract(h.payload_json,'$.actualDepartureAt'),''),
      NULLIF(json_extract(h.payload_json,'$.estimatedArrivalAt'),'')
    ), '+7 hours'))
  ELSE
    date(datetime(COALESCE(
      NULLIF(json_extract(h.payload_json,'$.estimatedArrivalAt'),''),
      NULLIF(json_extract(h.payload_json,'$.actualArrivalAt'),''),
      NULLIF(json_extract(h.payload_json,'$.estimatedDepartureAt'),'')
    ), '+7 hours'))
END`;

if (!alreadyComplete) {
  const backfillSql = `INSERT INTO ms_route_latest_history(hub,route_id,history_id,business_day,updated_at)
    SELECT r.hub,r.route_id,h.history_id,${businessDay},h.snapshot_at
    FROM ms_route_registry r
    JOIN ms_route_history h ON h.rowid=(
      SELECT h2.rowid
      FROM ms_route_history h2 INDEXED BY idx_ms_route_history_hub_route_snapshot
      WHERE h2.hub=r.hub AND h2.route_id=r.route_id
      ORDER BY h2.snapshot_at DESC,h2.rowid DESC
      LIMIT 1
    )
    WHERE h.hub=r.hub AND json_valid(h.payload_json)=1
    ON CONFLICT(hub,route_id) DO UPDATE SET
      history_id=excluded.history_id,
      business_day=excluded.business_day,
      updated_at=excluded.updated_at`;
  const backfill = resultOf((await pipeline([{ type: 'execute', stmt: { sql: backfillSql } }]))[0]);
  console.log(`BACKFILL_ROWS_READ=${Number(backfill.rows_read || 0)}`);
  console.log(`BACKFILL_ROWS_WRITTEN=${Number(backfill.rows_written || 0)}`);
} else {
  console.log('BACKFILL_SKIPPED=ALREADY_COMPLETE');
}

const expectedCte = `WITH expected AS (
  SELECT r.hub,r.route_id,h.history_id,
    ${businessDay} AS business_day
  FROM ms_route_registry r
  JOIN ms_route_history h ON h.rowid=(
    SELECT h2.rowid
    FROM ms_route_history h2 INDEXED BY idx_ms_route_history_hub_route_snapshot
    WHERE h2.hub=r.hub AND h2.route_id=r.route_id
    ORDER BY h2.snapshot_at DESC,h2.rowid DESC
    LIMIT 1
  )
  WHERE h.hub=r.hub AND json_valid(h.payload_json)=1
)`;

const verify = await pipeline([
  { type: 'execute', stmt: { sql: `${expectedCte}
    SELECT e.hub,COUNT(*) AS expected_count,
      SUM(CASE WHEN p.history_id=e.history_id AND p.business_day IS e.business_day THEN 1 ELSE 0 END) AS matched_count
    FROM expected e
    LEFT JOIN ms_route_latest_history p ON p.hub=e.hub AND p.route_id=e.route_id
    GROUP BY e.hub ORDER BY e.hub` } },
  { type: 'execute', stmt: { sql: `${expectedCte}
    SELECT COUNT(*) AS mismatch_count
    FROM expected e
    LEFT JOIN ms_route_latest_history p ON p.hub=e.hub AND p.route_id=e.route_id
    WHERE p.history_id IS NOT e.history_id OR p.business_day IS NOT e.business_day` } },
]);
const coverage = rowsOf(resultOf(verify[0]));
const mismatch = Number(rowsOf(resultOf(verify[1]))?.[0]?.[0] || 0);
console.log(`HUB_COVERAGE=${JSON.stringify(coverage)}`);
console.log(`POINTER_MISMATCH_COUNT=${mismatch}`);
if (!coverage.length) throw new Error('No HUB registry rows found');
for (const [hub, expected, matched] of coverage) {
  if (Number(expected) !== Number(matched)) throw new Error(`Coverage mismatch ${hub}: ${matched}/${expected}`);
}
if (mismatch !== 0) throw new Error(`Pointer parity mismatch: ${mismatch}`);

const mark = resultOf((await pipeline([{ type: 'execute', stmt: { sql: `INSERT INTO ms_route_latest_history_meta(key,value,updated_at)
  VALUES('all_hubs_backfill_v1','complete',datetime('now'))
  ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at` } }]))[0]);
console.log(`MARKER_ROWS_WRITTEN=${Number(mark.rows_written || 0)}`);

const benchmarkSql = (start, end) => `SELECT h.route_id,h.payload_json,h.snapshot_at,h.synced_by,h.event_type,p.business_day
  FROM ms_route_latest_history p INDEXED BY idx_ms_route_latest_history_hub_day
  JOIN ms_route_history h ON h.history_id=p.history_id
  WHERE p.hub='NE1' AND p.business_day>='${start}' AND p.business_day<='${end}'
  ORDER BY p.business_day DESC,h.snapshot_at DESC`;
const bench = await pipeline([
  { type: 'execute', stmt: { sql: benchmarkSql('2026-09-16','2026-09-16') } },
  { type: 'execute', stmt: { sql: benchmarkSql('2026-09-10','2026-09-16') } },
]);
for (const [label, result] of [['ONE_DAY', resultOf(bench[0])], ['SEVEN_DAY', resultOf(bench[1])]]) {
  console.log(`${label}_RESULT_ROWS=${(result.rows || []).length}`);
  console.log(`${label}_ROWS_READ=${Number(result.rows_read || 0)}`);
  console.log(`${label}_ROWS_WRITTEN=${Number(result.rows_written || 0)}`);
}
console.log('UPSTREAM_MS_CALLS=0');
console.log('PRODUCTION_TOUCHED=NO');
console.log('ALL_HUB_POINTER_BACKFILL=PASS');
