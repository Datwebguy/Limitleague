"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { sentenceOf, sideName, SIDE_HELP, verdictOf } from "../_lib/describe";
import { baseOf, fullDate, money, price, signedMoney } from "../_lib/format";
import { useStore } from "../_lib/store";
import type { ActivityItem, Verification } from "../_lib/types";
import { Icon } from "./Icon";
import { TokenLogo } from "./TokenLogo";
import { Badge, Dialog, Hint, Meter } from "./ui";

const RecordContext = createContext<{ open: (item: ActivityItem) => void } | null>(null);
export const useRecord = () => {
  const context = useContext(RecordContext);
  if (!context) throw new Error("useRecord must be used inside RecordHost.");
  return context;
};

export function RecordHost({ children }: { children: ReactNode }) {
  const { activity, ready } = useStore();
  const [record, setRecord] = useState<ActivityItem | null>(null);

  const open = useCallback((item: ActivityItem) => {
    setRecord(item);
    window.history.replaceState(null, "", `${window.location.pathname}?record=${item.id}`);
  }, []);
  const close = useCallback(() => {
    setRecord(null);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  // A shared link opens the record straight away, even if it is older than the first page of activity.
  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get("record") ?? params.get("audit");
    if (!id || record?.id === id) return;
    const listed = activity.find((item) => item.id === id);
    if (listed) { setRecord(listed); return; }
    fetch(`/api/audit/${id}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => data?.event && setRecord({ ...data.event, event_type: data.event.event_kind ?? "proposal" }))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  return (
    <RecordContext.Provider value={{ open }}>
      {children}
      {record && <RecordDialog item={record} onClose={close} />}
    </RecordContext.Provider>
  );
}

function RecordDialog({ item, onClose }: { item: ActivityItem; onClose: () => void }) {
  const { verifyHistory, notify } = useStore();
  const verdict = verdictOf(item);
  const [check, setCheck] = useState<Verification | "working" | "failed" | null>(null);
  const trade = item.event_type !== "rules";
  const after = item.decision_snapshot?.after;
  const limits = item.limits_snapshot;

  async function verify() {
    setCheck("working");
    try { setCheck(await verifyHistory(item.strategy_id)); } catch { setCheck("failed"); }
  }

  return (
    <Dialog title="Decision details" onClose={onClose} wide>
      <div className="record-top">
        <Badge tone={verdict.tone}>{verdict.label}</Badge>
        {item.mode === "live" && <Badge tone="warn">Real money</Badge>}
        {item.mode !== "live" && trade && <Badge>Practice</Badge>}
        <span className="muted-text">{fullDate(item.created_at)}</span>
      </div>
      <h2 className="dialog-title">{sentenceOf(item)}</h2>
      <p className="record-strategy">
        By <Link href={`/strategies/${item.strategy_id}`} onClick={onClose}>{item.strategy_name}</Link>
      </p>

      {trade && item.market && (
        <dl className="facts">
          <div><dt>Market</dt><dd><TokenLogo symbol={item.market} size={22} /> {baseOf(item.market)}</dd></div>
          <div><dt>Direction <Hint>{SIDE_HELP[sideName(item.side)]}</Hint></dt><dd className="cap">{sideName(item.side)}</dd></div>
          <div><dt>Trade size</dt><dd>{money(item.notional_usd ?? 0)}</dd></div>
          <div><dt>Price at the time</dt><dd>{item.price ? price(item.price) : "—"}</dd></div>
          {item.event_type === "close" && typeof item.portfolio_snapshot?.realizedPnlUsd === "number" && (
            <div><dt>Result</dt><dd className={item.portfolio_snapshot.realizedPnlUsd >= 0 ? "tone-up" : "tone-down"}>{signedMoney(item.portfolio_snapshot.realizedPnlUsd)}</dd></div>
          )}
        </dl>
      )}

      {item.event_type === "proposal" && item.reason && (
        <div className="note"><b>Owner’s note</b><p>“{item.reason}”</p></div>
      )}

      {item.event_type === "proposal" && !item.allowed && item.reasons?.length ? (
        <div className="callout callout-bad">
          <b>Why it was stopped</b>
          <ul>{item.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </div>
      ) : null}

      {item.event_type === "proposal" && after && limits && (
        <section className="record-block">
          <h3>How the trade measured up against the limits <Hint>These bars show what would have been true right after this trade.</Hint></h3>
          <Meter label="Position in this market" value={after.positionNotionalUsd} limit={limits.maxPositionNotionalUsd} format={(n) => money(n)} />
          <Meter label="Total in the market" value={after.totalExposureUsd} limit={limits.maxTotalExposureUsd} format={(n) => money(n)} />
          <Meter label="Open trades" value={after.openPositionCount} limit={limits.maxOpenPositions} format={(n) => String(n)} />
          <Meter label="Loss so far today" value={after.dailyLossUsd} limit={limits.dailyLossLimitUsd} format={(n) => money(n)} />
        </section>
      )}

      <section className="record-block seal">
        <h3><Icon name="shield" size={18} /> Tamper-proof record</h3>
        <p>
          Every decision is saved with a unique fingerprint that also covers the decision before it. If anyone changed or removed past
          decisions, the fingerprints would stop matching.
        </p>
        {item.hash_version === 2 ? (
          <button className="btn btn-secondary btn-sm" onClick={verify} disabled={check === "working"}>
            {check === "working" ? "Checking…" : "Check this strategy’s whole history"}
          </button>
        ) : item.event_type === "rules" ? null : (
          <p className="muted-text">This is an older record, saved before fingerprints were chained together.</p>
        )}
        {check && check !== "working" && (
          <p className={`verify ${check !== "failed" && check.valid ? "verify-ok" : "verify-bad"}`} role="status">
            {check === "failed"
              ? "We couldn’t run the check just now. Please try again."
              : check.valid
                ? `History is intact. ${check.checked} decisions were re-checked and every one matches.`
                : `Something doesn’t match: ${check.problem}`}
          </p>
        )}
        {item.event_hash && (
          <details>
            <summary>Show the technical details</summary>
            <p className="code-label">Fingerprint of this decision</p>
            <code>{item.event_hash}</code>
            {item.prev_hash && (<><p className="code-label">Fingerprint of the one before</p><code>{item.prev_hash}</code></>)}
            <button className="btn btn-ghost btn-sm" onClick={() => { void navigator.clipboard?.writeText(`${window.location.origin}${window.location.pathname}?record=${item.id}`); notify("Link copied.", "good"); }}>
              <Icon name="copy" size={15} /> Copy link to this record
            </button>
          </details>
        )}
      </section>
    </Dialog>
  );
}
