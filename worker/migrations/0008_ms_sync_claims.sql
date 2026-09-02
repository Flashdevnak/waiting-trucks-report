-- Cross-isolate claim used only when a new MS business source hash appears.
-- This prevents duplicate route/history/cache business writes from concurrent Workers
-- without adding a write on steady no-change 4-second polling.
CREATE TABLE IF NOT EXISTS ms_sync_claims (
  hub TEXT PRIMARY KEY NOT NULL,
  source_hash TEXT NOT NULL,
  claim_token TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'ACTIVE',
  lease_until TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  finished_at TEXT NOT NULL DEFAULT ''
);
