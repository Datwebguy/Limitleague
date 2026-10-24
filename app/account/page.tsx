"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";
import { Icon } from "../_components/Icon";
import { TokenLogo } from "../_components/TokenLogo";
import { Badge, ConfirmDialog, EmptyState, Hint, Skeleton, Stat } from "../_components/ui";
import { SIDE_HELP } from "../_lib/describe";
import { baseOf, fullDate, money, price, signedMoney, tone } from "../_lib/format";
import { useStore } from "../_lib/store";
import type { Position } from "../_lib/types";

export default function Account() {
  const { ready, portfolio, followed, mine, closeTrade, unfollow, notify, mode, strikeAccount, strikePositions } = useStore();
  const [closing, setClosing] = useState<Position | null>(null);
  const [busy, setBusy] = useState(false);

  if (!ready || !portfolio) return <div className="stack"><Skeleton height={40} width="40%" /><Skeleton height={110} radius={16} /><Skeleton height={220} radius={16} /></div>;

  const profit = portfolio.equityUsd - portfolio.startingBalanceUsd;

  async function confirmClose() {
    if (!closing) return;
    setBusy(true);
    try {
      const result = await closeTrade(closing);
      notify(`Closed your ${baseOf(closing.market)} trade at ${price(result.price)}. Result: ${signedMoney(result.realizedPnlUsd)}.`, result.realizedPnlUsd >= 0 ? "good" : "info");
      setClosing(null);
    } catch (error) { notify(error instanceof Error ? error.message : "Could not close that trade.", "bad"); }
    finally { setBusy(false); }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">My account</p>
          <h1>Your practice account</h1>
          <p className="muted-text">Started with {money(portfolio.startingBalanceUsd)} of practice money. It has no cash value and can’t be withdrawn, but every price is live.</p>
        </div>
        <Badge tone="brand"><Icon name="flask" size={14} /> Practice mode</Badge>
      </header>

      {mode === "real" && strikeAccount && (
        <section className="block real-summary" aria-labelledby="realacc">
          <div className="block-head row"><h2 id="realacc">Your Strike account <Badge tone="warn">Real money</Badge></h2></div>
          <div className="stats">
            <Stat label="Available to trade" value={money(Number(strikeAccount.available_balance), 2)} note="in your Strike account" />
            <Stat label="Account balance" value={money(Number(strikeAccount.wallet_balance), 2)} note="before open trades" />
            <Stat label="Open profit or loss" tone={tone(Number(strikeAccount.unrealized_pnl))} value={signedMoney(Number(strikeAccount.unrealized_pnl))} note="across your real positions" />
            <Stat label="Open real positions" value={String(strikePositions.length)} note="manage or close them on Strike" />
          </div>
          {strikePositions.length > 0 && (
            <ul className="card plain-list pad">
              {strikePositions.map((position) => {
                const size = Number(position.size);
                return (
                  <li key={position.symbol}>
                    <TokenLogo symbol={position.symbol} size={32} />
                    <span className="grow"><b>{baseOf(position.symbol)}</b> <Badge tone={size > 0 ? "good" : "bad"}>{size > 0 ? "Long" : "Short"}</Badge><small className="block-note">Entered at {price(Number(position.entry_price))}</small></span>
                    <b className={`num tone-${tone(Number(position.upnl))}`}>{signedMoney(Number(position.upnl))}</b>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="fineprint">Below is your separate practice account, which real trades never touch.</p>
        </section>
      )}

      <section className="stats" aria-label="Balances">
        <Stat label="Total value" value={money(portfolio.equityUsd, 2)} note="cash plus open-trade results" />
        <Stat label="Available to trade" value={money(portfolio.availableUsd, 2)} note="not tied up in open trades" hint="Practice trades use your own money one-for-one, with no borrowing." />
        <Stat label="In open trades" value={money(portfolio.exposureUsd, 2)} note="at current prices" />
        <Stat label="Profit or loss" tone={tone(profit)} value={signedMoney(profit)} note={`since you started with ${money(portfolio.startingBalanceUsd)}`} />
      </section>

      <section className="block" aria-labelledby="open">
        <div className="block-head"><h2 id="open">Open trades</h2></div>
        {portfolio.positions.length === 0 ? (
          <EmptyState title="No open trades" action={<Link className="btn btn-primary" href="/strategies">Find a strategy</Link>}>Follow a strategy, or create your own and place a trade.</EmptyState>
        ) : (
          <div className="stack">
            {portfolio.positions.map((position) => (
              <article className="trade card" key={`${position.strategy_id}-${position.market}-${position.side}`}>
                <div className="trade-id">
                  <TokenLogo symbol={position.market} size={40} />
                  <div>
                    <b>{baseOf(position.market)} <Badge tone={position.side === "long" ? "good" : "bad"}>{position.side === "long" ? "Long" : "Short"}</Badge> <Hint>{SIDE_HELP[position.side]}</Hint></b>
                    <Link href={`/strategies/${position.strategy_id}`}>{position.strategy_name}</Link>
                  </div>
                </div>
                <div className="trade-cell"><small>Entered at</small><b className="num">{price(position.entry_price)}</b></div>
                <div className="trade-cell"><small>Now</small><b className="num">{price(position.markPrice)}</b></div>
                <div className="trade-cell"><small>Size</small><b className="num">{money(position.notionalUsd, 2)}</b></div>
                <div className="trade-cell"><small>Profit or loss</small><b className={`num tone-${tone(position.unrealizedPnlUsd)}`}>{signedMoney(position.unrealizedPnlUsd)}</b></div>
                <div className="trade-cell trade-exits">
                  {position.take_profit_price || position.stop_loss_price ? (
                    <small>{position.take_profit_price ? <>Take profit at {price(position.take_profit_price)}</> : null}{position.take_profit_price && position.stop_loss_price ? " · " : ""}{position.stop_loss_price ? <>Stop loss at {price(position.stop_loss_price)}</> : null}</small>
                  ) : <small>No automatic exits</small>}
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => setClosing(position)}>Close trade</button>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="split-even">
        <section className="card card-pad" aria-labelledby="following">
          <h2 id="following">Strategies you follow</h2>
          {followed.length === 0 ? <p className="muted-text">You’re not following anyone yet. <Link href="/strategies">Browse strategies</Link></p> : (
            <ul className="plain-list">
              {followed.map((strategy) => (
                <li key={strategy.id}>
                  {strategy.config?.market && <TokenLogo symbol={strategy.config.market} size={32} />}
                  <Link href={`/strategies/${strategy.id}`}>{strategy.name}</Link>
                  <button className="btn btn-ghost btn-sm" onClick={async () => { try { await unfollow(strategy.id); notify(`You stopped following ${strategy.name}.`); } catch (e) { notify(e instanceof Error ? e.message : "Could not unfollow.", "bad"); } }}>Unfollow</button>
                </li>
              ))}
            </ul>
          )}
          <h3 className="mt">Strategies you created</h3>
          {mine.length === 0 ? <p className="muted-text">You haven’t created one yet. <Link href="/create">Create a strategy</Link></p> : (
            <ul className="plain-list">
              {mine.map((strategy) => (
                <li key={strategy.id}>
                  {strategy.config?.market && <TokenLogo symbol={strategy.config.market} size={32} />}
                  <Link href={`/strategies/${strategy.id}`}>{strategy.name}</Link>
                  {strategy.paused && <Badge tone="warn">Paused</Badge>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card card-pad" aria-labelledby="history">
          <h2 id="history">History</h2>
          <ul className="ledger">
            {portfolio.ledger.map((entry) => (
              <li key={entry.id}>
                <span><b>{entry.description}</b><small>{fullDate(entry.created_at)}</small></span>
                <span><b className={`num tone-${tone(entry.amount)}`}>{signedMoney(entry.amount)}</b><small>Balance {money(entry.balance_after, 2)}</small></span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <RealTrading />

      {closing && (
        <ConfirmDialog title="Close this trade?" confirmLabel="Close trade" busy={busy} onConfirm={confirmClose} onCancel={() => setClosing(null)}>
          <p>Your {closing.side} {baseOf(closing.market)} trade will be closed at the current price of <b>{price(closing.markPrice)}</b>.</p>
          <p>That locks in a {closing.unrealizedPnlUsd >= 0 ? "profit" : "loss"} of about <b className={`tone-${tone(closing.unrealizedPnlUsd)}`}>{signedMoney(closing.unrealizedPnlUsd)}</b> in your practice account.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

function RealTrading() {
  const { strikeAccount, connectStrike, disconnectStrike, notify } = useStore();
  const [pub, setPub] = useState("");
  const [priv, setPriv] = useState("");
  const [busy, setBusy] = useState(false);

  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await connectStrike(pub, priv);
      setPub(""); setPriv("");
      notify("Your Strike account is connected for this visit.", "good");
    } catch (error) { notify(error instanceof Error ? error.message : "Could not connect.", "bad"); }
    finally { setBusy(false); }
  }

  return (
    <details id="real" className="card card-pad real" open={!!strikeAccount || (typeof window !== "undefined" && window.location.hash === "#real")}>
      <summary>
        <span><b>Real trading</b> <Badge tone="muted">Optional</Badge></span>
        <small>Connect your own Strike account to place real orders on strategies you created.</small>
        <Icon name="chevron" size={18} />
      </summary>
      {strikeAccount ? (
        <div className="real-body">
          <div className="callout callout-good"><Icon name="check" size={18} /><p><b>Connected.</b> Available in your Strike account: <b>{money(Number(strikeAccount.available_balance), 2)}</b>. When you place a trade on one of your strategies you can now choose “Real money”.</p></div>
          <button className="btn btn-secondary" onClick={() => { disconnectStrike(); notify("Disconnected from Strike."); }}>Disconnect</button>
        </div>
      ) : (
        <form className="real-body" onSubmit={connect}>
          <p className="muted-text">Practice mode needs none of this. If you’d like to trade real money, create a <b>trading key</b> in Strike. It can place and cancel orders but <b>can never withdraw your funds</b>.</p>
          <a className="btn btn-ghost btn-sm" href="https://app.strikefinance.org/api-keys" target="_blank" rel="noreferrer">Create a trading key on Strike <Icon name="external" size={15} /></a>
          <div className="grid-2">
            <label className="field"><span className="field-label">Public key</span><input required autoComplete="off" spellCheck={false} value={pub} onChange={(e) => setPub(e.target.value)} placeholder="Paste the public key" /></label>
            <label className="field"><span className="field-label">Private key</span><input required type="password" autoComplete="off" spellCheck={false} value={priv} onChange={(e) => setPriv(e.target.value)} placeholder="Paste the private key" /></label>
          </div>
          <div className="callout callout-info"><Icon name="lock" size={18} /><p><b>Your private key stays on your device.</b> It’s used only in this browser tab to sign orders, it’s never sent to LimitLeague or stored, and it’s forgotten when you close or refresh the page.</p></div>
          <button className="btn btn-primary" disabled={busy}>{busy ? "Connecting…" : "Connect Strike account"}</button>
        </form>
      )}
    </details>
  );
}
