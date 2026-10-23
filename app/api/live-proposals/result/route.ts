import { ensurePaperUser, requireSameOrigin } from "@/lib/auth";
import { recordLiveExecution } from "@/lib/platform";
import { z } from "zod";

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
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
    return Response.json(await recordLiveExecution(user.id, parsed.data.auditId, parsed.data.accepted, parsed.data.strikeResponse));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not record Strike execution." }, { status: 400 });
  }
}
