CREATE TABLE `active_trucks` (
	`id` text PRIMARY KEY NOT NULL,
	`barcode` text,
	`previous_station` text,
	`route_name` text,
	`driver_name` text,
	`driver_phone` text,
	`vehicle_type` text,
	`plate` text,
	`parcels` integer DEFAULT 0 NOT NULL,
	`arrival_at` text NOT NULL,
	`hub` text NOT NULL,
	`supplier` text,
	`imported_at` text,
	`source_file` text,
	`work_status` text,
	`started_at` text,
	`started_by` text
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` text NOT NULL,
	`action` text NOT NULL,
	`record_id` text,
	`detail` text,
	`operator` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hub_settings` (
	`branch` text NOT NULL,
	`category` text NOT NULL,
	`setting_key` text NOT NULL,
	`label` text,
	`start_hour` real,
	`end_hour` real,
	`minutes` integer,
	`enabled` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	PRIMARY KEY(`branch`, `category`, `setting_key`)
);
--> statement-breakpoint
CREATE TABLE `ms_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`hub` text NOT NULL,
	`proof_id` text,
	`route_name` text,
	`region` text,
	`route_attribute` text,
	`route_type` text,
	`attendance_type` text,
	`estimated_arrival_at` text,
	`actual_arrival_at` text,
	`estimated_departure_at` text,
	`actual_departure_at` text,
	`supplier` text,
	`vehicle_type` text,
	`plate` text,
	`driver_name` text,
	`driver_phone` text,
	`tracking_status` text,
	`vehicle_status` text,
	`load_status` text,
	`source_updated_at` text,
	`synced_at` text NOT NULL,
	`synced_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `truck_history` (
	`history_id` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`barcode` text,
	`previous_station` text,
	`route_name` text,
	`driver_name` text,
	`driver_phone` text,
	`vehicle_type` text,
	`plate` text,
	`parcels` integer DEFAULT 0 NOT NULL,
	`arrival_at` text NOT NULL,
	`hub` text NOT NULL,
	`supplier` text,
	`imported_at` text,
	`source_file` text,
	`work_status` text,
	`started_at` text,
	`started_by` text,
	`status` text NOT NULL,
	`action_at` text NOT NULL,
	`note` text,
	`operator` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`username` text PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`branches` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL
);
