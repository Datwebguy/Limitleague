import { ensurePaperUser } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";
import { getPaperPortfolio } from "@/lib/platform";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await ensurePaperUser();
    rateLimit("portfolio", user.id, 60, 60_000);
    return Response.json({ portfolio: await getPaperPortfolio(user.id) });
  } catch (error) {
    return errorResponse(error, "Portfolio unavailable.", 503);
  }
}
