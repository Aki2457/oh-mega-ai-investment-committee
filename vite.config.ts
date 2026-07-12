import vinext from "vinext";
import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

let hostingConfig: { d1: string | null; r2: string | null } = { d1: null, r2: null };
try { hostingConfig = JSON.parse(readFileSync(new URL("./.openai/hosting.json", import.meta.url), "utf8")); } catch {}
const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  const nodeDeployment = process.env.DEPLOY_TARGET === "zeabur";
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const cloudflarePlugin = nodeDeployment ? null : (await import("@cloudflare/vite-plugin")).cloudflare({
    viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
    config: localBindingConfig,
  });

  return {
    ssr: { external: ["better-sqlite3"] },
    resolve: nodeDeployment ? { alias: { "cloudflare:workers": new URL("./db/cloudflare-env-stub.ts", import.meta.url).pathname } } : undefined,
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      ...(nodeDeployment ? [] : [sites()]),
      ...(cloudflarePlugin ? [cloudflarePlugin] : []),
    ],
  };
});
