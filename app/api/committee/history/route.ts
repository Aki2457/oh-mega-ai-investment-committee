import { listRuns } from "@/db/repository";

export async function GET(request: Request) {
  const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get("limit") ?? 20)));
  try { return Response.json({ runs: await listRuns(limit) }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "History unavailable" }, { status: 500 }); }
}
