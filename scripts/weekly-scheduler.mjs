const port = process.env.PORT || "8080";
const schedulerToken = process.env.COMMITTEE_SCHEDULER_TOKEN;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000];

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
  const events = message.split("\n\n").flatMap((block) => block.split("\n")).filter((line) => line.startsWith("data: ")).map((line) => {
    try { return JSON.parse(line.slice(6)); } catch { return null; }
  }).filter(Boolean);
  const failed = events.find((event) => event.stage === "error");
  if (failed) throw new Error(`Committee failed: ${failed.message}`);
  console.log(`[scheduler] Weekly Pro committee completed at ${new Date().toISOString()}`);
}

async function runWithRetry() {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try { await runCommittee(); return; }
    catch (error) {
      console.error(`[scheduler] Attempt ${attempt + 1} failed: ${error instanceof Error ? error.message : String(error)}`);
      if (attempt === RETRY_DELAYS_MS.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
}

function isWeekendCatchUpWindow(now = new Date()) {
  const singapore = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const day = singapore.getUTCDay();
  const hour = singapore.getUTCHours();
  return (day === 6 && hour >= 8) || day === 0;
}

async function scheduleForever() {
  if (!schedulerToken) {
    console.error("[scheduler] Disabled because COMMITTEE_SCHEDULER_TOKEN is missing");
    return;
  }
  if (isWeekendCatchUpWindow()) {
    console.log("[scheduler] Weekend restart detected. Checking the current forecast week.");
    try { await runWithRetry(); } catch (error) { console.error(`[scheduler] Catch-up failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
  for (;;) {
    const nextRun = nextSaturdaySingapore();
    console.log(`[scheduler] Next Pro committee: ${nextRun.toISOString()} (Saturday 08:00 Singapore)`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(nextRun.getTime() - Date.now(), 2_147_000_000)));
    if (Date.now() + 1_000 < nextRun.getTime()) continue;
    try {
      await runWithRetry();
    } catch (error) {
      console.error(`[scheduler] ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

scheduleForever().catch((error) => {
  console.error(`[scheduler] Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
