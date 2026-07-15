CREATE TABLE IF NOT EXISTS `fund_modifications` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	`ticker` text,
	`note` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `human_approvals` (
	`run_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`proposal_json` text NOT NULL,
	`decided_by` text,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
