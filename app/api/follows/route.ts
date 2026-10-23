import { z } from "zod";
import { ensurePaperUser, requireSameOrigin } from "@/lib/auth";
import { followStrategy } from "@/lib/platform";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    await requireSameOrigin(request);
    const user = await ensurePaperUser();
    const parsed = z
      .object({ strategyId: z.string().uuid() })
      .safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: "Invalid strategy." }, { status: 400 });
    await followStrategy(user.id, parsed.data.strategyId);
    return Response.json({ following: true });
  } catch {
    return Response.json(
      { error: "Could not follow strategy." },
      { status: 400 },
    );
  }
}
