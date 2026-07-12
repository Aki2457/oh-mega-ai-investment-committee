import { buildMarketPack } from "@/lib/market-data";

export async function GET() {
  try { return Response.json({ market: await buildMarketPack() }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Market data unavailable" }, { status: 503 }); }
}
