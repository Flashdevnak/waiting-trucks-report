CREATE TABLE `ms_pairings` (
  `code_hash` text PRIMARY KEY NOT NULL,
  `hub` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text NOT NULL,
  `expires_at` text NOT NULL,
  `status` text NOT NULL DEFAULT 'PENDING',
  `completed_at` text NOT NULL DEFAULT ''
);
CREATE INDEX `ms_pairings_expiry_idx` ON `ms_pairings` (`expires_at`);
CREATE TABLE `ms_connector_tokens` (
  `hub` text PRIMARY KEY NOT NULL,
  `token_hash` text NOT NULL,
  `created_at` text NOT NULL,
  `last_used_at` text NOT NULL DEFAULT '',
  `active` integer NOT NULL DEFAULT 1
);
