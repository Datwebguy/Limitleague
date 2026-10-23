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

## Strike accounts and chains
Strike supports Cardano, Ethereum, and Solana wallet identities. A strategy's live trades should use its owner's Strike account or a dedicated sub-account so its balance, positions, and risk budget can be verified independently. A follower needs authorization for their own account; the strategy owner's API wallet does not grant access to follower funds. Public account selectors can show account and position evidence without exposing an API-wallet private key.

The signing key must stay on the server. LimitLeague records the proposal, limit decision, and resulting Strike order ID or rejection separately. A paper fill is never presented as a live fill.
