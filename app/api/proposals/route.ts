import { ensurePaperUser, requireSameOrigin } from "@/lib/auth";
import { proposeTrade } from "@/lib/platform";
import { z } from "zod";
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
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: parsed.error.flatten() }, { status: 400 });
    return Response.json(await proposeTrade(user.id, parsed.data), {
      status: 201,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Proposal failed." },
      { status: 400 },
    );
  }
}
