"use client";

import Link from "next/link";
import { useState } from "react";
import { baseOf, money, percent, plural, signedPercent, tone } from "../_lib/format";
import { useStore } from "../_lib/store";
import type { Strategy } from "../_lib/types";
import { Icon } from "./Icon";
import { TokenLogo, TokenStack } from "./TokenLogo";
import { Badge } from "./ui";

export function ComplianceBar({ value }: { value: number | null }) {
  if (value === null) return <span className="muted-text">No trades yet</span>;
  const state = value >= 90 ? "good" : value >= 60 ? "warn" : "bad";
  return (
    <span className={`cbar cbar-${state}`} title={`${percent(value, 0)} of this strategy's trades stayed within its limits`}>
      <span className="cbar-track"><i style={{ width: `${value}%` }} /></span>
      <b>{percent(value, 0)}</b>
    </span>
  );
}

export function StrategyRow({ strategy, rank }: { strategy: Strategy; rank: number | null }) {
  const { user, follow, unfollow, notify } = useStore();
  const [busy, setBusy] = useState(false);
  const own = user?.id === strategy.owner_id;
  const market = strategy.config?.market ?? strategy.markets?.[0];
  const traded = strategy.markets && strategy.markets.length > 1 ? strategy.markets : market ? [market] : [];

  async function toggle() {
    setBusy(true);
    try {
      if (strategy.following) { await unfollow(strategy.id); notify(`You stopped following ${strategy.name}.`); }
      else { await follow(strategy.id); notify(`You're now following ${strategy.name}. Its trades will copy into your practice account.`, "good"); }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not update that.", "bad");
    } finally { setBusy(false); }
  }

  return (
    <article className="srow">
      <span className="srow-rank" aria-label={rank ? `Rank ${rank}` : "Not ranked yet"}>{rank ?? "–"}</span>
      <div className="srow-main">
        {market ? <TokenLogo symbol={market} size={40} /> : <span className="token token-badge" style={{ width: 40, height: 40 }}>?</span>}
        <div>
          <Link href={`/strategies/${strategy.id}`} className="srow-link">{strategy.name}</Link>
          <p className="srow-sub">
            {market ? baseOf(market) : "Any market"}
            {strategy.paused && <Badge tone="warn">Paused</Badge>}
            {own && <Badge tone="brand">Yours</Badge>}
          </p>
        </div>
      </div>
      <div className="srow-cell srow-markets">{traded.length > 1 && <TokenStack symbols={traded} size={22} />}</div>
      <div className="srow-cell" data-label="Return">
        <b className={`num tone-${tone(strategy.returnPct)}`}>{strategy.returnPct === null ? "—" : signedPercent(strategy.returnPct)}</b>
        <small>{strategy.returnPct === null ? "No results yet" : "on its risk budget"}</small>
      </div>
      <div className="srow-cell" data-label="Stays within limits">
        <ComplianceBar value={strategy.compliancePct} />
        <small>{strategy.blockedCount === 0 ? plural(strategy.allowedCount, "trade") : `${plural(strategy.blockedCount, "trade")} stopped`}</small>
      </div>
      <div className="srow-cell srow-limits" data-label="Limits">
        <b className="num">{money(strategy.limits.maxPositionNotionalUsd)}</b>
        <small>largest position · {money(strategy.limits.dailyLossLimitUsd)} daily loss</small>
      </div>
      <div className="srow-cell srow-follow">
        <small>{plural(strategy.followers, "follower")}</small>
        {own ? (
          <Link className="btn btn-secondary btn-sm" href={`/strategies/${strategy.id}`}>Manage</Link>
        ) : (
          <button className={`btn btn-sm ${strategy.following ? "btn-secondary" : "btn-primary"}`} onClick={toggle} disabled={busy}>
            {busy ? "…" : strategy.following ? "Following" : "Follow"}
          </button>
        )}
      </div>
      <Icon name="arrow" size={18} />
    </article>
  );
}
