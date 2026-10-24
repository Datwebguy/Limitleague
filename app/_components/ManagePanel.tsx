"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { LIMIT_INFO } from "../_lib/describe";
import { useStore } from "../_lib/store";
import type { Limits, Strategy } from "../_lib/types";
import { ConfirmDialog } from "./ui";

export function ManagePanel({ strategy }: { strategy: Strategy }) {
  const { setPaused, tighten, notify } = useStore();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [values, setValues] = useState({
    maxPositionNotionalUsd: String(strategy.limits.maxPositionNotionalUsd),
    dailyLossLimitUsd: String(strategy.limits.dailyLossLimitUsd),
    maxTotalExposureUsd: String(strategy.limits.maxTotalExposureUsd),
    maxOpenPositions: String(strategy.limits.maxOpenPositions),
  });

  async function togglePause() {
    setBusy(true);
    try {
      await setPaused(strategy.id, !strategy.paused);
      notify(strategy.paused ? "Strategy resumed." : "Strategy paused. No new trades will be placed.", "good");
    } catch (error) { notify(error instanceof Error ? error.message : "Could not update the strategy.", "bad"); }
    finally { setBusy(false); }
  }

  async function apply() {
    setBusy(true);
    try {
      const limits: Limits = {
        maxPositionNotionalUsd: Number(values.maxPositionNotionalUsd),
        dailyLossLimitUsd: Number(values.dailyLossLimitUsd),
        maxTotalExposureUsd: Number(values.maxTotalExposureUsd),
        maxOpenPositions: Number(values.maxOpenPositions),
        pauseAtDailyLoss: true,
      };
      await tighten(strategy.id, limits);
      notify("Your limits are now stricter. Followers are protected by them too.", "good");
      setConfirm(false);
    } catch (error) { notify(error instanceof Error ? error.message : "Could not change the limits.", "bad"); }
    finally { setBusy(false); }
  }

  const keys = Object.keys(LIMIT_INFO) as Array<keyof typeof LIMIT_INFO>;
  const changed = keys.some((key) => Number(values[key]) !== strategy.limits[key]);

  return (
    <section className="card card-pad manage">
      <h2>Manage your strategy</h2>
      <div className="manage-row">
        <div>
          <b>{strategy.paused ? "Your strategy is paused" : "Pause trading"}</b>
          <p className="muted-text">{strategy.paused ? "No new trades are being placed. Resume whenever you’re ready." : "Stops all new trades right away, for you and your followers."}</p>
        </div>
        <button className="btn btn-secondary" onClick={togglePause} disabled={busy}>{strategy.paused ? "Resume" : "Pause"}</button>
      </div>
      <form className="manage-limits" onSubmit={(event: FormEvent) => { event.preventDefault(); if (changed) setConfirm(true); }}>
        <h3>Make your limits stricter</h3>
        <p className="muted-text">You can lower a limit at any time, but never raise it. That promise is what lets people trust the numbers you published.</p>
        <div className="grid-2">
          {keys.map((key) => (
            <label className="field" key={key}>
              <span className="field-label">{LIMIT_INFO[key].name}</span>
              <span className="input-affix">{key !== "maxOpenPositions" && <i>$</i>}<input type="number" required min={1} max={strategy.limits[key]} step={key === "maxOpenPositions" ? 1 : "any"} value={values[key]} onChange={(e) => setValues({ ...values, [key]: e.target.value })} /></span>
              <small className="field-hint">Currently {key === "maxOpenPositions" ? strategy.limits[key] : `$${strategy.limits[key].toLocaleString("en-US")}`}</small>
            </label>
          ))}
        </div>
        <button className="btn btn-secondary" disabled={busy || !changed}>Review changes</button>
      </form>
      {confirm && (
        <ConfirmDialog title="Make these limits stricter?" confirmLabel="Yes, tighten limits" busy={busy} onConfirm={apply} onCancel={() => setConfirm(false)}>
          <p>This can’t be undone. Limits can only go down from here, and the change is added to your public activity.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
