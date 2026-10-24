"use client";

import { useState } from "react";
import { assetKind, commodityName, hueFor, logoFor } from "../_lib/assets";
import { baseOf } from "../_lib/format";

/** Logo for a market: the real token logo when we have it, otherwise a clear badge for stocks, indices and commodities. */
export function TokenLogo({ symbol, size = 32 }: { symbol: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const base = baseOf(symbol);
  const logo = logoFor(symbol);
  const style = { width: size, height: size };
  if (logo && !failed) {
    return (
      <span className="token" style={style} title={base}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt={base} width={size} height={size} loading="lazy" onError={() => setFailed(true)} />
      </span>
    );
  }
  const kind = assetKind(symbol);
  const hue = hueFor(base);
  const glyph = kind === "commodity" ? commodityGlyph(commodityName(symbol)!) : kind === "index" ? indexGlyph() : null;
  return (
    <span
      className={`token token-badge token-${kind}`}
      style={{ ...style, ["--hue" as string]: hue, fontSize: Math.max(9, size * (base.length > 4 ? 0.26 : 0.32)) }}
      title={base}
      role="img"
      aria-label={base}
    >
      {glyph ?? base.slice(0, 5)}
    </span>
  );
}

function commodityGlyph(name: string) {
  if (name === "Oil")
    return (
      <svg viewBox="0 0 24 24" width="62%" height="62%" aria-hidden="true"><path d="M12 3c3.4 4.3 5.5 7.2 5.5 10.2A5.5 5.5 0 0 1 12 19a5.5 5.5 0 0 1-5.5-5.8C6.5 10.2 8.6 7.3 12 3z" fill="currentColor" /></svg>
    );
  return (
    <svg viewBox="0 0 24 24" width="66%" height="66%" aria-hidden="true">
      <path d="M3 17l2.5-7h13L21 17z" fill="currentColor" />
      <path d="M8 10l1-3h6l1 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" opacity=".55" />
    </svg>
  );
}

function indexGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="64%" height="64%" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 17l5-6 4 3 7-9" />
      <path d="M15 5h5v5" />
    </svg>
  );
}

/** Overlapping logos for a strategy that has touched several markets. */
export function TokenStack({ symbols, size = 24, max = 3 }: { symbols: string[]; size?: number; max?: number }) {
  const shown = symbols.slice(0, max);
  return (
    <span className="token-stack">
      {shown.map((symbol) => (
        <TokenLogo key={symbol} symbol={symbol} size={size} />
      ))}
      {symbols.length > max && <span className="token token-more" style={{ width: size, height: size }}>+{symbols.length - max}</span>}
    </span>
  );
}
