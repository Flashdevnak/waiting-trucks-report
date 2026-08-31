CREATE TABLE `ms_connections` (
	`hub` text PRIMARY KEY NOT NULL,
	`session_cipher` text NOT NULL,
	`device_cipher` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`last_success_at` text,
	`last_error` text
);
