import { z } from "zod";
import { ensurePaperUser, requireSameOrigin } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";
import { recordLiveExecution } from "@/lib/platform";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const schema = z.object({
  auditId: z.string().uuid(),
  accepted: z.boolean(),
  strikeResponse: z.unknown(),
});

export async function POST(request: Request) {
  try {
    await requireSameOrigin(request);
    const user = await ensurePaperUser();
    rateLimit("live-result", user.id, 20, 60_000);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
    return Response.json(await recordLiveExecution(user.id, parsed.data.auditId, parsed.data.accepted, parsed.data.strikeResponse));
  } catch (error) {
    return errorResponse(error, "Could not record Strike execution.");
  }
}
