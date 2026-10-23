# LimitLeague — Product

## Name
LimitLeague

## One-line description
Seasonal leaderboard and following layer for strategies that only rank when they stay inside the hard limits they published.

## Problem
Most automation and copy-trading tools either run unrestricted or hide how risk is controlled. Normal leaderboards reward high risk. Users cannot easily find strategies that have proven they stay inside clear, published rules.

## Solution
Users publish strategies with explicit hard limits. Every proposed trade is checked against those limits before it reaches Strike. Only compliant performance is ranked. Followers get the same limits applied to their own account. Full audit trail is public.

## Who it is for
- Traders who want to run strategies under hard controls and get visibility.
- Users who want to follow strategies that have already demonstrated discipline.
- Anyone who wants social proof that a strategy stayed inside its stated rules.

## Core loop
1. Publish strategy + hard limits.
2. System proposes trades and only executes those that pass the limits.
3. Audit log records every allowed and blocked trade with reason.
4. Ranking updates based only on compliant performance.
5. Others inspect, paper-follow, or live-follow under the same limits.

## User activities
- Publish a strategy with limits and let it run (paper or live).
- View public feed of every proposed trade and the allow/block decision.
- Browse leaderboard of limit-respecting strategies.
- Inspect full audit trail before following.
- Paper-follow any strategy under identical limits.
- Promote paper follow to live.
- Tighten or pause limits (change is public and immediate).
- Compare strategies on how often their own rules blocked them.
- Receive alerts when a followed strategy hits a limit or pauses.
- Compete in weekly or multi-week seasons.

## Ranking mechanism (simple)
- Gate: strategies that breach published hard limits are excluded or moved to a breached board.
- Score: risk-adjusted return calculated only while the strategy was compliant.
- Bonus: longer compliant track record and complete public audit logs.
- Ranking only includes performance that stayed inside the published rules.

## Benefits of the rules
- Cannot lose more than the published daily and position limits.
- Automation stays inside user-defined control.
- Leaderboard becomes trustworthy because high rank requires proven discipline.
- Following is safer because the same limits travel with the strategy.
- Bad behavior is visible and penalized.
- Full audit trail for review and adjustment.
