# LimitLeague — Architecture

## High-level flow
1. User publishes strategy definition + hard limits.
2. Strategy engine (or agent) proposes trades based on rules, signals, or copy targets.
3. Limit checker evaluates the proposal against published limits (position size, daily loss, total exposure, max open positions, pause conditions).
4. If compliant → order is submitted to Strike via API Wallet.
5. If non-compliant → trade is blocked and logged with reason.
6. Audit log and performance metrics are updated.
7. Ranking service recalculates scores using only compliant periods.
8. Followers can subscribe; the same limit checker is applied to their accounts.

## Components
- Strategy publisher (limits + logic)
- Proposal engine
- Deterministic limit checker (source of truth for compliance)
- Strike order executor (API Wallet)
- Audit log store
- Ranking engine
- Paper trading simulator (uses Strike market data)
- Public discovery / leaderboard UI

## Compliance rule
A strategy remains eligible for the main ranking only while it respects its published hard limits. Breaches move it to a breached view and exclude the non-compliant period from scoring.

## Paper vs live
Paper mode simulates fills against Strike market data under the same limit checker. Promoting to live keeps the identical limits.
