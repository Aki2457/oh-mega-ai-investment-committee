const baseUrl = process.env.OH_MEGA_BASE_URL || "http://localhost:8888";
const schedulerToken = process.env.COMMITTEE_SCHEDULER_TOKEN;

if (!schedulerToken) {
  throw new Error("COMMITTEE_SCHEDULER_TOKEN is missing from .env.local");
}

const response = await fetch(`${baseUrl}/api/committee/run`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ trigger: "scheduled", profile: "pro", schedulerToken }),
});

if (!response.ok || !response.body) {
  throw new Error(`Weekly committee request failed with status ${response.status}`);
}

const decoder = new TextDecoder();
let buffer = "";
for await (const chunk of response.body) {
  buffer += decoder.decode(chunk, { stream: true });
  const events = buffer.split("\n\n");
  buffer = events.pop() || "";
  for (const event of events) {
    const line = event.split("\n").find((item) => item.startsWith("data: "));
    if (!line) continue;
    const value = JSON.parse(line.slice(6));
    console.log(`${new Date().toISOString()} ${value.stage}: ${value.message}`);
    if (value.stage === "error") process.exitCode = 1;
  }
}
