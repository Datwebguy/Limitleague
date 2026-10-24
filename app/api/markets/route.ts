import { errorResponse } from "@/lib/errors";
import { getStrikeMarkets } from "@/lib/strike/client";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json({ markets: await getStrikeMarkets() });
  } catch (error) {
    return errorResponse(error, "Strike markets are unavailable.", 503);
  }
}
