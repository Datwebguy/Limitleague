import { createHash } from "node:crypto";

/** Everything a decision proof commits to. The hash covers these fields and the previous event's hash. */
export type ProofFields = {
  id: string;
  strategyId: string;
  userId: string;
  kind: string;
  mode: string;
  market: string;
  side: string;
  notionalUsd: number;
  price: number | null;
  reason: string;
  allowed: boolean;
  reasons: string[];
  limits: unknown;
  portfolio: unknown;
  decision: unknown;
  createdAt: string;
};

export const PROOF_VERSION = 2;

/** JSON with recursively sorted keys so the same data always produces the same bytes. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

export function computeEventHash(fields: ProofFields, previousHash: string | null) {
  return createHash("sha256")
    .update(canonicalJson({ version: PROOF_VERSION, previousHash, ...fields }))
    .digest("hex");
}

export type ChainRow = { fields: ProofFields; previousHash: string | null; eventHash: string };

export type ChainVerification = {
  valid: boolean;
  checked: number;
  headHash: string | null;
  brokenAt: string | null;
  problem: string | null;
};

/** Recomputes every hash and checks each event points at the one before it. Rows must be in chain order. */
export function verifyChain(rows: ChainRow[]): ChainVerification {
  let expectedPrevious: string | null = null;
  for (const row of rows) {
    if (row.previousHash !== expectedPrevious)
      return { valid: false, checked: rows.indexOf(row), headHash: expectedPrevious, brokenAt: row.fields.id, problem: "Chain link does not match the previous event." };
    if (computeEventHash(row.fields, row.previousHash) !== row.eventHash)
      return { valid: false, checked: rows.indexOf(row), headHash: expectedPrevious, brokenAt: row.fields.id, problem: "Event contents no longer match their proof hash." };
    expectedPrevious = row.eventHash;
  }
  return { valid: true, checked: rows.length, headHash: expectedPrevious, brokenAt: null, problem: null };
}
