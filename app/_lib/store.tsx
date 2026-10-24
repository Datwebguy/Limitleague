"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { STRIKE_API, importStrikeKey, strikeHeaders } from "./strike-browser";
import type {
  ActivityItem, BacktestResult, Decision, Limits, Market, Portfolio, StrikeAccount, Strategy, StrategyStyle, TradeSide, Verification,
} from "./types";

type Toast = { id: number; text: string; tone: "info" | "good" | "bad" };
type User = { id: string };

export type TradeInput = { market: string; side: TradeSide; notionalUsd: number; reason: string };
export type TradeResult = Decision & { price: number };
export type CreateInput = {
  name: string;
  description: string;
  limits: Limits;
  config: { market: string; style: StrategyStyle; takeProfitPct: number | null; stopLossPct: number | null };
};
export type RealTradeDraft = { auditId: string; price: number; decision: Decision; input: TradeInput; size: string };

async function api<T = Record<string, unknown>>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    ...init,
    headers: init?.json !== undefined ? { "content-type": "application/json", ...init?.headers } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Something went wrong. Please check the details and try again.");
  return data as T;
}

async function withRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 300 * attempt));
    }
  }
}

type Store = {
  ready: boolean;
  loadError: string | null;
  user: User | null;
  strategies: Strategy[];
  mine: Strategy[];
  followed: Strategy[];
  activity: ActivityItem[];
  hasMoreActivity: boolean;
  portfolio: Portfolio | null;
  markets: Market[];
  toasts: Toast[];
  notify: (text: string, tone?: Toast["tone"]) => void;
  dismiss: (id: number) => void;
  refresh: () => Promise<void>;
  createStrategy: (input: CreateInput) => Promise<Strategy>;
  follow: (id: string) => Promise<void>;
  unfollow: (id: string) => Promise<void>;
  placeTrade: (strategyId: string, input: TradeInput) => Promise<TradeResult>;
  closeTrade: (position: { strategy_id: string; market: string; side: TradeSide }) => Promise<{ price: number; realizedPnlUsd: number }>;
  setPaused: (strategyId: string, paused: boolean) => Promise<void>;
  tighten: (strategyId: string, limits: Limits) => Promise<void>;
  runBacktest: (input: { market: string; style: StrategyStyle; days: number; notionalUsd: number; takeProfitPct: number | null; stopLossPct: number | null; limits: Limits }) => Promise<BacktestResult>;
  loadMoreActivity: () => Promise<void>;
  verifyHistory: (strategyId: string) => Promise<Verification>;
  strikeAccount: StrikeAccount | null;
  connectStrike: (publicKey: string, privateKey: string) => Promise<void>;
  disconnectStrike: () => void;
  prepareRealTrade: (strategyId: string, input: TradeInput) => Promise<RealTradeDraft>;
  sendRealOrder: (draft: RealTradeDraft) => Promise<void>;
};

const StoreContext = createContext<Store | null>(null);
export const useStore = () => {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside StoreProvider.");
  return store;
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [strikeAccount, setStrikeAccount] = useState<StrikeAccount | null>(null);
  const signingKey = useRef<CryptoKey | null>(null);
  const publicKey = useRef("");
  const toastId = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);
  const notify = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = (toastId.current += 1);
    setToasts((current) => [...current.slice(-2), { id, text, tone }]);
    window.setTimeout(() => dismiss(id), 6500);
  }, [dismiss]);

  const refresh = useCallback(async () => {
    try {
      // The workspace is created by the first call, so the rest wait for it.
      const session = await withRetry(() => api<{ user: User }>("/api/session"));
      setUser(session.user);
      const [league, record, account, catalog] = await Promise.all([
        withRetry(() => api<{ strategies: Strategy[] }>("/api/strategies")),
        withRetry(() => api<{ audit: ActivityItem[]; nextCursor: string | null }>("/api/audit")),
        withRetry(() => api<{ portfolio: Portfolio }>("/api/portfolio")),
        withRetry(() => api<{ markets: Market[] }>("/api/markets")),
      ]);
      setStrategies(league.strategies);
      setActivity(record.audit);
      setCursor(record.nextCursor);
      setPortfolio(account.portfolio);
      setMarkets(catalog.markets);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "We could not load the latest data.");
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const mine = useMemo(() => strategies.filter((strategy) => strategy.owner_id === user?.id), [strategies, user]);
  const followed = useMemo(() => strategies.filter((strategy) => strategy.following), [strategies]);

  const createStrategy: Store["createStrategy"] = async (input) => {
    const data = await api<{ strategy: Strategy }>("/api/strategies", { method: "POST", json: input });
    await refresh();
    return data.strategy;
  };
  const follow: Store["follow"] = async (id) => {
    await api("/api/follows", { method: "POST", json: { strategyId: id } });
    await refresh();
  };
  const unfollow: Store["unfollow"] = async (id) => {
    await api("/api/follows", { method: "DELETE", json: { strategyId: id } });
    await refresh();
  };
  const placeTrade: Store["placeTrade"] = async (strategyId, input) => {
    const data = await api<{ price: number; ownerDecision: { decision: Decision } }>("/api/proposals", {
      method: "POST",
      json: { strategyId, market: input.market, side: input.side, notionalUsd: input.notionalUsd, reason: input.reason },
    });
    await refresh();
    return { ...data.ownerDecision.decision, price: data.price };
  };
  const closeTrade: Store["closeTrade"] = async (position) => {
    const data = await api<{ price: number; realizedPnlUsd: number }>("/api/positions/close", {
      method: "POST",
      json: { strategyId: position.strategy_id, market: position.market, side: position.side },
    });
    await refresh();
    return data;
  };
  const setPaused: Store["setPaused"] = async (strategyId, paused) => {
    await api("/api/strategies", { method: "PATCH", json: { strategyId, paused } });
    await refresh();
  };
  const tighten: Store["tighten"] = async (strategyId, limits) => {
    await api("/api/strategies", { method: "PATCH", json: { strategyId, limits } });
    await refresh();
  };
  const runBacktest: Store["runBacktest"] = async (input) => {
    const data = await api<{ result: BacktestResult }>("/api/backtest", { method: "POST", json: { ...input, limits: input.limits } });
    return data.result;
  };
  const loadMoreActivity = async () => {
    if (!cursor) return;
    const data = await api<{ audit: ActivityItem[]; nextCursor: string | null }>(`/api/audit?before=${encodeURIComponent(cursor)}`);
    setActivity((current) => [...current, ...data.audit]);
    setCursor(data.nextCursor);
  };
  const verifyHistory: Store["verifyHistory"] = async (strategyId) => {
    const data = await api<{ verification: Verification }>(`/api/audit/verify?strategyId=${strategyId}`);
    return data.verification;
  };

  const connectStrike: Store["connectStrike"] = async (pub, priv) => {
    const imported = await importStrikeKey(pub, priv);
    const get = async (path: string) =>
      fetch(`${STRIKE_API}${path}`, { headers: await strikeHeaders(imported.publicKey, imported.signingKey, "GET", path) });
    const account = await get("/v2/account");
    if (!account.ok) throw new Error("Strike did not accept these keys. Check them and try again.");
    setStrikeAccount((await account.json()) as StrikeAccount);
    signingKey.current = imported.signingKey;
    publicKey.current = imported.publicKey;
  };
  const disconnectStrike = () => {
    signingKey.current = null;
    publicKey.current = "";
    setStrikeAccount(null);
  };

  const prepareRealTrade: Store["prepareRealTrade"] = async (strategyId, input) => {
    if (!strikeAccount || !signingKey.current) throw new Error("Connect your Strike account first (Account → Real trading).");
    const auth = await strikeHeaders(publicKey.current, signingKey.current, "GET", "/v2/account");
    const checked = await api<{ auditId: string; price: number; decision: Decision }>("/api/live-proposals", {
      method: "POST",
      json: {
        strategyId, ...input,
        strikeAccountId: strikeAccount.account_id,
        strikeAuth: {
          publicKey: auth["X-API-Wallet-Public-Key"], signature: auth["X-API-Wallet-Signature"],
          timestamp: auth["X-API-Wallet-Timestamp"], nonce: auth["X-API-Wallet-Nonce"],
        },
      },
    });
    const market = markets.find((item) => item.symbol === input.market);
    if (!market || !Number.isFinite(market.orderStepSize) || market.orderStepSize <= 0) throw new Error("Order sizing is unavailable for this market right now.");
    const step = market.orderStepSize;
    const size = (Math.floor((input.notionalUsd / checked.price + Number.EPSILON) / step) * step).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
    if (checked.decision.allowed && (!Number(size) || Number(size) * checked.price < market.minNotionalUsd))
      throw new Error(`Strike's smallest order for ${market.symbol} is about $${market.minNotionalUsd}. Try a larger trade.`);
    return { auditId: checked.auditId, price: checked.price, decision: checked.decision, input, size };
  };

  const sendRealOrder: Store["sendRealOrder"] = async (draft) => {
    if (!signingKey.current) throw new Error("Your Strike connection ended. Connect again to place the order.");
    const body = JSON.stringify({
      symbol: draft.input.market, side: draft.input.side === "long" ? "buy" : "sell", type: "market",
      size: draft.size, client_order_id: `limitleague-${crypto.randomUUID()}`,
    });
    const path = "/v2/order";
    const response = await fetch(`${STRIKE_API}${path}`, {
      method: "POST",
      headers: { ...(await strikeHeaders(publicKey.current, signingKey.current, "POST", path, body)), "Content-Type": "application/json" },
      body,
    });
    const result = await response.json().catch(() => ({}));
    await api("/api/live-proposals/result", { method: "POST", json: { auditId: draft.auditId, accepted: response.ok, strikeResponse: result } });
    await refresh();
    if (!response.ok) throw new Error(result.error ?? result.msg ?? "Strike did not accept the order.");
  };

  const value: Store = {
    ready, loadError, user, strategies, mine, followed, activity, hasMoreActivity: cursor !== null, portfolio, markets,
    toasts, notify, dismiss, refresh, createStrategy, follow, unfollow, placeTrade, closeTrade, setPaused, tighten,
    runBacktest, loadMoreActivity, verifyHistory, strikeAccount, connectStrike, disconnectStrike, prepareRealTrade, sendRealOrder,
  };
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
