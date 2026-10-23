import { listAuditEntries } from "@/lib/strategy-store";

export async function GET() {
  return Response.json({ audit: listAuditEntries() });
}
