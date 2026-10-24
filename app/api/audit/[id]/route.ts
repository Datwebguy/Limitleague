import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";
import { getAuditEvent } from "@/lib/platform";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success)
      return Response.json({ error: "Audit record not found." }, { status: 404 });
    return Response.json({ event: await getAuditEvent(id, (await currentUser())?.id) });
  } catch (error) {
    return errorResponse(error, "Audit record unavailable.", 503);
  }
}
