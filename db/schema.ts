import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const universe = sqliteTable("universe", {
  id: text("id").primaryKey(),
  ticker: text("ticker").notNull(),
  region: text("region", { enum: ["US", "China/HK"] }).notNull(),
  status: text("status", { enum: ["pending", "approved", "disabled"] }).notNull().default("pending"),
  source: text("source").notNull().default("user"),
  thesis: text("thesis").notNull().default(""),
  citationsJson: text("citations_json").notNull().default("[]"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("universe_ticker_idx").on(table.ticker)]);

export const marketCache = sqliteTable("market_cache", {
  ticker: text("ticker").primaryKey(),
  asOf: text("as_of").notNull(),
  payloadJson: text("payload_json").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const committeeRuns = sqliteTable("committee_runs", {
  id: text("id").primaryKey(),
  forecastWeek: text("forecast_week").notNull(),
  trigger: text("trigger", { enum: ["manual", "scheduled"] }).notNull(),
  profile: text("profile", { enum: ["flash", "think", "pro"] }).notNull(),
  status: text("status", { enum: ["running", "completed", "failed", "frozen"] }).notNull(),
  dataAsOf: text("data_as_of"),
  dataStale: integer("data_stale", { mode: "boolean" }).notNull().default(false),
  marketJson: text("market_json").notNull().default("{}"),
  finalJson: text("final_json").notNull().default("{}"),
  error: text("error"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  completedAt: text("completed_at"),
}, (table) => [
  uniqueIndex("committee_forecast_week_idx").on(table.forecastWeek),
  index("committee_created_idx").on(table.createdAt),
]);

export const opinions = sqliteTable("opinions", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  role: text("role").notNull(),
  model: text("model").notNull(),
  payloadJson: text("payload_json").notNull(),
  scoreJson: text("score_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("opinions_run_idx").on(table.runId)]);

export const decisions = sqliteTable("decisions", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  mode: text("mode", { enum: ["Balanced", "Attach", "Lockdown"] }).notNull(),
  stockPct: real("stock_pct").notNull(),
  cashPct: real("cash_pct").notNull(),
  usSleevePct: real("us_sleeve_pct").notNull(),
  chinaSleevePct: real("china_sleeve_pct").notNull(),
  riskOpinion: text("risk_opinion").notNull(),
  rationale: text("rationale").notNull(),
  citationsJson: text("citations_json").notNull().default("[]"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("decisions_run_idx").on(table.runId)]);

export const paperPositions = sqliteTable("paper_positions", {
  ticker: text("ticker").primaryKey(),
  region: text("region").notNull(),
  weightPct: real("weight_pct").notNull(),
  lastPrice: real("last_price"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const paperTransactions = sqliteTable("paper_transactions", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  ticker: text("ticker").notNull(),
  region: text("region").notNull(),
  oldWeightPct: real("old_weight_pct").notNull(),
  newWeightPct: real("new_weight_pct").notNull(),
  tradeWeightPct: real("trade_weight_pct").notNull(),
  referencePrice: real("reference_price"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("transactions_run_idx").on(table.runId)]);

export const navHistory = sqliteTable("nav_history", {
  id: text("id").primaryKey(),
  valuationDate: text("valuation_date").notNull(),
  nav: real("nav").notNull(),
  cashWeightPct: real("cash_weight_pct").notNull(),
  mode: text("mode").notNull(),
  runId: text("run_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("nav_date_idx").on(table.valuationDate)]);

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  agent: text("agent").notNull(),
  profile: text("profile").notNull(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  citationsJson: text("citations_json").notNull().default("[]"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("chat_session_idx").on(table.sessionId, table.createdAt)]);

export const fundModifications = sqliteTable("fund_modifications", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  value: text("value").notNull().default(""),
  ticker: text("ticker"),
  note: text("note").notNull().default(""),
  source: text("source", { enum: ["manual", "committee"] }).notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const humanApprovals = sqliteTable("human_approvals", {
  runId: text("run_id").primaryKey(),
  status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  proposalJson: text("proposal_json").notNull(),
  decidedBy: text("decided_by"),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
