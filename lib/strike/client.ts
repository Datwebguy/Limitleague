import { UserError } from "../errors";

const baseUrl = process.env.STRIKE_API_BASE_URL ?? "https://api.strikefinance.org";
const unavailable = (what: string) => new UserError(`${what} is unavailable. Please try again in a moment.`, 503);

export async function getStrikePrice(symbol: string): Promise<number> {
  const url = new URL("/price/v2/markPrice", baseUrl);
  url.searchParams.set("symbol", symbol);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw unavailable("Strike price");
  const value = await response.json();
  const price = Number(value.p);
  if (!Number.isFinite(price) || price <= 0) throw unavailable("Strike price");
  return price;
}

export type StrikeMarket = {
  symbol: string;
  name: string;
  baseAsset: string;
  markPrice: number;
  fundingRate: number;
  minNotionalUsd: number;
  orderStepSize: number;
  status: string;
};

let marketCache: { at: number; markets: StrikeMarket[] } | undefined;

export async function getStrikeMarkets(): Promise<StrikeMarket[]> {
  if (marketCache && Date.now() - marketCache.at < 15_000) return marketCache.markets;
  const markets = await fetchStrikeMarkets();
  marketCache = { at: Date.now(), markets };
  return markets;
}

/** The tradable market for a symbol, or undefined when Strike does not list it as trading. */
export async function getStrikeMarket(symbol: string) {
  return (await getStrikeMarkets()).find((market) => market.symbol === symbol);
}

async function fetchStrikeMarkets(): Promise<StrikeMarket[]> {
  const response = await fetch(new URL("/v2/markets", baseUrl), {
    next: { revalidate: 30 },
  });
  if (!response.ok) throw unavailable("Strike market data");
  const data = (await response.json()) as { markets?: Record<string, Record<string, unknown>> };
  const markets = Object.values(data.markets ?? {}).map((market) => ({
    symbol: String(market.symbol),
    name: String(market.name ?? market.symbol),
    baseAsset: String(market.base_asset ?? ""),
    markPrice: Number(market.mark_price),
    fundingRate: Number(market.funding_rate ?? 0),
    minNotionalUsd: Number(market.order_min_notional ?? 0),
    orderStepSize: Number(market.order_market_step_size ?? market.order_step_size ?? 0),
    status: String(market.status ?? "unknown"),
  }));
  return markets
    .filter((market) => market.status === "trading" && Number.isFinite(market.markPrice))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export type StrikeCandle = { timestamp: number; open: number; high: number; low: number; close: number; volume: number };

export async function getStrikeCandles(symbol: string, interval = "1h", limit = 168, priceType: "last" | "mark" = "last"): Promise<StrikeCandle[]> {
  const url = new URL("/price/v2/klines", baseUrl);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(Math.min(720, Math.max(24, limit))));
  url.searchParams.set("priceType", priceType);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw unavailable("Strike market history");
  const rows = await response.json();
  if (!Array.isArray(rows)) throw unavailable("Strike market history");
  return rows.map((row: unknown[]) => ({ timestamp: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5] ?? 0) }))
    .filter((c: StrikeCandle) => [c.timestamp,c.open,c.high,c.low,c.close].every(Number.isFinite));
}

async function publicStrikeRequest(path: string, query: Record<string, string>) {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new UserError(`Strike account data returned HTTP ${response.status}.`, 502);
  return data;
}

export type StrikePublicAccount = {
  account_id: string;
  available_balance: string;
  wallet_balance: string;
  unrealized_pnl: string;
};

export type StrikePublicPosition = {
  symbol: string;
  size: string;
  entry_price: string;
  create_timestamp: number;
};

export type StrikePublicFill = {
  realized_pnl: string;
  fee: string;
  timestamp: number;
};

export type StrikePublicOrder = {
  ID?: number;
  id?: number;
  Symbol?: string;
  symbol?: string;
  Side?: "buy" | "sell";
  side?: "buy" | "sell";
  Size?: string;
  size?: string;
  Status?: string;
  status?: string;
  ClientOrderID?: string;
  client_order_id?: string;
};

export async function getStrikePublicAccount(accountId: string): Promise<StrikePublicAccount> {
  return publicStrikeRequest("/v2/account", { account_id: accountId });
}

export async function getStrikePublicPositions(accountId: string): Promise<StrikePublicPosition[]> {
  const result = await publicStrikeRequest("/v2/positions", { account_id: accountId }) as { positions?: StrikePublicPosition[] };
  return result.positions ?? [];
}

export async function getStrikePublicFills(accountId: string, startTime: number): Promise<StrikePublicFill[]> {
  const result = await publicStrikeRequest("/v2/history/fill", {
    account_id: accountId,
    startTime: String(startTime),
    limit: "1000",
  }) as { fills?: StrikePublicFill[] };
  return result.fills ?? [];
}

export async function getStrikePublicOrder(accountId: string, symbol: string, orderId: number): Promise<StrikePublicOrder> {
  return publicStrikeRequest("/v2/order", {
    account_id: accountId,
    symbol,
    order_id: String(orderId),
  });
}

export type StrikeAuthProof = {
  publicKey: string;
  signature: string;
  timestamp: string;
  nonce: string;
};

/** Uses a single-use browser signature to let Strike identify the connected account. */
export async function verifyStrikeAccountAuth(proof: StrikeAuthProof): Promise<StrikePublicAccount> {
  const response = await fetch(new URL("/v2/account", baseUrl), {
    headers: {
      "X-API-Wallet-Public-Key": proof.publicKey,
      "X-API-Wallet-Signature": proof.signature,
      "X-API-Wallet-Timestamp": proof.timestamp,
      "X-API-Wallet-Nonce": proof.nonce,
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new UserError("Strike could not verify this API wallet session.", 400);
  return data as StrikePublicAccount;
}

/**
 * Price at 00:00 UTC today. Right after the day rolls over Strike may not have published the daily candle yet,
 * so fall back to the current mark, which is the day's open for practical purposes.
 */
export async function getStrikeDayOpen(symbol: string): Promise<number> {
  const dayStart = new Date().setUTCHours(0, 0, 0, 0);
  const url = new URL("/price/v2/klines", baseUrl);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "1d");
  url.searchParams.set("limit", "1");
  url.searchParams.set("priceType", "last");
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw unavailable("Strike daily price");
  const rows = await response.json();
  const open = Number(rows?.[0]?.[1]);
  if (Array.isArray(rows) && Number(rows[0]?.[0]) === dayStart && Number.isFinite(open) && open > 0) return open;
  if (Date.now() - dayStart < 15 * 60_000) return getStrikePrice(symbol);
  throw unavailable("Strike daily price");
}
