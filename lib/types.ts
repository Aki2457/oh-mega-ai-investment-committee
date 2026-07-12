export type Region = "US" | "China/HK";
export type Mode = "Attack" | "Balanced" | "Defense";
export type Profile = "flash" | "think" | "pro";
export type AgentKind = "research" | "cio" | "risk";

export type Citation = {
  url: string;
  title: string;
  content?: string;
};

export type PricePoint = {
  date: string;
  close: number;
  adjustedClose: number;
  volume: number;
};

export type MarketFeatures = {
  ticker: string;
  region: Region;
  currency: string;
  asOf: string;
  price: number;
  staleTradingDays: number;
  source: "live" | "cache";
  return1w: number;
  return4w: number;
  return12w: number;
  return26w: number;
  volatility20d: number;
  volatility60d: number;
  drawdown52w: number;
  volumeTrend: number;
  averageDollarVolume20d: number;
  above50d: boolean;
  above200d: boolean;
  relativeStrength12w: number;
  correlation60d: number;
};

export type MarketPack = {
  generatedAt: string;
  dataAsOf: string;
  stale: boolean;
  frozen: boolean;
  mechanicalMode: Mode;
  approvedTickers: Array<{ ticker: string; region: Region }>;
  features: MarketFeatures[];
  providerChecks: Array<{
    ticker: string;
    quotes: Array<{ provider: "yahoo" | "massive" | "alphaVantage" | "finnhub"; price: number; asOf: string }>;
    consensusPrice: number;
    maximumDifferencePct: number;
    agreement: "confirmed" | "warning" | "yahoo-only";
  }>;
};

export type CandidateStock = {
  ticker: string;
  region: Region;
  reason: string;
  confidence: number;
  citations: Citation[];
};

export type AnalystOpinion = {
  role: string;
  model: string;
  mode: Mode;
  usUpProbability: number;
  chinaUpProbability: number;
  usExpectedReturnPct: number;
  chinaExpectedReturnPct: number;
  confidence: number;
  catalysts: string[];
  risks: string[];
  rationale: string;
  candidates: CandidateStock[];
  stockViews: Array<{ ticker: string; upProbability: number; expectedReturnPct: number; catalystScore: number }>;
  citations: Citation[];
};

export type RiskOpinion = {
  opinion: "Support" | "Support with conditions" | "Challenge";
  confidence: number;
  concerns: string[];
  conditions: string[];
  improvementExperiments: Array<{
    objective: string;
    test: string;
    successMeasure: string;
    tradeoff: string;
  }>;
  rationale: string;
};

export type JudgeScore = {
  role: string;
  evidenceQuality: number;
  dataConsistency: number;
  calibration: number;
  sourceQuality: number;
  riskAwareness: number;
  total: number;
};

export type FinalDecision = {
  mode: Mode;
  confidence: number;
  usUpProbability: number;
  chinaUpProbability: number;
  usExpectedReturnPct: number;
  chinaExpectedReturnPct: number;
  usSleevePct: number;
  chinaSleevePct: number;
  rationale: string;
  riskOverrideRationale: string;
  analystScores: JudgeScore[];
  candidates: CandidateStock[];
  stockViews: Array<{ ticker: string; upProbability: number; expectedReturnPct: number; catalystScore: number }>;
  citations: Citation[];
};

export type PortfolioProposal = {
  mode: Mode;
  stockPct: number;
  cashPct: number;
  usSleevePct: number;
  chinaSleevePct: number;
  positions: Array<{ ticker: string; region: Region; weightPct: number; referencePrice: number }>;
  unallocatedStockPct: number;
  referencePrices: Record<string, number>;
};
