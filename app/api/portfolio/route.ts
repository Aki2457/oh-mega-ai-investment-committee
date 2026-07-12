import { getPortfolio } from "@/db/repository";

export async function GET() {
  try { return Response.json(await getPortfolio()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Portfolio unavailable" }, { status: 500 }); }
}
