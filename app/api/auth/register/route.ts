import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createSession, hashPassword, requireSameOrigin } from "@/lib/auth";
import { db, initializeDatabase } from "@/lib/db";
export const runtime = "nodejs";
const schema=z.object({email:z.string().email().max(254),password:z.string().min(12).max(128)});
export async function POST(request:Request) {
  try {
    await requireSameOrigin(request);
    const parsed=schema.safeParse(await request.json());
    if(!parsed.success) return Response.json({error:"Enter a valid email and a password of at least 12 characters."},{status:400});
    await initializeDatabase();
    const id=randomUUID();
    await db().query("INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)",[id,parsed.data.email.toLowerCase(),hashPassword(parsed.data.password)]);
    await createSession(id);
    return Response.json({id,email:parsed.data.email.toLowerCase()},{status:201});
  } catch { return Response.json({error:"Could not create account. The email may already be registered."},{status:400}); }
}
