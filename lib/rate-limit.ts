import { UserError } from "./errors";

type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();
let lastSweep = 0;

/**
 * Fixed-window limiter held in process memory. It is a per-instance brake against
 * accidental floods and scripted spam; durable limits (workspace creation) live in the database.
 */
export function rateLimit(bucket: string, key: string, limit: number, windowMs: number, now = Date.now()) {
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [id, window] of windows) if (window.resetAt <= now) windows.delete(id);
  }
  const id = `${bucket}:${key}`;
  const current = windows.get(id);
  if (!current || current.resetAt <= now) {
    windows.set(id, { count: 1, resetAt: now + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    throw new UserError("Too many requests. Please slow down and try again shortly.", 429, retryAfter);
  }
}

export function clientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "local";
}

export function resetRateLimitsForTests() {
  windows.clear();
  lastSweep = 0;
}
