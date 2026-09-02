CREATE TABLE IF NOT EXISTS ms_route_cancellations (
  hub TEXT NOT NULL,
  route_id TEXT NOT NULL,
  proof_id TEXT NOT NULL DEFAULT '',
  route_name TEXT NOT NULL DEFAULT '',
  cancelled_at TEXT NOT NULL,
  cancelled_by TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'ยกเลิกเส้นทาง',
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (hub, route_id)
);

CREATE INDEX IF NOT EXISTS idx_ms_route_cancellations_hub_active
  ON ms_route_cancellations(hub, active, cancelled_at DESC);
