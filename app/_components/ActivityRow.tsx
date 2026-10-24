"use client";

import { sentenceOf, verdictOf } from "../_lib/describe";
import { timeAgo } from "../_lib/format";
import type { ActivityItem } from "../_lib/types";
import { useRecord } from "./RecordHost";
import { TokenLogo } from "./TokenLogo";
import { Icon } from "./Icon";
import { Badge } from "./ui";

export function ActivityRow({ item, showStrategy = true }: { item: ActivityItem; showStrategy?: boolean }) {
  const { open } = useRecord();
  const verdict = verdictOf(item);
  return (
    <button className="arow" onClick={() => open(item)}>
      {item.market ? <TokenLogo symbol={item.market} size={36} /> : <span className="arow-rules"><Icon name="shield" size={18} /></span>}
      <span className="arow-text">
        <b>{sentenceOf(item)}</b>
        <small>
          {showStrategy && <>{item.strategy_name} · </>}
          <time dateTime={item.created_at} title={new Date(item.created_at).toLocaleString()}>{timeAgo(item.created_at)}</time>
        </small>
        {item.event_type === "proposal" && !item.allowed && item.reasons?.[0] && <em>{item.reasons[0]}</em>}
      </span>
      <Badge tone={verdict.tone}>{verdict.label}</Badge>
    </button>
  );
}
