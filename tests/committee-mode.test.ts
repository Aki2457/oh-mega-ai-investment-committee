import assert from "node:assert/strict";
import test from "node:test";
import { mostConservativeMode } from "../lib/committee";

test("a Human mode request can tighten an AI recommendation", () => {
  assert.equal(mostConservativeMode("Attach", "Balanced"), "Balanced");
  assert.equal(mostConservativeMode("Attach", "Lockdown"), "Lockdown");
  assert.equal(mostConservativeMode("Balanced", "Attach"), "Balanced");
});
