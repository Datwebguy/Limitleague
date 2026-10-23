import { ensurePaperUser } from "@/lib/auth";
import { getPaperPortfolio } from "@/lib/platform";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await ensurePaperUser();
    return Response.json({ portfolio: await getPaperPortfolio(user.id) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Portfolio unavailable." },
      { status: 503 },
    );
  }
}
