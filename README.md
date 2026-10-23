# LimitLeague

LimitLeague is a seasonal strategy discovery and following product built on Strike Finance.

Users publish strategies that run under hard, publicly declared risk limits. The ranking only counts performance that stayed inside those limits. Anyone can inspect the full audit trail, paper-follow a strategy under the same rules, or promote it to live.

This is a Strike Hackathon submission.

## Current implementation

The repository contains a Next.js application with account creation, strategy publishing, public limits and audit records, paper following, live Strike market prices, and a Postgres-backed paper trading gate. The discovery board shows actual paper returns when a strategy has trades. Live order submission is disabled until separate Strike accounts and a replacement API-wallet secret are configured. See [RUNBOOK.md](RUNBOOK.md) for setup and the exact activation requirements.

## What it does
- Publish a strategy with explicit hard limits (position size, daily loss, total exposure, max open positions, pause conditions).
- Every proposed trade is checked against the published limits before it can execute on Strike.
- Public leaderboard ranks only compliant performance.
- Full audit log of allowed vs blocked trades with reasons.
- Paper-follow or live-follow any strategy; the same limits apply to the follower.

## Live links
- App: [https://app.strikefinance.org](https://app.strikefinance.org)
- Docs: [https://docs.strikefinance.org](https://docs.strikefinance.org)

## Key Strike resources
- API Getting Started: [https://docs.strikefinance.org/api/getting-started](https://docs.strikefinance.org/api/getting-started)
- Copy Trading: [https://docs.strikefinance.org/perpetuals/copy-trading](https://docs.strikefinance.org/perpetuals/copy-trading)
- Copy Trader Discovery: [https://docs.strikefinance.org/api/copy-trading/copy-trader-discovery-public](https://docs.strikefinance.org/api/copy-trading/copy-trader-discovery-public)
- Skills: [https://github.com/strike-finance/strike-finance-skills](https://github.com/strike-finance/strike-finance-skills)

## Strike GitHub
- Organization: [https://github.com/strike-finance](https://github.com/strike-finance)
- Perpetuals contracts: [https://github.com/strike-finance/perpetuals-smart-contracts](https://github.com/strike-finance/perpetuals-smart-contracts)
- Skills: [https://github.com/strike-finance/strike-finance-skills](https://github.com/strike-finance/strike-finance-skills)
- Hermes skill: [https://github.com/strike-finance/strike-finance-hermes-skill](https://github.com/strike-finance/strike-finance-hermes-skill)
