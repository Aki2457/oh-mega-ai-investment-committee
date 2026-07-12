import { clamp, modeWeights } from "./quant";
import type { FinalDecision, MarketPack, PortfolioProposal, Region } from "./types";

export function forecastWeek(date = new Date()) {
  const current = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const daysToFriday = (5 - current.getUTCDay() + 7) % 7 || 7;
  current.setUTCDate(current.getUTCDate() + daysToFriday);
  return current.toISOString().slice(0, 10);
}

function normalize(values: number[]) {
  if (!values.length) return [];
  const low = Math.min(...values);
  const high = Math.max(...values);
  return high === low ? values.map(() => 0.5) : values.map((value) => (value - low) / (high - low));
}

export function buildProposal(pack: MarketPack, final: FinalDecision, controls?: { mode?: FinalDecision["mode"]; stockPct?: number; halted?: boolean }): PortfolioProposal {
  const effectiveMode = controls?.halted ? "Lockdown" : controls?.mode ?? final.mode;
  const baseTarget = modeWeights(effectiveMode);
  const target = { stockPct: controls?.halted ? 0 : clamp(controls?.stockPct ?? baseTarget.stockPct, 0, baseTarget.stockPct), cashPct: 0 };
  const approved = new Map(pack.approvedTickers.map((item) => [item.ticker, item.region]));
  const stockFeatures = pack.features.filter((feature) => approved.has(feature.ticker));
  const positions: PortfolioProposal["positions"] = [];
  const referencePrices = Object.fromEntries(pack.features.map((feature) => [feature.ticker, feature.price]));
  const regionShares: Record<Region, number> = {
    US: clamp(final.usSleevePct, 35, 65),
    "China/HK": clamp(final.chinaSleevePct, 35, 65),
  };
  const totalShares = regionShares.US + regionShares["China/HK"];
  regionShares.US = regionShares.US / totalShares * 100;
  regionShares["China/HK"] = 100 - regionShares.US;
  for (const region of ["US", "China/HK"] as Region[]) {
    const regional = stockFeatures.filter((feature) => feature.region === region);
    if (!regional.length) continue;
    const momentum = normalize(regional.map((feature) => feature.relativeStrength12w));
    const inverseVol = normalize(regional.map((feature) => -feature.volatility60d));
    const liquidity = normalize(regional.map((feature) => Math.log10(Math.max(1, feature.averageDollarVolume20d))));
    const scores = regional.map((feature, index) => {
      const view = final.stockViews.find((item) => item.ticker.toUpperCase() === feature.ticker.toUpperCase());
      const upProbability = view?.upProbability ?? (region === "US" ? final.usUpProbability : final.chinaUpProbability);
      const catalystScore = view?.catalystScore ?? 0.5;
      return 0.35 * upProbability + 0.25 * momentum[index] + 0.20 * inverseVol[index] + 0.10 * liquidity[index] + 0.10 * catalystScore;
    });
    const scoreTotal = scores.reduce((sum, value) => sum + Math.max(0.01, value), 0);
    const regionalBudget = target.stockPct * regionShares[region] / 100;
    regional.forEach((feature, index) => {
      const raw = regionalBudget * Math.max(0.01, scores[index]) / scoreTotal;
      positions.push({ ticker: feature.ticker, region, weightPct: Math.min(10, raw), referencePrice: feature.price });
    });
  }
  const allocated = positions.reduce((sum, position) => sum + position.weightPct, 0);
  return {
    mode: effectiveMode, stockPct: allocated, cashPct: 100 - allocated,
    usSleevePct: regionShares.US, chinaSleevePct: regionShares["China/HK"], positions,
    unallocatedStockPct: target.stockPct - allocated, referencePrices,
  };
}
