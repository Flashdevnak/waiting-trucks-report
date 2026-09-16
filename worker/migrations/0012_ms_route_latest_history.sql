CREATE TABLE IF NOT EXISTS ms_route_latest_history (
  hub TEXT NOT NULL,
  route_id TEXT NOT NULL,
  history_id TEXT NOT NULL,
  business_day TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (hub, route_id)
);
CREATE INDEX IF NOT EXISTS idx_ms_route_latest_history_hub_day
  ON ms_route_latest_history(hub, business_day);
CREATE TABLE IF NOT EXISTS ms_route_latest_history_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
