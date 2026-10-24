"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Icon } from "../_components/Icon";
import { MarketPicker } from "../_components/MarketPicker";
import { TokenLogo } from "../_components/TokenLogo";
import { Badge, Hint, Skeleton } from "../_components/ui";
import { LIMIT_INFO, STYLE_INFO } from "../_lib/describe";
import { baseOf, money, signedPercent, tone } from "../_lib/format";
import { useStore } from "../_lib/store";
import type { BacktestResult, StrategyStyle } from "../_lib/types";

type LimitKey = keyof typeof LIMIT_INFO;

/** Share of the account each preset risks. These are suggestions the person can change. */
const PRESETS = [
  { id: "cautious", name: "Cautious", blurb: "Small positions, quick to pause", position: 0.05, exposure: 0.15, daily: 0.01, open: 2 },
  { id: "balanced", name: "Balanced", blurb: "A sensible middle path", position: 0.1, exposure: 0.3, daily: 0.03, open: 3 },
  { id: "bold", name: "Bold", blurb: "Bigger swings, more room to lose", position: 0.2, exposure: 0.6, daily: 0.06, open: 5 },
] as const;

const niceRound = (value: number) => {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.max(1, Math.round(value / (magnitude / 2)) * (magnitude / 2));
};

function Section({ n, title, help, children }: { n: number; title: string; help: string; children: ReactNode }) {
  return (
    <section className="card card-pad csection">
      <header><span className="csection-n">{n}</span><div><h2>{title}</h2><p className="muted-text">{help}</p></div></header>
      {children}
    </section>
  );
}

export default function Create() {
  const router = useRouter();
  const { ready, markets, portfolio, createStrategy, runBacktest, notify } = useStore();
  const base = portfolio?.startingBalanceUsd ?? 0;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [market, setMarket] = useState("");
  const [style, setStyle] = useState<StrategyStyle>("momentum");
  const [takeProfit, setTakeProfit] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [limits, setLimits] = useState<Record<LimitKey, string>>({ maxPositionNotionalUsd: "", dailyLossLimitUsd: "", maxTotalExposureUsd: "", maxOpenPositions: "" });
  const [preset, setPreset] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [test, setTest] = useState<BacktestResult | "running" | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);

  function applyPreset(id: string) {
    const choice = PRESETS.find((item) => item.id === id);
    if (!choice || !base) return;
    setPreset(id);
    setLimits({
      maxPositionNotionalUsd: String(niceRound(base * choice.position)),
      dailyLossLimitUsd: String(niceRound(base * choice.daily)),
      maxTotalExposureUsd: String(niceRound(base * choice.exposure)),
      maxOpenPositions: String(choice.open),
    });
    setTest(null);
  }

  // Start from the middle option once the account size is known, unless the person already typed something.
  useEffect(() => {
    if (base && !limits.maxPositionNotionalUsd && !preset) applyPreset("balanced");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const numbers = {
    maxPositionNotionalUsd: Number(limits.maxPositionNotionalUsd),
    dailyLossLimitUsd: Number(limits.dailyLossLimitUsd),
    maxTotalExposureUsd: Number(limits.maxTotalExposureUsd),
    maxOpenPositions: Number(limits.maxOpenPositions),
  };
  const problems = useMemo(() => {
    const list: string[] = [];
    if (name.trim().length < 3) list.push("Give your strategy a name (at least 3 characters).");
    if (description.trim().length < 10) list.push("Describe your idea in a sentence or two.");
    if (!market) list.push("Choose the market your strategy trades.");
    if (Object.values(numbers).some((n) => !Number.isFinite(n) || n <= 0)) list.push("Fill in all four limits with numbers above zero.");
    else if (numbers.maxPositionNotionalUsd > numbers.maxTotalExposureUsd) list.push("Your largest position can’t be bigger than the most you allow in the market in total.");
    if (!Number.isInteger(numbers.maxOpenPositions) || numbers.maxOpenPositions > 100) list.push("Most open trades should be a whole number up to 100.");
    for (const [label, value] of [["Take profit", takeProfit], ["Stop loss", stopLoss]] as const)
      if (value !== "" && !(Number(value) > 0 && Number(value) <= 100)) list.push(`${label} should be a percentage between 0 and 100, or left empty.`);
    return list;
  }, [name, description, market, numbers.maxPositionNotionalUsd, numbers.dailyLossLimitUsd, numbers.maxTotalExposureUsd, numbers.maxOpenPositions, takeProfit, stopLoss]);

  const buildLimits = () => ({ ...numbers, pauseAtDailyLoss: true as const });

  async function backtest() {
    if (!market) return notify("Choose a market first so we know what to test.", "bad");
    if (problems.some((p) => p.includes("limits") || p.includes("largest"))) return notify("Fill in your limits first.", "bad");
    setTest("running");
    try {
      setTest(await runBacktest({ market, style, days, notionalUsd: numbers.maxPositionNotionalUsd, takeProfitPct: takeProfit ? Number(takeProfit) : null, stopLossPct: stopLoss ? Number(stopLoss) : null, limits: buildLimits() }));
    } catch (error) { setTest(null); notify(error instanceof Error ? error.message : "The test could not run.", "bad"); }
  }

  async function publish(event: FormEvent) {
    event.preventDefault();
    if (problems.length) return notify(problems[0], "bad");
    setBusy(true);
    try {
      const created = await createStrategy({
        name: name.trim(), description: description.trim(), limits: buildLimits(),
        config: { market, style, takeProfitPct: takeProfit ? Number(takeProfit) : null, stopLossPct: stopLoss ? Number(stopLoss) : null },
      });
      notify("Your strategy is live. Place its first trade to start its record.", "good");
      router.push(`/strategies/${created.id}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not publish your strategy.", "bad");
      setBusy(false);
    }
  }

  const fields: Array<{ key: LimitKey; prefix: boolean; max?: number }> = [
    { key: "maxPositionNotionalUsd", prefix: true }, { key: "maxTotalExposureUsd", prefix: true },
    { key: "dailyLossLimitUsd", prefix: true }, { key: "maxOpenPositions", prefix: false, max: 100 },
  ];

  if (!ready) return <div className="stack"><Skeleton height={40} width="50%" /><Skeleton height={260} radius={16} /></div>;

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Create</p>
          <h1>Create a strategy</h1>
          <p className="muted-text">Decide your rules before you trade. They’re shown to everyone and can only ever be made stricter.</p>
        </div>
      </header>

      <form className="create" onSubmit={publish}>
        <div className="stack-lg">
          <Section n={1} title="What’s your idea?" help="Tell people what your strategy is about.">
            <label className="field">
              <span className="field-label">Name</span>
              <input required minLength={3} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Give it a short, memorable name" />
            </label>
            <label className="field">
              <span className="field-label">Description</span>
              <textarea required maxLength={1000} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="In a sentence or two: what do you trade, and why?" />
              <small className="field-hint">{description.length}/1000</small>
            </label>
          </Section>

          <Section n={2} title="What does it trade?" help="Choose one market. Your strategy will only ever trade this one.">
            <MarketPicker markets={markets} value={market} onChange={(symbol) => { setMarket(symbol); setTest(null); }} />
            <div className="field">
              <span className="field-label">Trading style <Hint>Used to test your idea on past prices. You place your own trades.</Hint></span>
              <div className="radio-cards" role="radiogroup" aria-label="Trading style">
                {(Object.keys(STYLE_INFO) as StrategyStyle[]).map((key) => (
                  <button type="button" key={key} role="radio" aria-checked={style === key} className={style === key ? "on" : ""} onClick={() => { setStyle(key); setTest(null); }}>
                    <b>{STYLE_INFO[key].name}</b><small>{STYLE_INFO[key].blurb}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid-2">
              <label className="field">
                <span className="field-label">Take profit (optional) <Hint>Closes a trade automatically once it’s up by this percentage.</Hint></span>
                <span className="input-affix"><input type="number" min="0" max="100" step="0.1" value={takeProfit} onChange={(e) => { setTakeProfit(e.target.value); setTest(null); }} placeholder="Off" /><i>%</i></span>
              </label>
              <label className="field">
                <span className="field-label">Stop loss (optional) <Hint>Closes a trade automatically once it’s down by this percentage.</Hint></span>
                <span className="input-affix"><input type="number" min="0" max="100" step="0.1" value={stopLoss} onChange={(e) => { setStopLoss(e.target.value); setTest(null); }} placeholder="Off" /><i>%</i></span>
              </label>
            </div>
          </Section>

          <Section n={3} title="Set your risk limits" help="These are your promises to anyone who follows you. Every trade is checked against them.">
            {base > 0 && (
              <div className="field">
                <span className="field-label">Start from a suggestion <Hint>Sized to your practice account of {money(base)}. You can change every number.</Hint></span>
                <div className="radio-cards radio-cards-3" role="radiogroup" aria-label="Risk preset">
                  {PRESETS.map((item) => (
                    <button type="button" key={item.id} role="radio" aria-checked={preset === item.id} className={preset === item.id ? "on" : ""} onClick={() => applyPreset(item.id)}>
                      <b>{item.name}</b><small>{item.blurb}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid-2">
              {fields.map(({ key, prefix, max }) => (
                <label className="field" key={key}>
                  <span className="field-label">{LIMIT_INFO[key].name}</span>
                  <span className="input-affix">{prefix && <i>$</i>}<input required type="number" min={1} max={max} step={prefix ? "any" : 1} value={limits[key]} onChange={(e) => { setLimits({ ...limits, [key]: e.target.value }); setPreset(null); setTest(null); }} /></span>
                  <small className="field-hint">{LIMIT_INFO[key].help}</small>
                </label>
              ))}
            </div>
          </Section>

          <Section n={4} title="Test it on past prices (optional)" help="See how your idea and limits would have done recently. Each test trade uses your largest position size.">
            <div className="test-row">
              <div className="seg" role="group" aria-label="Test period">
                {[7, 14, 30].map((option) => <button type="button" key={option} className={days === option ? "on" : ""} onClick={() => { setDays(option); setTest(null); }}>{option} days</button>)}
              </div>
              <button type="button" className="btn btn-secondary" onClick={backtest} disabled={test === "running"}>
                <Icon name="flask" size={18} /> {test === "running" ? "Testing…" : "Run the test"}
              </button>
            </div>
            {test && test !== "running" && (
              <div className="test-result">
                <div><small>Result</small><b className={`num tone-${tone(test.returnPct)}`}>{signedPercent(test.returnPct)}</b></div>
                <div><small>Biggest drop <Hint>The largest fall from a high point during the test.</Hint></small><b className="num">{test.maxDrawdownPct}%</b></div>
                <div><small>Trades won</small><b className="num">{test.winRatePct}%</b></div>
                <div><small>Trades made</small><b className="num">{test.trades}</b></div>
                <div><small>Skipped by your limits</small><b className="num">{test.blockedSignals}</b></div>
                <p>Past results don’t predict the future. Fees of {money(test.feesUsd, 2)} are included.</p>
              </div>
            )}
          </Section>
        </div>

        <aside className="create-side">
          <div className="card card-pad preview">
            <p className="eyebrow">Preview</p>
            <div className="preview-id">
              {market ? <TokenLogo symbol={market} size={52} /> : <span className="token token-badge" style={{ width: 52, height: 52 }}>?</span>}
              <div><b>{name.trim() || "Your strategy"}</b><small>{market ? baseOf(market) : "Choose a market"} · by you</small></div>
            </div>
            <p className="preview-text">
              {Object.values(numbers).every((n) => n > 0)
                ? <>Can put up to <b>{money(numbers.maxPositionNotionalUsd)}</b> in one market and <b>{money(numbers.maxTotalExposureUsd)}</b> in total, hold at most <b>{numbers.maxOpenPositions}</b> {numbers.maxOpenPositions === 1 ? "trade" : "trades"} at once, and pauses for the day after losing <b>{money(numbers.dailyLossLimitUsd)}</b>.</>
                : "Your limits will be summarised here."}
            </p>
            <ul className="checklist">
              <li><Icon name="lock" size={15} /> Limits can be tightened later, never loosened</li>
              <li><Icon name="shield" size={15} /> Every trade is checked and recorded publicly</li>
              <li><Icon name="users" size={15} /> Followers are protected by the same limits</li>
            </ul>
            <label className="agree">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>I understand my limits will be public and can only be made stricter.</span>
            </label>
            {problems.length > 0 && agree && (
              <div className="callout callout-warn"><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>
            )}
            <button className="btn btn-primary btn-lg btn-block" disabled={busy || !agree}>{busy ? "Publishing…" : "Publish strategy"} {!busy && <Icon name="arrow" size={18} />}</button>
            <Badge tone="muted">Practice mode: no real money is used</Badge>
          </div>
        </aside>
      </form>
    </>
  );
}
