import test from "node:test";
import assert from "node:assert/strict";
import { db, initializeDatabase, normalizeConnectionString, resetPoolForTests } from "../lib/db";

test("ssl modes that pg aliases to verify-full are made explicit", () => {
  assert.match(normalizeConnectionString("postgres://u:p@h/db?sslmode=require"), /sslmode=verify-full/);
  assert.match(normalizeConnectionString("postgres://u:p@h/db?sslmode=prefer"), /sslmode=verify-full/);
  assert.equal(normalizeConnectionString("postgres://u:p@h/db?sslmode=disable"), "postgres://u:p@h/db?sslmode=disable");
  const compat = "postgres://u:p@h/db?sslmode=require&uselibpqcompat=true";
  assert.equal(normalizeConnectionString(compat), compat);
  assert.equal(normalizeConnectionString("not a url"), "not a url");
});

test("a failed first start is not remembered", { skip: !process.env.DATABASE_URL }, async () => {
  const good = process.env.DATABASE_URL!;
  await resetPoolForTests();
  process.env.DATABASE_URL = "postgres://postgres@127.0.0.1:1/unreachable";
  await assert.rejects(() => initializeDatabase());
  await resetPoolForTests();
  process.env.DATABASE_URL = good;
  await initializeDatabase();
  await db().end();
});
