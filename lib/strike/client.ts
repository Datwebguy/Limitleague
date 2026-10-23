import { createHash, createPrivateKey, createPublicKey, randomUUID, sign } from "node:crypto";

const baseUrl = process.env.STRIKE_API_BASE_URL ?? "https://api.strikefinance.org";

export function walletConfigured() {
  return Boolean(process.env.STRIKE_API_WALLET_PRIVATE_KEY && process.env.STRIKE_API_WALLET_PUBLIC_KEY);
}

export function signedHeaders(method: string, path: string, body = "", timestamp = Math.floor(Date.now() / 1000), nonce = randomUUID()) {
  const privateHex = process.env.STRIKE_API_WALLET_PRIVATE_KEY;
  const publicHex = process.env.STRIKE_API_WALLET_PUBLIC_KEY;
  if (!privateHex || !publicHex) throw new Error("Strike API wallet is not configured.");
  if (!/^(?:[0-9a-f]{64}|[0-9a-f]{128})$/i.test(privateHex) || !/^[0-9a-f]{64}$/i.test(publicHex)) throw new Error("Invalid API wallet key format.");
  const seed = Buffer.from(privateHex.slice(0, 64), "hex");
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
  const derived = createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
  if (derived !== publicHex.toLowerCase()) throw new Error("API wallet public/private keys do not match.");
  const hash = createHash("sha256").update(body).digest("hex");
  const message = `${method.toUpperCase()}:${path}:${timestamp}:${nonce}:${hash}`;
  return {
    "X-API-Wallet-Public-Key": publicHex,
    "X-API-Wallet-Signature": sign(null, Buffer.from(message), key).toString("hex"),
    "X-API-Wallet-Timestamp": String(timestamp),
    "X-API-Wallet-Nonce": nonce
  };
}

async function strikeRequest(method: string, path: string, body?: object) {
  const serialized = body === undefined ? "" : JSON.stringify(body);
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: { ...signedHeaders(method, path, serialized), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? serialized : undefined,
    cache: "no-store"
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Strike returned HTTP ${response.status}.`);
  return data;
}

export async function getStrikePositions() {
  return strikeRequest("GET", "/v2/positions");
}

export async function getStrikeAccount() {
  return strikeRequest("GET", "/v2/account");
}

export async function submitStrikeOrder(order: { symbol: string; side: "buy" | "sell"; size: string; client_order_id: string }) {
  return strikeRequest("POST", "/v2/order", { symbol: order.symbol, side: order.side, type: "market", size: order.size, client_order_id: order.client_order_id });
}

export async function getStrikePrice(symbol: string): Promise<number> {
  const url = new URL("/price/v2/markPrice", baseUrl);
  url.searchParams.set("symbol", symbol);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Strike price is unavailable.");
  const value = await response.json();
  const price = Number(value.p);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Strike price is invalid.");
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

export async function getStrikeMarkets(): Promise<StrikeMarket[]> {
  const response = await fetch(new URL("/v2/markets", baseUrl), {
    next: { revalidate: 30 },
  });
  if (!response.ok) throw new Error("Strike markets are unavailable.");
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

async function publicStrikeRequest(path: string, query: Record<string, string>) {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Strike public account data returned HTTP ${response.status}.`);
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
  if (!response.ok) throw new Error("Strike could not verify this API wallet session.");
  return data as StrikePublicAccount;
}

export async function getStrikeDayOpen(symbol: string): Promise<number> {
  const url = new URL("/price/v2/klines", baseUrl);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "1d");
  url.searchParams.set("limit", "1");
  url.searchParams.set("priceType", "last");
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Strike daily price is unavailable.");
  const rows = await response.json();
  const open = Number(rows?.[0]?.[1]);
  const dayStart = new Date().setUTCHours(0,0,0,0);
  if (!Number.isFinite(open) || open <= 0 || rows[0][0] !== dayStart) throw new Error("Strike daily price is stale.");
  return open;
}
