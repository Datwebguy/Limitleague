import { listAudit } from "@/lib/platform";
export const runtime = "nodejs";
export async function GET() {
  try { return Response.json({ audit: await listAudit() }); }
  catch { return Response.json({ error: "Audit data is unavailable." }, { status: 503 }); }
}
