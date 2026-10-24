import test from "node:test";
import assert from "node:assert/strict";
import { checkLimits } from "../lib/limit-checker";
import type { HardLimits, PortfolioState, TradeProposal } from "../lib/types";

const limits: HardLimits = { maxPositionNotionalUsd: 2000, dailyLossLimitUsd: 300, maxTotalExposureUsd: 5000, maxOpenPositions: 2, pauseAtDailyLoss: true };
const proposal: TradeProposal = { strategyId: "northstar", market: "BTC-USD", side: "long", notionalUsd: 1500, reason: "test" };

test("allows a proposal within every published limit", () => {
  const portfolio: PortfolioState = { openPositions: [{ market: "ETH-USD", side: "long", notionalUsd: 1200 }], dailyPnlUsd: 80 };
  assert.equal(checkLimits(proposal, limits, portfolio).allowed, true);
});

test("blocks a proposal after daily loss pause", () => {
  const portfolio: PortfolioState = { openPositions: [], dailyPnlUsd: -300 };
  const result = checkLimits(proposal, limits, portfolio);
  assert.equal(result.allowed, false);
  assert.match(result.reasons.join(" "), /paused/);
});

test("blocks exposure that breaches a published ceiling", () => {
  const portfolio: PortfolioState = { openPositions: [{ market: "ETH-USD", side: "long", notionalUsd: 4000 }], dailyPnlUsd: 0 };
  assert.equal(checkLimits(proposal, limits, portfolio).allowed, false);
});

test("blocks adding to a market beyond the position cap", () => {
  const portfolio: PortfolioState = { openPositions: [{ market: "BTC-USD", side: "long", notionalUsd: 900 }], dailyPnlUsd: 0 };
  const result = checkLimits(proposal, limits, portfolio);
  assert.equal(result.allowed, false);
  assert.match(result.reasons.join(" "), /size limit/);
});

test("blocks a third open position when the limit is two", () => {
  const portfolio: PortfolioState = {
    openPositions: [{ market: "ETH-USD", side: "long", notionalUsd: 100 }, { market: "SOL-USD", side: "short", notionalUsd: 100 }],
    dailyPnlUsd: 0,
  };
  const result = checkLimits({ ...proposal, notionalUsd: 100 }, limits, portfolio);
  assert.equal(result.allowed, false);
  assert.match(result.reasons.join(" "), /more positions/);
});

test("rejects non-positive and non-finite sizes and corrupt portfolio state", () => {
  const clean: PortfolioState = { openPositions: [], dailyPnlUsd: 0 };
  for (const notionalUsd of [0, -5, Number.NaN, Number.POSITIVE_INFINITY])
    assert.equal(checkLimits({ ...proposal, notionalUsd }, limits, clean).allowed, false, `notional ${notionalUsd}`);
  const corrupt: PortfolioState = { openPositions: [], dailyPnlUsd: Number.NaN };
  assert.match(checkLimits(proposal, limits, corrupt).reasons.join(" "), /could not be read/);
});

test("a loss one cent under the limit still allows trading", () => {
  const portfolio: PortfolioState = { openPositions: [], dailyPnlUsd: -299.99 };
  assert.equal(checkLimits(proposal, limits, portfolio).allowed, true);
});
