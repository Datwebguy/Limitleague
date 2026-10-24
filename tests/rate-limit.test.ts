import test from "node:test";
import assert from "node:assert/strict";
import { UserError } from "../lib/errors";
import { clientKey, rateLimit, resetRateLimitsForTests } from "../lib/rate-limit";

test("allows up to the limit, then answers 429 with a retry hint", () => {
  resetRateLimitsForTests();
  const now = 1_000_000;
  for (let i = 0; i < 3; i += 1) rateLimit("t", "a", 3, 60_000, now);
  assert.throws(
    () => rateLimit("t", "a", 3, 60_000, now + 1000),
    (error) => error instanceof UserError && error.status === 429 && (error.retryAfterSeconds ?? 0) > 0,
  );
});

test("keys and buckets are independent, and windows reset", () => {
  resetRateLimitsForTests();
  const now = 5_000_000;
  rateLimit("t", "a", 1, 1000, now);
  rateLimit("t", "b", 1, 1000, now);
  rateLimit("u", "a", 1, 1000, now);
  assert.throws(() => rateLimit("t", "a", 1, 1000, now + 10));
  rateLimit("t", "a", 1, 1000, now + 1001);
});

test("client key prefers the first forwarded address", () => {
  const request = new Request("http://x", { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } });
  assert.equal(clientKey(request), "203.0.113.9");
  assert.equal(clientKey(new Request("http://x")), "local");
});
