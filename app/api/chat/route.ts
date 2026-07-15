import { getChatHistory, getPortfolio, saveChatMessage } from "@/db/repository";
import { buildMarketPack } from "@/lib/market-data";
import { chatCompletion } from "@/lib/openrouter";
import type { AgentKind, Profile } from "@/lib/types";

const encoder = new TextEncoder();

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({})) as { sessionId?: string; agent?: AgentKind; profile?: Profile; message?: string };
  const sessionId = payload.sessionId?.trim() || crypto.randomUUID();
  const agent: AgentKind = ["decision", "risk", "ceo"].includes(payload.agent ?? "") ? payload.agent! : "decision";
  const profile: Profile = "think";
  const message = payload.message?.trim() ?? "";
  if (!message) return Response.json({ error: "message is required" }, { status: 400 });
  const stream = new ReadableStream({
    async start(controller) {
      const send = (value: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
      try {
        send({ type: "stage", stage: "market-data", message: "Loading real market and portfolio data" });
        const [pack, portfolio, history] = await Promise.all([buildMarketPack(), getPortfolio(), getChatHistory(sessionId)]);
        await saveChatMessage({ sessionId, agent, profile, role: "user", content: message });
        send({ type: "stage", stage: "agent", message: "Running Think Standard with web search" });
        const result = await chatCompletion({
          agent, profile,
          messages: [...history, { role: "user", content: message }],
          context: `Real market pack: ${JSON.stringify(pack)}\nCurrent simulated portfolio: ${JSON.stringify(portfolio)}.`,
        });
        for (const chunk of result.text.match(/.{1,120}(?:\s|$)/g) ?? [result.text]) send({ type: "delta", text: chunk });
        await saveChatMessage({ sessionId, agent, profile, role: "assistant", content: result.text, citations: result.citations });
        send({ type: "complete", sessionId, text: result.text, citations: result.citations, model: result.model });
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : "Agent failed" });
      } finally { controller.close(); }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}
