import assert from "node:assert/strict";
import test from "node:test";
import { calculateFeatures, convertToUsd, mechanicalMode, tradingDaysBetween } from "../lib/quant";
import type { PricePoint } from "../lib/types";

function series(start = 100, days = 260, dailyReturn = 0.001): PricePoint[] {
  return Array.from({ length: days }, (_, index) => ({
    date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
    close: start * (1 + dailyReturn) ** index,
    adjustedClose: start * (1 + dailyReturn) ** index,
    volume: 1_000_000 + index * 100,
  }));
}

test("converts Hong Kong prices to USD", () => {
  const points = series(78, 3, 0);
  const fx = series(7.8, 3, 0);
  const converted = convertToUsd(points, fx);
  assert.equal(converted[0].adjustedClose, 10);
});

test("calculates required weekly market features", () => {
  const points = series();
  const feature = calculateFeatures("TEST", "US", "USD", points, points, "live");
  assert.equal(feature.ticker, "TEST");
  assert.ok(feature.return12w > 0);
  assert.ok(feature.volatility60d >= 0);
  assert.ok(feature.averageDollarVolume20d > 0);
  assert.equal(feature.above200d, true);
});

test("maps two market trends to three mechanical modes", () => {
  const positive = calculateFeatures("A", "US", "USD", series(100, 260, 0.001), series(), "live");
  const negative = calculateFeatures("B", "China/HK", "USD", series(100, 260, -0.001), series(), "live");
  assert.equal(mechanicalMode(positive, positive), "Attack");
  assert.equal(mechanicalMode(positive, negative), "Balanced");
  assert.equal(mechanicalMode(negative, negative), "Defense");
});

test("counts weekdays for stale-data controls", () => {
  assert.equal(tradingDaysBetween("2026-07-03", "2026-07-10"), 5);
});
