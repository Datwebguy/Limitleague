"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "../_components/Icon";
import { MarketPicker } from "../_components/MarketPicker";
import { Badge, Hint } from "../_components/ui";
import { assetKind } from "../_lib/assets";
import { STYLE_INFO } from "../_lib/describe";
import { money, price, signedMoney, signedPercent, tone } from "../_lib/format";
import { SCENARIOS, SCENARIO_HOURS, WARMUP_HOURS, buildScenario } from "../_lib/scenarios";
import type { ScenarioId } from "../_lib/scenarios";
import { useStore } from "../_lib/store";
import type { StrategyStyle } from "../_lib/types";
import { runBacktest } from "@/lib/backtest";

const LEVELS = [
  { id: "cautious", name: "Cautious", position: 0.05, exposure: 0.15, daily: 0.01, open: 2 },
  { id: "balanced", name: "Balanced", position: 0.1, exposure: 0.3, daily: 0.03, open: 3 },
  { id: "bold", name: "Bold", position: 0.2, exposure: 0.6, daily: 0.06, open: 5 },
] as const;
const START = 10_000;
const NO_LIMITS = 1e12;
/** How much of the account a trader who ignores limits puts into each trade. */
const INTENDED_SHARE = 0.4;

export default function Demo() {
  const { markets } = useStore();
  const [picked, setPicked] = useState("");
  const [scenario, setScenario] = useState<ScenarioId>("whipsaw");
  const [style, setStyle] = useState<StrategyStyle>("momentum");
  const [level, setLevel] = useState<(typeof LEVELS)[number]["id"]>("cautious");

  const market = markets.find((item) => item.symbol === picked) ?? markets.find((item) => assetKind(item.symbol) === "token") ?? markets[0];
  const choice = LEVELS.find((item) => item.id === level)!;
  const limits = { maxPositionNotionalUsd: START * choice.position, dailyLossLimitUsd: START * choice.daily, maxTotalExposureUsd: START * choice.exposure, maxOpenPositions: choice.open, pauseAtDailyLoss: true as const };

  const run = useMemo(() => {
    if (!market) return null;
    const candles = buildScenario(scenario, market.markPrice);
    const config = { market: market.symbol, style, takeProfitPct: null, stopLossPct: null };
    // The same trader and the same market. Without limits they trade big and never pause; with limits each
    // trade is held to the largest allowed position and trading pauses after the daily loss limit.
    const size = START * INTENDED_SHARE;
    const cappedSize = Math.min(size, limits.maxPositionNotionalUsd);
    const withLimits = runBacktest(candles, { config, limits, notionalUsd: cappedSize });
    const without = runBacktest(candles, { config, limits: { ...limits, maxPositionNotionalUsd: NO_LIMITS, dailyLossLimitUsd: NO_LIMITS, maxTotalExposureUsd: NO_LIMITS }, notionalUsd: size });
    return { candles, withLimits, without, size };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market?.symbol, market?.markPrice, scenario, style, level]);

  const saved = run ? run.withLimits.endingEquityUsd - run.without.endingEquityUsd : 0;
  const calmer = !!run && run.without.maxDrawdownPct - run.withLimits.maxDrawdownPct >= 0.3;

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Try a scenario</p>
          <h1>See limits do their job</h1>
          <p className="muted-text">Pick something that could happen to the market and see how the same trading fares with and without risk limits. It’s a made-up price path that starts from today’s real price, so nothing is saved and nothing is at risk.</p>
        </div>
        <Badge tone="brand"><Icon name="flask" size={14} /> Simulation</Badge>
      </header>

      <div className="demo">
        <div className="card card-pad stack-lg demo-controls">
          <MarketPicker markets={markets} value={market?.symbol ?? ""} onChange={setPicked} label="Market" />
          <div className="field">
            <span className="field-label">What happens to the market?</span>
            <div className="radio-cards radio-cards-2" role="radiogroup" aria-label="Scenario">
              {(Object.keys(SCENARIOS) as ScenarioId[]).map((id) => (
                <button type="button" key={id} role="radio" aria-checked={scenario === id} className={scenario === id ? "on" : ""} onClick={() => setScenario(id)}>
                  <b>{SCENARIOS[id].name}</b><small>{SCENARIOS[id].blurb}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field-label">How the strategy trades</span>
            <div className="radio-cards" role="radiogroup" aria-label="Trading style">
              {(Object.keys(STYLE_INFO) as StrategyStyle[]).map((id) => (
                <button type="button" key={id} role="radio" aria-checked={style === id} className={style === id ? "on" : ""} onClick={() => setStyle(id)}><b>{STYLE_INFO[id].name}</b></button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field-label">How strict are the limits? <Hint>Sized for an account of {money(START)}.</Hint></span>
            <div className="radio-cards radio-cards-3" role="radiogroup" aria-label="Limit strictness">
              {LEVELS.map((item) => (
                <button type="button" key={item.id} role="radio" aria-checked={level === item.id} className={level === item.id ? "on" : ""} onClick={() => setLevel(item.id)}>
                  <b>{item.name}</b><small>Pauses after losing {money(START * item.daily)} in a day</small>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="stack-lg">
          {run && market ? (
            <>
              <section className="card card-pad demo-result" aria-live="polite">
                <p className={`demo-headline ${calmer ? "tone-up" : ""}`}>
                  {calmer
                    ? <>Without limits the account fell as far as <b>{run.without.maxDrawdownPct}%</b>. With them, the worst drop was <b>{run.withLimits.maxDrawdownPct}%</b>.</>
                    : <>In this scenario the limits made little difference to the worst drop (<b>{run.withLimits.maxDrawdownPct}%</b> with, <b>{run.without.maxDrawdownPct}%</b> without).</>}
                </p>
                <p className="muted-text">
                  {saved > 0.5 ? <>The limits also finished <b>{money(saved)}</b> ahead.</>
                    : saved < -0.5 ? <>The trade-off: the limits finished <b>{money(-saved)}</b> behind, because smaller trades also mean smaller gains. Limits trade some upside for a smoother ride.</>
                    : <>Both ended in about the same place.</>}
                </p>
                <Chart run={run} />
                <div className="legend">
                  <span><i className="l-good" /> With your limits</span>
                  <span><i className="l-bad" /> No limits</span>
                  <span><i className="l-price" /> {market.symbol.replace("-USD", "")} price</span>
                </div>
                <div className="compare">
                  <div />
                  <b>With limits</b><b>No limits</b>
                  <span>Ends at</span><em className={`tone-${tone(run.withLimits.returnPct)}`}>{money(run.withLimits.endingEquityUsd)} <small>({signedPercent(run.withLimits.returnPct, 1)})</small></em><em className={`tone-${tone(run.without.returnPct)}`}>{money(run.without.endingEquityUsd)} <small>({signedPercent(run.without.returnPct, 1)})</small></em>
                  <span>Biggest drop</span><em>{run.withLimits.maxDrawdownPct}%</em><em>{run.without.maxDrawdownPct}%</em>
                  <span>Trades made</span><em>{run.withLimits.trades}</em><em>{run.without.trades}</em>
                  <span>Stopped by limits</span><em>{run.withLimits.blockedSignals}</em><em>—</em>
                </div>
                {run.withLimits.blockedByDailyLoss > 0 && (
                  <div className="callout callout-info"><Icon name="shield" size={20} /><p><b>The daily loss limit kicked in.</b> After losing {money(limits.dailyLossLimitUsd)} in a day the strategy paused, skipping {run.withLimits.blockedByDailyLoss} more {run.withLimits.blockedByDailyLoss === 1 ? "trade" : "trades"} until the next day.</p></div>
                )}
                <p className="fineprint">Simulated price path starting from {market.symbol.replace("-USD", "")} at {price(market.markPrice)}. Without limits each trade is {money(run.size)}; with limits it’s held to {money(Math.min(run.size, limits.maxPositionNotionalUsd))}. Fees are included. It shows how limits behave, not what will happen.</p>
              </section>
              <div className="hero-actions">
                <Link className="btn btn-primary btn-lg" href="/create">Create a strategy with limits <Icon name="arrow" size={18} /></Link>
                <Link className="btn btn-secondary btn-lg" href="/strategies">Browse strategies</Link>
              </div>
            </>
          ) : (
            <div className="card card-pad"><p className="muted-text">Loading live prices…</p></div>
          )}
        </div>
      </div>
    </>
  );
}

function Chart({ run }: { run: { candles: { close: number }[]; withLimits: { equityCurve: { equity: number }[] }; without: { equityCurve: { equity: number }[] } } }) {
  const W = 640, H = 220, pad = 8;
  const a = run.withLimits.equityCurve.map((p) => p.equity), b = run.without.equityCurve.map((p) => p.equity);
  const lo = Math.min(...a, ...b), hi = Math.max(...a, ...b), span = Math.max(1, hi - lo);
  const closes = run.candles.map((c) => c.close), plo = Math.min(...closes), phi = Math.max(...closes), pspan = Math.max(1e-9, phi - plo);
  const x = (i: number) => pad + (i / (a.length - 1)) * (W - pad * 2);
  const line = (values: number[], min: number, range: number) => values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${(H - pad - ((v - min) / range) * (H - pad * 2)).toFixed(1)}`).join(" ");
  const startX = x(WARMUP_HOURS);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Account value over the scenario, with and without limits">
      <rect x={startX} y="0" width={W - startX} height={H} className="chart-scenario" />
      <path d={line(closes, plo, pspan)} className="chart-price" />
      <path d={line(b, lo, span)} className="chart-bad" />
      <path d={line(a, lo, span)} className="chart-good" />
      <text x={startX + 6} y="16" className="chart-label">Scenario starts · {SCENARIO_HOURS} hours</text>
    </svg>
  );
}
