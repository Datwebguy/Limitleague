import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, computeEventHash, verifyChain, type ChainRow, type ProofFields } from "../lib/proof";

const fields = (n: number): ProofFields => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  strategyId: "s",
  userId: "u",
  kind: "proposal",
  mode: "paper",
  market: "BTC-USD",
  side: "long",
  notionalUsd: 100 * n,
  price: 80_000.5,
  reason: `signal ${n}`,
  allowed: true,
  reasons: [],
  limits: { b: 2, a: 1 },
  portfolio: { openPositions: [], dailyPnlUsd: 0 },
  decision: { allowed: true },
  createdAt: `2026-10-24T10:00:0${n}.000Z`,
});

function chain(length: number): ChainRow[] {
  const rows: ChainRow[] = [];
  let previous: string | null = null;
  for (let n = 1; n <= length; n += 1) {
    const f = fields(n);
    const eventHash = computeEventHash(f, previous);
    rows.push({ fields: f, previousHash: previous, eventHash });
    previous = eventHash;
  }
  return rows;
}

test("canonical JSON ignores key order and drops undefined", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: undefined }] } }), canonicalJson({ a: { c: [3, { z: 1 }], d: 2 }, b: 1 }));
});

test("an intact chain verifies and reports its head", () => {
  const rows = chain(4);
  const result = verifyChain(rows);
  assert.equal(result.valid, true);
  assert.equal(result.checked, 4);
  assert.equal(result.headHash, rows[3].eventHash);
});

test("editing any stored field is detected", () => {
  const rows = chain(3);
  rows[1] = { ...rows[1], fields: { ...rows[1].fields, notionalUsd: 1 } };
  const result = verifyChain(rows);
  assert.equal(result.valid, false);
  assert.equal(result.brokenAt, rows[1].fields.id);
});

test("removing an event from the middle breaks the chain", () => {
  const rows = chain(4);
  rows.splice(1, 1);
  const result = verifyChain(rows);
  assert.equal(result.valid, false);
  assert.match(result.problem ?? "", /previous/);
});

test("reordering events breaks the chain", () => {
  const rows = chain(3);
  [rows[0], rows[1]] = [rows[1], rows[0]];
  assert.equal(verifyChain(rows).valid, false);
});

test("an empty chain is valid with no head", () => {
  assert.deepEqual(verifyChain([]), { valid: true, checked: 0, headHash: null, brokenAt: null, problem: null });
});
