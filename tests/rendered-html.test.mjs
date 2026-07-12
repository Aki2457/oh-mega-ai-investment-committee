import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = fileURLToPath(new URL("../node_modules/vinext/dist/cli.js", import.meta.url));
const port = 18988;

async function waitForServer(output) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const response = await fetch(`http://localhost:${port}/`);
      return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Local worker did not start.\n${output.join("")}`);
}

test("server-renders the OH MEGA investment committee", { timeout: 60_000 }, async () => {
  const output = [];
  const server = spawn(process.execPath, [cli, "dev", "--port", String(port)], {
    cwd: root,
    env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler/test.log" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => output.push(chunk.toString()));
  server.stderr.on("data", (chunk) => output.push(chunk.toString()));
  try {
    const response = await waitForServer(output);
    assert.equal(response.status, 200, output.join(""));
    const html = await response.text();
    assert.match(html, /OH MEGA/i);
    assert.match(html, /Investment Command Center/i);
    assert.match(html, /SIMULATED/i);
    assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
  } finally {
    server.kill();
  }
});
