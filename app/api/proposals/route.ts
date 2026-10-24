import { z } from "zod";
import { ensurePaperUser, requireSameOrigin } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";
import { proposeTrade } from "@/lib/platform";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
const schema = z.object({
  strategyId: z.string().uuid(),
  market: z.string().regex(/^[A-Z0-9]+-[A-Z0-9]+$/),
  side: z.enum(["long", "short"]),
  notionalUsd: z.number().positive().finite(),
  reason: z.string().trim().min(1).max(500),
});

export async function POST(request: Request) {
  try {
    await requireSameOrigin(request);
    const user = await ensurePaperUser();
    rateLimit("proposal", user.id, 30, 60_000);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
    return Response.json(await proposeTrade(user.id, parsed.data), { status: 201 });
  } catch (error) {
    return errorResponse(error, "Proposal failed.");
  }
}
