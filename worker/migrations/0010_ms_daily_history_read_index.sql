-- Optimize read-only latest-per-route daily history lookups.
CREATE INDEX IF NOT EXISTS idx_ms_route_history_hub_route_snapshot
ON ms_route_history(hub, route_id, snapshot_at DESC);
