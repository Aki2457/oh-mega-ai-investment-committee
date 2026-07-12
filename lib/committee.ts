import {
  completeRun, createRun, failRun, findRunByWeek, listModifications, rebalancePaper, replaceCommitteeModifications, restartRun, saveCandidates, saveDecision, saveOpinion,
} from "@/db/repository";
import { buildMarketPack } from "./market-data";
import { buildProposal, forecastWeek } from "./allocation";
import { judgeDecision, macroOpinion, profileModels, quantitativeOpinion, riskOpinion } from "./openrouter";
import type { AnalystOpinion, FinalDecision, MarketFeatures, MarketPack, Profile, RiskOpinion } from "./types";

export type CommitteeStage = {
  stage: "starting" | "market-data" | "search" | "opinions" | "risk" | "judge" | "rebalance" | "complete" | "frozen" | "error";
  message: string;
  data?: unknown;
};

function frozenDecision(pack: MarketPack): FinalDecision {
  return {
    mode: pack.mechanicalMode, confidence: 0, usUpProbability: 0.5, chinaUpProbability: 0.5,
    usExpectedReturnPct: 0, chinaExpectedReturnPct: 0, usSleevePct: 50, chinaSleevePct: 50,
    rationale: "The committee froze the paper portfolio because market data exceeded the five-trading-day freshness limit.",
    riskOverrideRationale: "No override permitted during a data freeze.", analystScores: [], candidates: [], stockViews: [], citations: [],
  };
}

function fallbackOpinion(pack: MarketPack, role: string, reason: string): AnalystOpinion {
  const us = pack.features.find((feature) => feature.ticker === "QQQ");
  const china = pack.features.find((feature) => feature.ticker === "3067.HK");
  const probability = (feature?: MarketFeatures) => Math.max(0.2, Math.min(0.8, 0.5 + Number(feature?.return12w ?? 0) * 0.8 - Number(feature?.volatility60d ?? 0) * 0.08));
  return {
    role, model: "mechanical-fallback", mode: pack.mechanicalMode,
    usUpProbability: probability(us), chinaUpProbability: probability(china),
    usExpectedReturnPct: Number(us?.return4w ?? 0) * 25, chinaExpectedReturnPct: Number(china?.return4w ?? 0) * 25,
    confidence: 0.35, catalysts: ["Price momentum and trend controls"], risks: [reason],
    rationale: `The ${role} used the mechanical feature pack because the AI response could not be validated.`,
    candidates: [], citations: [],
    stockViews: pack.features.filter((feature) => pack.approvedTickers.some((item) => item.ticker === feature.ticker)).map((feature) => ({
      ticker: feature.ticker, upProbability: probability(feature), expectedReturnPct: feature.return4w * 25, catalystScore: 0.5,
    })),
  };
}

function fallbackRisk(reason: string): RiskOpinion {
  return {
    opinion: "Support with conditions", confidence: 0.4,
    concerns: [reason, "AI output requires a successful validated run before confidence can increase."],
    conditions: ["Apply every hard allocation control and retain excess budget in cash."],
    improvementExperiments: [
      { objective: "Restore AI validation", test: "Retry the committee with a schema-compliant provider response.", successMeasure: "All agent JSON validates without fallback.", tradeoff: "May increase latency." },
      { objective: "Limit volatility", test: "Compare inverse-volatility weights with the current score.", successMeasure: "Lower realized volatility without lower return.", tradeoff: "May reduce upside capture." },
      { objective: "Improve diversification", test: "Add approved China/HK technology names.", successMeasure: "Both regional sleeves receive eligible allocations.", tradeoff: "Adds regional risk." },
    ],
    rationale: "Risk permits a simulated allocation at low confidence because code-level controls remain enforceable.",
  };
}

function fallbackDecision(pack: MarketPack, opinion: AnalystOpinion, reason: string): FinalDecision {
  return {
    mode: pack.mechanicalMode, confidence: 0.35,
    usUpProbability: opinion.usUpProbability, chinaUpProbability: opinion.chinaUpProbability,
    usExpectedReturnPct: opinion.usExpectedReturnPct, chinaExpectedReturnPct: opinion.chinaExpectedReturnPct,
    usSleevePct: 50, chinaSleevePct: 50,
    rationale: `The CIO applied the ${pack.mechanicalMode} mechanical control after AI output validation failed. Hard limits remain active.`,
    riskOverrideRationale: reason, analystScores: [], candidates: [], stockViews: opinion.stockViews, citations: [],
  };
}

export async function runCommittee(input: {
  trigger: "manual" | "scheduled";
  profile: Profile;
  emit?: (stage: CommitteeStage) => void | Promise<void>;
}) {
  const profile = input.trigger === "scheduled" ? "pro" : input.profile;
  const week = forecastWeek();
  const existing = await findRunByWeek(week);
  if (existing?.status === "completed" || existing?.status === "frozen") {
    await input.emit?.({ stage: "complete", message: "This forecast week was already processed.", data: existing });
    return existing;
  }
  if (existing?.status === "running") {
    const createdAt = Date.parse(`${existing.createdAt.replace(" ", "T")}Z`);
    const abandoned = !Number.isFinite(createdAt) || Date.now() - createdAt > 5 * 60_000;
    if (!abandoned) {
      await input.emit?.({ stage: "complete", message: "This forecast week is already running.", data: existing });
      return existing;
    }
    await input.emit?.({ stage: "starting", message: "Recovering an abandoned committee run." });
  }
  const runId = existing?.id ?? crypto.randomUUID();
  if (!existing) await createRun({ id: runId, forecastWeek: week, trigger: input.trigger, profile });
  else await restartRun(runId, input.trigger, profile);
  try {
    await input.emit?.({ stage: "starting", message: `Starting ${profile.toUpperCase()} committee for week ending ${week}.` });
    await input.emit?.({ stage: "market-data", message: "Fetching adjusted Yahoo prices and calculating weekly features." });
    const pack = await buildMarketPack();
    if (pack.frozen) {
      const final = frozenDecision(pack);
      await completeRun(runId, pack, final, "frozen");
      await input.emit?.({ stage: "frozen", message: final.rationale, data: { runId, pack, final } });
      return { id: runId, forecastWeek: week, status: "frozen", market: pack, final };
    }
    await input.emit?.({ stage: "opinions", message: "Running the quantitative analyst." });
    const quantPromise = quantitativeOpinion(pack, profile);
    const macroPromise = profile === "flash" ? Promise.resolve(null) : (async () => {
      await input.emit?.({ stage: "search", message: "Searching current macro, policy, filing, and market evidence." });
      return macroOpinion(pack, profile);
    })();
    const [quantResult, macroResult] = await Promise.allSettled([quantPromise, macroPromise]);
    const quant = quantResult.status === "fulfilled" ? quantResult.value : fallbackOpinion(pack, "Quantitative Analyst", quantResult.reason instanceof Error ? quantResult.reason.message : "AI quantitative output failed validation");
    const macro = macroResult.status === "fulfilled" ? macroResult.value : fallbackOpinion(pack, "News and Macro Analyst", macroResult.reason instanceof Error ? macroResult.reason.message : "AI macro output failed validation");
    const analystOpinions = [quant, ...(macro ? [macro] : [])];
    for (const opinion of analystOpinions) await saveOpinion(runId, opinion.role, opinion.model, opinion);
    await input.emit?.({ stage: "risk", message: "Running the independent Risk challenge." });
    let risk: RiskOpinion;
    try { risk = await riskOpinion(pack, analystOpinions, profile); }
    catch (error) { risk = fallbackRisk(error instanceof Error ? error.message : "AI Risk output failed validation"); }
    await saveOpinion(runId, "Risk Agent", profileModels[profile].risk, risk);
    await input.emit?.({ stage: "judge", message: "Scoring evidence and making the CIO decision." });
    let final: FinalDecision;
    try { final = await judgeDecision(pack, analystOpinions, risk, profile); }
    catch (error) { final = fallbackDecision(pack, quant, error instanceof Error ? error.message : "AI CIO output failed validation"); }
    const manual = (await listModifications(true)).filter((item) => item.source === "manual");
    const gear = manual.find((item) => item.type === "gear")?.value as FinalDecision["mode"] | undefined;
    const allocation = manual.find((item) => item.type === "stock_allocation")?.value;
    const halted = manual.some((item) => item.type === "halt" && item.value !== "false") || gear === "Lockdown";
    const proposal = buildProposal(pack, final, { mode: gear, stockPct: allocation == null ? undefined : Number(allocation), halted });
    await saveCandidates(final.candidates);
    await saveDecision(runId, final, proposal, risk);
    await input.emit?.({ stage: "rebalance", message: proposal.positions.length ? "Updating the simulated paper portfolio." : "Approved universe is empty. The paper portfolio remains in cash." });
    await rebalancePaper(runId, proposal);
    await replaceCommitteeModifications(proposal.mode, proposal.stockPct, final.rationale);
    await completeRun(runId, pack, final);
    const result = { id: runId, forecastWeek: week, status: "completed", profile, market: pack, opinions: analystOpinions, risk, final, proposal };
    await input.emit?.({ stage: "complete", message: "Committee decision and paper allocation completed.", data: result });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Committee run failed";
    await failRun(runId, message);
    await input.emit?.({ stage: "error", message });
    throw error;
  }
}

export function marketSummary(pack: MarketPack) {
  const byTicker = (ticker: string): MarketFeatures | undefined => pack.features.find((feature) => feature.ticker === ticker);
  return { us: byTicker("QQQ"), china: byTicker("3067.HK"), approved: pack.approvedTickers, mechanicalMode: pack.mechanicalMode, dataAsOf: pack.dataAsOf, stale: pack.stale, providerChecks: pack.providerChecks };
}
