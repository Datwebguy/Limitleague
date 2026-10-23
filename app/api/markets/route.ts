import { getStrikeMarkets } from "@/lib/strike/client";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json({ markets: await getStrikeMarkets() });
  } catch {
    return Response.json({ error: "Strike markets are unavailable." }, { status: 503 });
  }
}
