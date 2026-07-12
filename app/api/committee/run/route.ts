import { runCommittee } from "@/lib/committee";
import type { Profile } from "@/lib/types";

const encoder = new TextEncoder();

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({})) as { trigger?: "manual" | "scheduled"; profile?: Profile; schedulerToken?: string };
  const trigger = payload.trigger === "scheduled" ? "scheduled" : "manual";
  if (trigger === "scheduled") {
    const expected = process.env.COMMITTEE_SCHEDULER_TOKEN;
    if (!expected || payload.schedulerToken !== expected) return Response.json({ error: "Invalid scheduler token" }, { status: 401 });
  }
  const profile: Profile = ["flash", "think", "pro"].includes(payload.profile ?? "") ? payload.profile! : "think";
  const stream = new ReadableStream({
    start(controller) {
      const send = (value: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
      runCommittee({ trigger, profile, emit: send })
        .then(() => controller.close())
        .catch((error) => {
          send({ stage: "error", message: error instanceof Error ? error.message : "Committee failed" });
          controller.close();
        });
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}
