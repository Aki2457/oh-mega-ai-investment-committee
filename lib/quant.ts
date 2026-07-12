import type { MarketFeatures, Mode, PricePoint, Region } from "./types";

export function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value));
}

export function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function sampleStd(values: number[]) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

export function returnsFromPrices(values: number[]) {
  return values.slice(1).map((value, index) => value / values[index] - 1);
}

export function periodReturn(values: number[], days: number) {
  if (values.length <= days) return 0;
  return values.at(-1)! / values.at(-(days + 1))! - 1;
}

export function correlation(left: number[], right: number[]) {
  const size = Math.min(left.length, right.length);
  if (size < 3) return 0;
  const a = left.slice(-size);
  const b = right.slice(-size);
  const ma = mean(a);
  const mb = mean(b);
  const numerator = a.reduce((sum, value, index) => sum + (value - ma) * (b[index] - mb), 0);
  const denominator = Math.sqrt(
    a.reduce((sum, value) => sum + (value - ma) ** 2, 0) *
    b.reduce((sum, value) => sum + (value - mb) ** 2, 0),
  );
  return denominator ? numerator / denominator : 0;
}

export function tradingDaysBetween(from: string, to = new Date().toISOString().slice(0, 10)) {
  let cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  let count = 0;
  while (cursor < end) {
    cursor = new Date(cursor.getTime() + 86_400_000);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

export function convertToUsd(points: PricePoint[], fxPoints: PricePoint[]) {
  const fxByDate = new Map(fxPoints.map((point) => [point.date, point.adjustedClose]));
  let lastFx = fxPoints[0]?.adjustedClose ?? 7.8;
  return points.map((point) => {
    if (fxByDate.has(point.date)) lastFx = fxByDate.get(point.date)!;
    return { ...point, close: point.close / lastFx, adjustedClose: point.adjustedClose / lastFx };
  });
}

export function calculateFeatures(
  ticker: string,
  region: Region,
  currency: string,
  points: PricePoint[],
  proxyPoints: PricePoint[],
  source: "live" | "cache",
): MarketFeatures {
  if (points.length < 210) throw new Error(`${ticker} requires at least 210 daily observations`);
  const prices = points.map((point) => point.adjustedClose);
  const volumes = points.map((point) => point.volume).filter(Number.isFinite);
  const dailyReturns = returnsFromPrices(prices);
  const proxyReturns = returnsFromPrices(proxyPoints.map((point) => point.adjustedClose));
  const latest = prices.at(-1)!;
  const high52 = Math.max(...prices.slice(-252));
  const avgVolume20 = mean(volumes.slice(-20));
  const avgVolume60 = mean(volumes.slice(-60));
  return {
    ticker,
    region,
    currency,
    asOf: points.at(-1)!.date,
    price: latest,
    staleTradingDays: tradingDaysBetween(points.at(-1)!.date),
    source,
    return1w: periodReturn(prices, 5),
    return4w: periodReturn(prices, 20),
    return12w: periodReturn(prices, 60),
    return26w: periodReturn(prices, 130),
    volatility20d: sampleStd(dailyReturns.slice(-20)) * Math.sqrt(252),
    volatility60d: sampleStd(dailyReturns.slice(-60)) * Math.sqrt(252),
    drawdown52w: latest / high52 - 1,
    volumeTrend: avgVolume60 ? avgVolume20 / avgVolume60 - 1 : 0,
    averageDollarVolume20d: mean(points.slice(-20).map((point) => point.adjustedClose * point.volume)),
    above50d: latest > mean(prices.slice(-50)),
    above200d: latest > mean(prices.slice(-200)),
    relativeStrength12w: periodReturn(prices, 60) - periodReturn(proxyPoints.map((point) => point.adjustedClose), 60),
    correlation60d: correlation(dailyReturns.slice(-60), proxyReturns.slice(-60)),
  };
}

export function mechanicalMode(us: MarketFeatures, china: MarketFeatures): Mode {
  const votes = Number(us.above200d) + Number(china.above200d);
  return votes === 2 ? "Attack" : votes === 1 ? "Balanced" : "Defense";
}

export function modeWeights(mode: Mode) {
  if (mode === "Lockdown") return { stockPct: 0, cashPct: 100 };
  if (mode === "Attack") return { stockPct: 90, cashPct: 10 };
  if (mode === "Balanced") return { stockPct: 55, cashPct: 45 };
  return { stockPct: 25, cashPct: 75 };
}
