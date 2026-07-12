import { deleteUniverse, listUniverse, updateUniverse, upsertUniverse } from "@/db/repository";
import type { Region } from "@/lib/types";

function validTicker(value: string) {
  return /^[A-Z0-9.^=-]{1,15}$/.test(value);
}

export async function GET() {
  try { return Response.json({ universe: await listUniverse() }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Universe unavailable" }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { ticker?: string; region?: Region; thesis?: string };
    const ticker = payload.ticker?.trim().toUpperCase() ?? "";
    if (!validTicker(ticker)) return Response.json({ error: "Enter a valid Yahoo ticker" }, { status: 400 });
    if (!(["US", "China/HK"] as string[]).includes(payload.region ?? "")) return Response.json({ error: "Region must be US or China/HK" }, { status: 400 });
    return Response.json({ item: await upsertUniverse({ ticker, region: payload.region!, status: "pending", source: "user", thesis: payload.thesis ?? "" }) }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to add ticker" }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json() as { ticker?: string; status?: string; thesis?: string; region?: Region };
    if (!payload.ticker) return Response.json({ error: "ticker is required" }, { status: 400 });
    if (payload.status && !["pending", "approved", "disabled"].includes(payload.status)) return Response.json({ error: "Invalid status" }, { status: 400 });
    return Response.json({ item: await updateUniverse(payload.ticker, payload) });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to update ticker" }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  try {
    const ticker = new URL(request.url).searchParams.get("ticker");
    if (!ticker) return Response.json({ error: "ticker is required" }, { status: 400 });
    await deleteUniverse(ticker);
    return Response.json({ deleted: ticker.toUpperCase() });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to delete ticker" }, { status: 500 }); }
}
