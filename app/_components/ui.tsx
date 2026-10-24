"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function Hint({ children, label = "What does this mean?" }: { children: ReactNode; label?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className="hint-wrap" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="hint-button" aria-label={label} aria-describedby={open ? id : undefined} aria-expanded={open} onClick={() => setOpen((value) => !value)} onBlur={() => setOpen(false)}>
        <Icon name="info" size={15} />
      </button>
      {open && (
        <span role="tooltip" id={id} className="hint-bubble">
          {children}
        </span>
      )}
    </span>
  );
}

export function Badge({ tone = "muted", children }: { tone?: "good" | "warn" | "bad" | "muted" | "brand"; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Stat({ label, value, note, tone, hint }: { label: string; value: ReactNode; note?: ReactNode; tone?: "up" | "down" | "flat"; hint?: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-label">
        {label}
        {hint && <Hint>{hint}</Hint>}
      </span>
      <b className={`stat-value ${tone ? `tone-${tone}` : ""}`}>{value}</b>
      {note && <small className="stat-note">{note}</small>}
    </div>
  );
}

/** Shows how much of a limit a number uses, so a limit is something you can see rather than read. */
export function Meter({ label, value, limit, format }: { label: string; value: number; limit: number; format: (n: number) => string }) {
  const ratio = limit > 0 ? value / limit : 0;
  const state = ratio > 1 ? "over" : ratio > 0.75 ? "warn" : "ok";
  return (
    <div className={`meter meter-${state}`}>
      <div className="meter-head">
        <span>{label}</span>
        <b>
          {format(value)} <small>of {format(limit)}</small>
        </b>
      </div>
      <div className="meter-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(value, limit)}>
        <i style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
    </div>
  );
}

export function Skeleton({ height = 16, width = "100%", radius = 8 }: { height?: number; width?: number | string; radius?: number }) {
  return <span className="skeleton" style={{ height, width, borderRadius: radius }} aria-hidden="true" />;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const body = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab" && ref.current) {
        const focusable = ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])');
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = body;
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={ref} className={`dialog ${wide ? "dialog-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <button className="dialog-close" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, children, confirmLabel, cancelLabel = "Cancel", danger = false, busy = false, onConfirm, onCancel }: {
  title: string; children: ReactNode; confirmLabel: string; cancelLabel?: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Dialog title={title} onClose={onCancel}>
      <h2 className="dialog-title">{title}</h2>
      <div className="dialog-body">{children}</div>
      <div className="dialog-actions">
        <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
        <button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={onConfirm} disabled={busy}>{busy ? "Working…" : confirmLabel}</button>
      </div>
    </Dialog>
  );
}
