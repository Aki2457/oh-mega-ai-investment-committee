import type { Region } from "./types";

export type StockProvider = "yahoo" | "massive" | "alphaVantage" | "finnhub";
export type ProviderQuote = { provider: StockProvider; price: number; asOf: string };
export type ProviderCheck = {
  ticker: string;
  quotes: ProviderQuote[];
  consensusPrice: number;
  maximumDifferencePct: number;
  agreement: "confirmed" | "warning" | "yahoo-only";
};

const timeoutMs = 10_000;

async function getJson(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`provider returned ${response.status}`);
    return await response.json() as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

async function massiveQuote(ticker: string): Promise<ProviderQuote> {
  const key = process.env.MASSIVE_API_KEY?.trim();
  if (!key) throw new Error("MASSIVE_API_KEY is missing");
  const to = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(Date.now() - 21 * 86_400_000).toISOString().slice(0, 10);
  const url = `https://api.massive.com/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${fromDate}/${to}?adjusted=true&sort=desc&limit=1&apiKey=${encodeURIComponent(key)}`;
  const payload = await getJson(url) as { results?: Array<{ c?: number; t?: number }> };
  const result = payload.results?.[0];
  if (!result?.c || !result.t) throw new Error("Massive returned no daily bar");
  return { provider: "massive", price: Number(result.c), asOf: new Date(result.t).toISOString().slice(0, 10) };
}

async function alphaVantageQuote(ticker: string): Promise<ProviderQuote> {
  const key = process.env.ALPHA_VANTAGE_API_KEY?.trim();
  if (!key) throw new Error("ALPHA_VANTAGE_API_KEY is missing");
  const symbol = ticker.endsWith(".HK") ? ticker.replace(/\.HK$/, ".HKG") : ticker;
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`;
  const payload = await getJson(url) as { [key: string]: unknown };
  const quote = payload["Global Quote"] as Record<string, string> | undefined;
  const price = Number(quote?.["05. price"] ?? 0);
  const asOf = quote?.["07. latest trading day"];
  if (!(price > 0) || !asOf) throw new Error("Alpha Vantage returned no quote");
  return { provider: "alphaVantage", price, asOf };
}

async function finnhubQuote(ticker: string): Promise<ProviderQuote> {
  const key = process.env.FINNHUB_API_KEY?.trim();
  if (!key) throw new Error("FINNHUB_API_KEY is missing");
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(key)}`;
  const payload = await getJson(url) as { c?: number; t?: number };
  const price = Number(payload.c ?? 0);
  const timestamp = Number(payload.t ?? 0);
  if (!(price > 0) || !(timestamp > 0)) throw new Error("Finnhub returned no quote");
  return { provider: "finnhub", price, asOf: new Date(timestamp * 1000).toISOString().slice(0, 10) };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function configuredStockProviders() {
  return {
    mode: process.env.STOCK_DATA_PROVIDER?.trim().toLowerCase() || "yahoo",
    massive: Boolean(process.env.MASSIVE_API_KEY?.trim()),
    alphaVantage: Boolean(process.env.ALPHA_VANTAGE_API_KEY?.trim()),
    finnhub: Boolean(process.env.FINNHUB_API_KEY?.trim()),
  };
}

export async function crossCheckQuote(ticker: string, region: Region, yahooPrice: number, yahooAsOf: string): Promise<ProviderCheck> {
  const configured = configuredStockProviders();
  const quotes: ProviderQuote[] = [{ provider: "yahoo", price: yahooPrice, asOf: yahooAsOf }];
  if (configured.mode !== "all") return { ticker, quotes, consensusPrice: yahooPrice, maximumDifferencePct: 0, agreement: "yahoo-only" };

  const requests: Array<Promise<ProviderQuote>> = [];
  if (configured.massive && region === "US") requests.push(massiveQuote(ticker));
  if (configured.alphaVantage) requests.push(alphaVantageQuote(ticker));
  if (configured.finnhub) requests.push(finnhubQuote(ticker));
  const results = await Promise.allSettled(requests);
  for (const result of results) if (result.status === "fulfilled") quotes.push(result.value);

  const consensusPrice = median(quotes.map((quote) => quote.price));
  const maximumDifferencePct = Math.max(...quotes.map((quote) => Math.abs(quote.price / consensusPrice - 1)));
  return {
    ticker,
    quotes,
    consensusPrice,
    maximumDifferencePct,
    agreement: quotes.length === 1 ? "yahoo-only" : maximumDifferencePct <= 0.01 ? "confirmed" : "warning",
  };
}
