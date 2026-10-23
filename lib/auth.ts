import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { db, initializeDatabase } from "./db";

const cookieName = "limitleague_session";
async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  await db().query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
    [hash, userId],
  );
  (await cookies()).set(cookieName, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 2592000,
  });
}
export async function currentUser() {
  await initializeDatabase();
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const hash = createHash("sha256").update(token).digest("hex");
  const result = await db().query(
    "SELECT users.id FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=$1 AND expires_at>now()",
    [hash],
  );
  return (result.rows[0] as { id: string } | undefined) ?? null;
}
export async function ensurePaperUser() {
  await initializeDatabase();
  const existing = await currentUser();
  if (existing) return existing;
  const id = randomUUID();
  await db().query(
    "INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)",
    [id, `paper-${id}@limitleague.local`, "paper-session"],
  );
  await createSession(id);
  return { id };
}
export async function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = (await headers()).get("host");
  if (!origin || !host || new URL(origin).host !== host)
    throw new Error("Request origin is not allowed.");
}
