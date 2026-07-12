import { ensureDatabase } from "@/db/repository";
import { fetchYahooSeries } from "@/lib/market-data";
import { openRouterConfigured } from "@/lib/openrouter";
import { configuredStockProviders } from "@/lib/stock-providers";

export async function GET() {
  let persistence = true;
  let yahoo = true;
  try { await ensureDatabase(); } catch { persistence = false; }
  try { await fetchYahooSeries("QQQ"); } catch { yahoo = false; }
  return Response.json({
    openRouter: openRouterConfigured(), yahoo, persistence,
    scheduler: Boolean(process.env.COMMITTEE_SCHEDULER_TOKEN),
    port: 8888,
    simulatedOnly: true,
    stockData: configuredStockProviders(),
  });
}
