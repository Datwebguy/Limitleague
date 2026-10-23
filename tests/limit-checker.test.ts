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
