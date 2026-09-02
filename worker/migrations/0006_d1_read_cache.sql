-- D1 read optimization: live source cache and lifetime route registry.
CREATE TABLE IF NOT EXISTS ms_live_cache (
  hub TEXT PRIMARY KEY NOT NULL,
  source_hash TEXT NOT NULL DEFAULT '',
  rows_json TEXT NOT NULL DEFAULT '[]',
  synced_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS ms_route_registry (
  hub TEXT NOT NULL,
  route_id TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (hub, route_id)
);

INSERT OR IGNORE INTO ms_route_registry(hub, route_id, first_seen_at)
SELECT hub, route_id, MIN(snapshot_at)
FROM ms_route_history
WHERE COALESCE(hub, '') <> '' AND COALESCE(route_id, '') <> ''
GROUP BY hub, route_id;
