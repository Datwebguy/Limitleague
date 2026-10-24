export type HardLimits = {
  maxPositionNotionalUsd: number;
  dailyLossLimitUsd: number;
  maxTotalExposureUsd: number;
  maxOpenPositions: number;
  pauseAtDailyLoss: boolean;
};

export type StrategyConfig = {
  market: string;
  style: "momentum" | "mean_reversion" | "breakout";
  takeProfitPct: number | null;
  stopLossPct: number | null;
};

export type PortfolioState = {
  openPositions: Array<{ market: string; side: "long" | "short"; notionalUsd: number }>;
  dailyPnlUsd: number;
};

export type TradeProposal = {
  strategyId: string;
  market: string;
  side: "long" | "short";
  notionalUsd: number;
  reason: string;
  takeProfitPrice?: number;
  stopLossPrice?: number;
};

export type LimitDecision = {
  allowed: boolean;
  reasons: string[];
  after: { positionNotionalUsd: number; totalExposureUsd: number; openPositionCount: number; dailyLossUsd: number };
};
