import assert from "node:assert/strict";
import test from "node:test";
import { buildProposal, forecastWeek } from "../lib/allocation";
import type { FinalDecision, MarketFeatures, MarketPack } from "../lib/types";

const baseFeature: MarketFeatures = {
  ticker: "QQQ", region: "US", currency: "USD", asOf: "2026-07-10", price: 100, staleTradingDays: 0, source: "live",
  return1w: 0.01, return4w: 0.03, return12w: 0.08, return26w: 0.12, volatility20d: 0.2, volatility60d: 0.22,
  drawdown52w: -0.05, volumeTrend: 0.1, averageDollarVolume20d: 100_000_000, above50d: true, above200d: true,
  relativeStrength12w: 0.03, correlation60d: 0.8,
};

const final: FinalDecision = {
  mode: "Attack", confidence: 0.8, usUpProbability: 0.65, chinaUpProbability: 0.58, usExpectedReturnPct: 1, chinaExpectedReturnPct: 0.7,
  usSleevePct: 65, chinaSleevePct: 35, rationale: "Test", riskOverrideRationale: "", analystScores: [], candidates: [], citations: [],
  stockViews: [],
};

function pack(approved: MarketPack["approvedTickers"], features: MarketFeatures[]): MarketPack {
  return { generatedAt: "2026-07-11T00:00:00Z", dataAsOf: "2026-07-10", stale: false, frozen: false, mechanicalMode: "Attack", approvedTickers: approved, features, providerChecks: [], warnings: [] };
}

test("keeps an empty approved universe fully in cash", () => {
  const proposal = buildProposal(pack([], [baseFeature]), final);
  assert.equal(proposal.stockPct, 0);
  assert.equal(proposal.cashPct, 100);
});

test("enforces single-name caps and preserves total weight", () => {
  const features = Array.from({ length: 12 }, (_, index) => ({ ...baseFeature, ticker: `U${index}`, region: "US" as const, price: 100 + index }));
  const approved = features.map((feature) => ({ ticker: feature.ticker, region: feature.region }));
  const proposal = buildProposal(pack(approved, features), final);
  assert.ok(proposal.positions.every((position) => position.weightPct <= 10));
  assert.ok(Math.abs(proposal.stockPct + proposal.cashPct - 100) < 1e-9);
  assert.equal(proposal.usSleevePct + proposal.chinaSleevePct, 100);
});

test("uses the next Friday as the forecast week", () => {
  assert.equal(forecastWeek(new Date("2026-07-11T00:00:00Z")), "2026-07-17");
});
