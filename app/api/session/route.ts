import { ensurePaperUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json({ user: await ensurePaperUser(), mode: "paper" });
  } catch {
    return Response.json(
      { error: "Paper workspace is unavailable." },
      { status: 503 },
    );
  }
}
