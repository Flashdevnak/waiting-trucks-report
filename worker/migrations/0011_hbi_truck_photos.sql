CREATE TABLE IF NOT EXISTS ms_hbi_connections (
  hub TEXT PRIMARY KEY,
  credentials_cipher TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
