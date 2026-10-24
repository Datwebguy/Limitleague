import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import { verifyStrategyChain } from "@/lib/platform";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** Anyone can recompute a strategy owner's proof chain from the stored decisions. */
export async function GET(request: Request) {
  try {
    rateLimit("verify", clientKey(request), 30, 60_000);
    const strategyId = z.string().uuid().safeParse(new URL(request.url).searchParams.get("strategyId"));
    if (!strategyId.success) return Response.json({ error: "Provide a strategyId." }, { status: 400 });
    return Response.json({ verification: await verifyStrategyChain(strategyId.data) });
  } catch (error) {
    return errorResponse(error, "Verification is unavailable.", 503);
  }
}
