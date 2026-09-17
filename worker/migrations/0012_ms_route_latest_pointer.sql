CREATE TABLE IF NOT EXISTS ms_route_latest (
  hub TEXT NOT NULL,
  route_id TEXT NOT NULL,
  history_rowid INTEGER NOT NULL,
  snapshot_at TEXT NOT NULL,
  business_day TEXT,
  PRIMARY KEY (hub, route_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ms_route_latest_hub_day
  ON ms_route_latest(hub, business_day);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS ms_route_latest_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ready INTEGER NOT NULL DEFAULT 0,
  backfilled_at TEXT NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_ms_route_history_latest_pointer
AFTER INSERT ON ms_route_history
WHEN json_valid(NEW.payload_json)=1
BEGIN
  INSERT INTO ms_route_latest(hub, route_id, history_rowid, snapshot_at, business_day)
  VALUES(
    NEW.hub,
    NEW.route_id,
    NEW.rowid,
    NEW.snapshot_at,
    CASE
      WHEN COALESCE(json_extract(NEW.payload_json,'$.attendanceType'),'') LIKE '%ต้นทาง%' THEN
        date(datetime(COALESCE(
          NULLIF(json_extract(NEW.payload_json,'$.estimatedDepartureAt'),''),
          NULLIF(json_extract(NEW.payload_json,'$.actualDepartureAt'),''),
          NULLIF(json_extract(NEW.payload_json,'$.estimatedArrivalAt'),'')
        ), '+7 hours'))
      ELSE
        date(datetime(COALESCE(
          NULLIF(json_extract(NEW.payload_json,'$.estimatedArrivalAt'),''),
          NULLIF(json_extract(NEW.payload_json,'$.actualArrivalAt'),''),
          NULLIF(json_extract(NEW.payload_json,'$.estimatedDepartureAt'),'')
        ), '+7 hours'))
    END
  )
  ON CONFLICT(hub, route_id) DO UPDATE SET
    history_rowid=excluded.history_rowid,
    snapshot_at=excluded.snapshot_at,
    business_day=excluded.business_day
  WHERE excluded.snapshot_at > ms_route_latest.snapshot_at
     OR (excluded.snapshot_at = ms_route_latest.snapshot_at
         AND excluded.history_rowid > ms_route_latest.history_rowid);
END;
--> statement-breakpoint
INSERT INTO ms_route_latest(hub, route_id, history_rowid, snapshot_at, business_day)
SELECT
  r.hub,
  r.route_id,
  h.rowid,
  h.snapshot_at,
  CASE
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
  END
FROM ms_route_registry r
JOIN ms_route_history h
  ON h.rowid = (
    SELECT h2.rowid
    FROM ms_route_history h2 INDEXED BY idx_ms_route_history_hub_route_snapshot
    WHERE h2.hub=r.hub AND h2.route_id=r.route_id
    ORDER BY h2.snapshot_at DESC,h2.rowid DESC
    LIMIT 1
  )
WHERE h.hub=r.hub AND json_valid(h.payload_json)=1
ON CONFLICT(hub, route_id) DO UPDATE SET
  history_rowid=excluded.history_rowid,
  snapshot_at=excluded.snapshot_at,
  business_day=excluded.business_day
WHERE excluded.snapshot_at > ms_route_latest.snapshot_at
   OR (excluded.snapshot_at = ms_route_latest.snapshot_at
       AND excluded.history_rowid > ms_route_latest.history_rowid);
--> statement-breakpoint
INSERT INTO ms_route_latest_meta(id, ready, backfilled_at)
VALUES(1, 1, datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  ready=1,
  backfilled_at=excluded.backfilled_at;
