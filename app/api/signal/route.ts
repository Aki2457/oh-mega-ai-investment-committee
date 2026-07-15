import { buildMarketPack } from "@/lib/market-data";
import { modeWeights } from "@/lib/quant";

export async function GET() {
  try {
    const pack = await buildMarketPack();
    const us = pack.features.find((feature) => feature.ticker === "QQQ")!;
    const china = pack.features.find((feature) => feature.ticker === "3067.HK")!;
    const weights = modeWeights(pack.mechanicalMode);
    return Response.json({
      signalDate: pack.dataAsOf,
      mode: pack.mechanicalMode,
      stance: pack.mechanicalMode === "Attach" ? "Higher conviction" : "Balanced risk",
      stock: weights.stockPct,
      cash: weights.cashPct,
      reason: `US 200-day trend is ${us.above200d ? "positive" : "negative"}; China/HK 200-day trend is ${china.above200d ? "positive" : "negative"}.`,
      confidence: pack.frozen ? "Low" : pack.mechanicalMode === "Balanced" ? "Medium" : "High",
      markets: [
        { label: "US technology", ticker: "QQQ", close: us.price, average: us.price / (1 + us.return26w), distance: us.return26w * 100, positive: us.above200d },
        { label: "China technology", ticker: "3067.HK", close: china.price, average: china.price / (1 + china.return26w), distance: china.return26w * 100, positive: china.above200d },
      ],
      source: pack.stale ? "cache" : "live",
      stale: pack.stale,
      frozen: pack.frozen,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Signal unavailable" }, { status: 503 });
  }
}
