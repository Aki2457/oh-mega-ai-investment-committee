"use client";

import { FormEvent, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Profile = "think";
type Agent = "research" | "cio" | "risk";
type View = "committee" | "weather" | "workflow" | "universe" | "portfolio" | "decisions" | "performance" | "risk";
type HqRoom = "lounge" | "research" | "risk" | "cio" | "operations";
type Citation = { url: string; title: string; content?: string };
type Message = { id: string; role: "user" | "assistant"; text: string; citations?: Citation[]; model?: string };
type UniverseItem = { id: string; ticker: string; region: "US" | "China/HK"; status: string; source: string; thesis: string; citations: Citation[] };
type Stage = { stage: string; message: string; data?: Record<string, unknown> };

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function apiPath(path: string) {
  if (typeof window !== "undefined" && window.location.hostname.endsWith("chatgpt.site")) return `/api/backend${path}`;
  return path;
}

const views: Array<{ id: View; label: string; shortLabel: string; icon: string; group: "Decide" | "Manage" | "Review" }> = [
  { id: "committee", label: "Investment Committee", shortLabel: "Committee", icon: "Ω", group: "Decide" },
  { id: "weather", label: "Fund Weather", shortLabel: "Weather", icon: "☀", group: "Decide" },
  { id: "workflow", label: "Agent Workflow", shortLabel: "Workflow", icon: "↳", group: "Decide" },
  { id: "universe", label: "Approved Universe", shortLabel: "Universe", icon: "◇", group: "Manage" },
  { id: "portfolio", label: "Paper Portfolio", shortLabel: "Portfolio", icon: "◐", group: "Manage" },
  { id: "decisions", label: "Decision Journal", shortLabel: "Journal", icon: "≡", group: "Review" },
  { id: "performance", label: "Performance", shortLabel: "Performance", icon: "↗", group: "Review" },
  { id: "risk", label: "Risk Review", shortLabel: "Risk", icon: "!", group: "Review" },
];


const agents: Array<{ id: Agent; label: string }> = [
  { id: "research", label: "Research" },
  { id: "cio", label: "CIO" },
  { id: "risk", label: "Risk" },
];

async function readSse(response: Response, onEvent: (value: Record<string, unknown>) => void) {
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({ error: `Request failed with ${response.status}` })) as { error?: unknown };
    throw new Error(String(payload.error ?? `Request failed with ${response.status}`));
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const line = event.split("\n").find((item) => item.startsWith("data: "));
      if (line) onEvent(JSON.parse(line.slice(6)) as Record<string, unknown>);
    }
  }
}

function percent(value: unknown, digits = 1) {
  const number = Number(value ?? 0);
  return `${(number * 100).toFixed(digits)}%`;
}

function probability(value: unknown) {
  return `${(Number(value ?? 0) * 100).toFixed(0)}%`;
}

function ModeBadge({ mode }: { mode: string }) {
  return <span className={`mode-badge mode-${mode.toLowerCase()}`}>{mode}</span>;
}

function AllocationDonut({ stockPct, cashPct, label }: { stockPct: number; cashPct: number; label: string }) {
  return <div className="allocation-visual" aria-label={`${stockPct.toFixed(0)} percent stocks and ${cashPct.toFixed(0)} percent cash`}>
    <div className="allocation-donut" style={{ background: `conic-gradient(var(--green) 0 ${stockPct}%, #dfe7ec ${stockPct}% 100%)` }}><div><strong>{stockPct.toFixed(0)}%</strong><span>{label}</span></div></div>
    <div className="allocation-legend"><span><i className="legend-stock" />Stocks <b>{stockPct.toFixed(0)}%</b></span><span><i className="legend-cash" />Cash <b>{cashPct.toFixed(0)}%</b></span></div>
  </div>;
}

function ProbabilityBar({ label, value, detail }: { label: string; value: number; detail: string }) {
  const bounded = Math.max(0, Math.min(100, value));
  return <div className="probability-row"><div><span>{label}</span><strong>{bounded.toFixed(0)}%</strong></div><div className="probability-track"><i style={{ width: `${bounded}%` }} /></div><small>{detail}</small></div>;
}

function Sources({ citations }: { citations?: Citation[] }) {
  if (!citations?.length) return <p className="empty-copy">No web citations recorded.</p>;
  return <div className="source-list">{citations.map((citation) => (
    <a href={citation.url} target="_blank" rel="noreferrer" key={citation.url}>
      <span>{citation.title || new URL(citation.url).hostname}</span><small>{new URL(citation.url).hostname}</small>
    </a>
  ))}</div>;
}

function MarkdownMessage({ text }: { text: string }) {
  return <div className="markdown-body"><ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={{
      a({ node, ...props }) { void node; return <a {...props} target="_blank" rel="noreferrer" />; },
    }}
  >{text}</ReactMarkdown></div>;
}

export function ResearchChat() {
  const [view, setView] = useState<View>("committee");
  const profile: Profile = "think";
  const [agent, setAgent] = useState<Agent>("research");
  const [hqRoom, setHqRoom] = useState<HqRoom>("lounge");
  const [selectedCharacter, setSelectedCharacter] = useState<Agent>("cio");
  const [characterBeat, setCharacterBeat] = useState(0);
  const [status, setStatus] = useState<Record<string, unknown>>({});
  const [universe, setUniverse] = useState<UniverseItem[]>([]);
  const [runs, setRuns] = useState<Array<Record<string, unknown>>>([]);
  const [portfolio, setPortfolio] = useState<Record<string, Array<Record<string, unknown>>>>({ positions: [], transactions: [], nav: [], decisions: [] });
  const [risk, setRisk] = useState<Record<string, unknown>>({ metrics: {}, baseline: {}, controls: {} });
  const [weather, setWeather] = useState<Record<string, unknown>>({ mode: "Balanced", stockPct: 55, cashPct: 45, modifications: [] });
  const [stages, setStages] = useState<Stage[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { id: "welcome", role: "assistant", text: "Select an agent and ask a question. Every live answer requires real Yahoo data, and current questions can use web search." },
  ]);
  const [chatting, setChatting] = useState(false);
  const [chatStage, setChatStage] = useState("");
  const [sessionId] = useState(makeId);
  const [newTicker, setNewTicker] = useState("");
  const [newRegion, setNewRegion] = useState<"US" | "China/HK">("US");
  const [modType, setModType] = useState("gear");
  const [modValue, setModValue] = useState("Balanced");
  const [modTicker, setModTicker] = useState("");
  const [modNote, setModNote] = useState("");

  async function refresh() {
    const [statusResult, universeResult, historyResult, portfolioResult, riskResult, weatherResult] = await Promise.all([
      fetch(apiPath("/api/status"), { cache: "no-store" }).then((response) => response.json()),
      fetch(apiPath("/api/universe"), { cache: "no-store" }).then((response) => response.json()),
      fetch(apiPath("/api/committee/history"), { cache: "no-store" }).then((response) => response.json()),
      fetch(apiPath("/api/portfolio"), { cache: "no-store" }).then((response) => response.json()),
      fetch(apiPath("/api/risk"), { cache: "no-store" }).then((response) => response.json()),
      fetch(apiPath("/api/weather"), { cache: "no-store" }).then((response) => response.json()),
    ]) as [Record<string, unknown>, { universe?: UniverseItem[] }, { runs?: Array<Record<string, unknown>> }, Record<string, Array<Record<string, unknown>>>, Record<string, unknown>, Record<string, unknown>];
    setStatus(statusResult);
    setUniverse(universeResult.universe ?? []);
    setRuns(historyResult.runs ?? []);
    setPortfolio(portfolioResult);
    setRisk(riskResult);
    setWeather(weatherResult);
  }

  useEffect(() => {
    refresh().catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load the committee"));
  }, []);

  const latestRun = runs[0] ?? null;
  const latestFinal = (latestRun?.final ?? {}) as Record<string, unknown>;
  const latestMarket = (latestRun?.market ?? {}) as Record<string, unknown>;
  const latestFeatures = (latestMarket.features ?? []) as Array<Record<string, unknown>>;
  const latestUs = latestFeatures.find((item) => item.ticker === "QQQ");
  const latestChina = latestFeatures.find((item) => item.ticker === "3067.HK");
  const citations = (latestFinal.citations ?? []) as Citation[];
  const analystScores = (latestFinal.analystScores ?? []) as Array<Record<string, unknown>>;
  const nav = portfolio.nav ?? [];
  const currentNav = nav.length ? Number(nav[nav.length - 1]?.nav ?? 100) : 100;
  const riskMetrics = (risk.metrics ?? {}) as Record<string, unknown>;
  const riskBaseline = (risk.baseline ?? {}) as Record<string, unknown>;
  const latestRiskReview = (risk.latestRisk ?? {}) as Record<string, unknown>;
  const improvementExperiments = (latestRiskReview.improvementExperiments ?? []) as Array<Record<string, unknown>>;
  const approvedCount = universe.filter((item) => item.status === "approved").length;
  const pendingCount = universe.filter((item) => item.status === "pending").length;
  const stockData = (status.stockData ?? {}) as Record<string, unknown>;
  const stockProviderCount = 1 + [stockData.massive, stockData.alphaVantage, stockData.finnhub].filter(Boolean).length;
  const currentView = views.find((item) => item.id === view) ?? views[0];
  const latestDecision = portfolio.decisions?.[0];
  const displayMode = String(latestFinal.mode ?? latestDecision?.mode ?? "Cash");
  const displayStockPct = Number(latestDecision?.stockPct ?? (displayMode === "Attack" ? 90 : displayMode === "Balanced" ? 55 : displayMode === "Defense" ? 25 : 0));
  const displayCashPct = 100 - displayStockPct;

  const setupReady = Boolean(status.openRouter && status.yahoo && status.persistence);
  const weatherMode = String(weather.mode ?? "Balanced");
  const activeMods = ((weather.modifications ?? []) as Array<Record<string, unknown>>).filter((item) => item.active);

  function goToHouse(target?: "chat") {
    setView("committee");
    if (target === "chat") window.setTimeout(() => document.getElementById("agent-chat")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    else window.setTimeout(() => document.getElementById("main-content")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function goToRoom(room: HqRoom, character?: Agent) {
    setView("committee");
    setHqRoom(room);
    if (character) { setAgent(character); setSelectedCharacter(character); }
    window.setTimeout(() => document.getElementById("main-content")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function takeNextAction() {
    if (!setupReady) { setView("workflow"); return; }
    if (running) { goToHouse(); return; }
    if (pendingCount > 0) { setView("universe"); return; }
    if (!latestDecision) { runNow(); return; }
    if (activeMods.length > 0) { setView("weather"); return; }
    goToRoom("cio", "cio");
  }

  async function addMod(event: FormEvent) {
    event.preventDefault(); setError("");
    const response = await fetch(apiPath("/api/weather"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: modType, value: modType === "halt" ? "true" : modValue, ticker: modTicker, note: modNote }) });
    const result = await response.json();
    if (!response.ok) { setError(String(result.error ?? "Unable to add modification")); return; }
    setModNote(""); setModTicker(""); await refresh();
  }

  async function removeMod(id: string) {
    await fetch(apiPath(`/api/weather?id=${encodeURIComponent(id)}`), { method: "DELETE" }); await refresh();
  }

  async function runNow() {
    setRunning(true); setError(""); setStages([]);
    try {
      const response = await fetch(apiPath("/api/committee/run"), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trigger: "manual", profile }),
      });
      await readSse(response, (value) => setStages((current) => [...current, value as Stage]));
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Committee run failed"); }
    finally { setRunning(false); }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || chatting) return;
    setInput(""); setChatting(true); setChatStage("Preparing live market context"); setError("");
    const userMessage: Message = { id: makeId(), role: "user", text };
    const responseId = makeId();
    setMessages((current) => [...current, userMessage, { id: responseId, role: "assistant", text: "" }]);
    try {
      const response = await fetch(apiPath("/api/chat"), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, agent, profile, message: text }),
      });
      await readSse(response, (value) => {
        if (value.type === "stage") setChatStage(String(value.message ?? "Working"));
        if (value.type === "delta") { setChatStage("Writing the answer"); setMessages((current) => current.map((item) => item.id === responseId ? { ...item, text: item.text + String(value.text ?? "") } : item)); }
        if (value.type === "complete") setMessages((current) => current.map((item) => item.id === responseId ? { ...item, text: String(value.text ?? item.text), citations: value.citations as Citation[], model: String(value.model ?? "") } : item));
        if (value.type === "error") throw new Error(String(value.message ?? "Agent failed"));
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Agent failed";
      setMessages((current) => current.map((item) => item.id === responseId ? { ...item, text: message } : item));
    } finally { setChatting(false); setChatStage(""); }
  }

  function CommitteePet() {
    const committeeStage = stages[stages.length - 1];
    const busy = running || chatting;
    const mood = weatherMode === "Lockdown" ? "locked" : busy ? "working" : weatherMode === "Attack" ? "bright" : weatherMode === "Defense" ? "careful" : "calm";
    const message = running ? committeeStage?.message ?? "Starting the investment committee" : chatting ? chatStage || `${agent} agent is working` : weatherMode === "Lockdown" ? "Lockdown is active. I am watching the controls." : `I am watching the ${weatherMode} portfolio.`;
    return <section className={`committee-pet pet-${mood}`} aria-live="polite" aria-label="OH MEGA committee activity"><div className="pet-avatar" aria-hidden="true"><i className="pet-ear pet-ear-left" /><i className="pet-ear pet-ear-right" /><div className="pet-face"><b /><b /><span /></div><em>Ω</em></div><div className="pet-thought"><span>{running ? "COMMITTEE LIVE" : chatting ? `${agent.toUpperCase()} AGENT LIVE` : "OMEGA IS WATCHING"}</span><strong>{message}</strong>{busy && <div className="thinking-dots" aria-hidden="true"><i /><i /><i /></div>}</div></section>;
  }

  async function addTicker(event: FormEvent) {
    event.preventDefault(); setError("");
    const response = await fetch(apiPath("/api/universe"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: newTicker, region: newRegion }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) return setError(payload.error ?? "Unable to add ticker");
    setNewTicker(""); await refresh();
  }

  async function changeTicker(ticker: string, statusValue: string) {
    await fetch(apiPath("/api/universe"), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker, status: statusValue }) });
    await refresh();
  }

  async function removeTicker(ticker: string) {
    await fetch(apiPath(`/api/universe?ticker=${encodeURIComponent(ticker)}`), { method: "DELETE" });
    await refresh();
  }

  function ActionCenter() {
    const completedChecks = [setupReady, pendingCount === 0, Boolean(latestDecision), Boolean(latestRun && !latestRun.dataStale), (portfolio.positions?.length ?? 0) > 0, Boolean(latestRiskReview.opinion ?? latestDecision?.riskOpinion)].filter(Boolean).length;
    const todo = [
      ...(!setupReady ? [{ label: "Complete system setup", owner: "System", urgency: "Required", action: () => setView("workflow") }] : []),
      ...(pendingCount > 0 ? [{ label: `Review ${pendingCount} pending stock${pendingCount === 1 ? "" : "s"}`, owner: "You", urgency: "Approval", action: () => setView("universe") }] : []),
      ...(!latestDecision ? [{ label: "Run the Investment Committee", owner: "CIO Agent", urgency: "Next", action: runNow }] : []),
      ...(activeMods.length > 0 ? [{ label: `Review ${activeMods.length} active modification${activeMods.length === 1 ? "" : "s"}`, owner: "You", urgency: "Control", action: () => setView("weather") }] : []),
    ];
    return <section className="action-center" aria-label="Weekly action and tracking center"><div className="action-center-head"><div><p className="eyebrow">WEEKLY CONTROL BOARD</p><h2>What needs attention</h2><span>Start on the left. Tap any item to act or inspect it.</span></div><div className="readiness-score"><strong>{completedChecks}/6</strong><span>checks complete</span><i><b style={{ width: `${completedChecks / 6 * 100}%` }} /></i></div></div><div className="action-columns"><section className="action-column action-now"><header><b>{todo.length}</b><div><strong>Do now</strong><span>Items needing action</span></div></header><div>{todo.length ? todo.map((item) => <button onClick={item.action} key={item.label}><i>→</i><span><strong>{item.label}</strong><small>{item.owner} · {item.urgency}</small></span></button>) : <article className="all-clear"><b>✓</b><span><strong>No urgent actions</strong><small>The weekly controls are clear.</small></span></article>}</div></section><section className="action-column action-watch"><header><b>3</b><div><strong>Keep watching</strong><span>Current fund state</span></div></header><div><button onClick={() => setView("weather")}><i>◉</i><span><strong>{weatherMode} gear</strong><small>{displayStockPct.toFixed(0)}% stocks · {displayCashPct.toFixed(0)}% cash</small></span></button><button onClick={() => setView("risk")}><i>!</i><span><strong>{String(latestDecision?.riskOpinion ?? "Risk review pending")}</strong><small>Latest Risk opinion</small></span></button><button onClick={() => setView("performance")}><i>↗</i><span><strong>{String(latestRun?.dataAsOf ?? "Data pending")}</strong><small>{latestRun?.dataStale ? "Data freshness warning" : "Latest market data"}</small></span></button></div></section><section className="action-column action-done"><header><b>{portfolio.decisions?.length ?? 0}</b><div><strong>Completed</strong><span>Recorded work</span></div></header><div><button onClick={() => setView("decisions")}><i>✓</i><span><strong>{portfolio.decisions?.length ?? 0} decisions recorded</strong><small>Permanent journal</small></span></button><button onClick={() => setView("portfolio")}><i>✓</i><span><strong>{portfolio.positions?.length ?? 0} active positions</strong><small>Paper portfolio</small></span></button><button onClick={() => goToRoom("research", "research")}><i>✓</i><span><strong>{citations.length} cited sources</strong><small>Latest committee evidence</small></span></button></div></section></div></section>;
  }

  function CommitteeView() {
    return <>
      <ActionCenter />
      <LivingRoom />
      <WeatherStrip />
      <section className="decision-cockpit">
        <div className="decision-copy"><div className="decision-label"><p className="eyebrow">NEXT-WEEK PAPER DECISION</p><ModeBadge mode={displayMode} /></div><h2>{latestFinal.mode ? `${displayMode} mode` : "Ready for the first committee"}</h2><p>{String(latestFinal.rationale ?? "Run the committee to combine live market data, cited research, independent Risk review, and a final CIO allocation.")}</p><div className="hero-actions"><button className="primary-action" onClick={runNow} disabled={running || !setupReady}>{running ? "Committee running" : "Run Investment Committee"}</button><span>Manual and weekly decisions use Think Standard</span></div></div>
        <AllocationDonut stockPct={displayStockPct} cashPct={displayCashPct} label={displayMode} />
        <div className="probability-panel"><ProbabilityBar label="US technology" value={Number(latestFinal.usUpProbability ?? 0) * 100} detail={`Expected ${Number(latestFinal.usExpectedReturnPct ?? 0).toFixed(2)}% next week`} /><ProbabilityBar label="China / HK technology" value={Number(latestFinal.chinaUpProbability ?? 0) * 100} detail={`Expected ${Number(latestFinal.chinaExpectedReturnPct ?? 0).toFixed(2)}% next week`} /><div className="data-stamp"><span>DATA AS OF</span><strong>{String(latestRun?.dataAsOf ?? "Awaiting run")}</strong><small>{stockProviderCount}/4 market sources configured</small></div></div>
      </section>
      {!setupReady && <div className="setup-warning"><strong>Setup incomplete</strong><span>{!status.openRouter ? "Add OPENROUTER_API_KEY to .env.local. " : ""}{!status.persistence ? "Database unavailable. " : ""}{!status.yahoo ? "Yahoo data unavailable." : ""}</span></div>}
      {latestRun && <div className="summary-grid">
        <article><span>US up probability</span><strong>{probability(latestFinal.usUpProbability)}</strong><small>Expected {Number(latestFinal.usExpectedReturnPct ?? 0).toFixed(2)}%</small></article>
        <article><span>China/HK up probability</span><strong>{probability(latestFinal.chinaUpProbability)}</strong><small>Expected {Number(latestFinal.chinaExpectedReturnPct ?? 0).toFixed(2)}%</small></article>
        <article><span>Market data</span><strong>{String(latestRun.dataAsOf ?? "Pending")}</strong><small>{latestRun.dataStale ? "Cached or stale input" : "Live Yahoo input"}</small></article>
        <article><span>Paper NAV</span><strong>${currentNav.toFixed(2)}</strong><small>{approvedCount} approved stocks</small></article>
      </div>}
      <div className="committee-grid">
        <section className="panel chat-card" id="agent-chat">
          <div className="panel-head"><div><p className="eyebrow">LIVE AGENT</p><h3>Ask the committee</h3><span>Research explains evidence. CIO explains positioning. Risk tests what could go wrong.</span></div><div className="segmented">{agents.map((item) => <button className={agent === item.id ? "active" : ""} onClick={() => setAgent(item.id)} key={item.id}>{item.label}</button>)}</div></div>
          <div className="chat-stream">{messages.map((message) => <div className={`chat-message ${message.role}`} key={message.id}><span>{message.role === "assistant" ? `${agent.toUpperCase()} AGENT` : "YOU"}</span><MarkdownMessage text={message.text || "Thinking..."} />{message.model && <small>{message.model}</small>}<Sources citations={message.citations} /></div>)}</div>
          <form className="chat-composer" onSubmit={sendMessage}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask about next week, a risk, or the allocation" /><button disabled={chatting || !setupReady}>{chatting ? "Working" : "Send"}</button></form>
        </section>
        <aside className="panel evidence-card">
          <div className="panel-head"><div><p className="eyebrow">DECISION EVIDENCE</p><h3>Model council</h3><span>Scores show how the CIO rated each opinion for evidence, consistency, calibration, sources, and risk awareness.</span></div>{Boolean(latestFinal.mode) && <ModeBadge mode={String(latestFinal.mode)} />}</div>
          {analystScores.length ? <div className="score-list">{analystScores.map((score, index) => <div key={`${score.role}-${index}`}><span>{String(score.role)}</span><div><i style={{ width: `${Number(score.total ?? 0)}%` }} /></div><strong>{Number(score.total ?? 0).toFixed(0)}</strong></div>)}</div> : <p className="empty-copy">Scores appear after the first successful AI run.</p>}
          <div className="market-evidence"><div><span>US 1-week return</span><strong>{percent(latestUs?.return1w)}</strong></div><div><span>China/HK 1-week return</span><strong>{percent(latestChina?.return1w)}</strong></div><div><span>Mechanical control</span><strong>{String(latestMarket.mechanicalMode ?? "Pending")}</strong></div><div><span>Data state</span><strong>{latestMarket.stale ? "Stale" : "Current"}</strong></div></div>
          <h4>Sources</h4><Sources citations={citations} />
        </aside>
      </div>
      {!!stages.length && <section className="panel stage-panel" aria-live="polite"><div className="panel-head"><h3>Run stages</h3><span>{stages[stages.length - 1]?.stage}</span></div><ol>{stages.map((stage, index) => <li className={index === stages.length - 1 ? "active" : ""} key={`${stage.stage}-${index}`}><b>{index + 1}</b><div><strong>{stage.stage}</strong><span>{stage.message}</span></div></li>)}</ol></section>}
    </>;
  }

  function LivingRoom() {
    const currentStage = stages[stages.length - 1]?.stage;
    const activeCharacter = chatting ? agent : running ? (["risk"].includes(String(currentStage)) ? "risk" : ["judge", "rebalance", "complete"].includes(String(currentStage)) ? "cio" : "research") : null;
    const characterReactions: Record<Agent, string[]> = {
      research: [`Mika: I have ${citations.length} cited sources on my desk. Want the evidence tour?`, `Mika: US tech is showing ${Number(latestFinal.usUpProbability ?? 0) * 100 || 0}% upside probability. I can explain the signal.`, `Mika: My next job is to compare price momentum with the latest catalysts.`],
      risk: [`Rex: I am guarding the 10% position cap. No oversized paper bets get past me.`, `Rex: Current maximum drawdown is ${percent(riskMetrics.maximumDrawdown)}. Click again and I will keep challenging the plan.`, `Rex: I count ${activeMods.length} active modification${activeMods.length === 1 ? "" : "s"}. Every exception needs a reason.`],
      cio: [`Nova: The house is in ${weatherMode} gear. I am holding ${displayCashPct.toFixed(0)}% cash.`, `Nova: My job is to resolve disagreement and choose one clear paper allocation.`, `Nova: Call the committee when you want a fresh weekly decision.`],
    };
    const dialogue = chatting ? `${agent === "research" ? "Mika" : agent === "risk" ? "Rex" : "Nova"}: ${chatStage || "Let me check the evidence..."}` : running ? `${activeCharacter === "risk" ? "Rex" : activeCharacter === "cio" ? "Nova" : "Mika"}: ${stages[stages.length - 1]?.message || "The weekly meeting is starting."}` : characterReactions[selectedCharacter][characterBeat % characterReactions[selectedCharacter].length];
    const characters: Array<{ id: Agent; name: string; role: string }> = [{ id: "research", name: "Mika", role: "Research" }, { id: "risk", name: "Rex", role: "Risk" }, { id: "cio", name: "Nova", role: "CIO" }];
    const usProbability = Number(latestFinal.usUpProbability ?? 0) * 100;
    const chinaProbability = Number(latestFinal.chinaUpProbability ?? 0) * 100;
    const roomNames: Array<{ id: HqRoom; label: string; icon: string }> = [{ id: "lounge", label: "Living Room", icon: "⌂" }, { id: "research", label: "Research Lab", icon: "⌕" }, { id: "risk", label: "Risk Room", icon: "!" }, { id: "cio", label: "CIO Office", icon: "Ω" }, { id: "operations", label: "Operations", icon: "▦" }];
    function meetCharacter(id: Agent) { setAgent(id); setSelectedCharacter(id); setCharacterBeat((value) => value + 1); }
    function visitAgentRoom(id: Agent) { setSelectedCharacter(id); setAgent(id); setHqRoom(id === "research" ? "research" : id === "risk" ? "risk" : "cio"); }
    function openAgentChat() { setAgent(selectedCharacter); window.setTimeout(() => document.getElementById("agent-chat")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }
    const cast = <div className="character-row">{characters.map((character) => <button className={`jrpg-character character-${character.id} ${activeCharacter === character.id ? "active walking" : ""} ${selectedCharacter === character.id ? "reacting" : ""}`} onClick={() => meetCharacter(character.id)} aria-pressed={agent === character.id} key={character.id}>{selectedCharacter === character.id && !running && !chatting && <span className="character-bubble">{character.id === "research" ? "New clue!" : character.id === "risk" ? "Check that." : "Decision time!"}</span>}<span className="pixel-person" aria-hidden="true"><i className="pixel-hair" /><i className="pixel-head"><b className="pixel-eye left" /><b className="pixel-eye right" /><b className="pixel-mouth" /></i><i className="pixel-body" /><i className="pixel-arm left" /><i className="pixel-arm right" /><i className="pixel-leg left" /><i className="pixel-leg right" /></span><strong>{character.name}</strong><small>{character.role}</small>{activeCharacter === character.id && <em>!</em>}</button>)}</div>;
    return <section className={`living-room ${running || chatting ? "room-live" : ""}`} aria-label="OH MEGA interactive agent living room">
      <div className="room-help"><div><strong>OH MEGA Headquarters</strong><span>Pick a room. Talk to a character. Select any glowing object for the full report.</span></div><nav className="room-nav" aria-label="Headquarters rooms">{roomNames.map((room) => <button className={hqRoom === room.id ? "active" : ""} onClick={() => setHqRoom(room.id)} aria-pressed={hqRoom === room.id} key={room.id}><i>{room.icon}</i><span>{room.label}</span></button>)}</nav></div>
      <div className="hq-status-ribbon"><button onClick={() => setView("weather")}><span>FUND WEATHER</span><b>{weatherMode}</b></button><button onClick={() => setView("portfolio")}><span>PAPER NAV</span><b>${currentNav.toFixed(2)}</b></button><button onClick={() => setView("performance")}><span>US / HK UP</span><b>{usProbability.toFixed(0)}% / {chinaProbability.toFixed(0)}%</b></button><button onClick={() => setView("portfolio")}><span>ALLOCATION</span><b>{displayStockPct.toFixed(0)} / {displayCashPct.toFixed(0)}</b></button><button onClick={() => setView("universe")}><span>UNIVERSE</span><b>{approvedCount} approved</b></button></div>
      {hqRoom === "lounge" && <><div className="room-wall room-lounge-wall">
        <button className="room-window room-hotspot" onClick={() => setView("weather")} aria-label="Open Fund Weather"><i /><i /><span>{weatherMode.toUpperCase()} · {Number(weather.cashPct ?? 100).toFixed(0)}% CASH</span></button>
        <div className="room-clock"><b>Ω</b></div>
        <button className="room-picture room-hotspot" onClick={() => setView("decisions")}>DECISION<br />JOURNAL</button>
        <button className="room-market-screen room-hotspot" onClick={() => setView("performance")}><span>WEEKLY SIGNALS</span><b>US {usProbability.toFixed(0)}%</b><b>HK {chinaProbability.toFixed(0)}%</b><small>Open performance ↗</small></button>
      </div><div className="room-floor room-lounge-floor">
        <button className="room-sofa room-hotspot" onClick={() => setView("committee")} aria-label="Open committee home"><span>COMMITTEE TABLE</span></button>
        <button className="room-table room-hotspot" onClick={() => setView("workflow")}><span>WEEKLY<br />WORKFLOW</span></button>
        <button className="room-risk-desk room-hotspot" onClick={() => setView("risk")}><span>RISK</span><b>{String(latestDecision?.riskOpinion ?? "Review")}</b></button>
        <button className="room-portfolio-console room-hotspot" onClick={() => setView("portfolio")}><span>PAPER PORTFOLIO</span><b>${currentNav.toFixed(2)}</b><small>{displayStockPct.toFixed(0)}% stocks · {displayCashPct.toFixed(0)}% cash</small></button>
        <button className="room-universe-cabinet room-hotspot" onClick={() => setView("universe")}><i /><i /><span>{approvedCount} APPROVED</span><small>{pendingCount} pending</small></button>
        <div className="room-plant"><i /><i /><i /><b /></div>{cast}
      </div></>}
      {hqRoom === "research" && <div className="hq-special-room research-lab"><div className="room-title-sign"><span>MIKA'S RESEARCH LAB</span><small>Prices, predictions, and cited evidence</small></div><button className="lab-screen room-hotspot" onClick={() => setView("performance")}><span>NEXT WEEK</span><div><b>US TECH</b><strong>{usProbability.toFixed(0)}%</strong></div><div><b>CHINA / HK</b><strong>{chinaProbability.toFixed(0)}%</strong></div><small>Probability of a positive return</small></button><button className="lab-terminal room-hotspot" onClick={() => setView("workflow")}><span>DATA ENGINE</span><b>{String(latestRun?.dataAsOf ?? "Awaiting run")}</b><small>{latestRun?.dataStale ? "Cached data warning" : `${stockProviderCount}/4 sources configured`}</small></button><button className="lab-files room-hotspot" onClick={() => setView("decisions")}><b>{citations.length}</b><span>CITED SOURCES</span></button>{cast}</div>}
      {hqRoom === "risk" && <div className="hq-special-room risk-room"><div className="room-title-sign"><span>REX'S RISK ROOM</span><small>Independent challenge and hard controls</small></div><button className="risk-main-board room-hotspot" onClick={() => setView("risk")}><span>LATEST OPINION</span><strong>{String(latestDecision?.riskOpinion ?? "Awaiting review")}</strong><small>Open full Risk review</small></button><div className="risk-control-rack"><span>POSITION CAP</span><b>10%</b><span>STALE DATA</span><b>FREEZE</b><span>ACTIVE MODS</span><b>{activeMods.length}</b></div><button className="risk-metric-screen room-hotspot" onClick={() => setView("performance")}><span>MAX DRAWDOWN</span><b>{percent(riskMetrics.maximumDrawdown)}</b><small>Volatility {percent(riskMetrics.annualizedVolatility)}</small></button>{cast}</div>}
      {hqRoom === "cio" && <div className="hq-special-room cio-office"><div className="room-title-sign"><span>NOVA'S CIO OFFICE</span><small>Mode, allocation, and final judgment</small></div><button className="cio-mode-board room-hotspot" onClick={() => setView("weather")}><span>CURRENT GEAR</span><strong>{weatherMode}</strong><div><b>{displayStockPct.toFixed(0)}% stocks</b><b>{displayCashPct.toFixed(0)}% cash</b></div></button><button className="cio-briefing room-hotspot" onClick={() => setView("decisions")}><span>LATEST DECISION</span><p>{String(latestFinal.rationale ?? latestDecision?.rationale ?? "Run the committee to prepare the first decision brief.")}</p></button><button className="cio-run-desk room-hotspot" onClick={runNow} disabled={running || !setupReady}><span>{running ? "COMMITTEE RUNNING" : "CALL COMMITTEE"}</span><b>▶</b></button>{cast}</div>}
      {hqRoom === "operations" && <div className="hq-special-room operations-room"><div className="room-title-sign"><span>PORTFOLIO OPERATIONS</span><small>Paper positions, cash, universe, and records</small></div><button className="ops-nav-screen room-hotspot" onClick={() => setView("portfolio")}><span>PAPER NAV</span><strong>${currentNav.toFixed(2)}</strong><small>{portfolio.positions?.length ?? 0} active positions</small></button><button className="ops-allocation room-hotspot" onClick={() => setView("portfolio")}><span>ALLOCATION</span><b>{displayStockPct.toFixed(0)} / {displayCashPct.toFixed(0)}</b><small>Stocks / cash</small></button><button className="ops-universe room-hotspot" onClick={() => setView("universe")}><span>ELIGIBLE UNIVERSE</span><b>{approvedCount}</b><small>{pendingCount} pending approval</small></button><button className="ops-ledger room-hotspot" onClick={() => setView("decisions")}><span>DECISION LEDGER</span><b>{portfolio.decisions?.length ?? 0}</b><small>Recorded decisions</small></button>{cast}</div>}
      <div className={`jrpg-dialogue portrait-${activeCharacter ?? selectedCharacter}`}><i className="dialogue-portrait" aria-hidden="true" /><div><b>{busyLabel(running, chatting)}</b><p>{dialogue}</p><div className="dialogue-actions"><button onClick={openAgentChat}>Ask {selectedCharacter === "research" ? "Mika" : selectedCharacter === "risk" ? "Rex" : "Nova"}</button><button onClick={() => visitAgentRoom(selectedCharacter)}>Visit their room</button><button onClick={() => setCharacterBeat((value) => value + 1)}>Talk again</button></div></div><span>▼</span></div>
    </section>;
  }

  function busyLabel(committeeBusy: boolean, agentBusy: boolean) {
    if (committeeBusy) return "WEEKLY COMMITTEE";
    if (agentBusy) return "LIVE AGENT";
    return "LIVING ROOM";
  }

  function WeatherStrip() {
    const symbol = weatherMode === "Attack" ? "☀" : weatherMode === "Balanced" ? "⛅" : weatherMode === "Defense" ? "🌧" : "🔒";
    return <section className={`weather-strip weather-${weatherMode.toLowerCase()}`} aria-label="Current fund weather"><div className="weather-symbol" aria-hidden="true">{symbol}</div><div><p>FUND WEATHER</p><h2>{weatherMode}</h2><span>{Number(weather.stockPct ?? 0).toFixed(0)}% stocks · {Number(weather.cashPct ?? 100).toFixed(0)}% cash</span></div><div className="weather-mod-summary"><strong>{activeMods.length} active modification{activeMods.length === 1 ? "" : "s"}</strong><span>{weatherMode === "Lockdown" ? "Investing stopped. Portfolio held in cash." : activeMods.length ? "Manual or weekly committee controls are active." : "Standard gear rules are active."}</span></div><button onClick={() => setView("weather")}>View controls</button></section>;
  }

  function WeatherView() {
    return <><WeatherStrip /><section className="section-title"><p className="eyebrow">PUBLIC POSITIONING STATUS</p><h2>Fund weather and modifications</h2><p>Fund Weather is the fastest way to understand current positioning. The gear sets the maximum stock budget. Modifications add temporary instructions from a person or the weekly committee.</p></section><section className="gear-explainer"><article><b>☀</b><strong>Attack</strong><span>90% stocks. Used when evidence and trend conditions support higher risk.</span></article><article><b>⛅</b><strong>Balanced</strong><span>55% stocks. Used when signals are mixed and flexibility matters.</span></article><article><b>🌧</b><strong>Defense</strong><span>25% stocks. Used when downside protection has priority.</span></article><article><b>🔒</b><strong>Lockdown</strong><span>0% stocks. Stops investing and holds the portfolio in cash.</span></article></section><div className="guidance-note"><strong>Who has control?</strong><span>The weekly CIO Agent can publish a gear and allocation. A manual modification can tighten or replace that instruction. Portfolio limits, stale-data freezes, approved securities, and the 10% position cap remain enforced in code.</span></div><div className="weather-layout"><section className="panel"><div className="panel-head"><div><h3>Active modifications</h3><span>Read these as temporary instructions layered over the standard gear.</span></div><span>{activeMods.length} active</span></div><div className="mod-list">{activeMods.map((mod) => <article key={String(mod.id)}><div><span>{String(mod.source)} · {String(mod.type).replace("_", " ")}</span><strong>{mod.type === "gear" ? String(mod.value) : mod.type === "stock_allocation" ? `${mod.value}% stocks` : mod.ticker ? `${String(mod.type).toUpperCase()} ${mod.ticker}` : "Investing stopped"}</strong><small>{String(mod.note || "No additional note")}</small></div>{mod.source === "manual" && <button onClick={() => removeMod(String(mod.id))}>Remove</button>}</article>)}{!activeMods.length && <p className="empty-copy">No modifications are active. The standard gear allocation applies.</p>}</div></section><section className="panel"><div className="panel-head"><div><h3>Add manual modification</h3><span>Use this when a human decision should guide or restrict the next allocation.</span></div><span>Human control</span></div><form className="mod-form" onSubmit={addMod}><label><span>Modification</span><select value={modType} onChange={(event) => { setModType(event.target.value); setModValue(event.target.value === "stock_allocation" ? "55" : event.target.value === "gear" ? "Balanced" : "true"); }}><option value="gear">Change investment gear</option><option value="stock_allocation">Set stock allocation</option><option value="halt">Stop investments</option><option value="buy">Buy instruction</option><option value="short">Short instruction</option></select></label>{modType === "gear" && <label><span>Gear</span><select value={modValue} onChange={(event) => setModValue(event.target.value)}><option>Attack</option><option>Balanced</option><option>Defense</option><option>Lockdown</option></select></label>}{modType === "stock_allocation" && <label><span>Stocks, percent of NAV</span><input type="number" min="0" max="90" value={modValue} onChange={(event) => setModValue(event.target.value)} /></label>}{(modType === "buy" || modType === "short") && <label><span>Approved ticker</span><input value={modTicker} onChange={(event) => setModTicker(event.target.value.toUpperCase())} placeholder="AAPL" /></label>}<label><span>Reason or instruction</span><input value={modNote} onChange={(event) => setModNote(event.target.value)} placeholder="Why this control is needed" /></label><button className="primary-action" type="submit">Activate modification</button></form><p className="mod-safety">Lockdown and Stop Investments force 100% cash. Buy and short instructions are recorded for the simulated committee and remain subject to portfolio controls.</p></section></div></>;
  }

  function WorkflowView() {
    const workflowStages = [
      { number: "01", name: "Market Data", owner: "Data Engine", detail: "Yahoo prices, HKD conversion, freshness checks, and the quantitative feature pack.", tone: "data" },
      { number: "02", name: "Research", owner: "Quant + Macro Agents", detail: "Parallel price analysis and cited news, policy, filing, earnings, and macro research.", tone: "research" },
      { number: "03", name: "Challenge", owner: "Risk Agent", detail: "Independent review of freshness, disagreement, liquidity, concentration, volatility, drawdown, and source quality.", tone: "risk" },
      { number: "04", name: "Decision", owner: "CIO Agent", detail: "Scores every opinion, resolves disagreements, and chooses Attack, Balanced, Defense, or Lockdown.", tone: "cio" },
      { number: "05", name: "Controls", owner: "Allocation Engine", detail: "Applies fixed mode weights, regional bounds, approved-universe rules, and the 10% security cap.", tone: "control" },
      { number: "06", name: "Paper Action", owner: "Portfolio Engine", detail: "Records a simulated rebalance, unused stock budget as cash, transactions, and NAV history.", tone: "portfolio" },
    ];
    return <><section className="section-title workflow-title"><p className="eyebrow">FROM EVIDENCE TO PAPER ALLOCATION</p><h2>The complete agent workflow</h2><p>Follow each handoff from required market data through independent Risk review, the CIO decision, hard controls, and performance feedback.</p></section>
      <div className="workflow-profile panel"><div><span>AI mode</span><strong>Think · Standard</strong><small>One consistent fusion committee for chat, manual runs, and weekly automation.</small></div><div><span>Weekly schedule</span><strong>{status.scheduler ? "Automatic · Think" : "Setup required"}</strong><small>Saturday at 08:00 Singapore time, with weekend restart recovery</small></div><div><span>Execution scope</span><strong>Paper only</strong><small>No broker or live-trading connection</small></div></div>
      <section className="workflow-track" aria-label="Investment committee workflow">{workflowStages.map((stage, index) => <article className={`workflow-step workflow-${stage.tone}`} key={stage.number}><div className="workflow-step-head"><b>{stage.number}</b><span>{stage.name}</span></div><h3>{stage.owner}</h3><p>{stage.detail}</p>{index < workflowStages.length - 1 && <i className="workflow-arrow" aria-hidden="true">↓</i>}</article>)}</section>
      <section className="workflow-branches"><article className="panel"><div className="panel-head"><div><p className="eyebrow">DATA SAFETY GATE</p><h3>Freshness decides whether work continues</h3></div><span className="status-pill status-approved">Hard control</span></div><div className="branch-grid"><div><b>Fresh or valid cache</b><span>Continue through Research, Risk, CIO, and allocation.</span></div><div className="branch-freeze"><b>Older than five trading days</b><span>Freeze the paper portfolio and record the stale-data warning.</span></div></div></article><article className="panel"><div className="panel-head"><div><p className="eyebrow">HUMAN ELIGIBILITY GATE</p><h3>AI candidates require approval</h3></div><span className="status-pill status-pending">Approval required</span></div><div className="branch-grid"><div><b>Approved</b><span>The security enters the eligible US or China/HK universe.</span></div><div><b>Pending or disabled</b><span>The security may appear in research and receives zero portfolio weight.</span></div></div></article></section>
      <section className="panel feedback-panel"><div className="panel-head"><div><p className="eyebrow">LEARNING LOOP</p><h3>Performance returns to the Risk Agent</h3></div><span>{Number(risk.observations ?? 0)} observations</span></div><div className="feedback-flow"><span>Paper NAV</span><i>→</i><span>Performance metrics</span><i>→</i><span>Risk review</span><i>→</i><span>Three experiments</span><i>→</i><span>Next committee</span></div><p>CAGR, volatility, Sharpe, Sortino, drawdown, cash drag, turnover, regional attribution, hit rate, Brier score, and expected-return error are compared with the mechanical and fully invested controls.</p></section>
    </>;
  }

  function UniverseView() {
    return <><section className="section-title"><p className="eyebrow">ELIGIBILITY CONTROL</p><h2>Approved AI technology universe</h2><p>AI candidates remain pending until you approve them. Only approved tickers can receive paper weights.</p></section>
      <form className="ticker-form panel" onSubmit={addTicker}><label><span>Yahoo ticker</span><input value={newTicker} onChange={(event) => setNewTicker(event.target.value.toUpperCase())} placeholder="Ticker" required /></label><label><span>Market</span><select value={newRegion} onChange={(event) => setNewRegion(event.target.value as "US" | "China/HK")}><option>US</option><option>China/HK</option></select></label><button className="primary-action">Add pending ticker</button></form>
      <div className="universe-summary"><span>{approvedCount} approved</span><span>{pendingCount} pending</span><span>{universe.filter((item) => item.status === "disabled").length} disabled</span></div>
      <section className="panel table-panel"><table><thead><tr><th>Ticker</th><th>Market</th><th>Status</th><th>Source</th><th>Research thesis</th><th>Action</th></tr></thead><tbody>{universe.map((item) => <tr key={item.ticker}><td><strong>{item.ticker}</strong></td><td>{item.region}</td><td><span className={`status-pill status-${item.status}`}>{item.status}</span></td><td>{item.source}</td><td>{item.thesis || "Awaiting research"}</td><td><div className="row-actions">{item.status !== "approved" && <button onClick={() => changeTicker(item.ticker, "approved")}>Approve</button>}{item.status === "approved" && <button onClick={() => changeTicker(item.ticker, "disabled")}>Disable</button>}<button className="danger" onClick={() => removeTicker(item.ticker)}>Delete</button></div></td></tr>)}</tbody></table>{!universe.length && <p className="empty-copy table-empty">The universe starts empty. Add tickers or approve AI candidates after a Think Standard run.</p>}</section>
    </>;
  }

  function PortfolioView() {
    const positions = portfolio.positions ?? [];
    return <><section className="section-title portfolio-title"><div><p className="eyebrow">SIMULATED CAPITAL</p><h2>Paper portfolio</h2><p>No broker connection exists. Unallocatable stock budgets remain in cash.</p></div><button className="primary-action" onClick={runNow} disabled={running || !setupReady}>{running ? "Building allocation" : positions.length ? "Refresh Allocation" : "Create First Allocation"}</button></section>
      <section className="portfolio-overview panel"><AllocationDonut stockPct={Number(latestDecision?.stockPct ?? 0)} cashPct={Number(latestDecision?.cashPct ?? 100)} label={String(latestDecision?.mode ?? "Cash")} /><div className="portfolio-brief"><span>Current mandate</span><h3>{String(latestDecision?.mode ?? "Cash protection")}</h3><p>{positions.length ? `${positions.length} approved holdings are active in the simulated portfolio.` : approvedCount ? `${approvedCount} stocks are approved. Run the committee to create the first controlled allocation.` : "Approve eligible stocks in Universe, then create the first allocation."}</p><div><b>US sleeve {Number(latestDecision?.usSleevePct ?? 0).toFixed(0)}%</b><b>China/HK sleeve {Number(latestDecision?.chinaSleevePct ?? 0).toFixed(0)}%</b></div></div></section>
      <div className="summary-grid"><article><span>Current NAV</span><strong>${currentNav.toFixed(2)}</strong></article><article><span>Mode</span><strong>{String(latestDecision?.mode ?? "Cash")}</strong></article><article><span>Stock weight</span><strong>{Number(latestDecision?.stockPct ?? 0).toFixed(1)}%</strong></article><article><span>Cash weight</span><strong>{Number(latestDecision?.cashPct ?? 100).toFixed(1)}%</strong></article></div>
      <section className="panel table-panel"><table><thead><tr><th>Ticker</th><th>Market</th><th>Weight</th><th>Allocation</th><th>Reference price</th></tr></thead><tbody>{positions.map((position) => <tr key={String(position.ticker)}><td><strong>{String(position.ticker)}</strong></td><td>{String(position.region)}</td><td>{Number(position.weightPct).toFixed(2)}%</td><td><div className="weight-bar"><i style={{ width: `${Math.min(100, Number(position.weightPct) * 10)}%` }} /></div></td><td>${Number(position.lastPrice ?? 0).toFixed(2)}</td></tr>)}</tbody></table>{!positions.length && <p className="empty-copy table-empty">The portfolio is 100% cash until the Investment Committee allocates approved securities.</p>}</section>
      {!!stages.length && <section className="panel stage-panel" aria-live="polite"><div className="panel-head"><h3>Allocation progress</h3><span>{stages[stages.length - 1]?.stage}</span></div><ol>{stages.map((stage, index) => <li className={index === stages.length - 1 ? "active" : ""} key={`${stage.stage}-${index}`}><b>{index + 1}</b><div><strong>{stage.stage}</strong><span>{stage.message}</span></div></li>)}</ol></section>}
    </>;
  }

  function DecisionsView() {
    const decisions = portfolio.decisions ?? [];
    return <><section className="section-title"><p className="eyebrow">AUDIT TRAIL</p><h2>Decision journal</h2><p>Every final mode, Risk opinion, evidence source, and allocation is retained.</p></section>
      <section className="decision-list">{decisions.map((decision) => <article className="panel" key={String(decision.id)}><div className="panel-head"><div><span>{new Date(String(decision.createdAt)).toLocaleString()}</span><h3>{String(decision.mode)}</h3></div><ModeBadge mode={String(decision.mode)} /></div><p>{String(decision.rationale)}</p><div className="decision-numbers"><span>{Number(decision.stockPct).toFixed(1)}% stocks</span><span>{Number(decision.cashPct).toFixed(1)}% cash</span><span>{Number(decision.usSleevePct).toFixed(1)}% US sleeve</span><span>{String(decision.riskOpinion)}</span></div><Sources citations={decision.citations as Citation[]} /></article>)}{!decisions.length && <p className="empty-copy">No committee decisions have been recorded.</p>}</section>
    </>;
  }

  function PerformanceView() {
    return <><section className="section-title"><p className="eyebrow">MEASUREMENT</p><h2>Performance and prediction quality</h2><p>Metrics become meaningful as weekly paper decisions and realized outcomes accumulate.</p></section>
      <div className="metric-grid"><article><span>CAGR</span><strong>{percent(riskMetrics.cagr)}</strong><small>Paper NAV</small></article><article><span>Annual volatility</span><strong>{percent(riskMetrics.annualizedVolatility)}</strong><small>Weekly observations</small></article><article><span>Sharpe</span><strong>{Number(riskMetrics.sharpe ?? 0).toFixed(2)}</strong><small>Cash return assumed at zero</small></article><article><span>Maximum drawdown</span><strong>{percent(riskMetrics.maximumDrawdown)}</strong><small>Peak-to-trough paper NAV</small></article><article><span>Prediction hit rate</span><strong>{riskMetrics.predictionHitRate == null ? "Pending" : percent(riskMetrics.predictionHitRate)}</strong></article><article><span>Brier score</span><strong>{riskMetrics.brierScore == null ? "Pending" : Number(riskMetrics.brierScore).toFixed(3)}</strong></article><article><span>Turnover</span><strong>{percent(riskMetrics.turnover)}</strong><small>Cumulative one-way turnover</small></article><article><span>Cash drag</span><strong>{percent(riskMetrics.cashDrag)}</strong><small>Versus the stock control</small></article><article><span>Mechanical control</span><strong>{percent(riskBaseline.mechanicalTrendReturn)}</strong><small>{Number(riskBaseline.periods ?? 0)} periods</small></article><article><span>Fully invested control</span><strong>{percent(riskBaseline.fullyInvestedStockReturn)}</strong><small>Equal-weighted market proxies</small></article></div>
      <section className="panel"><h3>NAV history</h3><div className="nav-bars">{nav.map((item) => <div key={String(item.date)}><i style={{ height: `${Math.max(8, Number(item.nav) / Math.max(...nav.map((row) => Number(row.nav))) * 100)}%` }} /><span>{String(item.date).slice(5)}</span></div>)}</div></section>
    </>;
  }

  function RiskView() {
    return <><section className="section-title"><p className="eyebrow">INDEPENDENT CHALLENGE</p><h2>Risk Agent review</h2><p>The Risk Agent reviews evidence, data freshness, model disagreement, concentration, volatility, and decision quality.</p></section>
      <div className="risk-layout"><section className="panel"><div className="panel-head"><h3>Current controls</h3><span className="status-pill status-approved">Enforced in code</span></div><ul className="control-list"><li>No broker or live-trading connection</li><li>Maximum 10% NAV per approved security</li><li>US and China/HK sleeve bounds of 35% to 65%</li><li>Stock and cash weights total 100%</li><li>Portfolio freeze beyond five stale trading days</li><li>Candidate stocks require human approval</li></ul></section><section className="panel"><div className="panel-head"><h3>Latest improvement priorities</h3><span>{Number(risk.observations ?? 0)} observations</span></div><ol className="experiment-list">{improvementExperiments.length ? improvementExperiments.slice(0, 3).map((experiment, index) => <li key={index}><strong>{String(experiment.objective)}</strong><span>{String(experiment.test)} Success: {String(experiment.successMeasure)}</span></li>) : <><li><strong>Improve Sharpe</strong><span>Compare the fusion committee with the mechanical control on identical data.</span></li><li><strong>Lower volatility</strong><span>Test volatility-aware security weights and regional stress cases.</span></li><li><strong>Improve calibration</strong><span>Track hit rate, Brier score, and expected-return error weekly.</span></li></>}</ol></section></div>
    </>;
  }

  const content = view === "committee" ? CommitteeView() : view === "weather" ? WeatherView() : view === "workflow" ? WorkflowView() : view === "universe" ? UniverseView() : view === "portfolio" ? PortfolioView() : view === "decisions" ? DecisionsView() : view === "performance" ? PerformanceView() : RiskView();
  const nextStep = !setupReady ? { title: "Check system setup", detail: "Open the workflow and confirm the required services are ready.", action: "Check setup" } : running ? { title: "Watch the committee", detail: "The agents are working now. Follow the live stage updates.", action: "Watch now" } : pendingCount > 0 ? { title: `Review ${pendingCount} pending stock${pendingCount === 1 ? "" : "s"}`, detail: "Approve or reject candidates before they can receive a paper allocation.", action: "Review candidates" } : !latestDecision ? { title: "Run the first committee", detail: "Create a researched mode and simulated stock-cash allocation.", action: "Run committee" } : activeMods.length > 0 ? { title: "Review active modifications", detail: `${activeMods.length} temporary instruction${activeMods.length === 1 ? " is" : "s are"} affecting the portfolio.`, action: "Review controls" } : { title: "Ask Nova to explain the position", detail: `${weatherMode} gear is active with ${displayCashPct.toFixed(0)}% cash. Get the CIO explanation.`, action: "Visit the CIO" };

  return <main className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <header className="topbar"><div className="brand-lockup"><span className="omega" aria-hidden="true">Ω</span><div><p>OH MEGA CAPITAL</p><h1>Investment Command Center</h1></div></div><div className="single-profile"><span>AI MODE</span><strong>Think · Standard</strong></div><div className="live-state" role="status"><i className={setupReady ? "ready" : ""} /><span>{setupReady ? "Systems operational" : "Setup required"}</span><b>SIMULATED</b></div></header>
    <nav className="quick-dock grouped-dock" aria-label="Grouped command center navigation"><button className={view === "committee" ? "active" : ""} onClick={() => goToRoom("lounge")}><i>⌂</i><span>Today</span></button><details><summary><i>♟</i><span>Agents</span></summary><div><button onClick={() => goToRoom("research", "research")}>Research</button><button onClick={() => goToRoom("risk", "risk")}>Risk</button><button onClick={() => goToRoom("cio", "cio")}>CIO</button><button onClick={() => goToHouse("chat")}>Ask an agent</button></div></details><button className={view === "portfolio" ? "active" : ""} onClick={() => setView("portfolio")}><i>◐</i><span>Portfolio</span></button><details><summary><i>≡</i><span>Records</span></summary><div><button onClick={() => setView("weather")}>Current position</button><button onClick={() => setView("performance")}>Results</button><button onClick={() => setView("universe")}>Approved stocks {pendingCount ? `(${pendingCount})` : ""}</button><button onClick={() => setView("decisions")}>Decision journal</button><button onClick={() => setView("workflow")}>How it works</button></div></details></nav>
    <div className="app-grid"><section className="content" id="main-content" tabIndex={-1}><section className="next-step-card" aria-label="Recommended next action"><div className="next-step-number">NEXT</div><div><span>Tap this next</span><strong>{nextStep.title}</strong><small>{nextStep.detail}</small></div><button onClick={takeNextAction} disabled={running && view === "committee"}>{nextStep.action} →</button></section><div className="page-context">{view !== "committee" && <button className="back-house" onClick={() => goToHouse()}>← House</button>}<div><span>You are here</span><strong>{currentView.label}</strong></div><small>{setupReady ? "Live system" : "Connecting"}</small></div>{view !== "committee" && <div className="navigation-guide"><div><strong>{currentView.label}</strong><span>{view === "portfolio" ? "See what the simulated fund owns and how much cash it holds." : view === "weather" ? "See the current gear, allocation limits, and active instructions." : view === "performance" ? "Review returns, volatility, drawdown, and prediction quality." : view === "risk" ? "Review challenges, hard controls, and improvement ideas." : view === "universe" ? "Approve the stocks the paper portfolio is allowed to hold." : view === "decisions" ? "Read the permanent record of past committee decisions." : "Follow how data moves through each agent and control."}</span></div><button onClick={() => goToHouse("chat")}>Ask an agent about this</button></div>}<CommitteePet />{content}{error && <div className="error-toast" role="alert"><strong>Review required</strong><span>{error}</span><button onClick={() => setError("")}>Close</button></div>}</section></div>
  </main>;
}
