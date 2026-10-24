import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import { listAudit } from "@/lib/platform";

export const runtime = "nodejs";
const query = z.object({
  strategyId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/).optional(),
});

export async function GET(request: Request) {
  try {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = query.safeParse(params);
    if (!parsed.success) return Response.json({ error: "Check the audit filters." }, { status: 400 });
    return Response.json(await listAudit(parsed.data));
  } catch (error) {
    return errorResponse(error, "Audit data is unavailable.", 503);
  }
}
