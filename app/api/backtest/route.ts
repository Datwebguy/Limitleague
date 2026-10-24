import { z } from "zod";
import { requireSameOrigin } from "@/lib/auth";
import { runBacktest } from "@/lib/backtest";
import { errorResponse, UserError } from "@/lib/errors";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { getStrikeCandles, getStrikeMarket } from "@/lib/strike/client";

export const runtime = "nodejs";
const schema = z.object({
  market: z.string().regex(/^[A-Z0-9]+-[A-Z0-9]+$/),
  style: z.enum(["momentum", "mean_reversion", "breakout"]),
  days: z.number().int().min(1).max(30),
  notionalUsd: z.number().positive().finite(),
  takeProfitPct: z.number().min(0).max(100).nullable(),
  stopLossPct: z.number().min(0).max(100).nullable(),
  limits: z.object({
    maxPositionNotionalUsd: z.number().positive().finite(),
    dailyLossLimitUsd: z.number().positive().finite(),
    maxTotalExposureUsd: z.number().positive().finite(),
    maxOpenPositions: z.number().int().positive(),
    pauseAtDailyLoss: z.literal(true),
  }),
});

export async function POST(request: Request) {
  try {
    await requireSameOrigin(request);
    rateLimit("backtest", clientKey(request), 10, 60_000);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new UserError("Check the backtest settings.");
    const { market, style, days, notionalUsd, takeProfitPct, stopLossPct, limits } = parsed.data;
    if (!(await getStrikeMarket(market))) throw new UserError(`${market} is not a market currently trading on Strike.`);
    const candles = await getStrikeCandles(market, "1h", days * 24);
    const result = runBacktest(candles, { config: { market, style, takeProfitPct, stopLossPct }, limits, notionalUsd });
    return Response.json({ result });
  } catch (error) {
    return errorResponse(error, "Backtest unavailable.");
  }
}
