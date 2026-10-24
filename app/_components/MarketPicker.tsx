"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { kindLabel } from "../_lib/assets";
import { baseOf, price } from "../_lib/format";
import type { Market } from "../_lib/types";
import { Icon } from "./Icon";
import { TokenLogo } from "./TokenLogo";

/** A searchable market list that shows each token's logo, name and live price. */
export function MarketPicker({ markets, value, onChange, label = "Market", disabled = false, placeholder = "Choose a market" }: {
  markets: Market[]; value: string; onChange: (symbol: string) => void; label?: string; disabled?: boolean; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const selected = markets.find((market) => market.symbol === value);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => !box.current?.contains(event.target as Node) && setOpen(false);
    const esc = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const results = useMemo(() => {
    const text = query.trim().toLowerCase();
    const list = text ? markets.filter((market) => market.symbol.toLowerCase().includes(text) || market.name.toLowerCase().includes(text)) : markets;
    return list;
  }, [markets, query]);

  return (
    <div className="picker" ref={box}>
      <span className="field-label" id={`${id}-label`}>{label}</span>
      <button type="button" className="picker-button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-labelledby={`${id}-label`} onClick={() => setOpen((v) => !v)}>
        {selected ? (
          <>
            <TokenLogo symbol={selected.symbol} size={28} />
            <span className="picker-main"><b>{baseOf(selected.symbol)}</b><small>{selected.name.replace(/ \/ USD$/, "")}</small></span>
            <span className="picker-price">{price(selected.markPrice)}</span>
          </>
        ) : (
          <span className="picker-placeholder">{placeholder}</span>
        )}
        <Icon name="chevron" size={18} />
      </button>
      {open && (
        <div className="picker-pop">
          <label className="picker-search">
            <Icon name="search" size={16} />
            <input autoFocus placeholder="Search by name or ticker" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search markets" />
          </label>
          <ul role="listbox" aria-labelledby={`${id}-label`}>
            {results.length === 0 && <li className="picker-none">No market matches “{query}”.</li>}
            {results.map((market) => (
              <li key={market.symbol} role="option" aria-selected={market.symbol === value}>
                <button type="button" onClick={() => { onChange(market.symbol); setOpen(false); setQuery(""); }}>
                  <TokenLogo symbol={market.symbol} size={30} />
                  <span className="picker-main"><b>{baseOf(market.symbol)}</b><small>{market.name.replace(/ \/ USD$/, "")} · {kindLabel(market.symbol)}</small></span>
                  <span className="picker-price">{price(market.markPrice)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
