import { decideHumanApproval, getPortfolio } from "@/db/repository";

function humanIdentity(request: Request) {
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  if (encodedName && request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8") {
    try { return decodeURIComponent(encodedName); } catch {}
  }
  return request.headers.get("oai-authenticated-user-email") ?? "Human operator";
}

export async function GET() {
  try {
    const portfolio = await getPortfolio();
    return Response.json({ approvals: portfolio.approvals });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Approval status unavailable" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => ({})) as { runId?: string; action?: "approve" | "reject"; note?: string };
    if (!payload.runId?.trim()) return Response.json({ error: "runId is required" }, { status: 400 });
    if (!(["approve", "reject"] as string[]).includes(payload.action ?? "")) return Response.json({ error: "action must be approve or reject" }, { status: 400 });
    const result = await decideHumanApproval({
      runId: payload.runId,
      action: payload.action!,
      decidedBy: humanIdentity(request),
      note: payload.note?.trim().slice(0, 500),
    });
    return Response.json({ approval: result });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to record Human decision" }, { status: 400 });
  }
}
