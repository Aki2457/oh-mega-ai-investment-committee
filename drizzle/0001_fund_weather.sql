CREATE TABLE IF NOT EXISTS `fund_modifications` (
  `id` text PRIMARY KEY NOT NULL,
  `type` text NOT NULL,
  `value` text DEFAULT '' NOT NULL,
  `ticker` text,
  `note` text DEFAULT '' NOT NULL,
  `source` text NOT NULL,
  `active` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
