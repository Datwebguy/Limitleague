import { ensurePaperUser } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    rateLimit("session", clientKey(request), 60, 60_000);
    return Response.json({ user: await ensurePaperUser(), mode: "paper" });
  } catch (error) {
    return errorResponse(error, "Paper workspace is unavailable.", 503);
  }
}
