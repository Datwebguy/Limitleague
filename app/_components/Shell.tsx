"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { money } from "../_lib/format";
import { useStore } from "../_lib/store";
import { Brand } from "./Brand";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

const nav: Array<{ href: string; label: string; icon: IconName; match: (path: string) => boolean }> = [
  { href: "/", label: "Home", icon: "home", match: (p) => p === "/" },
  { href: "/strategies", label: "Strategies", icon: "strategies", match: (p) => p.startsWith("/strategies") },
  { href: "/create", label: "Create", icon: "plus", match: (p) => p.startsWith("/create") },
  { href: "/activity", label: "Activity", icon: "activity", match: (p) => p.startsWith("/activity") },
  { href: "/account", label: "My account", icon: "wallet", match: (p) => p.startsWith("/account") },
];

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { portfolio, toasts, dismiss, loadError, refresh, ready } = useStore();
  return (
    <div className="shell">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="topbar">
        <div className="container topbar-inner">
          <Brand />
          <nav className="topnav" aria-label="Main">
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className={item.match(path) ? "active" : ""} aria-current={item.match(path) ? "page" : undefined}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="topbar-end">
            <span className="live-dot" title="Prices come straight from Strike Finance"><i /> Live Strike prices</span>
            <Link href="/account" className="practice-pill" title="Practice money has no cash value">
              <span>Practice</span>
              <b>{portfolio ? money(portfolio.availableUsd) : "—"}</b>
            </Link>
          </div>
        </div>
      </header>

      {ready && loadError && (
        <div className="banner" role="alert">
          <div className="container banner-inner">
            <span>We couldn’t reach the latest data. {loadError}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => void refresh()}>Try again</button>
          </div>
        </div>
      )}

      <main id="main" className="container main">{children}</main>

      <footer className="footer">
        <div className="container footer-inner">
          <div>
            <Brand />
            <p>Follow strategies that publish their risk limits first. Everything here uses practice money and live prices from <a href="https://www.strikefinance.org" target="_blank" rel="noreferrer">Strike Finance</a>.</p>
          </div>
          <nav aria-label="Footer">
            <Link href="/strategies">Strategies</Link>
            <Link href="/create">Create a strategy</Link>
            <Link href="/activity">Public activity</Link>
            <Link href="/#how-it-works">How it works</Link>
            <Link href="/#questions">Questions</Link>
          </nav>
          <p className="footer-note">Practice money has no cash value and can’t be withdrawn. Nothing here is financial advice. Trading real money involves risk of loss.</p>
        </div>
      </footer>

      <nav className="tabbar" aria-label="Main">
        {nav.map((item) => (
          <Link key={item.href} href={item.href} className={item.match(path) ? "active" : ""} aria-current={item.match(path) ? "page" : undefined}>
            <Icon name={item.icon} size={22} />
            <span>{item.label === "My account" ? "Account" : item.label}</span>
          </Link>
        ))}
      </nav>

      <div className="toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`} role="status">
            <Icon name={toast.tone === "bad" ? "info" : "check"} size={18} />
            <span>{toast.text}</span>
            <button onClick={() => dismiss(toast.id)} aria-label="Dismiss"><Icon name="close" size={16} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
