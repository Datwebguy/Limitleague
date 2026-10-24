"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "../_components/Icon";
import { StrategyRow } from "../_components/StrategyRow";
import { TokenLogo } from "../_components/TokenLogo";
import { EmptyState, Hint, Skeleton } from "../_components/ui";
import { baseOf } from "../_lib/format";
import { useStore } from "../_lib/store";

type Sort = "rank" | "followers" | "newest" | "discipline";
type Scope = "all" | "following" | "mine";

export default function Strategies() {
  const { ready, strategies, user } = useStore();
  const [query, setQuery] = useState("");
  const [market, setMarket] = useState("all");
  const [sort, setSort] = useState<Sort>("rank");
  const [scope, setScope] = useState<Scope>("all");

  const marketChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const strategy of strategies) {
      const symbol = strategy.config?.market;
      if (symbol) counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [strategies]);

  const rankOf = useMemo(() => {
    const map = new Map<string, number>();
    strategies.filter((s) => s.score !== null).forEach((s, i) => map.set(s.id, i + 1));
    return map;
  }, [strategies]);

  const shown = useMemo(() => {
    const text = query.trim().toLowerCase();
    const list = strategies.filter((strategy) =>
      (scope === "all" || (scope === "following" ? strategy.following : strategy.owner_id === user?.id)) &&
      (market === "all" || strategy.config?.market === market) &&
      (!text || strategy.name.toLowerCase().includes(text) || strategy.description.toLowerCase().includes(text)));
    const by: Record<Sort, (a: typeof list[number], b: typeof list[number]) => number> = {
      rank: (a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity),
      followers: (a, b) => b.followers - a.followers,
      newest: (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      discipline: (a, b) => (b.compliancePct ?? -1) - (a.compliancePct ?? -1) || b.allowedCount - a.allowedCount,
    };
    return [...list].sort(by[sort]);
  }, [strategies, query, market, sort, scope, user]);

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Strategies</p>
          <h1>Find a strategy worth following</h1>
          <p className="muted-text">Every strategy below published its limits before placing a single trade.</p>
        </div>
        <Link href="/create" className="btn btn-primary"><Icon name="plus" size={18} /> Create a strategy</Link>
      </header>

      <div className="callout callout-info">
        <Icon name="info" size={20} />
        <p><b>How the ranking works.</b> Strategies are ranked by return on the money they said they’d risk, adjusted for how often they stayed inside their own limits. A strategy needs at least one trade to be ranked.</p>
      </div>

      <div className="toolbar">
        <label className="search">
          <Icon name="search" size={18} />
          <input type="search" placeholder="Search strategies" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search strategies" />
        </label>
        <div className="seg" role="group" aria-label="Show">
          {(["all", "following", "mine"] as const).map((option) => (
            <button key={option} className={scope === option ? "on" : ""} onClick={() => setScope(option)}>{option === "all" ? "All" : option === "following" ? "Following" : "Mine"}</button>
          ))}
        </div>
        <label className="select">
          <span className="sr-only">Sort by</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="rank">Top ranked</option>
            <option value="discipline">Most disciplined</option>
            <option value="followers">Most followed</option>
            <option value="newest">Newest</option>
          </select>
        </label>
      </div>

      {marketChips.length > 0 && (
        <div className="chips" role="group" aria-label="Filter by market">
          <button className={`chip ${market === "all" ? "on" : ""}`} onClick={() => setMarket("all")}>All markets</button>
          {marketChips.map(([symbol, count]) => (
            <button key={symbol} className={`chip ${market === symbol ? "on" : ""}`} onClick={() => setMarket(symbol)}>
              <TokenLogo symbol={symbol} size={18} /> {baseOf(symbol)} <small>{count}</small>
            </button>
          ))}
        </div>
      )}

      <div className="slist-head" aria-hidden="true">
        <span>#</span><span>Strategy</span><span />
        <span>Return <Hint>Profit or loss as a percentage of the money the strategy said it would risk.</Hint></span>
        <span>Stays within limits <Hint>The share of this strategy’s trades that were allowed. Stopped trades lower it.</Hint></span>
        <span>Largest position</span><span>Followers</span><span />
      </div>
      <div className="slist">
        {!ready ? [0, 1, 2, 3].map((i) => <Skeleton key={i} height={84} radius={14} />) : shown.length === 0 ? (
          <EmptyState title={strategies.length === 0 ? "No strategies yet" : "Nothing matches"} action={strategies.length === 0 ? <Link className="btn btn-primary" href="/create">Create the first strategy</Link> : <button className="btn btn-secondary" onClick={() => { setQuery(""); setMarket("all"); setScope("all"); }}>Clear filters</button>}>
            {strategies.length === 0 ? "Be the first to publish a strategy and its limits." : "Try a different search or clear the filters."}
          </EmptyState>
        ) : shown.map((strategy) => <StrategyRow key={strategy.id} strategy={strategy} rank={rankOf.get(strategy.id) ?? null} />)}
      </div>
    </>
  );
}
