import { timingSafeEqual } from "node:crypto";
import { errorResponse } from "@/lib/errors";
import { claimJob, settleAllExits } from "@/lib/platform";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Daily sweep (see vercel.json) so stop-loss and take-profit exits settle even when nobody opens the app.
 * It only closes trades that already reached their own levels, so anyone may trigger it; it is throttled to
 * once every ten minutes. If CRON_SECRET is set, a request that presents it skips the throttle.
 */
export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    const given = Buffer.from(request.headers.get("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${secret ?? ""}`);
    const trusted = !!secret && given.length === expected.length && timingSafeEqual(given, expected);
    if (!trusted && !(await claimJob("settle-exits", 10))) return Response.json({ skipped: "Ran recently." });
    return Response.json(await settleAllExits());
  } catch (error) {
    return errorResponse(error, "Settlement sweep failed.", 500);
  }
}
