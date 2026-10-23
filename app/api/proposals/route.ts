import { proposeTrade } from "@/lib/strategy-store";
import { z } from "zod";

const proposalSchema = z.object({
  strategyId: z.string().min(1),
  market: z.string().regex(/^[A-Z0-9]+-[A-Z0-9]+$/),
  side: z.enum(["long", "short"]),
  notionalUsd: z.number().positive(),
  reason: z.string().min(1).max(500)
});

export async function POST(request: Request) {
  const parsed = proposalSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  try {
    // This records an audit decision only. It does not place an order.
    return Response.json(proposeTrade(parsed.data), { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 404 });
  }
}
