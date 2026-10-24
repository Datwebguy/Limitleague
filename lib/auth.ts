import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { db, initializeDatabase } from "./db";
import { UserError } from "./errors";

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
/** A salted hash of the caller's network address, used only to cap how many workspaces one network can create. */
async function networkHash() {
  try {
    const list = await headers();
    const address = list.get("x-forwarded-for")?.split(",")[0]?.trim() || list.get("x-real-ip") || "local";
    return createHash("sha256").update(`limitleague-network:${address}`).digest("hex");
  } catch {
    return null;
  }
}

export async function assertWorkspaceBudget(ipHash: string | null) {
  if (!ipHash) return;
  const limit = Number(process.env.PAPER_WORKSPACES_PER_NETWORK_PER_HOUR ?? "30");
  const recent = await db().query(
    "SELECT count(*)::int AS n FROM users WHERE ip_hash=$1 AND created_at > now() - interval '1 hour'",
    [ipHash],
  );
  if (recent.rows[0].n >= limit)
    throw new UserError("Too many new workspaces were created from this network. Please try again later.", 429, 3600);
}

export async function ensurePaperUser() {
  await initializeDatabase();
  const existing = await currentUser();
  if (existing) {
    await ensurePaperAccount(existing.id);
    return existing;
  }
  const ipHash = await networkHash();
  await assertWorkspaceBudget(ipHash);
  const id = randomUUID();
  await db().query(
    "INSERT INTO users(id,email,password_hash,ip_hash) VALUES($1,$2,$3,$4)",
    [id, `paper-${id}@limitleague.local`, "paper-session", ipHash],
  );
  await ensurePaperAccount(id);
  await createSession(id);
  return { id };
}
export async function ensurePaperAccount(userId: string) {
  await initializeDatabase();
  const allocation = Number(process.env.PAPER_STARTING_BALANCE_USD ?? "10000");
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO paper_accounts(user_id,starting_balance,cash_balance)
       VALUES($1,$2,$2) ON CONFLICT DO NOTHING RETURNING user_id`,
      [userId, allocation],
    );
    if (inserted.rowCount) {
      await client.query(
        `INSERT INTO paper_ledger(id,user_id,event_type,amount,balance_after,description)
         VALUES($1,$2,'allocation',$3,$3,'Practice money added to your account')`,
        [randomUUID(), userId, allocation],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = (await headers()).get("host");
  let originHost: string | null = null;
  try {
    originHost = origin ? new URL(origin).host : null;
  } catch {
    originHost = null;
  }
  if (!originHost || !host || originHost !== host) throw new UserError("Request origin is not allowed.", 403);
}
