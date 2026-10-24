import test from "node:test";
import assert from "node:assert/strict";
import { errorResponse, UserError } from "../lib/errors";

test("expected errors keep their message and status", async () => {
  const response = errorResponse(new UserError("Strategy not found.", 404), "fallback");
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Strategy not found." });
});

test("rate limit errors carry Retry-After", () => {
  assert.equal(errorResponse(new UserError("slow down", 429, 12), "x").headers.get("Retry-After"), "12");
});

test("unexpected errors never leak internals", async () => {
  const original = console.error;
  console.error = () => undefined;
  try {
    const response = errorResponse(new Error('relation "audit_events" does not exist'), "Proposal failed.");
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Proposal failed." });
  } finally {
    console.error = original;
  }
});
