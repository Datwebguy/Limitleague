import { getAuditEvent } from "@/lib/platform";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json({ event: await getAuditEvent(id) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Audit record unavailable." },
      { status: 404 },
    );
  }
}
