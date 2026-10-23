export type HardLimits = {
  maxPositionNotionalUsd: number;
  dailyLossLimitUsd: number;
  maxTotalExposureUsd: number;
  maxOpenPositions: number;
  pauseAtDailyLoss: boolean;
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
};

export type LimitDecision = {
  allowed: boolean;
  reasons: string[];
  after: { positionNotionalUsd: number; totalExposureUsd: number; openPositionCount: number; dailyLossUsd: number };
};
