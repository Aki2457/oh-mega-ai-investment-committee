"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Mode = "Balanced" | "Attach" | "Lockdown";
type Page = "command" | "research" | "ledger";
type Agent = "decision" | "risk" | "ceo";

type Approval = {
  runId: string;
  status: "pending" | "approved" | "rejected";
  decidedBy?: string | null;
  note?: string;
  proposal?: { mode?: Mode; stockPct?: number; cashPct?: number; positions?: Position[] };
};

type Position = { ticker: string; region: string; weightPct: number; lastPrice?: number | null };
type Decision = { runId: string; mode: Mode; stockPct: number; cashPct: number; riskOpinion: string; rationale: string; createdAt: string };
type Run = {
  id: string;
  status: string;
  dataAsOf?: string | null;
  dataStale?: boolean;
  final?: {
    mode?: Mode;
    confidence?: number;
    rationale?: string;
    riskOverrideRationale?: string;
    stockViews?: Array<{ ticker: string; upProbability: number; expectedReturnPct: number }>;
    citations?: Array<{ url: string; title: string }>;
  };
  opinions?: Array<{ role: string; payload?: { opinion?: string; rationale?: string; concerns?: string[] } }>;
};

type Portfolio = {
  positions: Position[];
  decisions: Decision[];
  approvals: Approval[];
  nav: Array<{ date: string; nav: number; cashWeightPct: number; mode: string }>;
};

const modes: Array<{ id: Mode; target: string; cash: number; description: string; rule: string }> = [
  { id: "Balanced", target: "50 / 50", cash: 50, description: "Default state for mixed evidence and steady participation.", rule: "Diversified, long-only, measured position sizes." },
  { id: "Attach", target: "75 / 25", cash: 25, description: "Attach capital to the strongest verified signals with higher conviction.", rule: "Requires stronger evidence and Risk support." },
  { id: "Lockdown", target: "0 / 100", cash: 100, description: "Freeze new exposure when evidence is stale, weak, or unsafe.", rule: "No stock allocation. Cash only." },
];

const committee = [
  { role: "Decision", mark: "D", copy: "Combines market features with current web evidence and proposes probabilities." },
  { role: "Risk", mark: "R", copy: "Challenges concentration, stale data, liquidity, volatility, and false confidence." },
  { role: "CEO", mark: "C", copy: "Main AI judge. Resolves disagreements and prepares one recommendation." },
  { role: "Human", mark: "H", copy: "You approve or reject. This is the only role allowed to change the paper portfolio." },
];

function safeMode(value: unknown): Mode {
  return value === "Attach" || value === "Lockdown" ? value : "Balanced";
}

function percent(value: unknown, digits = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? `${(number * 100).toFixed(digits)}%` : "Pending";
}

function formatDate(value: unknown) {
  if (!value) return "Awaiting run";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" });
}

export function ResearchChat() {
  const [page, setPage] = useState<Page>("command");
  const [portfolio, setPortfolio] = useState<Portfolio>({ positions: [], decisions: [], approvals: [], nav: [] });
  const [runs, setRuns] = useState<Run[]>([]);
  const [universe, setUniverse] = useState<Array<{ ticker: string; region: string; status: string }>>([]);
  const [system, setSystem] = useState({ openRouter: false, yahoo: false, persistence: false, simulatedOnly: true });
  const [weather, setWeather] = useState({ mode: "Balanced" as Mode, stockPct: 50, cashPct: 50, halted: false });
  const [draftMode, setDraftMode] = useState<Mode>("Balanced");
  const [running, setRunning] = useState(false);
  const [runStage, setRunStage] = useState("Ready for the next committee review");
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [approvalNote, setApprovalNote] = useState("");
  const [agent, setAgent] = useState<Agent>("decision");
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [citations, setCitations] = useState<Array<{ url: string; title: string }>>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const requests = await Promise.allSettled([
      fetch("/api/portfolio", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/committee/history?limit=20", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/universe", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/status", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/weather", { cache: "no-store" }).then((response) => response.json()),
    ]);
    if (requests[0].status === "fulfilled" && !requests[0].value.error) setPortfolio(requests[0].value);
    if (requests[1].status === "fulfilled") setRuns(requests[1].value.runs ?? []);
    if (requests[2].status === "fulfilled") setUniverse(requests[2].value.universe ?? []);
    if (requests[3].status === "fulfilled") setSystem(requests[3].value);
    if (requests[4].status === "fulfilled" && !requests[4].value.error) {
      const next = { ...requests[4].value, mode: safeMode(requests[4].value.mode) };
      setWeather(next);
      setDraftMode(next.mode);
    }
  }

  useEffect(() => { load().catch(() => setError("The live fund state could not be loaded.")); }, []);

  const latestRun = runs[0];
  const latestDecision = portfolio.decisions[0];
  const latestApproval = portfolio.approvals[0];
  const pendingApproval = portfolio.approvals.find((item) => item.status === "pending");
  const activeMode = safeMode(weather.mode ?? latestDecision?.mode);
  const activeCash = Number(weather.cashPct ?? latestDecision?.cashPct ?? 100);
  const activeStock = Math.max(0, 100 - activeCash);
  const latestNav = portfolio.nav.at(-1)?.nav ?? 100;
  const approvedCount = universe.filter((item) => item.status === "approved").length;
  const riskOpinion = latestRun?.opinions?.find((item) => item.role === "Risk Agent")?.payload;
  const predictions = latestRun?.final?.stockViews ?? [];
  const cashSafe = activeCash >= 25;
  const systemsReady = system.yahoo && system.persistence;

  const decisionFlow = useMemo(() => {
    const status = pendingApproval ? "Human review" : latestApproval?.status === "approved" ? "Approved" : latestApproval?.status === "rejected" ? "Rejected" : "Awaiting committee";
    return [
      { label: "Decision", state: latestRun ? "Complete" : "Waiting" },
      { label: "Risk", state: riskOpinion ? "Complete" : "Waiting" },
      { label: "CEO", state: latestRun?.final?.mode ? "Complete" : "Waiting" },
      { label: "Human", state: status },
    ];
  }, [latestRun, latestApproval, pendingApproval, riskOpinion]);

  async function runCommittee() {
    setRunning(true);
    setError("");
    setRunStage("Loading market data");
    try {
      const response = await fetch("/api/committee/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trigger: "manual", profile: "think", requestedMode: draftMode }),
      });
      if (!response.ok || !response.body) throw new Error("The committee could not start.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const block of events) {
          const line = block.split("\n").find((item) => item.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6));
          setRunStage(event.message ?? event.stage);
          if (event.stage === "error") throw new Error(event.message);
        }
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The committee run failed.");
    } finally {
      setRunning(false);
    }
  }

  async function decide(action: "approve" | "reject") {
    if (!pendingApproval) return;
    setApprovalBusy(true);
    setError("");
    try {
      const response = await fetch("/api/committee/approval", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: pendingApproval.runId, action, note: approvalNote }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "The Human decision could not be recorded.");
      setApprovalNote("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Human decision could not be recorded.");
    } finally {
      setApprovalBusy(false);
    }
  }

  async function askCommittee(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setAnswer("");
    setCitations([]);
    setError("");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "virtual-fund-web", agent, message: query.trim() }),
      });
      if (!response.ok || !response.body) throw new Error("Web research is unavailable.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completeText = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const block of events) {
          const line = block.split("\n").find((item) => item.startsWith("data: "));
          if (!line) continue;
          const item = JSON.parse(line.slice(6));
          if (item.type === "delta") setAnswer((current) => current + item.text);
          if (item.type === "complete") {
            completeText = item.text;
            setAnswer(item.text);
            setCitations(item.citations ?? []);
          }
          if (item.type === "error") throw new Error(item.message);
        }
      }
      if (!completeText && !answer) setAnswer("The committee returned no answer.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Web research is unavailable.");
    } finally {
      setSearching(false);
    }
  }

  function CommandPage() {
    return <>
      <section className="hero-grid">
        <div className="hero-copy">
          <p className="eyebrow">VIRTUAL FUND CONTROL ROOM</p>
          <h2>One recommendation.<br /><span>Four layers of control.</span></h2>
          <p>AI forecasts the next-week direction, checks current web evidence, and presents a paper allocation. You make the final decision.</p>
          <div className="hero-actions">
            <button className="primary-button" onClick={runCommittee} disabled={running || !systemsReady}>{running ? "Committee working" : "Run committee"}</button>
            <button className="quiet-button" onClick={() => setPage("research")}>Search with AI</button>
          </div>
          <div className="run-status"><i className={running ? "pulse" : ""} /><span>{runStage}</span></div>
        </div>
        <div className="fund-orbit" aria-label={`Current allocation is ${activeStock.toFixed(0)} percent stocks and ${activeCash.toFixed(0)} percent cash`}>
          <div className="orbit-ring"><div className="orbit-core"><span>VIRTUAL NAV</span><strong>{latestNav.toFixed(2)}</strong><small>{activeMode} mode</small></div></div>
          <div className="allocation-split"><span><i className="stock-dot" />Stocks <b>{activeStock.toFixed(0)}%</b></span><span><i className="cash-dot" />Cash <b>{activeCash.toFixed(0)}%</b></span></div>
        </div>
      </section>

      <section className="safety-row" aria-label="Hard safety controls">
        <div><span className={cashSafe ? "safe" : "alert"}>{cashSafe ? "✓" : "!"}</span><p><strong>Cash reserve protected</strong><small>At least 25% cash in every investable mode</small></p></div>
        <div><span className="safe">✓</span><p><strong>Paper fund only</strong><small>No broker connection and no real-money execution</small></p></div>
        <div><span className="safe">✓</span><p><strong>Human approval gate</strong><small>No simulated rebalance before your decision</small></p></div>
        <div><span className="safe">✓</span><p><strong>Long-only controls</strong><small>No leverage, no shorts, 10% single-stock cap</small></p></div>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">THREE OPERATING MODES</p><h3>Choose the posture for the next review</h3></div><span>Selection is a review preference. The committee still needs evidence.</span></div>
        <div className="mode-grid">{modes.map((mode) => <button key={mode.id} className={`mode-card mode-${mode.id.toLowerCase()} ${draftMode === mode.id ? "selected" : ""}`} onClick={() => setDraftMode(mode.id)}>
          <div className="mode-top"><span>{mode.id.slice(0, 1)}</span><small>{draftMode === mode.id ? "SELECTED" : "MODE"}</small></div>
          <h4>{mode.id}</h4><p>{mode.description}</p>
          <div className="mode-target"><b>{mode.target}</b><span>stocks / cash</span></div>
          <small className="mode-rule">{mode.rule}</small>
        </button>)}</div>
      </section>

      <section className="committee-layout">
        <div className="committee-panel">
          <div className="section-heading compact"><div><p className="eyebrow">INVESTMENT COMMITTEE</p><h3>Evidence moves through four gates</h3></div><span>CEO is the main AI. Human is final.</span></div>
          <div className="committee-chain">{committee.map((member, index) => <article key={member.role} className={member.role === "Human" ? "human" : ""}>
            <div className="member-mark">{member.mark}</div><div><span>0{index + 1}</span><h4>{member.role}</h4><p>{member.copy}</p><small>{decisionFlow[index].state}</small></div>
          </article>)}</div>
        </div>
        <div className={`approval-panel ${pendingApproval ? "pending" : ""}`}>
          <p className="eyebrow">HUMAN CHECKPOINT</p>
          {pendingApproval ? <>
            <h3>Recommendation ready</h3>
            <div className="approval-mode"><span>{safeMode(pendingApproval.proposal?.mode)}</span><strong>{Number(pendingApproval.proposal?.stockPct ?? 0).toFixed(0)}% stocks</strong><small>{Number(pendingApproval.proposal?.cashPct ?? 100).toFixed(0)}% cash</small></div>
            <p>Review the CEO rationale and Risk opinion before changing the paper portfolio.</p>
            <label><span>Decision note</span><textarea value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)} placeholder="Record why you approve or reject" /></label>
            <div className="approval-actions"><button onClick={() => decide("approve")} disabled={approvalBusy}>Approve paper allocation</button><button onClick={() => decide("reject")} disabled={approvalBusy}>Reject</button></div>
          </> : <>
            <h3>{latestApproval?.status === "approved" ? "Latest allocation approved" : latestApproval?.status === "rejected" ? "Latest proposal rejected" : "Waiting for a recommendation"}</h3>
            <div className="approval-empty"><span>{latestApproval?.status === "approved" ? "✓" : latestApproval?.status === "rejected" ? "×" : "H"}</span></div>
            <p>{latestApproval?.status === "approved" ? "The approved paper allocation passed the cash floor and position caps." : latestApproval?.status === "rejected" ? "The paper portfolio was left unchanged." : "Run the committee to prepare an evidence-backed recommendation."}</p>
          </>}
        </div>
      </section>
    </>;
  }

  function ResearchPage() {
    return <>
      <section className="page-intro"><p className="eyebrow">AI RESEARCH DESK</p><h2>Search current evidence.<br /><span>Keep forecasts accountable.</span></h2><p>The Decision, Risk, and CEO agents can search the web. Every current claim should return a source link.</p></section>
      <section className="research-layout">
        <form className="search-panel" onSubmit={askCommittee}>
          <div className="agent-switch" role="group" aria-label="Choose committee agent">{(["decision", "risk", "ceo"] as Agent[]).map((item) => <button type="button" key={item} onClick={() => setAgent(item)} className={agent === item ? "active" : ""}>{item === "ceo" ? "CEO" : item[0].toUpperCase() + item.slice(1)}</button>)}</div>
          <label><span>Question for the {agent === "ceo" ? "CEO" : agent} Agent</span><textarea value={query} onChange={(event) => setQuery(event.target.value)} placeholder="What current evidence could change the next-week view for the approved universe?" /></label>
          <button className="primary-button" disabled={searching || !systemsReady}>{searching ? "Searching and reasoning" : "Search the web"}</button>
          <small>{system.openRouter ? "AI reasoning and cited web search are active." : "Cited web-evidence fallback is active. Quantitative forecasts remain available."} Verify every source before approval.</small>
        </form>
        <article className="answer-panel">
          <div className="answer-head"><span>{agent.toUpperCase()} AGENT</span><small>{searching ? "LIVE SEARCH" : answer ? "RESEARCH COMPLETE" : "READY"}</small></div>
          <div className="answer-copy">{answer ? answer.split("\n").map((line, index) => line.trim() ? <p key={`${line.slice(0, 12)}-${index}`}>{line}</p> : null) : <div className="empty-answer"><span>⌕</span><h3>Ask for evidence, probabilities, or a risk challenge</h3><p>The answer will use the current paper portfolio and live market pack.</p></div>}</div>
          {citations.length > 0 && <div className="source-list"><strong>Sources</strong>{citations.map((source, index) => <a href={source.url} target="_blank" rel="noreferrer" key={`${source.url}-${index}`}><span>{index + 1}</span>{source.title || source.url}</a>)}</div>}
        </article>
      </section>
      <section className="prediction-panel">
        <div className="section-heading compact"><div><p className="eyebrow">STOCK FORECASTS</p><h3>Latest calibrated probabilities</h3></div><span>Forecast horizon: next Friday close</span></div>
        <div className="prediction-table"><div className="prediction-row prediction-head"><span>Ticker</span><span>Up probability</span><span>Expected return</span><span>Signal</span></div>
          {predictions.length ? predictions.slice(0, 10).map((item) => <div className="prediction-row" key={item.ticker}><strong>{item.ticker}</strong><span><i style={{ width: `${Math.max(0, Math.min(100, item.upProbability * 100))}%` }} /><b>{percent(item.upProbability)}</b></span><span className={item.expectedReturnPct >= 0 ? "positive" : "negative"}>{item.expectedReturnPct >= 0 ? "+" : ""}{item.expectedReturnPct.toFixed(2)}%</span><small>{item.upProbability >= 0.6 ? "Review" : item.upProbability < 0.45 ? "Avoid" : "Watch"}</small></div>) : <div className="table-empty">Run the committee to create the first stock-level forecast.</div>}
        </div>
      </section>
    </>;
  }

  function LedgerPage() {
    return <>
      <section className="page-intro ledger-intro"><p className="eyebrow">CONTROL LEDGER</p><h2>See what is owned,<br /><span>why it changed, and who approved.</span></h2></section>
      <section className="ledger-cards"><article><span>Virtual NAV</span><strong>{latestNav.toFixed(2)}</strong><small>Paper value</small></article><article><span>Cash</span><strong>{activeCash.toFixed(0)}%</strong><small>{cashSafe ? "Reserve protected" : "Control breach"}</small></article><article><span>Approved universe</span><strong>{approvedCount}</strong><small>Eligible securities</small></article><article><span>Latest data</span><strong>{formatDate(latestRun?.dataAsOf)}</strong><small>{latestRun?.dataStale ? "Stale data warning" : "Freshness checked"}</small></article></section>
      <section className="ledger-grid">
        <article className="data-panel"><div className="section-heading compact"><div><p className="eyebrow">PAPER HOLDINGS</p><h3>Current allocation</h3></div><span>{portfolio.positions.length} positions</span></div>
          <div className="holdings-table"><div className="holding-row heading"><span>Ticker</span><span>Region</span><span>Weight</span><span>Reference</span></div>{portfolio.positions.length ? portfolio.positions.map((position) => <div className="holding-row" key={position.ticker}><strong>{position.ticker}</strong><span>{position.region}</span><span>{position.weightPct.toFixed(2)}%</span><span>{position.lastPrice == null ? "Pending" : position.lastPrice.toFixed(2)}</span></div>) : <div className="table-empty">The paper portfolio is currently in cash.</div>}</div>
        </article>
        <article className="data-panel"><div className="section-heading compact"><div><p className="eyebrow">LATEST RATIONALE</p><h3>CEO and Risk record</h3></div><span>{latestDecision?.mode ?? "No decision"}</span></div>
          <div className="rationale"><span>CEO recommendation</span><p>{latestRun?.final?.rationale ?? latestDecision?.rationale ?? "Run the committee to create the first decision record."}</p><span>Risk challenge</span><p>{riskOpinion?.rationale ?? latestDecision?.riskOpinion ?? "Risk review pending."}</p></div>
        </article>
      </section>
      <section className="decision-list"><div className="section-heading compact"><div><p className="eyebrow">DECISION JOURNAL</p><h3>Permanent Human checkpoints</h3></div><span>{portfolio.approvals.length} records</span></div>{portfolio.approvals.length ? portfolio.approvals.map((approval) => <article key={approval.runId}><span className={`decision-status status-${approval.status}`}>{approval.status}</span><div><strong>{safeMode(approval.proposal?.mode)} proposal</strong><p>{approval.note || "No Human note recorded."}</p><small>{approval.decidedBy || "Human decision pending"}</small></div><div><b>{Number(approval.proposal?.cashPct ?? 100).toFixed(0)}% cash</b><small>Run {approval.runId.slice(0, 8)}</small></div></article>) : <div className="table-empty">No committee recommendation has reached the Human gate.</div>}</section>
    </>;
  }

  return <main className="app-shell">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <header className="topbar">
      <button className="brand" onClick={() => setPage("command")}><span>Ω</span><div><strong>OH MEGA</strong><small>VIRTUAL FUND</small></div></button>
      <nav aria-label="Primary navigation"><button className={page === "command" ? "active" : ""} onClick={() => setPage("command")}>Command</button><button className={page === "research" ? "active" : ""} onClick={() => setPage("research")}>Research</button><button className={page === "ledger" ? "active" : ""} onClick={() => setPage("ledger")}>Ledger</button></nav>
      <div className="system-badge"><i className={systemsReady ? "ready" : ""} /><span>{systemsReady ? "SYSTEMS READY" : "SETUP REQUIRED"}</span><b>PAPER ONLY</b></div>
    </header>
    <div className="ticker-strip"><span>MODE <b>{activeMode}</b></span><span>STOCKS <b>{activeStock.toFixed(0)}%</b></span><span>CASH <b>{activeCash.toFixed(0)}%</b></span><span>FORECAST <b>{system.openRouter ? "AI + QUANT" : "QUANT MODEL"}</b></span><span>WEB EVIDENCE <b>{systemsReady ? "READY" : "UNAVAILABLE"}</b></span><span>HUMAN GATE <b>{pendingApproval ? "ACTION NEEDED" : "CLEAR"}</b></span></div>
    <div id="main-content" className="page-content" tabIndex={-1}>{page === "command" ? <CommandPage /> : page === "research" ? <ResearchPage /> : <LedgerPage />}</div>
    <footer><span>OH MEGA Virtual Fund</span><p>Simulation and research interface. AI forecasts can be wrong. No real-money trading.</p><strong>Minimum cash: 25%</strong></footer>
    {error && <div className="error-toast" role="alert"><div><strong>Review required</strong><span>{error}</span></div><button onClick={() => setError("")}>Close</button></div>}
  </main>;
}
