export type Limits = {
  maxPositionNotionalUsd: number;
  dailyLossLimitUsd: number;
  maxTotalExposureUsd: number;
  maxOpenPositions: number;
  pauseAtDailyLoss: true;
};

export type StrategyStyle = "momentum" | "mean_reversion" | "breakout";

export type Strategy = {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  mode: "paper" | "live";
  limits: Limits;
  paused: boolean;
  created_at: string;
  following: boolean;
  followers: number;
  audit_count: number;
  allowedCount: number;
  blockedCount: number;
  compliancePct: number | null;
  pnlUsd: number;
  returnPct: number | null;
  score: number | null;
  priceStale?: boolean;
  markets?: string[];
  config?: { market?: string; style?: StrategyStyle; takeProfitPct: number | null; stopLossPct: number | null };
};

export type Decision = {
  allowed: boolean;
  reasons: string[];
  price: number;
  after: { positionNotionalUsd: number; totalExposureUsd: number; openPositionCount: number; dailyLossUsd: number };
};

export type ActivityItem = {
  id: string;
  strategy_id: string;
  strategy_name: string;
  event_type: "proposal" | "rules" | "close";
  action?: string;
  paused?: boolean;
  market?: string;
  side?: "long" | "short";
  notional_usd?: number;
  price?: number;
  allowed?: boolean;
  reasons?: string[];
  reason?: string;
  limits_snapshot?: Limits;
  portfolio_snapshot?: {
    openPositions?: Array<{ market: string; side: string; notionalUsd: number }>;
    dailyPnlUsd?: number;
    availableBuyingPowerUsd?: number;
    realizedPnlUsd?: number;
  };
  decision_snapshot?: Decision;
  event_hash?: string;
  prev_hash?: string | null;
  hash_version?: number;
  mode?: "paper" | "live";
  execution_snapshot?: { accepted: boolean; recordedAt: string };
  created_at: string;
  page_cursor?: string;
};

export type Market = {
  symbol: string;
  name: string;
  baseAsset: string;
  markPrice: number;
  fundingRate: number;
  minNotionalUsd: number;
  orderStepSize: number;
};

export type Position = {
  strategy_id: string;
  strategy_name: string;
  market: string;
  side: "long" | "short";
  size: number;
  entry_price: number;
  markPrice: number;
  notionalUsd: number;
  unrealizedPnlUsd: number;
  take_profit_price?: number | null;
  stop_loss_price?: number | null;
};

export type LedgerEntry = {
  id: string;
  event_type: string;
  amount: number;
  balance_after: number;
  description: string;
  created_at: string;
};

export type Portfolio = {
  currency: string;
  startingBalanceUsd: number;
  cashBalanceUsd: number;
  equityUsd: number;
  availableUsd: number;
  exposureUsd: number;
  unrealizedPnlUsd: number;
  positions: Position[];
  ledger: LedgerEntry[];
};

export type StrikeAccount = {
  account_id: string;
  available_balance: string;
  wallet_balance: string;
  unrealized_pnl: string;
};

export type Verification = {
  valid: boolean;
  checked: number;
  headHash: string | null;
  problem: string | null;
  unchainedLegacyEvents: number;
};

export type BacktestResult = {
  returnPct: number;
  maxDrawdownPct: number;
  winRatePct: number;
  trades: number;
  blockedSignals: number;
  compliancePct: number;
  endingEquityUsd: number;
  startingEquityUsd: number;
  feesUsd: number;
};

export type TradeSide = "long" | "short";
