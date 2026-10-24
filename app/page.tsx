"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

type Limits = {
  maxPositionNotionalUsd: number;
  dailyLossLimitUsd: number;
  maxTotalExposureUsd: number;
  maxOpenPositions: number;
  pauseAtDailyLoss: true;
};
type Strategy = {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  mode: "paper" | "live";
  limits: Limits;
  paused: boolean;
  following: boolean;
  followers: number;
  audit_count: number;
  pnlUsd: number;
  returnPct: number | null;
  score: number | null;
  markets?: string[];
  config?: { market: string; style: "momentum" | "mean_reversion" | "breakout"; takeProfitPct: number | null; stopLossPct: number | null };
};
type Audit = {
  id: string;
  strategy_id: string;
  strategy_name: string;
  event_type: "proposal" | "rules" | "close";
  action?: string;
  paused?: boolean;
  market?: string;
  side?: string;
  notional_usd?: number;
  price?: number;
  allowed?: boolean;
  reasons?: string[];
  reason?: string;
  limits_snapshot?: Limits;
  portfolio_snapshot?: {
    openPositions: Array<{ market: string; side: string; notionalUsd: number }>;
    dailyPnlUsd: number;
    availableBuyingPowerUsd: number;
  };
  decision_snapshot?: Decision;
  event_hash?: string;
  mode?: "paper" | "live";
  execution_snapshot?: { accepted: boolean; strikeResponse?: Record<string, unknown>; recordedAt: string };
  created_at: string;
};
type User = { id: string };
type View = "league" | "account" | "audit" | "publish";
type Decision = {
  allowed: boolean;
  reasons: string[];
  price: number;
  after: {
    positionNotionalUsd: number;
    totalExposureUsd: number;
    openPositionCount: number;
    dailyLossUsd: number;
  };
};
type Market = { symbol: string; name: string; markPrice: number; fundingRate: number; minNotionalUsd: number; orderStepSize: number };
type Position = {
  strategy_id: string; strategy_name: string; market: string; side: "long" | "short";
  size: number; entry_price: number; markPrice: number; notionalUsd: number; unrealizedPnlUsd: number;
  take_profit_price?: number | null; stop_loss_price?: number | null;
};
type Portfolio = {
  currency: string; startingBalanceUsd: number; cashBalanceUsd: number; equityUsd: number;
  availableUsd: number; exposureUsd: number; unrealizedPnlUsd: number; positions: Position[];
  ledger: Array<{ id: string; event_type: string; amount: number; balance_after: number; description: string; created_at: string }>;
  priceSource: string;
};
type StrikeAccount = {
  account_id: string; blockchain: string; blockchain_address: string | null;
  wallet_balance: string; available_balance: string; unrealized_pnl: string;
  margin_balance: string;
};
type StrikePosition = { symbol: string; size: string; entry_price: string; upnl: string; leverage: number; margin_mode: string };

const hexBytes = (value: string) => {
  const pairs = value.match(/.{1,2}/g);
  if (!pairs) throw new Error("Invalid key format.");
  return new Uint8Array(pairs.map((pair) => Number.parseInt(pair, 16)));
};
const bytesHex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");

async function importStrikeKey(publicKey: string, privateKey: string) {
  const normalizedPublic = publicKey.trim().toLowerCase();
  const normalizedPrivate = privateKey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalizedPublic) || !/^(?:[0-9a-f]{64}|[0-9a-f]{128})$/.test(normalizedPrivate))
    throw new Error("Enter the hexadecimal public and private keys from your Strike API wallet.");
  const prefix = hexBytes("302e020100300506032b657004220420");
  const seed = hexBytes(normalizedPrivate.slice(0, 64));
  const pkcs8 = new Uint8Array(prefix.length + seed.length);
  pkcs8.set(prefix); pkcs8.set(seed, prefix.length);
  const signingKey = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, ["sign"]);
  return { publicKey: normalizedPublic, signingKey };
}

async function strikeHeaders(publicKey: string, signingKey: CryptoKey, method: string, path: string, body = "") {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();
  const bodyHash = bytesHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
  const message = `${method}:${path}:${timestamp}:${nonce}:${bodyHash}`;
  const signature = bytesHex(await crypto.subtle.sign("Ed25519", signingKey, new TextEncoder().encode(message)));
  return {
    "X-API-Wallet-Public-Key": publicKey,
    "X-API-Wallet-Signature": signature,
    "X-API-Wallet-Timestamp": String(timestamp),
    "X-API-Wallet-Nonce": nonce,
  };
}

const money = (value: number, digits = 0) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  }).format(value);
const percent = (value: number | null) =>
  value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

async function loadJson(path: string, attempts = 3) {
  let response: Response | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      response = await fetch(path, { cache: "no-store" });
      if (response.ok || attempt === attempts - 1) return response;
    } catch {
      if (attempt === attempts - 1) throw new Error(`${path} is unavailable.`);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw new Error(`${path} is unavailable.`);
}

function Icon({
  name,
}: {
  name: "league" | "account" | "audit" | "publish" | "shield" | "arrow" | "close" | "check";
}) {
  const paths: Record<string, ReactNode> = {
    league: (
      <>
        <path d="M4 19V9m6 10V5m6 14v-7m4 7H2" />
      </>
    ),
    audit: (
      <>
        <path d="M5 4h14v16H5z" />
        <path d="M8 9h8M8 13h8M8 17h5" />
      </>
    ),
    account: (
      <>
        <path d="M3 7h18v12H3zM3 9l3-4h12l3 4" />
        <path d="M15 13h4v3h-4z" />
      </>
    ),
    publish: (
      <>
        <path d="M12 5v14M5 12h14" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3l7 3v5c0 5-3.4 8.5-7 10-3.6-1.5-7-5-7-10V6z" />
        <path d="M9 12l2 2 4-4" />
      </>
    ),
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    close: (
      <>
        <path d="M6 6l12 12M18 6 6 18" />
      </>
    ),
    check: <path d="M5 12l4 4L19 6" />,
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("league");
  const [user, setUser] = useState<User | null>(null);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [selectedAudit, setSelectedAudit] = useState<Audit | null>(null);
  const [strikeOpen, setStrikeOpen] = useState(false);
  const [strikeAccount, setStrikeAccount] = useState<StrikeAccount | null>(null);
  const [strikePositions, setStrikePositions] = useState<StrikePosition[]>([]);
  const [strikeKeys, setStrikeKeys] = useState({ publicKey: "", privateKey: "" });
  const strikeSigningKey = useRef<CryptoKey | null>(null);
  const strikePublicKey = useRef("");
  const [executionMode, setExecutionMode] = useState<"paper" | "live">("paper");
  const [selected, setSelected] = useState<Strategy | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [tour, setTour] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [draft, setDraft] = useState({
    name: "",
    description: "",
    maxPositionNotionalUsd: "2000",
    dailyLossLimitUsd: "300",
    maxTotalExposureUsd: "5000",
    maxOpenPositions: "2",
    market: "BTC-USD",
    style: "momentum",
    takeProfitPct: "2",
    stopLossPct: "1",
  });
  const [backtestBusy, setBacktestBusy] = useState(false);
  const [backtestResult, setBacktestResult] = useState<{ returnPct:number; maxDrawdownPct:number; winRatePct:number; trades:number; blockedSignals:number; compliancePct:number; endingEquityUsd:number } | null>(null);
  const [proposal, setProposal] = useState({
    market: "BTC-USD",
    side: "long",
    notionalUsd: "100",
    reason: "Test the published limits",
  });
  const [tighten, setTighten] = useState({
    maxPositionNotionalUsd: "",
    dailyLossLimitUsd: "",
    maxTotalExposureUsd: "",
    maxOpenPositions: "",
  });
  const [result, setResult] = useState<Decision | null>(null);

  const refresh = useCallback(async () => {
    try {
      const paths = ["/api/session", "/api/strategies", "/api/audit", "/api/portfolio", "/api/markets"];
      // Establish the HTTP-only paper session before the other routes open database work.
      // Parallel first-load requests can otherwise race while Neon creates the workspace.
      const sessionResponse = await loadJson(paths[0]);
      const session = await sessionResponse.json();
      if (!sessionResponse.ok)
        throw new Error(session.error ?? "Paper workspace is unavailable.");
      const responses = await Promise.all(paths.slice(1).map((path) => loadJson(path)));
      const [strategyData, auditData, portfolioData, marketData] = await Promise.all(
        responses.map((response) => response.json()),
      );
      const failedIndex = responses.findIndex((response) => !response.ok);
      if (failedIndex !== -1) {
        const failedPath = paths[failedIndex + 1];
        const failedData = [strategyData, auditData, portfolioData, marketData][failedIndex] as { error?: string };
        throw new Error(failedData.error ?? `${failedPath} is temporarily unavailable. Please refresh.`);
      }
      setUser(session.user);
      setStrategies(strategyData.strategies);
      setAudit(auditData.audit);
      setPortfolio(portfolioData.portfolio);
      setMarkets(marketData.markets);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not load LimitLeague.",
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!window.localStorage.getItem("limitleague-tour-v1")) setTour(true);
  }, [refresh]);

  useEffect(() => {
    if (!audit.length) return;
    const auditId = new URLSearchParams(window.location.search).get("audit");
    if (auditId) setSelectedAudit(audit.find((item) => item.id === auditId) ?? null);
  }, [audit]);

  const metrics = useMemo(() => {
    const proposals = audit.filter((item) => item.event_type === "proposal");
    const allowed = proposals.filter((item) => item.allowed).length;
    return {
      decisions: proposals.length,
      allowedRate: proposals.length
        ? Math.round((allowed / proposals.length) * 100)
        : null,
      followers: strategies.reduce((sum, item) => sum + item.followers, 0),
    };
  }, [audit, strategies]);

  const ownStrategy = strategies.find((strategy) => strategy.owner_id === user?.id);

  async function post(path: string, body: object) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        typeof data.error === "string"
          ? data.error
          : "Check the information and try again.",
      );
    return data;
  }

  async function onPublish(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const data = await post("/api/strategies", {
        name: draft.name,
        description: draft.description,
        limits: {
          maxPositionNotionalUsd: Number(draft.maxPositionNotionalUsd),
          dailyLossLimitUsd: Number(draft.dailyLossLimitUsd),
          maxTotalExposureUsd: Number(draft.maxTotalExposureUsd),
          maxOpenPositions: Number(draft.maxOpenPositions),
          pauseAtDailyLoss: true,
        },
        config: { market: draft.market, style: draft.style, takeProfitPct: Number(draft.takeProfitPct) || null, stopLossPct: Number(draft.stopLossPct) || null },
      });
      const created: Strategy = {
        ...data.strategy,
        following: false,
        followers: 0,
        audit_count: 0,
        pnlUsd: 0,
        returnPct: null,
        score: null,
      };
      setDraft({ ...draft, name: "", description: "" });
      setView("league");
      setMessage("Strategy published. Submit a proposal to test its limits.");
      await refresh();
      openStrategy(created);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runBacktest() {
    setBacktestBusy(true); setMessage("");
    try {
      const data = await post("/api/backtest", { market: draft.market, style: draft.style, days: 7, notionalUsd: Number(draft.maxPositionNotionalUsd), takeProfitPct: Number(draft.takeProfitPct) || null, stopLossPct: Number(draft.stopLossPct) || null, limits: { maxPositionNotionalUsd: Number(draft.maxPositionNotionalUsd), dailyLossLimitUsd: Number(draft.dailyLossLimitUsd), maxTotalExposureUsd: Number(draft.maxTotalExposureUsd), maxOpenPositions: Number(draft.maxOpenPositions), pauseAtDailyLoss: true } });
      setBacktestResult(data.result);
    } catch (error) { setMessage((error as Error).message); } finally { setBacktestBusy(false); }
  }

  async function onFollow(strategy: Strategy) {
    setBusy(true);
    setMessage("");
    try {
      await post("/api/follows", { strategyId: strategy.id });
      setSelected({
        ...strategy,
        following: true,
        followers: strategy.followers + (strategy.following ? 0 : 1),
      });
      setMessage(`You are paper-following ${strategy.name}.`);
      await refresh();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onProposal(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setResult(null);
    setMessage("");
    try {
      const payload = {
        strategyId: selected.id, market: proposal.market.toUpperCase(),
        side: proposal.side, notionalUsd: Number(proposal.notionalUsd), reason: proposal.reason,
      };
      if (executionMode === "live") {
        if (!strikeAccount || !strikeSigningKey.current) throw new Error("Connect your Strike API wallet from Account before placing a live order.");
        const authHeaders = await strikeHeaders(strikePublicKey.current, strikeSigningKey.current, "GET", "/v2/account");
        const checked = await post("/api/live-proposals", {
          ...payload,
          strikeAccountId: strikeAccount.account_id,
          strikeAuth: {
            publicKey: authHeaders["X-API-Wallet-Public-Key"],
            signature: authHeaders["X-API-Wallet-Signature"],
            timestamp: authHeaders["X-API-Wallet-Timestamp"],
            nonce: authHeaders["X-API-Wallet-Nonce"],
          },
        });
        setResult({ ...checked.decision, price: checked.price });
        if (checked.decision.allowed) {
          if (!window.confirm(`Place a live ${payload.side.toUpperCase()} ${payload.market} order for ${money(payload.notionalUsd)} on Strike? This order uses real funds.`)) {
            setMessage("Live order canceled before it reached Strike.");
            return;
          }
          const market = markets.find((item) => item.symbol === payload.market);
          if (!market) throw new Error("Strike market configuration is unavailable.");
          const rawSize = payload.notionalUsd / checked.price;
          const step = market.orderStepSize;
          if (!Number.isFinite(step) || step <= 0) throw new Error("Strike order sizing is unavailable for this market.");
          const size = (Math.floor((rawSize + Number.EPSILON) / step) * step).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
          if (!Number(size) || Number(size) * checked.price < market.minNotionalUsd) throw new Error("Order is below Strike's minimum size.");
          const orderBody = JSON.stringify({ symbol: payload.market, side: payload.side === "long" ? "buy" : "sell", type: "market", size, client_order_id: `limitleague-${crypto.randomUUID()}` });
          const path = "/v2/order";
          const orderResponse = await fetch(`https://api.strikefinance.org${path}`, {
            method: "POST",
            headers: { ...(await strikeHeaders(strikePublicKey.current, strikeSigningKey.current, "POST", path, orderBody)), "Content-Type": "application/json" },
            body: orderBody,
          });
          const orderResult = await orderResponse.json();
          await post("/api/live-proposals/result", { auditId: checked.auditId, accepted: orderResponse.ok, strikeResponse: orderResult });
          if (!orderResponse.ok) throw new Error(orderResult.error ?? orderResult.msg ?? "Strike rejected the live order.");
          setMessage(`Live ${payload.market} order accepted by Strike. Audit ${checked.auditId.slice(0, 8)} recorded.`);
        }
      } else {
        const response = await post("/api/proposals", payload);
        setResult({ ...response.ownerDecision.decision, price: response.price });
      }
      await refresh();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onPause() {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await fetch("/api/strategies", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          strategyId: selected.id,
          paused: !selected.paused,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "Could not update strategy.");
      setSelected({ ...selected, paused: data.strategy.paused });
      setMessage(
        data.strategy.paused ? "Strategy paused." : "Strategy resumed.",
      );
      await refresh();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onTighten(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    try {
      const limits = {
        maxPositionNotionalUsd: Number(tighten.maxPositionNotionalUsd),
        dailyLossLimitUsd: Number(tighten.dailyLossLimitUsd),
        maxTotalExposureUsd: Number(tighten.maxTotalExposureUsd),
        maxOpenPositions: Number(tighten.maxOpenPositions),
        pauseAtDailyLoss: true as const,
      };
      const response = await fetch("/api/strategies", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ strategyId: selected.id, limits }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "Could not tighten limits.");
      setSelected({ ...selected, limits: data.strategy.limits });
      setMessage("Published limits tightened.");
      await refresh();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onClosePosition(position: Position) {
    setBusy(true);
    setMessage("");
    try {
      const result = await post("/api/positions/close", {
        strategyId: position.strategy_id,
        market: position.market,
        side: position.side,
      });
      setMessage(`${position.market} closed at ${money(result.price, 2)}. Realized PnL ${money(result.realizedPnlUsd, 2)}.`);
      await refresh();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function connectStrike(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      const base = "https://api.strikefinance.org";
      const [accountPath, positionsPath] = ["/v2/account", "/v2/positions"];
      const imported = await importStrikeKey(strikeKeys.publicKey, strikeKeys.privateKey);
      const [accountResponse, positionsResponse] = await Promise.all([
        fetch(`${base}${accountPath}`, { headers: await strikeHeaders(imported.publicKey, imported.signingKey, "GET", accountPath) }),
        fetch(`${base}${positionsPath}`, { headers: await strikeHeaders(imported.publicKey, imported.signingKey, "GET", positionsPath) }),
      ]);
      if (!accountResponse.ok || !positionsResponse.ok) throw new Error("Strike rejected this API wallet. Check the keys and try again.");
      const accountData = await accountResponse.json();
      const positionData = await positionsResponse.json();
      setStrikeAccount(accountData);
      setStrikePositions(positionData.positions ?? []);
      strikeSigningKey.current = imported.signingKey;
      strikePublicKey.current = imported.publicKey;
      setStrikeKeys({ publicKey: "", privateKey: "" });
      setStrikeOpen(false);
      setMessage("Strike account connected for this browser session.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not connect Strike account.");
    } finally { setBusy(false); }
  }

  function disconnectStrike() {
    strikeSigningKey.current = null;
    strikePublicKey.current = "";
    setStrikeAccount(null);
    setStrikePositions([]);
    setStrikeKeys({ publicKey: "", privateKey: "" });
    setExecutionMode("paper");
    setMessage("Strike account disconnected from this browser session.");
  }

  function openAudit(item: Audit) {
    setSelectedAudit(item);
    window.history.replaceState(null, "", `?audit=${item.id}`);
  }

  function closeAudit() {
    setSelectedAudit(null);
    window.history.replaceState(null, "", window.location.pathname);
  }

  function openStrategy(strategy: Strategy) {
    setSelected(strategy);
    setResult(null);
    setTighten({
      maxPositionNotionalUsd: String(strategy.limits.maxPositionNotionalUsd),
      dailyLossLimitUsd: String(strategy.limits.dailyLossLimitUsd),
      maxTotalExposureUsd: String(strategy.limits.maxTotalExposureUsd),
      maxOpenPositions: String(strategy.limits.maxOpenPositions),
    });
  }

  function changeView(next: View) {
    setView(next);
    setSelected(null);
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function finishTour(openPublish = false) {
    window.localStorage.setItem("limitleague-tour-v1", "1");
    setTour(false);
    setTourStep(0);
    if (openPublish) changeView("publish");
  }

  const navItems: {
    id: View;
    label: string;
    icon: "league" | "account" | "audit" | "publish";
  }[] = [
    { id: "league", label: "League", icon: "league" },
    { id: "account", label: "Account", icon: "account" },
    { id: "audit", label: "Audit", icon: "audit" },
    { id: "publish", label: "Publish", icon: "publish" },
  ];

  return (
    <div className="app-shell">
      <header className="app-header">
        <button
          className="brand"
          onClick={() => changeView("league")}
          aria-label="LimitLeague home"
        >
          <img className="brand-logo" src="/limitleague-logo.svg" alt="" />
          <span>LIMIT<span>LEAGUE</span></span>
        </button>
        <span className="mode-pill">
            <i /> {portfolio ? `${money(portfolio.availableUsd, 0)} pUSD` : "PAPER"}
        </span>
        <nav className="desktop-nav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "active" : ""}
              onClick={() => changeView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <span className="market-status">
            <i /> Strike data live
          </span>
          <button
            className="tour-button"
            onClick={() => {
              setTourStep(0);
              setTour(true);
            }}
          >
            Judge tour
          </button>
          <button
            className="primary small"
            onClick={() => changeView("publish")}
          >
            <Icon name="publish" /> Publish
          </button>
        </div>
      </header>

      {message && (
        <div className="toast" role="status">
          <span>{message}</span>
          <button onClick={() => setMessage("")} aria-label="Dismiss">
            <Icon name="close" />
          </button>
        </div>
      )}

      <main className="workspace">
        {view === "league" && (
          <>
            <section className="workspace-head">
              <div>
                <span className="kicker">OPEN PAPER LEAGUE · LIVE STRIKE PRICES</span>
                <h1>
                  Strategies ranked by <span>discipline.</span>
                </h1>
                <p>
                  Inspect the limits, test the decisions, then follow under the
                  same rules.
                </p>
              </div>
              <div className="head-actions">
                <button className="secondary" onClick={() => setTour(true)}>
                  How it works
                </button>
                <button
                  className="primary"
                  onClick={() => changeView("publish")}
                >
                  Publish a strategy <Icon name="arrow" />
                </button>
              </div>
            </section>

            <section className="metric-strip" aria-label="League statistics">
              <div>
                <span>Published strategies</span>
                <b>{strategies.length}</b>
                <small>public limit sets</small>
              </div>
              <div>
                <span>Audited decisions</span>
                <b>{metrics.decisions}</b>
                <small>allowed + blocked</small>
              </div>
              <div>
                <span>Allowed rate</span>
                <b>
                  {metrics.allowedRate === null
                    ? "—"
                    : `${metrics.allowedRate}%`}
                </b>
                <small>across paper proposals</small>
              </div>
              <div>
                <span>Paper follows</span>
                <b>{metrics.followers}</b>
                <small>same limits applied</small>
              </div>
            </section>

            <section className="judge-path">
              <div className="path-intro">
                <span className="kicker">TRY IT IN 60 SECONDS</span>
                <h2>The full proof loop</h2>
              </div>
              <div className="path-steps">
                <button onClick={() => changeView("account")}>
                  <b>01</b>
                  <span>
                    <strong>Open paper account</strong>
                    <small>Start with persisted pUSD buying power.</small>
                  </span>
                </button>
                <button onClick={() => changeView("publish")}>
                  <b>02</b>
                  <span>
                    <strong>Publish limits</strong>
                    <small>Start with the prefilled risk caps.</small>
                  </span>
                </button>
                <button
                  onClick={() => ownStrategy ? openStrategy(ownStrategy) : changeView("publish")}
                >
                  <b>03</b>
                  <span>
                    <strong>{ownStrategy ? "Test a proposal" : "Publish, then test"}</strong>
                    <small>{ownStrategy ? "Watch one pass or hit a hard limit." : "Create your first strategy to open the paper order check."}</small>
                  </span>
                </button>
                <button onClick={() => changeView("audit")}>
                  <b>04</b>
                  <span>
                    <strong>Verify the record</strong>
                    <small>See the decision and exact reason.</small>
                  </span>
                </button>
              </div>
            </section>

            <div className="dashboard-grid">
              <section className="panel league-panel">
                <div className="panel-head">
                  <div>
                    <span className="kicker">DISCOVERY</span>
                    <h2>League board</h2>
                  </div>
                  <span className="panel-note">
                    Ranked by compliant paper performance
                  </span>
                </div>
                {strategies.length === 0 ? (
                  <div className="empty-state">
                    <span className="empty-icon">
                      <Icon name="shield" />
                    </span>
                    <h3>The league is ready.</h3>
                    <p>
                      Publish the first strategy and make its limits public.
                    </p>
                    <button
                      className="primary"
                      onClick={() => changeView("publish")}
                    >
                      Publish strategy
                    </button>
                  </div>
                ) : (
                  <div className="strategy-list">
                    <div className="strategy-labels">
                      <span>Rank / Strategy</span>
                      <span>Paper return</span>
                      <span>Hard limits</span>
                      <span>Proof</span>
                    </div>
                    {strategies.map((strategy, index) => (
                      <button
                        className="strategy-row"
                        key={strategy.id}
                        onClick={() => openStrategy(strategy)}
                      >
                        <span className="rank">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="strategy-main">
                          <span className="avatar"><Icon name="shield" /></span>
                          <span>
                            <strong>{strategy.name}</strong>
                            <small>
                              {strategy.paused
                                ? "Paused"
                                : "Compliant paper strategy"}
                              {user?.id === strategy.owner_id ? " · Yours" : ""}
                            </small>
                            <span className="strategy-markets">
                              {(strategy.markets ?? []).length > 0 ? strategy.markets?.slice(0, 3).map((market) => (
                                <span className="market-chip" key={market}><i />{market.replace("-USD", "")}</span>
                              )) : <span className="market-chip muted">No trades yet</span>}
                            </span>
                          </span>
                        </span>
                        <span
                          className={`return ${strategy.returnPct !== null && strategy.returnPct < 0 ? "negative" : ""}`}
                        >
                          <strong>{percent(strategy.returnPct)}</strong>
                          <small>on risk budget</small>
                        </span>
                        <span className="limits-mini">
                          <span>
                            <small>Position</small>
                            <b>
                              {money(strategy.limits.maxPositionNotionalUsd)}
                            </b>
                          </span>
                          <span>
                            <small>Daily loss</small>
                            <b>{money(strategy.limits.dailyLossLimitUsd)}</b>
                          </span>
                          <span>
                            <small>Exposure</small>
                            <b>{money(strategy.limits.maxTotalExposureUsd)}</b>
                          </span>
                        </span>
                        <span className="proof">
                          <strong>{strategy.audit_count}</strong>
                          <small>decisions</small>
                          <em>{strategy.followers} following</em>
                        </span>
                        <span className="row-arrow">
                          <Icon name="arrow" />
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="panel recent-panel">
                <div className="panel-head">
                  <div>
                    <span className="kicker">LIVE RECORD</span>
                    <h2>Recent decisions</h2>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => changeView("audit")}
                  >
                    Open audit <Icon name="arrow" />
                  </button>
                </div>
                <div className="decision-feed">
                  {audit.length === 0 ? (
                    <div className="feed-empty">
                      Proposal decisions will appear here.
                    </div>
                  ) : (
                    audit.slice(0, 5).map((item) => (
                      <button key={item.id} onClick={() => { setView("audit"); openAudit(item); }}>
                        <span
                          className={`decision-dot ${item.event_type === "rules" ? "rules" : item.allowed ? "pass" : "stop"}`}
                        />
                        <span>
                          <strong>{item.strategy_name}</strong>
                          <small>
                            {item.event_type === "rules"
                              ? item.action
                              : `${item.side?.toUpperCase()} ${item.market} · ${money(item.notional_usd ?? 0)}`}
                          </small>
                        </span>
                        <em
                          className={
                            item.event_type === "rules"
                              ? "rules"
                              : item.allowed
                                ? "pass"
                                : "stop"
                          }
                        >
                          {item.event_type === "rules"
                            ? "RULES"
                            : item.allowed
                              ? "ALLOWED"
                              : "BLOCKED"}
                        </em>
                      </button>
                    ))
                  )}
                </div>
                <div className="proof-note">
                  <Icon name="shield" />
                  <p>
                    <strong>Public by design.</strong> Every proposal and every
                    limit change stays attached to the strategy.
                  </p>
                </div>
              </section>
            </div>
          </>
        )}

        {view === "account" && (
          <section className="page-section">
            <div className="page-head account-heading">
              <div>
                <span className="kicker">YOUR PAPER WALLET</span>
                <h1>Trade the league with pUSD.</h1>
                <p>
                  Every browser receives one persisted {portfolio ? money(portfolio.startingBalanceUsd, 0) : "funded"} pUSD allocation. It is virtual trading credit; fills and marks come from Strike Finance live market data.
                </p>
              </div>
              <div className="account-head-actions">
                <span className="source-chip"><i /> Strike marks live</span>
                <span className="source-chip"><i /> No wallet required</span>
              </div>
            </div>
            {portfolio && (
              <>
                <section className="account-balance panel">
                  <div className="balance-primary">
                    <span>Paper equity</span>
                    <b>{money(portfolio.equityUsd, 2)}</b>
                    <small>{portfolio.currency} · issued when this workspace was created</small>
                  </div>
                  <div><span>Available</span><b>{money(portfolio.availableUsd, 2)}</b><small>1× buying power</small></div>
                  <div><span>Open exposure</span><b>{money(portfolio.exposureUsd, 2)}</b><small>marked by Strike</small></div>
                  <div><span>Unrealized PnL</span><b className={portfolio.unrealizedPnlUsd < 0 ? "negative" : "positive"}>{money(portfolio.unrealizedPnlUsd, 2)}</b><small>live across positions</small></div>
                </section>
                <div className="account-grid">
                  <section className="panel positions-panel">
                    <div className="panel-head"><div><span className="kicker">PORTFOLIO</span><h2>Open positions</h2></div><span className="panel-note">Close and realize PnL at the current Strike mark</span></div>
                    {portfolio.positions.length === 0 ? (
                      <div className="empty-state"><h3>No open positions.</h3><p>Publish a strategy, then submit an allowed proposal.</p><button className="primary" onClick={() => changeView("league")}>Open league</button></div>
                    ) : portfolio.positions.map((position) => (
                      <div className="position-row" key={`${position.strategy_id}-${position.market}-${position.side}`}>
                        <span><strong>{position.market}</strong><small>{position.side.toUpperCase()} · {position.strategy_name}</small></span>
                        <span><small>Entry / mark</small><b>{money(position.entry_price, 2)} / {money(position.markPrice, 2)}</b></span>
                        <span><small>Notional</small><b>{money(position.notionalUsd, 2)}</b></span>
                        <span><small>Unrealized</small><b className={position.unrealizedPnlUsd < 0 ? "negative" : "positive"}>{money(position.unrealizedPnlUsd, 2)}</b></span>
                        <button className="secondary" disabled={busy} onClick={() => void onClosePosition(position)}>Close &amp; realize</button>
                      </div>
                    ))}
                  </section>
                  <section className="panel ledger-panel">
                    <div className="panel-head"><div><span className="kicker">ACCOUNT HISTORY</span><h2>pUSD ledger</h2></div></div>
                    {portfolio.ledger.map((entry) => (
                      <div className="ledger-row" key={entry.id}>
                        <span><strong>{entry.description}</strong><small>{new Date(entry.created_at).toLocaleString()}</small></span>
                        <span><b className={entry.amount < 0 ? "negative" : "positive"}>{entry.amount >= 0 ? "+" : ""}{money(entry.amount, 2)}</b><small>Balance {money(entry.balance_after, 2)}</small></span>
                      </div>
                    ))}
                  </section>
                </div>
                <p className="paper-note"><Icon name="shield" /> pUSD is virtual paper credit and cannot be withdrawn. Closing a position realizes its paper PnL into this account's ledger; Strike prices and marks remain live.</p>
              </>
            )}
          </section>
        )}

        {view === "audit" && (
          <section className="page-section">
            <div className="page-head">
              <div>
                <span className="kicker">PUBLIC PROOF</span>
                <h1>Decision audit</h1>
                <p>
                  Every proposal, verdict, rule change, and block reason in one
                  public record.
                </p>
              </div>
              <div className="legend">
                <span>
                  <i className="pass" />
                  Allowed
                </span>
                <span>
                  <i className="stop" />
                  Blocked
                </span>
                <span>
                  <i className="rules" />
                  Rules
                </span>
              </div>
            </div>
            <div className="panel audit-panel">
              <div className="audit-header">
                <span>Verdict</span>
                <span>Strategy / Event</span>
                <span>Price</span>
                <span>Time</span>
              </div>
              {audit.length === 0 ? (
                <div className="empty-state">
                  <h3>No decisions yet.</h3>
                  <p>Publish a strategy and test its first proposal.</p>
                </div>
              ) : (
                audit.map((item) => (
                  <button className="audit-entry" key={item.id} onClick={() => openAudit(item)}>
                    <span>
                      <em
                        className={
                          item.event_type === "rules"
                            ? "rules"
                            : item.allowed
                              ? "pass"
                              : "stop"
                        }
                      >
                        {item.event_type === "rules"
                          ? "RULES"
                          : item.allowed
                            ? "ALLOWED"
                            : "BLOCKED"}
                      </em>
                    </span>
                    <span>
                      <strong>{item.strategy_name}</strong>
                      <small>
                        {item.event_type === "rules"
                          ? item.action
                          : `${item.side?.toUpperCase()} ${item.market} · ${money(item.notional_usd ?? 0)}`}
                      </small>
                      {item.event_type === "proposal" && !item.allowed && (
                        <p>{item.reasons?.join(" ")}</p>
                      )}
                    </span>
                    <span className="mono">
                      {item.price ? money(item.price, 2) : "—"}
                    </span>
                    <time>{new Date(item.created_at).toLocaleString()}</time>
                  </button>
                ))
              )}
            </div>
          </section>
        )}

        {view === "publish" && (
          <section className="page-section publish-layout">
            <div className="publish-copy">
              <span className="kicker">PUBLISH TO THE LEAGUE</span>
              <h1>Declare the limits before the results.</h1>
              <p>
                Your strategy receives an instant paper workspace. Every
                proposal is priced with Strike market data and checked before a
                paper position opens.
              </p>
              <div className="assurance-list">
                <span>
                  <Icon name="check" />
                  <b>No wallet or email required</b>
                </span>
                <span>
                  <Icon name="check" />
                  <b>Limits are public immediately</b>
                </span>
                <span>
                  <Icon name="check" />
                  <b>Limits can tighten, never loosen</b>
                </span>
              </div>
            </div>
            <form className="publish-form panel" onSubmit={onPublish}>
              <div className="form-title">
                <span>01</span>
                <div>
                  <h2>Strategy identity</h2>
                  <p>Give judges enough context to understand the idea.</p>
                </div>
              </div>
              <label>
                Strategy name
                <input
                  required
                  minLength={3}
                  maxLength={80}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="e.g. BTC Momentum Guard"
                />
              </label>
              <label>
                Short description
                <textarea
                  required
                  maxLength={1000}
                  value={draft.description}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                  placeholder="Describe the signal and the discipline behind it."
                />
              </label>
              <div className="form-title divided">
                <span>02</span>
                <div>
                  <h2>Published hard limits</h2>
                  <p>
                    Every proposal and follower is checked against these caps.
                  </p>
                </div>
              </div>
              <div className="form-grid">
                <label>
                  Max position
                  <input
                    required
                    type="number"
                    min="1"
                    value={draft.maxPositionNotionalUsd}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        maxPositionNotionalUsd: e.target.value,
                      })
                    }
                  />
                  <small>USD per market</small>
                </label>
                <label>
                  Daily loss
                  <input
                    required
                    type="number"
                    min="1"
                    value={draft.dailyLossLimitUsd}
                    onChange={(e) =>
                      setDraft({ ...draft, dailyLossLimitUsd: e.target.value })
                    }
                  />
                  <small>USD before pause</small>
                </label>
                <label>
                  Total exposure
                  <input
                    required
                    type="number"
                    min="1"
                    value={draft.maxTotalExposureUsd}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        maxTotalExposureUsd: e.target.value,
                      })
                    }
                  />
                  <small>USD across markets</small>
                </label>
                <label>
                  Open positions
                  <input
                    required
                    type="number"
                    min="1"
                    max="100"
                    value={draft.maxOpenPositions}
                    onChange={(e) =>
                      setDraft({ ...draft, maxOpenPositions: e.target.value })
                    }
                  />
                  <small>Maximum at once</small>
                </label>
              </div>
              <div className="form-title divided">
                <span>03</span>
                <div>
                  <h2>Strategy behavior</h2>
                  <p>Choose the market and exits that paper followers will inherit.</p>
                </div>
              </div>
              <div className="form-grid">
                <label>Market<select value={draft.market} onChange={(e) => setDraft({ ...draft, market: e.target.value })}>{(markets.length ? markets : [{ symbol: "BTC-USD" } as Market]).slice(0, 33).map((m) => <option key={m.symbol} value={m.symbol}>{m.symbol}</option>)}</select><small>Strike perpetual</small></label>
                <label>Signal style<select value={draft.style} onChange={(e) => setDraft({ ...draft, style: e.target.value })}><option value="momentum">Momentum</option><option value="mean_reversion">Mean reversion</option><option value="breakout">Breakout</option></select><small>Used by the backtest</small></label>
                <label>Take profit %<input type="number" min="0" step="0.1" value={draft.takeProfitPct} onChange={(e) => setDraft({ ...draft, takeProfitPct: e.target.value })} /><small>Automatic paper exit</small></label>
                <label>Stop loss %<input type="number" min="0" step="0.1" value={draft.stopLossPct} onChange={(e) => setDraft({ ...draft, stopLossPct: e.target.value })} /><small>Automatic paper exit</small></label>
              </div>
              <div className="backtest-box">
                <div><strong>Validate this strategy on Strike candles</strong><small>Runs a seven day backtest using live public market history.</small></div>
                <button type="button" className="secondary" disabled={backtestBusy} onClick={runBacktest}>{backtestBusy ? "Running…" : "Run backtest"}</button>
                {backtestResult && <div className="backtest-result"><span><b>{percent(backtestResult.returnPct)}</b><small>return</small></span><span><b>{backtestResult.trades}</b><small>trades</small></span><span><b>{backtestResult.winRatePct}%</b><small>win rate</small></span><span><b>{backtestResult.maxDrawdownPct}%</b><small>max drawdown</small></span><span><b>{backtestResult.compliancePct}%</b><small>compliance</small></span></div>}
              </div>
              <div className="publish-confirm">
                <Icon name="shield" />
                <span>
                  <strong>Automatic pause enabled</strong>
                  <small>
                    New proposals stop when the daily loss limit is reached.
                  </small>
                </span>
              </div>
              <button disabled={busy} className="primary wide">
                {busy ? "Publishing…" : "Publish strategy"}
                <Icon name="arrow" />
              </button>
            </form>
          </section>
        )}
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={view === item.id ? "active" : ""}
            onClick={() => changeView(item.id)}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {strikeOpen && (
        <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && setStrikeOpen(false)}>
          <section className="drawer connect-drawer" role="dialog" aria-modal="true" aria-label="Connect Strike account">
            <button className="drawer-close" onClick={() => setStrikeOpen(false)} aria-label="Close Strike connection"><Icon name="close" /></button>
            <div className="drawer-top"><span className="status-badge"><i /> STRIKE MAINNET</span></div>
            <h2>Connect a Strike API wallet</h2>
            <p className="drawer-description">Create an API wallet in Strike, then connect it for this browser session. Strike API wallets can trade and read your portfolio, but cannot withdraw funds. Your raw private key is cleared after connection.</p>
            <a className="strike-key-link" href="https://app.strikefinance.org/api-keys" target="_blank" rel="noreferrer">Create API wallet on Strike <Icon name="arrow" /></a>
            <form className="connect-form" onSubmit={connectStrike}>
              <label>API wallet public key<input required autoComplete="off" spellCheck={false} value={strikeKeys.publicKey} onChange={(event) => setStrikeKeys({ ...strikeKeys, publicKey: event.target.value })} placeholder="64-character public key" /></label>
              <label>API wallet private key<input required type="password" autoComplete="off" spellCheck={false} value={strikeKeys.privateKey} onChange={(event) => setStrikeKeys({ ...strikeKeys, privateKey: event.target.value })} placeholder="Private signing key" /></label>
              <div className="key-safety"><Icon name="shield" /><span><strong>Browser-only signing</strong><small>A non-exportable signing key stays in this tab until refresh or disconnect. The raw private key is never sent to LimitLeague or saved.</small></span></div>
              <button className="primary wide" disabled={busy}>{busy ? "Connecting…" : "Verify and connect"}<Icon name="arrow" /></button>
            </form>
          </section>
        </div>
      )}

      {selectedAudit && (
        <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && closeAudit()}>
          <section className="drawer audit-drawer" role="dialog" aria-modal="true" aria-label="Audit proof">
            <button className="drawer-close" onClick={closeAudit} aria-label="Close audit proof"><Icon name="close" /></button>
            <div className="drawer-top">
              <span className={`status-badge ${selectedAudit.allowed ? "" : "paused"}`}><i />{selectedAudit.allowed ? "ALLOWED" : "BLOCKED"}</span>
              <span className="owner-badge">PUBLIC PROOF</span>
            </div>
            <h2>{selectedAudit.strategy_name}</h2>
            <p className="drawer-description">{selectedAudit.side?.toUpperCase()} {selectedAudit.market} · {money(selectedAudit.notional_usd ?? 0)} at {money(selectedAudit.price ?? 0, 2)}</p>
            <div className="proof-hash">
              <span>SHA-256 decision proof</span>
              <code>{selectedAudit.event_hash ?? selectedAudit.id}</code>
            </div>
            {selectedAudit.limits_snapshot && selectedAudit.decision_snapshot && (
              <div className="audit-checks">
                <h3>Deterministic limit check</h3>
                {[
                  ["Position size", selectedAudit.decision_snapshot.after.positionNotionalUsd, selectedAudit.limits_snapshot.maxPositionNotionalUsd],
                  ["Total exposure", selectedAudit.decision_snapshot.after.totalExposureUsd, selectedAudit.limits_snapshot.maxTotalExposureUsd],
                  ["Open positions", selectedAudit.decision_snapshot.after.openPositionCount, selectedAudit.limits_snapshot.maxOpenPositions],
                  ["Daily loss", selectedAudit.decision_snapshot.after.dailyLossUsd, selectedAudit.limits_snapshot.dailyLossLimitUsd],
                ].map(([label, actual, limit]) => (
                  <div key={String(label)}><span>{label}</span><b>{label === "Open positions" ? actual : money(Number(actual), 2)} / {label === "Open positions" ? limit : money(Number(limit), 2)}</b><em>{Number(actual) <= Number(limit) ? "PASS" : "BLOCK"}</em></div>
                ))}
              </div>
            )}
            <div className="proof-source">
              <span>Price source</span><b>Strike Finance live market API</b>
              <span>Recorded</span><b>{new Date(selectedAudit.created_at).toLocaleString()}</b>
              <span>Mode</span><b>{selectedAudit.mode === "live" ? "Strike mainnet" : "Persisted paper account"}</b>
            </div>
            {selectedAudit.mode === "live" && selectedAudit.execution_snapshot && (
              <div className={`execution-proof ${selectedAudit.execution_snapshot.accepted ? "accepted" : "rejected"}`}>
                <strong>Strike execution {selectedAudit.execution_snapshot.accepted ? "accepted" : "rejected"}</strong>
                <span>{String(selectedAudit.execution_snapshot.strikeResponse?.order_id ?? selectedAudit.execution_snapshot.strikeResponse?.ID ?? "Recorded by Strike")}</span>
              </div>
            )}
            {selectedAudit.reasons && selectedAudit.reasons.length > 0 && <div className="block-reason"><strong>Block reason</strong><p>{selectedAudit.reasons.join(" ")}</p></div>}
            <button className="primary wide" onClick={() => {
              void navigator.clipboard.writeText(`${window.location.origin}/?audit=${selectedAudit.id}`);
              setMessage("Verification link copied.");
            }}>Copy verification link <Icon name="arrow" /></button>
          </section>
        </div>
      )}

      {selected && (
        <div
          className="overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelected(null);
          }}
        >
          <section
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`${selected.name} strategy`}
          >
            <button
              className="drawer-close"
              onClick={() => setSelected(null)}
              aria-label="Close strategy"
            >
              <Icon name="close" />
            </button>
            <div className="drawer-top">
              <span
                className={`status-badge ${selected.paused ? "paused" : ""}`}
              >
                <i />
                {selected.paused ? "PAUSED" : "PAPER · COMPLIANT"}
              </span>
              {user?.id === selected.owner_id && (
                <span className="owner-badge">YOUR STRATEGY</span>
              )}
            </div>
            <h2>{selected.name}</h2>
            <p className="drawer-description">
              {selected.description ||
                "Published limits and a public decision record."}
            </p>
            <div className="drawer-performance">
              <div>
                <span>Paper return</span>
                <b>{percent(selected.returnPct)}</b>
              </div>
              <div>
                <span>Decisions</span>
                <b>{selected.audit_count}</b>
              </div>
              <div>
                <span>Followers</span>
                <b>{selected.followers}</b>
              </div>
            </div>
            <div className="limit-box">
              <div className="limit-title">
                <span>Published hard limits</span>
                <small>Applied before every proposal</small>
              </div>
              <div className="limit-grid">
                <div>
                  <small>Max position</small>
                  <b>{money(selected.limits.maxPositionNotionalUsd)}</b>
                </div>
                <div>
                  <small>Daily loss</small>
                  <b>{money(selected.limits.dailyLossLimitUsd)}</b>
                </div>
                <div>
                  <small>Total exposure</small>
                  <b>{money(selected.limits.maxTotalExposureUsd)}</b>
                </div>
                <div>
                  <small>Open positions</small>
                  <b>{selected.limits.maxOpenPositions}</b>
                </div>
              </div>
            </div>
            <div className="drawer-actions">
              <button
                className="primary"
                disabled={
                  busy || user?.id === selected.owner_id || selected.following
                }
                onClick={() => void onFollow(selected)}
              >
                {user?.id === selected.owner_id
                  ? "Your paper strategy"
                  : selected.following
                    ? "Following in paper"
                    : "Paper follow"}
                <Icon name="arrow" />
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setSelected(null);
                  changeView("audit");
                }}
              >
                View public audit
              </button>
            </div>
            {user?.id === selected.owner_id && (
              <>
                <form className="proposal-card" onSubmit={onProposal}>
                  <div className="form-title">
                    <span>ORDER</span>
                    <div>
                      <h3>Submit a paper order</h3>
                      <p>Select any of {markets.length || "the live"} Strike markets. The checker decides.</p>
                    </div>
                  </div>
                  <div className="form-grid compact">
                    <label>
                      Market
                      <select
                        value={proposal.market}
                        onChange={(e) =>
                          setProposal({ ...proposal, market: e.target.value })
                        }
                      >
                        {markets.map((market) => (
                          <option key={market.symbol} value={market.symbol}>
                            {market.symbol} · {money(market.markPrice, market.markPrice < 1 ? 4 : 2)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Side
                      <select
                        value={proposal.side}
                        onChange={(e) =>
                          setProposal({ ...proposal, side: e.target.value })
                        }
                      >
                        <option value="long">Long</option>
                        <option value="short">Short</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    Notional (USD)
                    <input
                      required
                      type="number"
                      min="1"
                      value={proposal.notionalUsd}
                      onChange={(e) =>
                        setProposal({
                          ...proposal,
                          notionalUsd: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Reason
                    <input
                      required
                      maxLength={500}
                      value={proposal.reason}
                      onChange={(e) =>
                        setProposal({ ...proposal, reason: e.target.value })
                      }
                    />
                  </label>
                  <button
                    className="primary wide"
                    disabled={busy || selected.paused}
                  >
                    {selected.paused ? "Strategy paused" : "Check paper proposal"}
                    <Icon name="arrow" />
                  </button>
                  {result && (
                    <div
                      className={`decision-result ${result.allowed ? "pass" : "stop"}`}
                    >
                      <span className="result-icon">
                        <Icon name={result.allowed ? "check" : "close"} />
                      </span>
                      <div>
                        <strong>
                          {result.allowed ? "ALLOWED" : "BLOCKED"} ·{" "}
                          {money(result.price, 2)}
                        </strong>
                        <p>
                          {result.allowed
                            ? "Every published limit passed."
                            : result.reasons.join(" ")}
                        </p>
                        <div>
                          <span>
                            Position{" "}
                            <b>
                              {money(result.after.positionNotionalUsd)} /{" "}
                              {money(selected.limits.maxPositionNotionalUsd)}
                            </b>
                          </span>
                          <span>
                            Exposure{" "}
                            <b>
                              {money(result.after.totalExposureUsd)} /{" "}
                              {money(selected.limits.maxTotalExposureUsd)}
                            </b>
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </form>
                <details className="risk-controls">
                  <summary>
                    Strategy controls <span>Pause or tighten limits</span>
                  </summary>
                  <div className="pause-row">
                    <div>
                      <strong>
                        {selected.paused
                          ? "Strategy is paused"
                          : "Immediate pause"}
                      </strong>
                      <p>Stop every new proposal under this strategy.</p>
                    </div>
                    <button
                      className="secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => void onPause()}
                    >
                      {selected.paused ? "Resume" : "Pause strategy"}
                    </button>
                  </div>
                  <form onSubmit={onTighten}>
                    <h3>Tighten published limits</h3>
                    <p>
                      Values may move down. The change is added to the public
                      audit.
                    </p>
                    <div className="form-grid compact">
                      <label>
                        Max position
                        <input
                          required
                          type="number"
                          min="1"
                          max={selected.limits.maxPositionNotionalUsd}
                          value={tighten.maxPositionNotionalUsd}
                          onChange={(e) =>
                            setTighten({
                              ...tighten,
                              maxPositionNotionalUsd: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Daily loss
                        <input
                          required
                          type="number"
                          min="1"
                          max={selected.limits.dailyLossLimitUsd}
                          value={tighten.dailyLossLimitUsd}
                          onChange={(e) =>
                            setTighten({
                              ...tighten,
                              dailyLossLimitUsd: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Total exposure
                        <input
                          required
                          type="number"
                          min="1"
                          max={selected.limits.maxTotalExposureUsd}
                          value={tighten.maxTotalExposureUsd}
                          onChange={(e) =>
                            setTighten({
                              ...tighten,
                              maxTotalExposureUsd: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Open positions
                        <input
                          required
                          type="number"
                          min="1"
                          max={selected.limits.maxOpenPositions}
                          value={tighten.maxOpenPositions}
                          onChange={(e) =>
                            setTighten({
                              ...tighten,
                              maxOpenPositions: e.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                    <button className="secondary" disabled={busy}>
                      Publish tighter limits
                    </button>
                  </form>
                </details>
              </>
            )}
          </section>
        </div>
      )}

      {tour && (
        <div className="tour-overlay">
          <section
            className="tour-card"
            role="dialog"
            aria-modal="true"
            aria-label="LimitLeague judge tour"
          >
            <div className="tour-progress">
              <span>{tourStep + 1} / 4</span>
              <button onClick={() => finishTour()} aria-label="Close tour">
                Skip tour
              </button>
            </div>
            {tourStep === 0 && (
              <>
                <span className="tour-icon"><Icon name="account" /></span>
                <h2>Your paper account is ready.</h2>
                <p>
                  LimitLeague creates a private workspace and issues its pUSD
                  allocation automatically. Account shows buying power, live
                  PnL, positions, and the complete balance ledger.
                </p>
              </>
            )}
            {tourStep === 1 && (
              <>
                <span className="tour-icon">
                  <Icon name="publish" />
                </span>
                <h2>Publish the rules first.</h2>
                <p>
                  Set position size, daily loss, total exposure, and open
                  position limits before the strategy builds a record.
                </p>
              </>
            )}
            {tourStep === 2 && (
              <>
                <span className="tour-icon"><Icon name="shield" /></span>
                <h2>Every order is checked.</h2>
                <p>
                  Choose a live Strike market and submit a paper order. The
                  checker reads buying power and every limit before allowing a
                  position to open.
                </p>
              </>
            )}
            {tourStep === 3 && (
              <>
                <span className="tour-icon">
                  <Icon name="audit" />
                </span>
                <h2>Verify every decision.</h2>
                <p>
                  The public audit shows allowed and blocked proposals with the
                  exact reason. Followers receive the same checks on their own
                  paper portfolios.
                </p>
              </>
            )}
            <div className="tour-dots">
              {[0, 1, 2, 3].map((index) => (
                <i key={index} className={index === tourStep ? "active" : ""} />
              ))}
            </div>
            <div className="tour-actions">
              {tourStep > 0 && (
                <button
                  className="secondary"
                  onClick={() => setTourStep(tourStep - 1)}
                >
                  Back
                </button>
              )}
              <button
                className="primary"
                onClick={() =>
                  tourStep < 3 ? setTourStep(tourStep + 1) : finishTour(true)
                }
              >
                {tourStep < 3 ? "Next" : "Publish a strategy"}
                <Icon name="arrow" />
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
