/** An error whose message is safe to show to the person who triggered it. */
export class UserError extends Error {
  readonly status: number;
  readonly retryAfterSeconds?: number;
  constructor(message: string, status = 400, retryAfterSeconds?: number) {
    super(message);
    this.name = "UserError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Expected errors keep their message; anything else is logged and replaced so internals never leak. */
export function errorResponse(error: unknown, fallback: string, fallbackStatus = 400) {
  if (error instanceof UserError) {
    const headers: Record<string, string> = {};
    if (error.retryAfterSeconds) headers["Retry-After"] = String(error.retryAfterSeconds);
    return Response.json({ error: error.message }, { status: error.status, headers });
  }
  console.error(fallback, error);
  return Response.json({ error: fallback }, { status: fallbackStatus >= 500 ? fallbackStatus : 500 });
}
