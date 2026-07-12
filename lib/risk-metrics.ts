import { getPortfolio, listRuns } from "@/db/repository";
import { mean, modeWeights, sampleStd } from "./quant";

function maxDrawdown(values: number[]) {
  let peak = values[0] ?? 100;
  let worst = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    worst = Math.min(worst, value / peak - 1);
  }
  return worst;
}

export async function calculateRiskDashboard() {
  const portfolio = await getPortfolio();
  const runs = await listRuns(100);
  const nav = portfolio.nav.map((item) => item.nav);
  const returns = nav.slice(1).map((value, index) => value / nav[index] - 1);
  const years = Math.max(returns.length / 52, 1 / 52);
  const cumulative = nav.length > 1 ? nav.at(-1)! / nav[0] - 1 : 0;
  const cagr = (1 + cumulative) ** (1 / years) - 1;
  const volatility = returns.length > 1 ? sampleStd(returns) * Math.sqrt(52) : 0;
  const sharpe = volatility ? mean(returns) * 52 / volatility : 0;
  const downside = returns.filter((value) => value < 0);
  const downsideDeviation = downside.length ? Math.sqrt(mean(downside.map((value) => value ** 2))) * Math.sqrt(52) : 0;
  const sortino = downsideDeviation ? mean(returns) * 52 / downsideDeviation : 0;
  type RunShape = {
    status: string;
    final: Record<string, unknown>;
    market: { mechanicalMode?: "Attack" | "Balanced" | "Defense"; features?: Array<{ ticker: string; return1w: number }> };
    opinions?: Array<{ role: string; payload: Record<string, unknown> }>;
  };
  const typedRuns = runs as RunShape[];
  const completed = typedRuns.filter((run) => run.status === "completed" && run.final.usUpProbability != null);
  const predictions = completed.slice().reverse();
  const outcomes = predictions.slice(0, -1).map((run, index) => {
    const next = predictions[index + 1];
    const nextUs = next.market.features?.find((item) => item.ticker === "QQQ")?.return1w ?? 0;
    const nextChina = next.market.features?.find((item) => item.ticker === "3067.HK")?.return1w ?? 0;
    const usP = Number(run.final.usUpProbability);
    const chinaP = Number(run.final.chinaUpProbability);
    return {
      hit: Number((usP >= 0.5) === (nextUs >= 0)) + Number((chinaP >= 0.5) === (nextChina >= 0)),
      brier: ((usP - Number(nextUs >= 0)) ** 2 + (chinaP - Number(nextChina >= 0)) ** 2) / 2,
      returnError: (Math.abs(Number(run.final.usExpectedReturnPct) / 100 - nextUs) + Math.abs(Number(run.final.chinaExpectedReturnPct) / 100 - nextChina)) / 2,
    };
  });
  const controlPeriods = predictions.slice(0, -1).map((run, index) => {
    const next = predictions[index + 1];
    const nextUs = next.market.features?.find((item) => item.ticker === "QQQ")?.return1w ?? 0;
    const nextChina = next.market.features?.find((item) => item.ticker === "3067.HK")?.return1w ?? 0;
    const usSleeve = Number(run.final.usSleevePct ?? 50) / 100;
    const chinaSleeve = Number(run.final.chinaSleevePct ?? 50) / 100;
    const committeeStockWeight = modeWeights((run.final.mode ?? "Balanced") as "Attack" | "Balanced" | "Defense").stockPct / 100;
    const mechanicalStockWeight = modeWeights(run.market.mechanicalMode ?? "Balanced").stockPct / 100;
    const stockControlReturn = (nextUs + nextChina) / 2;
    return {
      committeeReturn: committeeStockWeight * (usSleeve * nextUs + chinaSleeve * nextChina),
      mechanicalReturn: mechanicalStockWeight * stockControlReturn,
      stockControlReturn,
      usAttribution: committeeStockWeight * usSleeve * nextUs,
      chinaAttribution: committeeStockWeight * chinaSleeve * nextChina,
      cashDrag: (1 - committeeStockWeight) * stockControlReturn,
    };
  });
  const compound = (items: number[]) => items.reduce((value, item) => value * (1 + item), 1) - 1;
  const latestRun = typedRuns[0];
  const latestRisk = latestRun?.opinions?.find((opinion) => opinion.role === "Risk Agent")?.payload ?? null;
  const turnover = portfolio.transactions.reduce((sum, item) => sum + Math.abs(item.tradeWeightPct), 0) / 2 / 100;
  return {
    metrics: {
      cumulativeReturn: cumulative, cagr, annualizedVolatility: volatility, sharpe, sortino,
      maximumDrawdown: maxDrawdown(nav), predictionHitRate: outcomes.length ? outcomes.reduce((sum, item) => sum + item.hit, 0) / (outcomes.length * 2) : null,
      brierScore: outcomes.length ? mean(outcomes.map((item) => item.brier)) : null,
      expectedReturnError: outcomes.length ? mean(outcomes.map((item) => item.returnError)) : null,
      cashDrag: controlPeriods.length ? controlPeriods.reduce((sum, item) => sum + item.cashDrag, 0) : 0,
      turnover,
      regionalAttribution: {
        us: controlPeriods.reduce((sum, item) => sum + item.usAttribution, 0),
        chinaHongKong: controlPeriods.reduce((sum, item) => sum + item.chinaAttribution, 0),
      },
    },
    observations: returns.length,
    latestRisk,
    baseline: {
      committeeIndexReturn: compound(controlPeriods.map((item) => item.committeeReturn)),
      mechanicalTrendReturn: compound(controlPeriods.map((item) => item.mechanicalReturn)),
      fullyInvestedStockReturn: compound(controlPeriods.map((item) => item.stockControlReturn)),
      periods: controlPeriods.length,
    },
    controls: { mechanicalTrend: "Mode weights applied to equal-weighted US and China/HK controls", fullyInvestedStock: "Equal-weighted QQQ and 3067.HK USD control" },
  };
}
