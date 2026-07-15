#!/usr/bin/env node

const baseUrl = (process.env.OH_MEGA_BACKEND_URL || "https://ohmega-committee-sg-20260711.zeabur.app").replace(/\/$/, "");
const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const commandArgs = args.filter((item) => item !== "--json");
const command = (commandArgs.shift() || "help").toLowerCase();
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => color ? `\u001b[${code}m${text}\u001b[0m` : text;
const heading = (text) => console.log(`\n${paint("1;32", text)}\n`);

async function request(path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 300)}`);
  return response;
}
const data = (path, options) => request(path, options).then((response) => response.json());
const output = (value) => console.log(JSON.stringify(value, null, 2));

function help() {
  console.log(`Virtual Fund CLI

Usage:
  npm run cli -- status
  npm run cli -- weather
  npm run cli -- portfolio
  npm run cli -- universe
  npm run cli -- run
  npm run cli -- modify gear <Balanced|Attach|Lockdown> [note]
  npm run cli -- modify allocation <0-75> [note]
  npm run cli -- modify halt [note]
  npm run cli -- modify buy <ticker> [note]
  npm run cli -- remove-mod <id>

Options: --json
Environment: OH_MEGA_BACKEND_URL, NO_COLOR=1`);
}

async function showStatus() {
  const value = await data("/api/status");
  if (jsonOutput) return output(value);
  heading("System Status");
  const rows = [["AI committee", value.openRouter], ["Yahoo", value.yahoo], ["Persistence", value.persistence], ["Weekly automation", value.scheduler], ["Massive", value.stockData?.massive], ["Alpha Vantage", value.stockData?.alphaVantage], ["Finnhub", value.stockData?.finnhub]];
  for (const [label, ready] of rows) console.log(`${ready ? paint("32", "●") : paint("31", "●")} ${String(label).padEnd(20)} ${ready ? "Ready" : "Unavailable"}`);
  console.log(`\nSchedule: ${value.weeklySchedule || "Saturday 08:00 Asia/Singapore"}`);
}

async function showWeather() {
  const value = await data("/api/weather");
  if (jsonOutput) return output(value);
  heading("Fund Weather");
  console.log(`${paint("1", value.mode)}  ${Number(value.stockPct).toFixed(1)}% stocks  ${Number(value.cashPct).toFixed(1)}% cash`);
  console.log(value.halted ? paint("31", "Investing is stopped") : paint("32", "Investing is permitted within controls"));
  const active = (value.modifications || []).filter((item) => item.active);
  console.log(`\nActive modifications: ${active.length}`);
  for (const item of active) console.log(`  ${item.id}  ${item.source}/${item.type}  ${item.ticker || item.value}  ${item.note || ""}`);
}

async function showPortfolio() {
  const value = await data("/api/portfolio");
  if (jsonOutput) return output(value);
  const decision = value.decisions?.[0];
  const nav = value.nav?.at(-1);
  heading("Paper Portfolio");
  console.log(`NAV ${Number(nav?.nav || 100).toFixed(2)}  Mode ${decision?.mode || "Cash"}  Cash ${Number(decision?.cashPct ?? 100).toFixed(1)}%\n`);
  console.log(`${"Ticker".padEnd(10)}${"Market".padEnd(12)}${"Weight".padStart(10)}${"Price".padStart(14)}`);
  for (const item of value.positions || []) console.log(`${String(item.ticker).padEnd(10)}${String(item.region).padEnd(12)}${`${Number(item.weightPct).toFixed(2)}%`.padStart(10)}${Number(item.lastPrice).toFixed(2).padStart(14)}`);
}

async function showUniverse() {
  const value = await data("/api/universe");
  if (jsonOutput) return output(value);
  heading("Approved Universe");
  for (const item of value.universe || []) console.log(`${String(item.ticker).padEnd(12)}${String(item.region).padEnd(12)}${String(item.status).padEnd(12)}${item.thesis || ""}`);
}

async function runCommittee() {
  const profile = "think";
  heading("Running THINK STANDARD Committee");
  const response = await request("/api/committee/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ trigger: "manual", profile }) });
  const decoder = new TextDecoder(); let buffer = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const blocks = buffer.split("\n\n"); buffer = blocks.pop() || "";
    for (const block of blocks) {
      const line = block.split("\n").find((item) => item.startsWith("data: "));
      if (!line) continue;
      const event = JSON.parse(line.slice(6));
      console.log(jsonOutput ? JSON.stringify(event) : `${paint("36", String(event.stage).padEnd(14))} ${event.message}`);
      if (event.stage === "error") process.exitCode = 1;
    }
  }
}

async function modify() {
  const kind = (commandArgs.shift() || "").toLowerCase();
  const map = { gear: "gear", allocation: "stock_allocation", halt: "halt", buy: "buy" };
  if (!map[kind]) throw new Error("Choose gear, allocation, halt, or buy");
  let value = "true"; let ticker = null;
  if (kind === "gear" || kind === "allocation") value = commandArgs.shift() || "";
  if (kind === "buy") ticker = (commandArgs.shift() || "").toUpperCase();
  const result = await data("/api/weather", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: map[kind], value, ticker, note: commandArgs.join(" ") }) });
  if (jsonOutput) return output(result);
  console.log(`${paint("32", "Activated")} ${result.modification.type} ${result.modification.ticker || result.modification.value}\nID: ${result.modification.id}`);
}

async function removeModification() {
  if (!commandArgs[0]) throw new Error("Modification ID is required");
  const result = await data(`/api/weather?id=${encodeURIComponent(commandArgs[0])}`, { method: "DELETE" });
  if (jsonOutput) return output(result);
  console.log(paint("32", `Removed ${commandArgs[0]}`));
}

try {
  if (["help", "--help", "-h"].includes(command)) help();
  else if (command === "status") await showStatus();
  else if (command === "weather") await showWeather();
  else if (command === "portfolio") await showPortfolio();
  else if (command === "universe") await showUniverse();
  else if (command === "run") await runCommittee();
  else if (command === "modify") await modify();
  else if (command === "remove-mod") await removeModification();
  else { help(); process.exitCode = 1; }
} catch (error) {
  console.error(paint("31", `Error: ${error instanceof Error ? error.message : String(error)}`));
  process.exitCode = 1;
}
