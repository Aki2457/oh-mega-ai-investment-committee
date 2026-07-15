import type { Citation, FinalDecision, FundModification, MarketPack, PortfolioProposal, Profile, Region, RiskOpinion } from "@/lib/types";

type D1Row = Record<string, unknown>;
type BoundStatement = {
  bind: (...values: unknown[]) => BoundStatement;
  all: <T = D1Row>() => Promise<{ results: T[] }>;
  first: <T = D1Row>() => Promise<T | null>;
  run: () => Promise<unknown>;
};
type DatabaseBinding = {
  prepare: (query: string) => BoundStatement;
  batch: (statements: BoundStatement[]) => Promise<unknown>;
};

let activeDatabase: DatabaseBinding | null = null;

function sqliteBinding(native: { prepare: (query: string) => { all: (...values: unknown[]) => unknown[]; get: (...values: unknown[]) => unknown; run: (...values: unknown[]) => unknown }; pragma: (query: string) => unknown }): DatabaseBinding {
  native.pragma("journal_mode = WAL");
  return {
    prepare(query) {
      let values: unknown[] = [];
      const statement: BoundStatement = {
        bind(...next) { values = next; return statement; },
        async all<T>() { return { results: native.prepare(query).all(...values) as T[] }; },
        async first<T>() { return (native.prepare(query).get(...values) as T | undefined) ?? null; },
        async run() { return native.prepare(query).run(...values); },
      };
      return statement;
    },
    async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); },
  };
}

async function loadDatabase(): Promise<DatabaseBinding> {
  if (activeDatabase) return activeDatabase;
  if (process.env.SQLITE_PATH) {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const NativeDatabase = require("better-sqlite3") as new (path: string) => Parameters<typeof sqliteBinding>[0];
    activeDatabase = sqliteBinding(new NativeDatabase(process.env.SQLITE_PATH));
    return activeDatabase;
  }
  const { env } = await import("cloudflare:workers");
  const binding = (env as unknown as { DB?: DatabaseBinding }).DB;
  if (!binding) throw new Error("Database binding is unavailable");
  activeDatabase = binding;
  return activeDatabase;
}

function db(): DatabaseBinding {
  if (!activeDatabase) throw new Error("Database has not been initialized");
  return activeDatabase;
}

let initialized: Promise<void> | null = null;

export function ensureDatabase() {
  if (!initialized) {
    initialized = (async () => {
      const d1 = await loadDatabase();
      const statements = [
      `CREATE TABLE IF NOT EXISTS universe (id TEXT PRIMARY KEY, ticker TEXT NOT NULL UNIQUE, region TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', source TEXT NOT NULL DEFAULT 'user', thesis TEXT NOT NULL DEFAULT '', citations_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS market_cache (ticker TEXT PRIMARY KEY, as_of TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS committee_runs (id TEXT PRIMARY KEY, forecast_week TEXT NOT NULL UNIQUE, trigger TEXT NOT NULL, profile TEXT NOT NULL, status TEXT NOT NULL, data_as_of TEXT, data_stale INTEGER NOT NULL DEFAULT 0, market_json TEXT NOT NULL DEFAULT '{}', final_json TEXT NOT NULL DEFAULT '{}', error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT)`,
      `CREATE TABLE IF NOT EXISTS opinions (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, role TEXT NOT NULL, model TEXT NOT NULL, payload_json TEXT NOT NULL, score_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE INDEX IF NOT EXISTS opinions_run_idx ON opinions(run_id)`,
      `CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE, mode TEXT NOT NULL, stock_pct REAL NOT NULL, cash_pct REAL NOT NULL, us_sleeve_pct REAL NOT NULL, china_sleeve_pct REAL NOT NULL, risk_opinion TEXT NOT NULL, rationale TEXT NOT NULL, citations_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS paper_positions (ticker TEXT PRIMARY KEY, region TEXT NOT NULL, weight_pct REAL NOT NULL, last_price REAL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS paper_transactions (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, ticker TEXT NOT NULL, region TEXT NOT NULL, old_weight_pct REAL NOT NULL, new_weight_pct REAL NOT NULL, trade_weight_pct REAL NOT NULL, reference_price REAL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE INDEX IF NOT EXISTS transactions_run_idx ON paper_transactions(run_id)`,
      `CREATE TABLE IF NOT EXISTS nav_history (id TEXT PRIMARY KEY, valuation_date TEXT NOT NULL UNIQUE, nav REAL NOT NULL, cash_weight_pct REAL NOT NULL, mode TEXT NOT NULL, run_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS chat_messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, agent TEXT NOT NULL, profile TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, citations_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE INDEX IF NOT EXISTS chat_session_idx ON chat_messages(session_id, created_at)`,
      `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS fund_modifications (id TEXT PRIMARY KEY, type TEXT NOT NULL, value TEXT NOT NULL DEFAULT '', ticker TEXT, note TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS human_approvals (run_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending', proposal_json TEXT NOT NULL, decided_by TEXT, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      ];
      await d1.batch(statements.map((statement) => d1.prepare(statement)));
      await d1.prepare("INSERT INTO nav_history (id, valuation_date, nav, cash_weight_pct, mode) VALUES (?, ?, 100, 100, 'Cash') ON CONFLICT(id) DO NOTHING")
        .bind("initial-nav", "2026-01-01").run();
    })();
  }
  return initialized;
}

function parseJson<T>(value: unknown, fallback: T): T {
  try { return value ? JSON.parse(String(value)) as T : fallback; } catch { return fallback; }
}

export async function listUniverse() {
  await ensureDatabase();
  const result = await db().prepare("SELECT * FROM universe ORDER BY status, region, ticker").all<D1Row>();
  return result.results.map((row) => ({
    id: String(row.id), ticker: String(row.ticker), region: row.region as Region,
    status: String(row.status), source: String(row.source), thesis: String(row.thesis),
    citations: parseJson<Citation[]>(row.citations_json, []), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }));
}

export async function upsertUniverse(input: { ticker: string; region: Region; status?: string; source?: string; thesis?: string; citations?: Citation[] }) {
  await ensureDatabase();
  const ticker = input.ticker.trim().toUpperCase();
  await db().prepare(`INSERT INTO universe (id, ticker, region, status, source, thesis, citations_json) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ticker) DO UPDATE SET region=excluded.region, status=excluded.status, source=excluded.source, thesis=excluded.thesis, citations_json=excluded.citations_json, updated_at=CURRENT_TIMESTAMP`)
    .bind(crypto.randomUUID(), ticker, input.region, input.status ?? "pending", input.source ?? "user", input.thesis ?? "", JSON.stringify(input.citations ?? [])).run();
  return (await listUniverse()).find((item) => item.ticker === ticker)!;
}

export async function updateUniverse(ticker: string, updates: { status?: string; thesis?: string; region?: Region }) {
  await ensureDatabase();
  const current = (await listUniverse()).find((item) => item.ticker === ticker.toUpperCase());
  if (!current) throw new Error("Ticker not found");
  await db().prepare("UPDATE universe SET region=?, status=?, thesis=?, updated_at=CURRENT_TIMESTAMP WHERE ticker=?")
    .bind(updates.region ?? current.region, updates.status ?? current.status, updates.thesis ?? current.thesis, current.ticker).run();
  return (await listUniverse()).find((item) => item.ticker === current.ticker)!;
}

export async function deleteUniverse(ticker: string) {
  await ensureDatabase();
  await db().prepare("DELETE FROM universe WHERE ticker=?").bind(ticker.toUpperCase()).run();
}

export async function getMarketCache(ticker: string) {
  await ensureDatabase();
  const row = await db().prepare("SELECT * FROM market_cache WHERE ticker=?").bind(ticker).first<D1Row>();
  return row ? { asOf: String(row.as_of), payload: parseJson(row.payload_json, {}) } : null;
}

export async function setMarketCache(ticker: string, asOf: string, payload: unknown) {
  await ensureDatabase();
  await db().prepare(`INSERT INTO market_cache (ticker, as_of, payload_json) VALUES (?, ?, ?)
    ON CONFLICT(ticker) DO UPDATE SET as_of=excluded.as_of, payload_json=excluded.payload_json, updated_at=CURRENT_TIMESTAMP`)
    .bind(ticker, asOf, JSON.stringify(payload)).run();
}

export async function findRunByWeek(forecastWeek: string) {
  await ensureDatabase();
  const row = await db().prepare("SELECT * FROM committee_runs WHERE forecast_week=?").bind(forecastWeek).first<D1Row>();
  return row ? mapRun(row) : null;
}

export async function createRun(input: { id: string; forecastWeek: string; trigger: string; profile: Profile }) {
  await ensureDatabase();
  await db().prepare("INSERT INTO committee_runs (id, forecast_week, trigger, profile, status) VALUES (?, ?, ?, ?, 'running')")
    .bind(input.id, input.forecastWeek, input.trigger, input.profile).run();
}

export async function restartRun(id: string, trigger: string, profile: Profile) {
  await ensureDatabase();
  await db().batch([
    db().prepare("DELETE FROM opinions WHERE run_id=?").bind(id),
    db().prepare("UPDATE committee_runs SET trigger=?, profile=?, status='running', error=NULL, completed_at=NULL WHERE id=? AND status IN ('failed', 'running')")
      .bind(trigger, profile, id),
  ]);
}

export async function completeRun(id: string, pack: MarketPack, final: FinalDecision, status: "completed" | "frozen" = "completed") {
  await ensureDatabase();
  await db().prepare("UPDATE committee_runs SET status=?, data_as_of=?, data_stale=?, market_json=?, final_json=?, completed_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(status, pack.dataAsOf, pack.stale ? 1 : 0, JSON.stringify(pack), JSON.stringify(final), id).run();
}

export async function failRun(id: string, error: string) {
  await ensureDatabase();
  await db().prepare("UPDATE committee_runs SET status='failed', error=?, completed_at=CURRENT_TIMESTAMP WHERE id=?").bind(error, id).run();
}

export async function saveOpinion(runId: string, role: string, model: string, payload: unknown, score: unknown = {}) {
  await ensureDatabase();
  await db().prepare("INSERT INTO opinions (id, run_id, role, model, payload_json, score_json) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), runId, role, model, JSON.stringify(payload), JSON.stringify(score)).run();
}

export async function saveDecision(runId: string, final: FinalDecision, proposal: PortfolioProposal, risk: RiskOpinion) {
  await ensureDatabase();
  await db().prepare(`INSERT OR REPLACE INTO decisions (id, run_id, mode, stock_pct, cash_pct, us_sleeve_pct, china_sleeve_pct, risk_opinion, rationale, citations_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), runId, proposal.mode, proposal.stockPct, proposal.cashPct, proposal.usSleevePct, proposal.chinaSleevePct, risk.opinion, final.rationale, JSON.stringify(final.citations)).run();
  await savePendingApproval(runId, proposal);
}

export async function savePendingApproval(runId: string, proposal: PortfolioProposal) {
  await ensureDatabase();
  await db().prepare(`INSERT INTO human_approvals (run_id, status, proposal_json) VALUES (?, 'pending', ?)
    ON CONFLICT(run_id) DO UPDATE SET proposal_json=CASE WHEN human_approvals.status='pending' THEN excluded.proposal_json ELSE human_approvals.proposal_json END, updated_at=CURRENT_TIMESTAMP`)
    .bind(runId, JSON.stringify(proposal)).run();
}

function validateHumanProposal(proposal: PortfolioProposal) {
  const total = proposal.stockPct + proposal.cashPct;
  if (proposal.cashPct < 25 || proposal.stockPct > 75) throw new Error("Safety control failed: every investable mode must retain at least 25% cash");
  if (Math.abs(total - 100) > 0.01) throw new Error("Safety control failed: proposal weights do not total 100%");
  if (proposal.positions.some((position) => position.weightPct < 0 || position.weightPct > 10)) throw new Error("Safety control failed: single-stock weight exceeds the 10% cap");
}

export async function decideHumanApproval(input: { runId: string; action: "approve" | "reject"; decidedBy: string; note?: string }) {
  await ensureDatabase();
  const row = await db().prepare("SELECT * FROM human_approvals WHERE run_id=?").bind(input.runId).first<D1Row>();
  if (!row) throw new Error("No proposal is waiting for Human approval");
  const currentStatus = String(row.status);
  if (currentStatus !== "pending") return { runId: input.runId, status: currentStatus, decidedBy: row.decided_by, note: row.note };
  if (input.action === "reject") {
    await db().prepare("UPDATE human_approvals SET status='rejected', decided_by=?, note=?, updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND status='pending'")
      .bind(input.decidedBy, input.note ?? "", input.runId).run();
    return { runId: input.runId, status: "rejected", decidedBy: input.decidedBy, note: input.note ?? "" };
  }
  const proposal = parseJson<PortfolioProposal>(row.proposal_json, {} as PortfolioProposal);
  validateHumanProposal(proposal);
  await rebalancePaper(input.runId, proposal);
  await replaceCommitteeModifications(proposal.mode, proposal.stockPct, `Human approved: ${input.note ?? "No note"}`);
  await db().prepare("UPDATE human_approvals SET status='approved', decided_by=?, note=?, updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND status='pending'")
    .bind(input.decidedBy, input.note ?? "", input.runId).run();
  return { runId: input.runId, status: "approved", decidedBy: input.decidedBy, note: input.note ?? "", proposal };
}

export async function rebalancePaper(runId: string, proposal: PortfolioProposal) {
  await ensureDatabase();
  const d1 = db();
  const priorApplication = await d1.prepare("SELECT run_id FROM nav_history WHERE run_id=? UNION SELECT run_id FROM paper_transactions WHERE run_id=? LIMIT 1")
    .bind(runId, runId).first<D1Row>();
  if (priorApplication) return;
  const existing = await d1.prepare("SELECT * FROM paper_positions").all<D1Row>();
  const previousNavRow = await d1.prepare("SELECT nav FROM nav_history ORDER BY valuation_date DESC LIMIT 1").first<D1Row>();
  const previousNav = Number(previousNavRow?.nav ?? 100);
  const portfolioReturn = existing.results.reduce((sum, row) => {
    const oldPrice = Number(row.last_price ?? 0);
    const currentPrice = proposal.referencePrices[String(row.ticker)] ?? oldPrice;
    return sum + (Number(row.weight_pct) / 100) * (oldPrice > 0 ? currentPrice / oldPrice - 1 : 0);
  }, 0);
  const nextNav = previousNav * (1 + portfolioReturn);
  const old = new Map(existing.results.map((row) => [String(row.ticker), Number(row.weight_pct)]));
  const next = new Map(proposal.positions.map((position) => [position.ticker, position]));
  const tickers = new Set([...old.keys(), ...next.keys()]);
  const statements: BoundStatement[] = [];
  for (const ticker of tickers) {
    const position = next.get(ticker);
    const oldWeight = old.get(ticker) ?? 0;
    const newWeight = position?.weightPct ?? 0;
    statements.push(d1.prepare("INSERT INTO paper_transactions (id, run_id, ticker, region, old_weight_pct, new_weight_pct, trade_weight_pct, reference_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), runId, ticker, position?.region ?? "Unknown", oldWeight, newWeight, newWeight - oldWeight, position?.referencePrice ?? null));
    if (position && newWeight > 0) {
      statements.push(d1.prepare(`INSERT INTO paper_positions (ticker, region, weight_pct, last_price) VALUES (?, ?, ?, ?)
        ON CONFLICT(ticker) DO UPDATE SET region=excluded.region, weight_pct=excluded.weight_pct, last_price=excluded.last_price, updated_at=CURRENT_TIMESTAMP`)
        .bind(ticker, position.region, newWeight, position.referencePrice));
    } else {
      statements.push(d1.prepare("DELETE FROM paper_positions WHERE ticker=?").bind(ticker));
    }
  }
  const valuationDate = new Date().toISOString().slice(0, 10);
  statements.push(d1.prepare(`INSERT INTO nav_history (id, valuation_date, nav, cash_weight_pct, mode, run_id) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(valuation_date) DO UPDATE SET nav=excluded.nav, cash_weight_pct=excluded.cash_weight_pct, mode=excluded.mode, run_id=excluded.run_id`)
    .bind(crypto.randomUUID(), valuationDate, nextNav, proposal.cashPct, proposal.mode, runId));
  await d1.batch(statements);
}

export async function getPaperPositionTickers() {
  await ensureDatabase();
  const result = await db().prepare("SELECT ticker, region FROM paper_positions").all<D1Row>();
  return result.results.map((row) => ({ ticker: String(row.ticker), region: row.region as Region }));
}

export async function saveCandidates(candidates: Array<{ ticker: string; region: Region; reason: string; citations: Citation[] }>) {
  for (const candidate of candidates) {
    if (/^[A-Z0-9.^=-]{1,15}$/.test(candidate.ticker)) {
      await upsertUniverse({ ticker: candidate.ticker, region: candidate.region, status: "pending", source: "ai-candidate", thesis: candidate.reason, citations: candidate.citations });
    }
  }
}

export async function listRuns(limit = 20) {
  await ensureDatabase();
  const result = await db().prepare("SELECT * FROM committee_runs ORDER BY created_at DESC LIMIT ?").bind(limit).all<D1Row>();
  return Promise.all(result.results.map(async (row) => {
    const run = mapRun(row);
    const opinionRows = await db().prepare("SELECT * FROM opinions WHERE run_id=? ORDER BY created_at ASC").bind(run.id).all<D1Row>();
    return {
      ...run,
      opinions: opinionRows.results.map((opinion) => ({
        id: String(opinion.id), role: String(opinion.role), model: String(opinion.model),
        payload: parseJson<Record<string, unknown>>(opinion.payload_json, {}),
        score: parseJson<Record<string, unknown>>(opinion.score_json, {}), createdAt: String(opinion.created_at),
      })),
    };
  }));
}

function mapRun(row: D1Row) {
  return {
    id: String(row.id), forecastWeek: String(row.forecast_week), trigger: String(row.trigger), profile: String(row.profile), status: String(row.status),
    dataAsOf: row.data_as_of ? String(row.data_as_of) : null, dataStale: Boolean(row.data_stale), market: parseJson(row.market_json, {}),
    final: parseJson(row.final_json, {}), error: row.error ? String(row.error) : null, createdAt: String(row.created_at), completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

export async function getPortfolio() {
  await ensureDatabase();
  const [positions, transactions, nav, decisionsRows, approvals] = await Promise.all([
    db().prepare("SELECT * FROM paper_positions ORDER BY weight_pct DESC").all<D1Row>(),
    db().prepare("SELECT * FROM paper_transactions ORDER BY created_at DESC LIMIT 50").all<D1Row>(),
    db().prepare("SELECT * FROM nav_history ORDER BY valuation_date ASC").all<D1Row>(),
    db().prepare("SELECT * FROM decisions ORDER BY created_at DESC LIMIT 20").all<D1Row>(),
    db().prepare("SELECT * FROM human_approvals ORDER BY created_at DESC LIMIT 20").all<D1Row>(),
  ]);
  return {
    positions: positions.results.map((row) => ({ ticker: row.ticker, region: row.region, weightPct: Number(row.weight_pct), lastPrice: row.last_price == null ? null : Number(row.last_price) })),
    transactions: transactions.results.map((row) => ({ id: row.id, runId: row.run_id, ticker: row.ticker, region: row.region, oldWeightPct: Number(row.old_weight_pct), newWeightPct: Number(row.new_weight_pct), tradeWeightPct: Number(row.trade_weight_pct), createdAt: row.created_at })),
    nav: nav.results.map((row) => ({ date: row.valuation_date, nav: Number(row.nav), cashWeightPct: Number(row.cash_weight_pct), mode: row.mode, runId: row.run_id })),
    decisions: decisionsRows.results.map((row) => ({ id: row.id, runId: row.run_id, mode: row.mode, stockPct: Number(row.stock_pct), cashPct: Number(row.cash_pct), usSleevePct: Number(row.us_sleeve_pct), chinaSleevePct: Number(row.china_sleeve_pct), riskOpinion: row.risk_opinion, rationale: row.rationale, citations: parseJson(row.citations_json, []), createdAt: row.created_at })),
    approvals: approvals.results.map((row) => ({ runId: row.run_id, status: row.status, proposal: parseJson(row.proposal_json, {}), decidedBy: row.decided_by, note: row.note, createdAt: row.created_at, updatedAt: row.updated_at })),
  };
}

export async function listModifications(activeOnly = false): Promise<FundModification[]> {
  await ensureDatabase();
  const result = await db().prepare(`SELECT * FROM fund_modifications ${activeOnly ? "WHERE active=1" : ""} ORDER BY created_at DESC`).all<D1Row>();
  return result.results.map((row) => ({ id: String(row.id), type: row.type as FundModification["type"], value: String(row.value ?? ""), ticker: row.ticker ? String(row.ticker) : null, note: String(row.note ?? ""), source: row.source as FundModification["source"], active: Boolean(row.active), createdAt: String(row.created_at) }));
}

export async function addModification(input: Omit<FundModification, "id" | "active" | "createdAt">) {
  await ensureDatabase();
  const id = crypto.randomUUID();
  await db().prepare("INSERT INTO fund_modifications (id,type,value,ticker,note,source,active) VALUES (?,?,?,?,?,?,1)")
    .bind(id, input.type, input.value, input.ticker?.toUpperCase() ?? null, input.note, input.source).run();
  return (await listModifications()).find((item) => item.id === id)!;
}

export async function disableModification(id: string) {
  await ensureDatabase();
  await db().prepare("UPDATE fund_modifications SET active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run();
}

export async function replaceCommitteeModifications(mode: FinalDecision["mode"], stockPct: number, note: string) {
  await ensureDatabase();
  await db().batch([
    db().prepare("UPDATE fund_modifications SET active=0, updated_at=CURRENT_TIMESTAMP WHERE source='committee' AND active=1"),
    db().prepare("INSERT INTO fund_modifications (id,type,value,note,source,active) VALUES (?,?,?,?, 'committee',1)").bind(crypto.randomUUID(), "gear", mode, note),
    db().prepare("INSERT INTO fund_modifications (id,type,value,note,source,active) VALUES (?,?,?,?, 'committee',1)").bind(crypto.randomUUID(), "stock_allocation", String(stockPct), "Weekly committee stock allocation"),
  ]);
}

export async function saveChatMessage(input: { sessionId: string; agent: string; profile: Profile; role: "user" | "assistant"; content: string; citations?: Citation[] }) {
  await ensureDatabase();
  await db().prepare("INSERT INTO chat_messages (id, session_id, agent, profile, role, content, citations_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), input.sessionId, input.agent, input.profile, input.role, input.content, JSON.stringify(input.citations ?? [])).run();
}

export async function getChatHistory(sessionId: string, limit = 12) {
  await ensureDatabase();
  const result = await db().prepare("SELECT * FROM chat_messages WHERE session_id=? ORDER BY created_at DESC LIMIT ?").bind(sessionId, limit).all<D1Row>();
  return result.results.reverse().map((row) => ({ role: row.role as "user" | "assistant", content: String(row.content) }));
}
