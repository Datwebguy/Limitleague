import { timingSafeEqual } from "node:crypto";
import { errorResponse } from "@/lib/errors";
import { settleAllExits } from "@/lib/platform";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Scheduled sweep (see vercel.json) so take-profit and stop-loss exits settle even when nobody opens the app. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "Not configured." }, { status: 503 });
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  try {
    return Response.json(await settleAllExits());
  } catch (error) {
    return errorResponse(error, "Settlement sweep failed.", 500);
  }
}
