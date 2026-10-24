import { db, initializeDatabase } from "@/lib/db";
import { requireSameOrigin } from "@/lib/auth";

export const runtime = "nodejs";

// One-time cleanup for QA records created while validating the public deployment.
const token = "limitleague-qa-cleanup-20261024";

export async function POST(request: Request) {
  if (request.headers.get("x-limitleague-cleanup") !== token)
    return Response.json({ error: "Not found." }, { status: 404 });
  try {
    await requireSameOrigin(request);
    await initializeDatabase();
    const client = await db().connect();
    try {
      await client.query("BEGIN");
      const targets = await client.query(
        `SELECT id FROM strategies WHERE name LIKE 'Paper Test %' OR name LIKE 'Production Verify %'`,
      );
      const ids = targets.rows.map((row) => row.id as string);
      if (ids.length) {
        await client.query("DELETE FROM audit_events WHERE strategy_id = ANY($1::uuid[])", [ids]);
        await client.query("DELETE FROM strategy_events WHERE strategy_id = ANY($1::uuid[])", [ids]);
        await client.query("DELETE FROM follows WHERE strategy_id = ANY($1::uuid[])", [ids]);
        await client.query("DELETE FROM paper_positions WHERE strategy_id = ANY($1::uuid[])", [ids]);
        await client.query("DELETE FROM paper_ledger WHERE reference_id = ANY($1::uuid[])", [ids]);
        await client.query("DELETE FROM strategies WHERE id = ANY($1::uuid[])", [ids]);
      }
      await client.query("COMMIT");
      return Response.json({ deleted: ids.length });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch {
    return Response.json({ error: "Cleanup failed." }, { status: 500 });
  }
}
