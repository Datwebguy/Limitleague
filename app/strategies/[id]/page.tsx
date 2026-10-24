"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { ActivityRow } from "../../_components/ActivityRow";
import { Icon } from "../../_components/Icon";
import { ManagePanel } from "../../_components/ManagePanel";
import { ComplianceBar } from "../../_components/StrategyRow";
import { TokenLogo } from "../../_components/TokenLogo";
import { TradeForm } from "../../_components/TradeForm";
import { Badge, EmptyState, Hint, Skeleton, Stat } from "../../_components/ui";
import { LIMIT_INFO, STYLE_INFO } from "../../_lib/describe";
import { baseOf, money, percent, plural, signedPercent, tone } from "../../_lib/format";
import { useStore } from "../../_lib/store";
import type { ActivityItem } from "../../_lib/types";

export default function StrategyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { ready, strategies, user, follow, unfollow, notify } = useStore();
  const strategy = strategies.find((item) => item.id === id);
  const [recent, setRecent] = useState<ActivityItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const decisions = strategy?.audit_count ?? 0;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/audit?strategyId=${id}&limit=8`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { audit: [] }))
      .then((data) => !cancelled && setRecent(data.audit))
      .catch(() => !cancelled && setRecent([]));
    return () => { cancelled = true; };
  }, [id, decisions]);

  if (!ready) return <div className="stack"><Skeleton height={32} width="40%" /><Skeleton height={120} radius={16} /><Skeleton height={220} radius={16} /></div>;
  if (!strategy)
    return (
      <EmptyState title="We couldn’t find that strategy" action={<Link className="btn btn-primary" href="/strategies">Back to strategies</Link>}>
        It may have been removed, or the link may be incomplete.
      </EmptyState>
    );

  const own = user?.id === strategy.owner_id;
  const market = strategy.config?.market;
  const style = strategy.config?.style ? STYLE_INFO[strategy.config.style] : null;

  async function toggleFollow() {
    if (!strategy) return;
    setBusy(true);
    try {
      if (strategy.following) { await unfollow(strategy.id); notify(`You stopped following ${strategy.name}. Trades you already hold stay open until you close them.`); }
      else { await follow(strategy.id); notify(`You’re following ${strategy.name}. Its next trades will copy into your practice account.`, "good"); }
    } catch (error) { notify(error instanceof Error ? error.message : "Could not update that.", "bad"); }
    finally { setBusy(false); }
  }

  return (
    <>
      <Link href="/strategies" className="backlink"><Icon name="back" size={16} /> All strategies</Link>

      <header className="sheader card card-pad">
        <div className="sheader-id">
          {market ? <TokenLogo symbol={market} size={64} /> : null}
          <div>
            <div className="badges">
              {own && <Badge tone="brand">Your strategy</Badge>}
              {strategy.paused && <Badge tone="warn">Paused</Badge>}
              {market && <Badge>{baseOf(market)}</Badge>}
            </div>
            <h1>{strategy.name}</h1>
            <p className="muted-text">{strategy.description || "No description yet."}</p>
          </div>
        </div>
        <div className="sheader-actions">
          {own ? (
            <a href="#manage" className="btn btn-secondary">Manage</a>
          ) : (
            <button className={`btn btn-lg ${strategy.following ? "btn-secondary" : "btn-primary"}`} onClick={toggleFollow} disabled={busy}>
              {busy ? "…" : strategy.following ? "Following · unfollow" : "Follow in practice"}
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => { void navigator.clipboard?.writeText(window.location.href); notify("Link copied.", "good"); }}><Icon name="copy" size={16} /> Share</button>
        </div>
      </header>

      <section className="stats" aria-label="Results">
        <Stat label="Return" tone={tone(strategy.returnPct)} value={signedPercent(strategy.returnPct)} note={strategy.returnPct === null ? "No results yet" : "on the money it said it would risk"} hint="Profit or loss as a percentage of the strategy’s ‘most in the market’ limit." />
        <Stat label="Stays within limits" value={<ComplianceBar value={strategy.compliancePct} />} note={strategy.blockedCount ? `${plural(strategy.blockedCount, "trade")} stopped` : "Nothing stopped so far"} hint="Share of this strategy’s trades that were allowed. Stopped trades lower it." />
        <Stat label="Trades checked" value={(strategy.allowedCount + strategy.blockedCount).toLocaleString("en-US")} note={`${strategy.allowedCount} placed · ${strategy.blockedCount} stopped`} />
        <Stat label="Followers" value={strategy.followers.toLocaleString("en-US")} note="copying in practice" />
      </section>

      <div className="split">
        <div className="stack-lg">
          <section className="card card-pad" aria-labelledby="limits">
            <div className="card-head"><h2 id="limits">Risk limits <Hint>These were published before any trading and can only ever be made stricter.</Hint></h2><Badge tone="good"><Icon name="lock" size={13} /> Can’t be loosened</Badge></div>
            <div className="limits-grid">
              {(Object.keys(LIMIT_INFO) as Array<keyof typeof LIMIT_INFO>).map((key) => (
                <div key={key} className="limit">
                  <span>{LIMIT_INFO[key].name}</span>
                  <b>{key === "maxOpenPositions" ? strategy.limits[key] : money(strategy.limits[key])}</b>
                  <small>{LIMIT_INFO[key].help}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="card card-pad" aria-labelledby="approach">
            <h2 id="approach">How it trades</h2>
            <dl className="facts facts-wide">
              <div><dt>Market</dt><dd>{market ? <><TokenLogo symbol={market} size={22} /> {baseOf(market)}</> : "Any market"}</dd></div>
              <div><dt>Style</dt><dd>{style?.name ?? "—"}</dd></div>
              <div><dt>Take profit <Hint>Closes the trade automatically once it’s up by this much.</Hint></dt><dd>{strategy.config?.takeProfitPct ? percent(strategy.config.takeProfitPct) : "Not set"}</dd></div>
              <div><dt>Stop loss <Hint>Closes the trade automatically once it’s down by this much.</Hint></dt><dd>{strategy.config?.stopLossPct ? percent(strategy.config.stopLossPct) : "Not set"}</dd></div>
            </dl>
            {style && <p className="muted-text">{style.blurb}</p>}
          </section>

          <section className="card" aria-labelledby="recent">
            <div className="card-head pad"><h2 id="recent">Recent decisions</h2><Link href="/activity" className="btn btn-ghost btn-sm">All activity</Link></div>
            <div className="alist">
              {recent === null ? <div className="stack pad"><Skeleton height={44} /><Skeleton height={44} /></div> : recent.length === 0 ? (
                <EmptyState title="No decisions yet">{own ? "Place a trade to start this strategy’s public record." : "This strategy hasn’t placed a trade yet."}</EmptyState>
              ) : recent.map((item) => <ActivityRow key={item.id} item={item} showStrategy={false} />)}
            </div>
          </section>
        </div>

        <aside className="stack-lg side">
          {own ? (
            <>
              <TradeForm strategy={strategy} />
              <div id="manage"><ManagePanel strategy={strategy} /></div>
            </>
          ) : (
            <section className="card card-pad follow-box">
              <h2>{strategy.following ? "You’re following this strategy" : "Follow in your practice account"}</h2>
              <p className="muted-text">
                {strategy.following
                  ? "Each trade the owner places is tried in your practice account too, using your own cash and the limits above."
                  : "When the owner places a trade, the same trade is tried in your practice account, using your own cash. The limits above protect you too."}
              </p>
              <button className={`btn btn-lg btn-block ${strategy.following ? "btn-secondary" : "btn-primary"}`} onClick={toggleFollow} disabled={busy}>{busy ? "…" : strategy.following ? "Unfollow" : "Follow in practice"}</button>
              <p className="fineprint">Only the owner can place trades for a strategy. You can unfollow at any time.</p>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
