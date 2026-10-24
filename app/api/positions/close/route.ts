import { z } from "zod";
import { ensurePaperUser, requireSameOrigin } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";
import { closePaperPosition } from "@/lib/platform";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
const schema = z.object({
  strategyId: z.string().uuid(),
  market: z.string().regex(/^[A-Z0-9]+-[A-Z0-9]+$/),
  side: z.enum(["long", "short"]),
});

export async function POST(request: Request) {
  try {
    await requireSameOrigin(request);
    const user = await ensurePaperUser();
    rateLimit("close", user.id, 30, 60_000);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Invalid position." }, { status: 400 });
    return Response.json(await closePaperPosition(user.id, parsed.data));
  } catch (error) {
    return errorResponse(error, "Position could not be closed.");
  }
}
