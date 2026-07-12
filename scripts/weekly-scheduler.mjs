const port = process.env.PORT || "8080";
const schedulerToken = process.env.COMMITTEE_SCHEDULER_TOKEN;

function nextSaturdaySingapore() {
  const now = new Date();
  const target = new Date(now);
  const daysUntilSaturday = (6 - now.getUTCDay() + 7) % 7;
  target.setUTCDate(now.getUTCDate() + daysUntilSaturday);
  target.setUTCHours(0, 0, 0, 0);
  if (target <= now) target.setUTCDate(target.getUTCDate() + 7);
  return target;
}

async function runCommittee() {
  if (!schedulerToken) {
    console.error("[scheduler] COMMITTEE_SCHEDULER_TOKEN is missing");
    return;
  }
  const response = await fetch(`http://127.0.0.1:${port}/api/committee/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ trigger: "scheduled", profile: "pro", schedulerToken }),
  });
  const message = await response.text();
  if (!response.ok) throw new Error(`Committee returned ${response.status}: ${message.slice(0, 300)}`);
  console.log(`[scheduler] Weekly Pro committee completed at ${new Date().toISOString()}`);
}

async function scheduleForever() {
  for (;;) {
    const nextRun = nextSaturdaySingapore();
    console.log(`[scheduler] Next Pro committee: ${nextRun.toISOString()} (Saturday 08:00 Singapore)`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(nextRun.getTime() - Date.now(), 2_147_000_000)));
    if (Date.now() + 1_000 < nextRun.getTime()) continue;
    try {
      await runCommittee();
    } catch (error) {
      console.error(`[scheduler] ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

scheduleForever().catch((error) => {
  console.error(`[scheduler] Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
