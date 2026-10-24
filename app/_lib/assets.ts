import { baseOf } from "./format";

/**
 * Visual catalog only: which markets have a bundled logo and how to draw the rest.
 * Prices, names and availability always come from Strike.
 */
const LOGOS: Record<string, string> = {
  ADA: "/tokens/ADA.svg",
  BNB: "/tokens/BNB.svg",
  BTC: "/tokens/BTC.svg",
  DOGE: "/tokens/DOGE.svg",
  ETH: "/tokens/ETH.svg",
  HYPE: "/tokens/HYPE.png",
  LIT: "/tokens/LIT.png",
  NEAR: "/tokens/NEAR.svg",
  NIGHT: "/tokens/NIGHT.png",
  PUMP: "/tokens/PUMP.png",
  SOL: "/tokens/SOL.svg",
  XRP: "/tokens/XRP.svg",
  ZEC: "/tokens/ZEC.svg",
};

const COMMODITIES: Record<string, string> = { XAU: "Gold", XAG: "Silver", WTI: "Oil" };
const INDICES = new Set(["NAS100", "SP500"]);

export type AssetKind = "token" | "commodity" | "index" | "stock";

export function assetKind(symbol: string): AssetKind {
  const base = baseOf(symbol);
  if (LOGOS[base]) return "token";
  if (COMMODITIES[base]) return "commodity";
  if (INDICES.has(base)) return "index";
  return "stock";
}

export const logoFor = (symbol: string) => LOGOS[baseOf(symbol)] ?? null;
export const commodityName = (symbol: string) => COMMODITIES[baseOf(symbol)] ?? null;

export function kindLabel(symbol: string) {
  const kind = assetKind(symbol);
  return kind === "token" ? "Crypto" : kind === "commodity" ? "Commodity" : kind === "index" ? "Index" : "Stock";
}

/** A stable hue per ticker so badges stay recognisable between visits. */
export function hueFor(text: string) {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}
