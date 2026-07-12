import { addModification, disableModification, getPortfolio, listModifications } from "@/db/repository";
import { modeWeights } from "@/lib/quant";
import type { FundModification, Mode } from "@/lib/types";

const types = ["gear", "stock_allocation", "halt", "buy", "short"];
const modes: Mode[] = ["Attack", "Balanced", "Defense", "Lockdown"];

export async function GET() {
  const [modifications, portfolio] = await Promise.all([listModifications(), getPortfolio()]);
  const active = modifications.filter((item) => item.active);
  const manualGear = active.find((item) => item.source === "manual" && item.type === "gear");
  const committeeGear = active.find((item) => item.source === "committee" && item.type === "gear");
  const halted = active.some((item) => item.type === "halt" && item.value !== "false") || manualGear?.value === "Lockdown";
  const mode = (halted ? "Lockdown" : manualGear?.value ?? committeeGear?.value ?? portfolio.decisions[0]?.mode ?? "Balanced") as Mode;
  const manualAllocation = active.find((item) => item.source === "manual" && item.type === "stock_allocation");
  const stockPct = halted ? 0 : Math.min(modeWeights(mode).stockPct, Number(manualAllocation?.value ?? portfolio.decisions[0]?.stockPct ?? modeWeights(mode).stockPct));
  return Response.json({ mode, stockPct, cashPct: 100 - stockPct, halted, modifications, updatedAt: modifications[0]?.createdAt ?? null });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as Partial<FundModification>;
  if (!types.includes(String(body.type))) return Response.json({ error: "Choose a valid modification type" }, { status: 400 });
  if (body.type === "gear" && !modes.includes(body.value as Mode)) return Response.json({ error: "Choose a valid gear" }, { status: 400 });
  if (body.type === "stock_allocation" && (!Number.isFinite(Number(body.value)) || Number(body.value) < 0 || Number(body.value) > 90)) return Response.json({ error: "Stock allocation must be between 0 and 90" }, { status: 400 });
  if ((body.type === "buy" || body.type === "short") && !body.ticker?.trim()) return Response.json({ error: "Ticker is required" }, { status: 400 });
  const modification = await addModification({ type: body.type!, value: String(body.value ?? "true"), ticker: body.ticker?.trim() || null, note: String(body.note ?? ""), source: "manual" });
  return Response.json({ modification }, { status: 201 });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Modification ID is required" }, { status: 400 });
  await disableModification(id);
  return Response.json({ ok: true });
}
