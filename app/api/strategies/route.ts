import { listStrategies } from "@/lib/strategy-store";

export async function GET() {
  return Response.json({ strategies: listStrategies() });
}
