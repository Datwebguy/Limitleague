import { z } from "zod";
import { createSession, requireSameOrigin, verifyPassword } from "@/lib/auth";
import { db, initializeDatabase } from "@/lib/db";
export const runtime = "nodejs";
const schema=z.object({email:z.string().email(),password:z.string()});
export async function POST(request:Request) {
  try {
    await requireSameOrigin(request);
    const parsed=schema.safeParse(await request.json());
    if(!parsed.success) return Response.json({error:"Invalid email or password."},{status:401});
    await initializeDatabase();
    const result=await db().query("SELECT id,email,password_hash FROM users WHERE email=$1",[parsed.data.email.toLowerCase()]);
    const user=result.rows[0];
    if(!user || !verifyPassword(parsed.data.password,user.password_hash)) return Response.json({error:"Invalid email or password."},{status:401});
    await createSession(user.id);
    return Response.json({id:user.id,email:user.email});
  } catch { return Response.json({error:"Could not sign in."},{status:503}); }
}
