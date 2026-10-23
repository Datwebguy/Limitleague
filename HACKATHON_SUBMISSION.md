# LimitLeague — Strike Hackathon Submission

## Project name
LimitLeague

## Short description
Seasonal discovery and following product for strategies that only rank when they stay inside the hard risk limits they published. Built on Strike.

## What we built
- Strategy publishing with explicit hard limits
- Deterministic limit checker before any order reaches Strike
- Public audit trail of allowed and blocked trades
- Ranking that only counts compliant performance
- Paper-follow and live-follow under the same limits

## Strike integration
- Uses Strike API (API Wallet for trading, public endpoints for market and portfolio data)
- Limit checks happen before orders are submitted to Strike
- Leverages public discovery and portfolio data for verification

## Demo flow
1. Publish a strategy with clear limits.
2. Show a proposed trade that is allowed.
3. Show a proposed trade that is blocked (with reason).
4. View the public audit log.
5. Check the leaderboard (only compliant strategies ranked).
6. Paper-follow the strategy, then promote to live.

## Links
- Docs: [https://docs.strikefinance.org](https://docs.strikefinance.org)
- API Getting Started: [https://docs.strikefinance.org/api/getting-started](https://docs.strikefinance.org/api/getting-started)
- Strike GitHub: [https://github.com/strike-finance](https://github.com/strike-finance)
