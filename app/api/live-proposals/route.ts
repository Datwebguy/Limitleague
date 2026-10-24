import { z } from "zod";
import { ensurePaperUser, requireSameOrigin } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";
import { checkLiveTrade } from "@/lib/platform";
import { rateLimit } from "@/lib/rate-limit";
import { verifyStrikeAccountAuth } from "@/lib/strike/client";

export const runtime = "nodejs";

const schema = z.object({
  strategyId: z.string().uuid(),
  market: z.string().regex(/^[A-Z0-9]+-[A-Z0-9]+$/),
  side: z.enum(["long", "short"]),
  notionalUsd: z.number().positive().finite(),
  reason: z.string().trim().min(1).max(500),
  strikeAccountId: z.string().uuid(),
  strikeAuth: z.object({
    publicKey: z.string().regex(/^[0-9a-f]{64}$/i),
    signature: z.string().regex(/^[0-9a-f]{128}$/i),
    timestamp: z.string().regex(/^\d{10}$/),
    nonce: z.string().uuid(),
  }),
});

export async function POST(request: Request) {
  try {
    await requireSameOrigin(request);
    const user = await ensurePaperUser();
    rateLimit("live-proposal", user.id, 20, 60_000);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
    const { strikeAuth, strikeAccountId, ...proposal } = parsed.data;
    const verified = await verifyStrikeAccountAuth(strikeAuth);
    if (verified.account_id !== strikeAccountId)
      return Response.json({ error: "The connected Strike account does not match this order." }, { status: 400 });
    return Response.json(await checkLiveTrade(user.id, proposal, verified.account_id), { status: 201 });
  } catch (error) {
    return errorResponse(error, "Live limit check failed.");
  }
}
