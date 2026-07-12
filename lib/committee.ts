import {
  completeRun, createRun, failRun, findRunByWeek, listUniverse, rebalancePaper, restartRun, saveCandidates, saveDecision, saveOpinion,
} from "@/db/repository";
import { buildMarketPack } from "./market-data";
import { buildProposal, forecastWeek } from "./allocation";
import { judgeDecision, macroOpinion, profileModels, quantitativeOpinion, riskOpinion } from "./openrouter";
import type { FinalDecision, MarketFeatures, MarketPack, Profile } from "./types";

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
    await input.emit?.({ stage: "complete", message: "This forecast week is already running.", data: existing });
    return existing;
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
    const [quant, macro] = await Promise.all([quantPromise, macroPromise]);
    const analystOpinions = [quant, ...(macro ? [macro] : [])];
    for (const opinion of analystOpinions) await saveOpinion(runId, opinion.role, opinion.model, opinion);
    await input.emit?.({ stage: "risk", message: "Running the independent Risk challenge." });
    const risk = await riskOpinion(pack, analystOpinions, profile);
    await saveOpinion(runId, "Risk Agent", profileModels[profile].risk, risk);
    await input.emit?.({ stage: "judge", message: "Scoring evidence and making the CIO decision." });
    const final = await judgeDecision(pack, analystOpinions, risk, profile);
    const proposal = buildProposal(pack, final);
    await saveCandidates(final.candidates);
    await saveDecision(runId, final, proposal, risk);
    await input.emit?.({ stage: "rebalance", message: proposal.positions.length ? "Updating the simulated paper portfolio." : "Approved universe is empty. The paper portfolio remains in cash." });
    await rebalancePaper(runId, proposal);
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
