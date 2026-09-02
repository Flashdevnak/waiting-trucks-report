-- Avoid full-history scans for msArchive/msHistory newest-first reads.
CREATE INDEX IF NOT EXISTS idx_ms_route_history_hub_snapshot
ON ms_route_history(hub, snapshot_at DESC);
