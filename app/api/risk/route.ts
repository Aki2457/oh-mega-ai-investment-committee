import { calculateRiskDashboard } from "@/lib/risk-metrics";

export async function GET() {
  try { return Response.json(await calculateRiskDashboard()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Risk report unavailable" }, { status: 500 }); }
}
