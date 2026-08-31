ALTER TABLE `ms_routes` ADD `expected_parcels` integer;
--> statement-breakpoint
ALTER TABLE `ms_routes` ADD `entered_parcels` integer;
--> statement-breakpoint
ALTER TABLE `ms_routes` ADD `pending_parcels` integer;
--> statement-breakpoint
ALTER TABLE `ms_routes` ADD `schedule_kit_arrival_at` text;
--> statement-breakpoint
ALTER TABLE `ms_routes` ADD `schedule_tbr_arrival_at` text;
--> statement-breakpoint
ALTER TABLE `ms_routes` ADD `arrived_parcels` integer;
--> statement-breakpoint
ALTER TABLE `ms_routes` ADD `arrived_bags` integer;
--> statement-breakpoint
CREATE TABLE `ms_preentry_connections` (
  `hub` text PRIMARY KEY NOT NULL,
  `credentials_cipher` text NOT NULL,
  `updated_at` text NOT NULL,
  `updated_by` text NOT NULL,
  `last_success_at` text,
  `last_error` text
);
--> statement-breakpoint
CREATE TABLE `ms_bus_connections` (
  `hub` text PRIMARY KEY NOT NULL,
  `credentials_cipher` text NOT NULL,
  `updated_at` text NOT NULL,
  `updated_by` text NOT NULL,
  `last_success_at` text,
  `last_error` text
);
