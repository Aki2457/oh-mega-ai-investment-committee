CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`agent` text NOT NULL,
	`profile` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`citations_json` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_session_idx` ON `chat_messages` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `committee_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`forecast_week` text NOT NULL,
	`trigger` text NOT NULL,
	`profile` text NOT NULL,
	`status` text NOT NULL,
	`data_as_of` text,
	`data_stale` integer DEFAULT false NOT NULL,
	`market_json` text DEFAULT '{}' NOT NULL,
	`final_json` text DEFAULT '{}' NOT NULL,
	`error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `committee_forecast_week_idx` ON `committee_runs` (`forecast_week`);--> statement-breakpoint
CREATE INDEX `committee_created_idx` ON `committee_runs` (`created_at`);--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`mode` text NOT NULL,
	`stock_pct` real NOT NULL,
	`cash_pct` real NOT NULL,
	`us_sleeve_pct` real NOT NULL,
	`china_sleeve_pct` real NOT NULL,
	`risk_opinion` text NOT NULL,
	`rationale` text NOT NULL,
	`citations_json` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `decisions_run_idx` ON `decisions` (`run_id`);--> statement-breakpoint
CREATE TABLE `market_cache` (
	`ticker` text PRIMARY KEY NOT NULL,
	`as_of` text NOT NULL,
	`payload_json` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `nav_history` (
	`id` text PRIMARY KEY NOT NULL,
	`valuation_date` text NOT NULL,
	`nav` real NOT NULL,
	`cash_weight_pct` real NOT NULL,
	`mode` text NOT NULL,
	`run_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nav_date_idx` ON `nav_history` (`valuation_date`);--> statement-breakpoint
CREATE TABLE `opinions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`role` text NOT NULL,
	`model` text NOT NULL,
	`payload_json` text NOT NULL,
	`score_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `opinions_run_idx` ON `opinions` (`run_id`);--> statement-breakpoint
CREATE TABLE `paper_positions` (
	`ticker` text PRIMARY KEY NOT NULL,
	`region` text NOT NULL,
	`weight_pct` real NOT NULL,
	`last_price` real,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `paper_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`ticker` text NOT NULL,
	`region` text NOT NULL,
	`old_weight_pct` real NOT NULL,
	`new_weight_pct` real NOT NULL,
	`trade_weight_pct` real NOT NULL,
	`reference_price` real,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `transactions_run_idx` ON `paper_transactions` (`run_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `universe` (
	`id` text PRIMARY KEY NOT NULL,
	`ticker` text NOT NULL,
	`region` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`source` text DEFAULT 'user' NOT NULL,
	`thesis` text DEFAULT '' NOT NULL,
	`citations_json` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `universe_ticker_idx` ON `universe` (`ticker`);