CREATE TABLE `ms_route_history` (
	`history_id` text PRIMARY KEY NOT NULL,
	`route_id` text NOT NULL,
	`hub` text NOT NULL,
	`event_type` text NOT NULL,
	`snapshot_at` text NOT NULL,
	`payload_json` text NOT NULL,
	`synced_by` text NOT NULL
);
