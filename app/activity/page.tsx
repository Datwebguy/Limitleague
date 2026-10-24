"use client";

import { useMemo, useState } from "react";
import { ActivityRow } from "../_components/ActivityRow";
import { EmptyState, Skeleton } from "../_components/ui";
import { useStore } from "../_lib/store";

type Filter = "all" | "placed" | "stopped" | "closed" | "rules";

export default function Activity() {
  const { ready, activity, hasMoreActivity, loadMoreActivity, notify } = useStore();
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);

  const shown = useMemo(() => activity.filter((item) => {
    if (filter === "all") return true;
    if (filter === "rules") return item.event_type === "rules";
    if (filter === "closed") return item.event_type === "close";
    if (item.event_type !== "proposal") return false;
    return filter === "placed" ? !!item.allowed : !item.allowed;
  }), [activity, filter]);

  const options: Array<[Filter, string]> = [["all", "Everything"], ["placed", "Trades placed"], ["stopped", "Stopped by limits"], ["closed", "Trades closed"], ["rules", "Rule changes"]];

  async function more() {
    setBusy(true);
    try { await loadMoreActivity(); } catch (error) { notify(error instanceof Error ? error.message : "Could not load more.", "bad"); }
    finally { setBusy(false); }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Public activity</p>
          <h1>Every decision, in the open</h1>
          <p className="muted-text">Each time a strategy places a trade, is stopped by its limits, closes a trade or changes its rules, it appears here. Select any item to see the details and check it hasn’t been altered.</p>
        </div>
      </header>

      <div className="chips" role="group" aria-label="Filter activity">
        {options.map(([id, label]) => <button key={id} className={`chip ${filter === id ? "on" : ""}`} onClick={() => setFilter(id)}>{label}</button>)}
      </div>

      <div className="card alist">
        {!ready ? <div className="stack pad">{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={52} />)}</div> : shown.length === 0 ? (
          <EmptyState title={activity.length === 0 ? "No activity yet" : "Nothing in this view"}>
            {activity.length === 0 ? "Decisions appear here the moment a strategy places, or is stopped from placing, a trade." : hasMoreActivity ? "Nothing in the latest items matches. Load older activity to look further back." : "Try another filter."}
          </EmptyState>
        ) : shown.map((item) => <ActivityRow key={item.id} item={item} />)}
      </div>
      {hasMoreActivity && <button className="btn btn-secondary btn-block load-more" onClick={more} disabled={busy}>{busy ? "Loading…" : "Load older activity"}</button>}
    </>
  );
}
