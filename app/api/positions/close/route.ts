import { ensurePaperUser, requireSameOrigin } from "@/lib/auth";
import { closePaperPosition } from "@/lib/platform";
import { z } from "zod";

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
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Invalid position." }, { status: 400 });
    return Response.json(await closePaperPosition(user.id, parsed.data));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Position could not be closed." },
      { status: 400 },
    );
  }
}
