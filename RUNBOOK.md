# Running LimitLeague

## What works

Users can create an account, publish a strategy with public hard limits, paper-follow it, and submit proposals. Each proposal uses the latest Strike production market price. The checker evaluates the owner and every follower independently before a paper position is opened. Allowed and blocked decisions are stored in Postgres. Owners can pause immediately or tighten limits; these changes are recorded publicly. The discovery board calculates paper returns from open positions and current Strike prices. No sample strategy or performance is seeded.

## Required services

- Node.js 22 or later
- PostgreSQL with a persistent `DATABASE_URL`
- Network access to `https://api.strikefinance.org`

The database schema is created on first request. For Vercel, connect a Neon Postgres database and set `DATABASE_URL` for Production, Preview, and Development. The app cannot operate without it.

## Local start

```bash
npm ci
cp .env.example .env.local
npm run build
npm run dev
```

Set `DATABASE_URL` in `.env.local` before starting. `npm test` runs the limit-checker tests. With `DATABASE_URL` set, it also runs a database and live-price integration test.

## Strike API wallet

An API wallet is a separate Ed25519 key pair registered at [Strike API Wallets](https://app.strikefinance.org/api-keys). It can read an account and place trades but cannot withdraw. Authenticated requests sign:

```text
METHOD:PATH:UNIX_TIMESTAMP:NONCE:SHA256_OF_EXACT_JSON_BODY
```

The app implements this signature in `lib/strike/client.ts` and has verified a read-only authenticated account request against Strike production. Keep the private key as a server-side secret. The key shared in chat during development should be revoked and replaced before use.

Live order submission is disabled. Before enabling it, a published strategy must be bound to an isolated Strike account or sub-account; each follower must authorize their own account; the service must reconcile positions and daily PnL from Strike immediately before submission; and the signed order must pass the same deterministic limit check. A paper audit entry is never evidence of a live fill.

Strike account APIs support Cardano, Ethereum, and Solana wallet identities. Strike sub-accounts can separate strategy balances, positions, and risk budgets.

## Deployment

The intended target is Vercel, linked to `Datwebguy/Limitleague`. Add a Neon Postgres integration, then set and verify `DATABASE_URL`. The public Strike price feed needs no API wallet. Add API-wallet secrets only after rotation and a live execution review. The previous private ChatGPT-hosted prototype is not part of this deployment.
