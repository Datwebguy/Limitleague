# Running LimitLeague

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. The initial strategy is configured in paper mode.

## Proposal gate

`POST /api/proposals` accepts:

```json
{
  "strategyId": "northstar",
  "market": "BTC-USD",
  "side": "long",
  "notionalUsd": 1500,
  "reason": "Published strategy signal"
}
```

The endpoint always invokes `lib/limit-checker.ts` before recording an audit event. A blocked proposal never reaches the Strike order executor.

- `GET /api/strategies` lists published strategies and their hard limits.
- `GET /api/audit` returns recorded allow/block decisions for the current service instance.

## Strike activation

The project intentionally has no configured wallet or live order endpoint. Before enabling live execution:

1. Add a durable database adapter for strategy, portfolio, and audit data.
2. Provide API Wallet signing through a server-side secret provider.
3. Fetch and reconcile portfolio state from Strike before each proposal.
4. Invoke `submitAllowedOrder` only after `checkLimits` returns `allowed: true`.
5. Keep API-wallet keys out of client-side code and do not add withdrawal authority.

Run the logic tests with:

```bash
npm test
```
