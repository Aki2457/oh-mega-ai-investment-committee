import assert from "node:assert/strict";
import test from "node:test";
import type { PortfolioProposal } from "../lib/types";

process.env.SQLITE_PATH = ":memory:";

const repository = await import("../db/repository");

function proposal(run: string, cashPct: number): PortfolioProposal {
  return {
    mode: cashPct === 100 ? "Lockdown" : "Attach",
    stockPct: 100 - cashPct,
    cashPct,
    usSleevePct: 50,
    chinaSleevePct: 50,
    positions: [],
    unallocatedStockPct: 100 - cashPct,
    referencePrices: { RUN: run.length },
  };
}

test("Human approval rejects a proposal below the hard cash floor", async () => {
  await repository.savePendingApproval("unsafe-run", proposal("unsafe-run", 10));
  await assert.rejects(
    repository.decideHumanApproval({ runId: "unsafe-run", action: "approve", decidedBy: "test-human" }),
    /at least 25% cash/,
  );
});

test("Human approval can apply a safe paper proposal", async () => {
  await repository.savePendingApproval("safe-run", proposal("safe-run", 25));
  const result = await repository.decideHumanApproval({ runId: "safe-run", action: "approve", decidedBy: "test-human", note: "Test approval" });
  assert.equal(result.status, "approved");
  const state = await repository.getPortfolio();
  assert.equal(state.approvals.find((item) => item.runId === "safe-run")?.status, "approved");
});
