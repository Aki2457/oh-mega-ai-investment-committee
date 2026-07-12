import assert from "node:assert/strict";
import test from "node:test";
import { judgeDecision, macroOpinion, quantitativeOpinion, riskOpinion } from "../lib/openrouter";
import type { MarketPack } from "../lib/types";

const pack: MarketPack = {
  generatedAt: "2026-07-11T00:00:00Z",
  dataAsOf: "2026-07-10",
  stale: false,
  frozen: false,
  mechanicalMode: "Balanced",
  approvedTickers: [],
  features: [],
  providerChecks: [],
};

test("validates mocked Flash, Think, and Pro committee outputs", async () => {
  const original = process.env.OPENROUTER_MOCK;
  process.env.OPENROUTER_MOCK = "1";
  try {
    const flashQuant = await quantitativeOpinion(pack, "flash");
    assert.equal(await macroOpinion(pack, "flash"), null);
    const thinkMacro = await macroOpinion(pack, "think");
    assert.equal(thinkMacro?.model, "openai/gpt-oss-120b:free");
    const risk = await riskOpinion(pack, [flashQuant, thinkMacro!], "pro");
    assert.equal(risk.improvementExperiments.length, 3);
    const final = await judgeDecision(pack, [flashQuant, thinkMacro!], risk, "pro");
    assert.equal(final.mode, "Balanced");
    assert.equal(final.usSleevePct + final.chinaSleevePct, 100);
  } finally {
    if (original === undefined) delete process.env.OPENROUTER_MOCK;
    else process.env.OPENROUTER_MOCK = original;
  }
});
