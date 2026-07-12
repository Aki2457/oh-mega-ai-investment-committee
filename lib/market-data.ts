import { getMarketCache, getPaperPositionTickers, listUniverse, setMarketCache } from "@/db/repository";
import { calculateFeatures, convertToUsd, mechanicalMode, tradingDaysBetween } from "./quant";
import { crossCheckQuote } from "./stock-providers";
import type { MarketPack, PricePoint, Region } from "./types";

type YahooSeries = { ticker: string; currency: string; points: PricePoint[]; source: "live" | "cache" };

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function parseYahoo(ticker: string, payload: unknown): YahooSeries {
  const chart = payload as { chart?: { result?: Array<{ meta?: { currency?: string }; timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null>; volume?: Array<number | null> }>; adjclose?: Array<{ adjclose?: Array<number | null> }> } }> } };
  const result = chart.chart?.result?.[0];
  if (!result?.timestamp?.length) throw new Error(`${ticker} returned no observations`);
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose ?? closes;
  const volumes = result.indicators?.quote?.[0]?.volume ?? [];
  const points: PricePoint[] = [];
  result.timestamp.forEach((timestamp, index) => {
    const close = closes[index];
    const adjustedClose = adjusted[index];
    if (close == null || adjustedClose == null || !Number.isFinite(close) || !Number.isFinite(adjustedClose)) return;
    points.push({
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      close,
      adjustedClose,
      volume: Number(volumes[index] ?? 0),
    });
  });
  if (points.length < 210) throw new Error(`${ticker} has only ${points.length} valid observations`);
  return { ticker, currency: result.meta?.currency ?? "USD", points, source: "live" };
}

export async function fetchYahooSeries(ticker: string): Promise<YahooSeries> {
  const period2 = Math.floor(Date.now() / 1000) + 86_400;
  const period1 = period2 - 900 * 86_400;
  const query = new URLSearchParams({ period1: String(period1), period2: String(period2), interval: "1d", events: "div,splits" });
  let lastError = "Yahoo data unavailable";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const host = attempt % 2 === 0 ? "query1.finance.yahoo.com" : "query2.finance.yahoo.com";
    try {
      const response = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?${query}`, {
        headers: { "User-Agent": "Mozilla/5.0 OH-MEGA/2.0" }, cache: "no-store",
      });
      if (!response.ok) throw new Error(`${ticker} returned ${response.status}`);
      const parsed = parseYahoo(ticker, await response.json());
      await setMarketCache(ticker, parsed.points.at(-1)!.date, parsed);
      return parsed;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      if (attempt < 3) await pause(600 * (attempt + 1));
    }
  }
  try {
    const yahooUrl = `http://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?${query}`;
    const response = await fetch(`https://r.jina.ai/${yahooUrl}`, {
      headers: { "User-Agent": "Mozilla/5.0 OH-MEGA/2.0" }, cache: "no-store",
    });
    if (!response.ok) throw new Error(`${ticker} Yahoo relay returned ${response.status}`);
    const body = await response.text();
    const jsonStart = body.indexOf('{"chart"');
    if (jsonStart < 0) throw new Error(`${ticker} Yahoo relay returned an invalid payload`);
    const parsed = parseYahoo(ticker, JSON.parse(body.slice(jsonStart)));
    await setMarketCache(ticker, parsed.points.at(-1)!.date, parsed);
    return parsed;
  } catch (error) {
    lastError = error instanceof Error ? error.message : lastError;
  }
  const cached = await getMarketCache(ticker);
  if (cached) {
    const parsed = cached.payload as YahooSeries;
    if (parsed?.points?.length) return { ...parsed, source: "cache" };
  }
  throw new Error(`${ticker}: ${lastError}`);
}

export async function buildMarketPack(): Promise<MarketPack> {
  const approved = (await listUniverse()).filter((item) => item.status === "approved");
  const held = await getPaperPositionTickers();
  const requested = [
    { ticker: "QQQ", region: "US" as Region },
    { ticker: "3067.HK", region: "China/HK" as Region },
    { ticker: "HKD=X", region: "China/HK" as Region },
    ...approved.map((item) => ({ ticker: item.ticker, region: item.region })),
    ...held,
  ];
  const unique = Array.from(new Map(requested.map((item) => [item.ticker, item])).values());
  const series = new Map<string, YahooSeries>();
  for (const item of unique) {
    series.set(item.ticker, await fetchYahooSeries(item.ticker));
    await pause(200);
  }
  const providerChecks = [];
  for (const item of unique.filter((entry) => entry.ticker !== "HKD=X")) {
    const latest = series.get(item.ticker)!.points.at(-1)!;
    providerChecks.push(await crossCheckQuote(item.ticker, item.region, latest.adjustedClose, latest.date));
  }
  const fx = series.get("HKD=X")!;
  const usProxy = series.get("QQQ")!;
  const chinaRaw = series.get("3067.HK")!;
  const chinaUsd: YahooSeries = { ...chinaRaw, points: convertToUsd(chinaRaw.points, fx.points) };
  const features = [];
  const usFeature = calculateFeatures("QQQ", "US", "USD", usProxy.points, usProxy.points, usProxy.source);
  const chinaFeature = calculateFeatures("3067.HK", "China/HK", "USD", chinaUsd.points, chinaUsd.points, chinaRaw.source);
  features.push(usFeature, chinaFeature);
  const stockItems = Array.from(new Map([...approved, ...held].map((item) => [item.ticker, item])).values());
  for (const item of stockItems) {
    const raw = series.get(item.ticker)!;
    const points = item.region === "China/HK" ? convertToUsd(raw.points, fx.points) : raw.points;
    const proxy = item.region === "China/HK" ? chinaUsd.points : usProxy.points;
    features.push(calculateFeatures(item.ticker, item.region, "USD", points, proxy, raw.source));
  }
  const dataAsOf = features.map((feature) => feature.asOf).sort()[0];
  const maximumAge = Math.max(...features.map((feature) => tradingDaysBetween(feature.asOf)));
  return {
    generatedAt: new Date().toISOString(),
    dataAsOf,
    stale: maximumAge > 0 || features.some((feature) => feature.source === "cache"),
    frozen: maximumAge > 5,
    mechanicalMode: mechanicalMode(usFeature, chinaFeature),
    approvedTickers: approved.map((item) => ({ ticker: item.ticker, region: item.region })),
    features,
    providerChecks,
  };
}
