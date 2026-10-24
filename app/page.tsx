"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ActivityRow } from "./_components/ActivityRow";
import { Faq } from "./_components/Faq";
import { Icon } from "./_components/Icon";
import { StrategyRow, ComplianceBar } from "./_components/StrategyRow";
import { TokenLogo } from "./_components/TokenLogo";
import { Badge, EmptyState, Skeleton, Stat } from "./_components/ui";
import { assetKind } from "./_lib/assets";
import { baseOf, money, price, signedPercent, tone } from "./_lib/format";
import { useStore } from "./_lib/store";

export default function Home() {
  const { ready, strategies, activity, markets, portfolio, mine, followed } = useStore();

  const ranked = useMemo(() => strategies.filter((strategy) => strategy.score !== null), [strategies]);
  const top = ranked.slice(0, 5);
  const featured = ranked[0] ?? strategies[0];
  const totals = useMemo(() => ({
    checked: strategies.reduce((sum, s) => sum + s.allowedCount + s.blockedCount, 0),
    stopped: strategies.reduce((sum, s) => sum + s.blockedCount, 0),
    followers: strategies.reduce((sum, s) => sum + s.followers, 0),
  }), [strategies]);
  const ticker = useMemo(() => [...markets].sort((a, b) => Number(assetKind(a.symbol) !== "token") - Number(assetKind(b.symbol) !== "token")).slice(0, 10), [markets]);

  const steps = [
    { done: followed.length > 0, title: "Follow a strategy", text: "Pick one you like and its trades copy into your practice account.", href: "/strategies", cta: "Browse strategies" },
    { done: mine.length > 0, title: "Create your own", text: "Choose a market and set your limits. It takes about two minutes.", href: "/create", cta: "Create a strategy" },
    { done: mine.some((s) => s.allowedCount > 0) || (portfolio?.positions.length ?? 0) > 0, title: "Place a practice trade", text: "See a trade pass, or get stopped, by the limits.", href: mine[0] ? `/strategies/${mine[0].id}` : "/create", cta: mine[0] ? "Place a trade" : "Create first" },
  ];
  const doneCount = steps.filter((step) => step.done).length;

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <Badge tone="brand"><Icon name="flask" size={14} /> Practice mode · no sign-up, no wallet</Badge>
          <h1>Follow strategies that play by their <em>own rules</em>.</h1>
          <p className="lead">
            Every strategy on LimitLeague publishes its risk limits first. Every trade is checked against them, and every decision, placed or stopped, is public.
            Try it with {portfolio ? money(portfolio.startingBalanceUsd) : "free"} of practice money at live Strike prices.
          </p>
          <div className="hero-actions">
            <Link className="btn btn-primary btn-lg" href="/strategies">Browse strategies <Icon name="arrow" size={18} /></Link>
            <Link className="btn btn-secondary btn-lg" href="/create">Create your own</Link>
            <Link className="btn btn-ghost btn-lg" href="/demo"><Icon name="flask" size={18} /> Try a scenario</Link>
          </div>
          <ul className="hero-points">
            <li><Icon name="check" size={16} /> Opens instantly</li>
            <li><Icon name="check" size={16} /> Live Strike prices</li>
            <li><Icon name="check" size={16} /> Limits can never be loosened</li>
          </ul>
        </div>

        <div className="hero-card card" aria-live="polite">
          {!ready ? (
            <div className="stack"><Skeleton height={44} width={44} radius={22} /><Skeleton height={22} width="60%" /><Skeleton height={60} /></div>
          ) : featured ? (
            <>
              <p className="eyebrow">{featured.score !== null ? "Top of the leaderboard right now" : "Newest strategy"}</p>
              <div className="hero-card-head">
                {featured.config?.market ? <TokenLogo symbol={featured.config.market} size={48} /> : null}
                <div>
                  <Link href={`/strategies/${featured.id}`} className="hero-card-name">{featured.name}</Link>
                  <small>{featured.config?.market ? baseOf(featured.config.market) : "Any market"} · {featured.followers} {featured.followers === 1 ? "follower" : "followers"}</small>
                </div>
              </div>
              <div className="hero-card-stats">
                <div><small>Return</small><b className={`num tone-${tone(featured.returnPct)}`}>{signedPercent(featured.returnPct)}</b></div>
                <div><small>Stays within limits</small><ComplianceBar value={featured.compliancePct} /></div>
              </div>
              <dl className="hero-card-limits">
                <div><dt>Largest position</dt><dd>{money(featured.limits.maxPositionNotionalUsd)}</dd></div>
                <div><dt>Daily loss limit</dt><dd>{money(featured.limits.dailyLossLimitUsd)}</dd></div>
                <div><dt>Most in the market</dt><dd>{money(featured.limits.maxTotalExposureUsd)}</dd></div>
              </dl>
              <Link href={`/strategies/${featured.id}`} className="btn btn-secondary btn-block">See its limits and record</Link>
            </>
          ) : (
            <div className="hero-card-empty">
              <h3>Be the first on the board</h3>
              <p>No strategies have been published yet. Create one and it will appear here for everyone to follow.</p>
              <Link href="/create" className="btn btn-primary">Create a strategy</Link>
            </div>
          )}
        </div>
      </section>

      {ticker.length > 0 && (
        <section className="ticker" aria-label="Live Strike prices">
          {ticker.map((market) => (
            <Link key={market.symbol} href="/strategies" className="ticker-item" tabIndex={-1}>
              <TokenLogo symbol={market.symbol} size={24} />
              <span><b>{baseOf(market.symbol)}</b><small>{price(market.markPrice)}</small></span>
            </Link>
          ))}
        </section>
      )}

      <section className="stats" aria-label="LimitLeague so far">
        <Stat label="Strategies" value={ready ? strategies.length.toLocaleString("en-US") : "—"} note="published with public limits" />
        <Stat label="Trades checked" value={ready ? totals.checked.toLocaleString("en-US") : "—"} note="each one tested against the limits" />
        <Stat label="Stopped by limits" value={ready ? totals.stopped.toLocaleString("en-US") : "—"} note="trades that would have broken a rule" />
        <Stat label="Followers" value={ready ? totals.followers.toLocaleString("en-US") : "—"} note="copying in practice accounts" />
      </section>

      {ready && doneCount < steps.length && (
        <section className="card card-pad getstarted" aria-labelledby="gs">
          <div className="getstarted-head">
            <h2 id="gs">Get started</h2>
            <span className="muted-text">{doneCount} of {steps.length} done</span>
          </div>
          <div className="getstarted-steps">
            {steps.map((step, index) => (
              <div key={step.title} className={`gstep ${step.done ? "done" : ""}`}>
                <span className="gstep-mark">{step.done ? <Icon name="check" size={16} /> : index + 1}</span>
                <div><b>{step.title}</b><p>{step.text}</p></div>
                {!step.done && <Link href={step.href} className="btn btn-secondary btn-sm">{step.cta}</Link>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section id="how-it-works" className="block">
        <div className="block-head">
          <p className="eyebrow">How it works</p>
          <h2>Rules first, results second</h2>
          <p className="muted-text">Most leaderboards only show who made the most. LimitLeague also shows how carefully they got there.</p>
        </div>
        <ol className="steps">
          <li><span>1</span><h3>Set the rules first</h3><p>A strategy picks a market and publishes its limits: how big a position can be and how much it can lose in a day.</p></li>
          <li><span>2</span><h3>Trade with practice money</h3><p>Trades happen at live Strike prices, so results are realistic, but nothing real is ever at risk.</p></li>
          <li><span>3</span><h3>Every trade is checked</h3><p>If a trade would break a limit, it’s stopped. The reason is saved for everyone to read.</p></li>
          <li><span>4</span><h3>Follow with the same protection</h3><p>Followers copy each trade into their own practice account, with the same limits keeping them safe.</p></li>
        </ol>
      </section>

      <section className="block">
        <div className="block-head row">
          <div><p className="eyebrow">Leaderboard</p><h2>Top strategies</h2></div>
          <Link href="/strategies" className="btn btn-ghost">See all <Icon name="arrow" size={16} /></Link>
        </div>
        {!ready ? (
          <div className="stack">{[0, 1, 2].map((i) => <Skeleton key={i} height={76} radius={14} />)}</div>
        ) : top.length === 0 ? (
          <EmptyState title="No ranked strategies yet" action={<Link className="btn btn-primary" href="/create">Create the first one</Link>}>
            A strategy is ranked once it has placed a trade. Publish yours and be the first.
          </EmptyState>
        ) : (
          <div className="slist">{top.map((strategy, index) => <StrategyRow key={strategy.id} strategy={strategy} rank={index + 1} />)}</div>
        )}
      </section>

      <section className="block">
        <div className="block-head row">
          <div><p className="eyebrow">Public activity</p><h2>What just happened</h2></div>
          <Link href="/activity" className="btn btn-ghost">All activity <Icon name="arrow" size={16} /></Link>
        </div>
        <div className="card alist">
          {!ready ? <div className="stack pad"><Skeleton height={48} /><Skeleton height={48} /></div> : activity.length === 0 ? (
            <EmptyState title="Nothing yet">Decisions appear here the moment a strategy places or is stopped from placing a trade.</EmptyState>
          ) : activity.slice(0, 6).map((item) => <ActivityRow key={item.id} item={item} />)}
        </div>
      </section>

      <section id="questions" className="block">
        <div className="block-head"><p className="eyebrow">Questions</p><h2>Good to know</h2></div>
        <Faq />
      </section>

      <section className="cta card">
        <h2>Ready to try it?</h2>
        <p>Your practice account is already waiting. No sign-up, no wallet, nothing to lose.</p>
        <div className="hero-actions">
          <Link className="btn btn-primary btn-lg" href="/create">Create a strategy</Link>
          <Link className="btn btn-secondary btn-lg" href="/strategies">Browse strategies</Link>
        </div>
      </section>
    </>
  );
}
