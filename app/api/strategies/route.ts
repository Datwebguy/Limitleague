import { z } from "zod";
import { currentUser, ensurePaperUser, requireSameOrigin } from "@/lib/auth";
import { createStrategy, listStrategies, updateStrategy } from "@/lib/platform";
export const runtime = "nodejs";
const schema = z.object({
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().max(1000).default(""),
  limits: z.object({
    maxPositionNotionalUsd: z.number().positive().finite(),
    dailyLossLimitUsd: z.number().positive().finite(),
    maxTotalExposureUsd: z.number().positive().finite(),
    maxOpenPositions: z.number().int().min(1).max(100),
    pauseAtDailyLoss: z.literal(true),
  }),
  config: z.object({
    market: z.string().regex(/^[A-Z0-9-]+$/),
    style: z.enum(["momentum", "mean_reversion", "breakout"]),
    takeProfitPct: z.number().min(0).max(100).nullable(),
    stopLossPct: z.number().min(0).max(100).nullable(),
  }).default({ market: "BTC-USD", style: "momentum", takeProfitPct: null, stopLossPct: null }),
});
const updateSchema = z
  .object({
    strategyId: z.string().uuid(),
    paused: z.boolean().optional(),
    limits: schema.shape.limits.optional(),
  })
  .refine((data) => data.paused !== undefined || data.limits !== undefined);
export async function GET() {
  try {
    return Response.json({
      strategies: await listStrategies((await currentUser())?.id),
    });
  } catch {
    return Response.json(
      { error: "Database is unavailable." },
      { status: 503 },
    );
  }
}
export async function POST(request: Request) {
  try {
    await requireSameOrigin(request);
    const user = await ensurePaperUser();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: parsed.error.flatten() }, { status: 400 });
    const strategy = await createStrategy(
      user.id,
      parsed.data.name,
      parsed.data.description,
      parsed.data.limits,
      parsed.data.config,
    );
    return Response.json({ strategy }, { status: 201 });
  } catch {
    return Response.json(
      { error: "Could not publish strategy." },
      { status: 500 },
    );
  }
}
export async function PATCH(request: Request) {
  try {
    await requireSameOrigin(request);
    const user = await ensurePaperUser();
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success)
      return Response.json(
        { error: "Check the strategy changes." },
        { status: 400 },
      );
    return Response.json({
      strategy: await updateStrategy(
        user.id,
        parsed.data.strategyId,
        parsed.data,
      ),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Could not edit strategy.",
      },
      { status: 400 },
    );
  }
}
