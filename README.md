<div align="center">

![LimitLeague — prove the discipline](./public/readme-banner.svg)

**Discover strategies by the rules they keep.**

[Open the app](https://limitleague.vercel.app) · [Explore Strike Finance](https://www.strikefinance.org) · [Strike API docs](https://docs.strikefinance.org/api/getting-started)

</div>

## Why LimitLeague

A return tells you what happened. It does not tell you how much risk a strategy took to get there. LimitLeague puts the risk contract first: every strategy publishes hard limits, and every paper trade proposal receives an allow or block decision against those limits. The strategy's record is public, so people can inspect its discipline before following it.

LimitLeague is built for the Strike Finance ecosystem and uses live Strike mark prices for every fill and open position.

## What you can do

| Explore | Publish | Follow |
| --- | --- | --- |
| Compare public strategies, limits, paper returns, follower counts, and decision histories. | Set caps for position size, daily loss, total exposure, and open positions. Pause immediately or tighten limits with a public record of the change. | Paper-follow a strategy. Each proposal is checked against **your own** paper portfolio under the strategy's published limits. |

Every browser workspace receives a persisted 10,000 pUSD paper allocation. The account view shows equity, available buying power, open exposure, live PnL, closable positions, and its funding ledger. pUSD is virtual trading credit and has no cash value.

The public audit trail records allowed and blocked proposals with the exact limits and portfolio state used by the checker. Each new decision has a SHA-256 proof ID and a shareable verification link. Performance shown in the app is paper performance derived from positions and current Strike marks; a strategy with no trades shows no return.

## How it works

```mermaid
flowchart LR
    A[Publish strategy and limits] --> B[Submit trade proposal]
    B --> C[Read paper portfolio and Strike price]
    C --> D{Check every limit}
    D -->|Allowed| E[Open paper position]
    D -->|Blocked| F[Record reason]
    E --> G[Public audit and discovery]
    F --> G
    B --> H[Follower portfolios]
    H --> D
```

The deterministic checker evaluates maximum position notional, total open exposure, number of open positions, daily loss, and pause state. The same proposal may be allowed for the publisher and blocked for a follower because their portfolios differ. Pauses take effect immediately; published limits can only be tightened.

## Use the platform

1. **Open the paper league** at [limitleague.vercel.app](https://limitleague.vercel.app). Your private paper session starts automatically.
2. **Publish a strategy** with a name, description, and hard limits.
3. **Submit a paper trade proposal.** Choose from the live Strike market catalog; LimitLeague gets the current mark, checks the rules and buying power, then records the decision.
4. **Manage the paper account.** Review balances and PnL, then close positions at the current Strike mark.
5. **Verify the public audit.** Open any decision to inspect every before/after value or copy its verification link.
6. **Paper-follow a strategy** to apply its published limits to your own paper portfolio.

## Run locally

Requirements: Node.js 22+, PostgreSQL, and network access to the Strike Finance API.

```bash
git clone https://github.com/Datwebguy/Limitleague.git
cd Limitleague
npm ci
cp .env.example .env.local
```

Set `DATABASE_URL` in `.env.local` to a PostgreSQL connection string, then run:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Database tables are created on first use. The public Strike price feed works without an API wallet.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Persistent PostgreSQL connection for users, sessions, strategies, positions, and audit records. |
| `STRIKE_API_BASE_URL` | Strike API origin; defaults to `https://api.strikefinance.org`. |
| `STRIKE_API_WALLET_PUBLIC_KEY` | Server-side Strike API wallet public key for authenticated Strike requests. |
| `STRIKE_API_WALLET_PRIVATE_KEY` | Server-side signing key. Keep it in your hosting provider's secret store; never commit it. |
| `PAPER_STARTING_BALANCE_USD` | One-time pUSD allocation for a new paper workspace; defaults to `10000`. |

## Checks

```bash
npm run typecheck
npm test
npm run build
```

The tests cover limit decisions. With `DATABASE_URL` set, the integration test also exercises PostgreSQL, the public Strike price feed, follower checks, and the audit trail.

## Architecture

The app uses Next.js and React for the interface and API routes, PostgreSQL for durable state, and a deterministic TypeScript limit checker as the source of truth for proposal decisions. Anonymous paper workspaces use private HTTP-only session cookies, so judges can start immediately without an email flow. Strike's public API supplies prices; its authenticated API wallet client is isolated on the server.

LimitLeague was created for the Strike Hackathon.
