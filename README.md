<div align="center">

![LimitLeague](./public/readme-banner.svg)

# LimitLeague

**Follow strategies that play by their own rules.**

[Open the app](https://limitleague.vercel.app) · [Strike Finance](https://www.strikefinance.org)

</div>

LimitLeague is a place to find and follow trading strategies that publish their risk limits first. Every trade is checked against those limits, and every decision, whether the trade was placed or stopped, is public. Everything runs on practice money at live prices from Strike Finance, so you can try it instantly with no sign-up and no wallet.

## What you can do

- **Browse strategies** and see each one's limits, results and how often it stayed inside its own rules.
- **Follow a strategy.** Its trades are tried in your own practice account, using your cash and its limits. Unfollow any time.
- **Create your own.** Pick a market, choose your limits (with suggestions sized to your account), test the idea on past prices, and publish.
- **Place practice trades** with live prices. If a trade would break a limit, it's stopped and the reason is shown.
- **Try a scenario** such as a sudden crash and see the same trading with and without risk limits, on a simulated price path that starts from today's real price.
- **Watch the public activity** and check that history hasn't been altered.
- **Switch between Practice and Real** at the top of every page. Real is optional: connect your own Strike account with a trading key (it can trade but never withdraw), and the switch turns on. Practice is always the default.

## How ranking works

Strategies are ranked by return on the money they said they would risk, adjusted for how often they stayed within their own limits. Only the owner's own results count, stopped trades lower a score, and losses are never softened.

## What's protected, and what isn't

| | |
| --- | --- |
| **Practice trading** | Every trade is checked before it happens. Nothing can bypass the limits. |
| **Real-money trading** | The limits are checked and recorded first, then you confirm each order. Because the order is sent from your own browser, the check is a safeguard, not a lock. Your private key never leaves your device. |
| **History** | Every decision is saved with a fingerprint that also covers the one before it, so changes or removals can be detected with one click. |
| **Limits** | Owners can make them stricter, never looser. |

Practice money has no cash value and can't be withdrawn. Practice fills happen at the market price with no fees or spread, so practice results are friendlier than real trading would be.

## Run it yourself

You'll need Node.js 22 or newer and a PostgreSQL database.

```bash
npm ci
cp .env.example .env.local   # then add your database address
npm run dev
```

Useful settings are listed in `.env.example`. To check everything works, run `npm run typecheck`, `npm test` and `npm run build`.

LimitLeague was built for the Strike Hackathon.
