"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { SIDE_HELP } from "../_lib/describe";
import { baseOf, money, price } from "../_lib/format";
import type { RealTradeDraft, TradeResult } from "../_lib/store";
import { useStore } from "../_lib/store";
import type { Strategy, TradeSide } from "../_lib/types";
import { Icon } from "./Icon";
import { MarketPicker } from "./MarketPicker";
import { TokenLogo } from "./TokenLogo";
import { Badge, ConfirmDialog, Hint, Meter } from "./ui";

export function TradeForm({ strategy }: { strategy: Strategy }) {
  const { markets, portfolio, placeTrade, strikeAccount, prepareRealTrade, sendRealOrder, notify, mode } = useStore();
  const fixed = strategy.config?.market;
  const [market, setMarket] = useState(fixed ?? "");
  const [side, setSide] = useState<TradeSide>("long");
  const [size, setSize] = useState("");
  const [note, setNote] = useState("");
  const real = mode === "real";
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TradeResult | null>(null);
  const [draft, setDraft] = useState<RealTradeDraft | null>(null);

  const quote = markets.find((item) => item.symbol === market);
  const mine = portfolio?.positions.filter((position) => position.strategy_id === strategy.id) ?? [];
  const inMarket = mine.filter((position) => position.market === market).reduce((sum, position) => sum + position.notionalUsd, 0);
  const inTotal = mine.reduce((sum, position) => sum + position.notionalUsd, 0);
  const room = useMemo(() => {
    const limits = strategy.limits;
    const cash = real ? Number(strikeAccount?.available_balance ?? 0) : (portfolio?.availableUsd ?? 0);
    return Math.max(0, Math.min(limits.maxPositionNotionalUsd - inMarket, limits.maxTotalExposureUsd - inTotal, cash));
  }, [strategy.limits, inMarket, inTotal, portfolio, real, strikeAccount]);
  const amount = Number(size);
  const estimate = quote && amount > 0 ? amount / quote.markPrice : null;
  const tooSmall = quote && amount > 0 && amount < quote.minNotionalUsd;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const input = { market, side, notionalUsd: amount, reason: note.trim() };
      if (real) {
        const prepared = await prepareRealTrade(strategy.id, input);
        setResult({ ...prepared.decision, price: prepared.price });
        if (prepared.decision.allowed) setDraft(prepared);
      } else {
        const outcome = await placeTrade(strategy.id, input);
        setResult(outcome);
        if (outcome.allowed) { notify("Practice trade placed.", "good"); setSize(""); setNote(""); }
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not place that trade.", "bad");
    } finally { setBusy(false); }
  }

  async function confirmReal() {
    if (!draft) return;
    setBusy(true);
    try {
      await sendRealOrder(draft);
      notify("Your real order was placed on Strike.", "good");
      setSize(""); setNote("");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Strike did not accept the order.", "bad");
    } finally { setBusy(false); setDraft(null); }
  }

  return (
    <form className="card card-pad tradeform" onSubmit={submit}>
      <div className="card-head">
        <h2>Place a trade</h2>
        <Badge tone={real ? "warn" : "brand"}>{real ? "Real money" : "Practice"}</Badge>
      </div>
      <p className="muted-text">
        {real
          ? "Your Strike account is checked first. If the trade stays within the limits, you’ll confirm before anything is sent. Use the switch at the top to go back to Practice."
          : "This uses practice money at live Strike prices. Followers get the same trade in their own practice accounts. To trade for real, connect Strike under My account and switch to Real."}
      </p>

      {fixed ? (
        <div className="field">
          <span className="field-label">Market</span>
          <div className="fixed-market">
            <TokenLogo symbol={fixed} size={32} />
            <span><b>{baseOf(fixed)}</b><small>{quote ? quote.name.replace(/ \/ USD$/, "") : "This strategy only trades this market"}</small></span>
            {quote && <span className="picker-price">{price(quote.markPrice)}</span>}
          </div>
        </div>
      ) : (
        <MarketPicker markets={markets} value={market} onChange={setMarket} />
      )}

      <div className="field">
        <span className="field-label">Direction</span>
        <div className="seg seg-fill" role="radiogroup" aria-label="Direction">
          {(["long", "short"] as const).map((option) => (
            <button key={option} type="button" role="radio" aria-checked={side === option} className={side === option ? `on seg-${option}` : ""} onClick={() => setSide(option)}>
              <Icon name={option === "long" ? "up" : "down"} size={16} /> {option === "long" ? "Long" : "Short"}
            </button>
          ))}
        </div>
        <small className="field-hint">{SIDE_HELP[side]}</small>
      </div>

      <label className="field">
        <span className="field-label">Trade size</span>
        <span className="input-affix"><i>$</i><input required type="number" inputMode="decimal" min={quote?.minNotionalUsd ?? 1} step="any" value={size} onChange={(e) => setSize(e.target.value)} placeholder="0" /></span>
        <span className="quick">
          {[25, 50, 100].map((part) => (
            <button type="button" key={part} disabled={room <= 0} onClick={() => setSize(String(Math.floor((room * part) / 100 * 100) / 100))}>{part === 100 ? "Max" : `${part}%`}</button>
          ))}
        </span>
        <small className="field-hint">
          You can place up to <b>{money(room)}</b> right now.
          {quote && <> Smallest trade: {money(quote.minNotionalUsd)}.</>}
          {estimate !== null && quote && <> That’s about {estimate.toLocaleString("en-US", { maximumSignificantDigits: 4 })} {baseOf(quote.symbol)}.</>}
        </small>
        {tooSmall && quote && <small className="field-error">Strike’s smallest trade for {baseOf(quote.symbol)} is {money(quote.minNotionalUsd)}.</small>}
      </label>

      <label className="field">
        <span className="field-label">Why this trade? <Hint>Everyone can read this note next to the decision.</Hint></span>
        <input required maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: price broke above its recent high" />
      </label>

      <button className={`btn btn-lg btn-block ${real ? "btn-warn" : "btn-primary"}`} disabled={busy || strategy.paused || !market || !!tooSmall}>
        {strategy.paused ? "Strategy is paused" : busy ? "Checking…" : real ? "Check and place real trade" : "Place practice trade"}
        {!busy && !strategy.paused && <Icon name="arrow" size={18} />}
      </button>

      {result && (
        <div className={`outcome ${result.allowed ? "outcome-good" : "outcome-bad"}`} role="status">
          <b>{result.allowed ? (real ? "Within your limits" : "Trade placed") : "Stopped by the limits"} · at {price(result.price)}</b>
          {!result.allowed && <ul>{result.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
          <Meter label="Position in this market" value={result.after.positionNotionalUsd} limit={strategy.limits.maxPositionNotionalUsd} format={(n) => money(n)} />
          <Meter label="Total in the market" value={result.after.totalExposureUsd} limit={strategy.limits.maxTotalExposureUsd} format={(n) => money(n)} />
        </div>
      )}

      {draft && (
        <ConfirmDialog title="Place this real order?" confirmLabel="Place real order" danger busy={busy} onConfirm={confirmReal} onCancel={() => setDraft(null)}>
          <p>You are about to send a <b>{draft.input.side}</b> market order for <b>{money(draft.input.notionalUsd)}</b> of {baseOf(draft.input.market)} to your Strike account at about {price(draft.price)}.</p>
          <p><b>This uses real money.</b> Once it’s sent it can’t be undone from here.</p>
        </ConfirmDialog>
      )}
    </form>
  );
}
