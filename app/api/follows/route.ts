import { z } from "zod";
import { ensurePaperUser, requireSameOrigin } from "@/lib/auth";
import { errorResponse, UserError } from "@/lib/errors";
import { followStrategy, unfollowStrategy } from "@/lib/platform";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
const schema = z.object({ strategyId: z.string().uuid() });

async function parse(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new UserError("Invalid strategy.");
  return parsed.data;
}

export async function POST(request: Request) {
  try {
    await requireSameOrigin(request);
    const user = await ensurePaperUser();
    rateLimit("follow", user.id, 30, 60_000);
    await followStrategy(user.id, (await parse(request)).strategyId);
    return Response.json({ following: true });
  } catch (error) {
    return errorResponse(error, "Could not follow strategy.");
  }
}

export async function DELETE(request: Request) {
  try {
    await requireSameOrigin(request);
    const user = await ensurePaperUser();
    rateLimit("follow", user.id, 30, 60_000);
    await unfollowStrategy(user.id, (await parse(request)).strategyId);
    return Response.json({ following: false });
  } catch (error) {
    return errorResponse(error, "Could not unfollow strategy.");
  }
}
