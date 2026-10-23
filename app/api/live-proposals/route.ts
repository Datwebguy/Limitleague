import { ensurePaperUser, requireSameOrigin } from "@/lib/auth";
import { checkLiveTrade } from "@/lib/platform";
import { verifyStrikeAccountAuth } from "@/lib/strike/client";
import { z } from "zod";

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
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
    const { strikeAuth, strikeAccountId, ...proposal } = parsed.data;
    const verified = await verifyStrikeAccountAuth(strikeAuth);
    if (verified.account_id !== strikeAccountId) throw new Error("The connected Strike account does not match this order.");
    return Response.json(await checkLiveTrade(user.id, proposal, verified.account_id), { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Live limit check failed." }, { status: 400 });
  }
}
