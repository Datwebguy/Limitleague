import test from "node:test";
import assert from "node:assert/strict";
import { evaluateExit, rangeSince, type PriceBands } from "../lib/exits";
import type { StrikeCandle } from "../lib/strike/client";

test("long: target hit, stop hit, neither, and both", () => {
  assert.deepEqual(evaluateExit("long", 110, 90, 111, 100), { kind: "Take profit", price: 110 });
  assert.deepEqual(evaluateExit("long", 110, 90, 105, 89), { kind: "Stop loss", price: 90 });
  assert.equal(evaluateExit("long", 110, 90, 105, 95), null);
  assert.equal(evaluateExit("long", 110, 90, 120, 80)?.kind, "Stop loss");
});

test("short: levels are mirrored", () => {
  assert.deepEqual(evaluateExit("short", 90, 110, 100, 89), { kind: "Take profit", price: 90 });
  assert.deepEqual(evaluateExit("short", 90, 110, 111, 100), { kind: "Stop loss", price: 110 });
  assert.equal(evaluateExit("short", 90, 110, 105, 95), null);
});

test("missing levels never trigger", () => {
  assert.equal(evaluateExit("long", null, null, 1e9, 0), null);
  assert.equal(evaluateExit("long", 110, null, 105, 0), null);
});

const candle = (timestamp: number, high: number, low: number): StrikeCandle => ({ timestamp, open: low, high, low, close: high, volume: 1 });

test("the candle containing the entry is ignored but later ones count", () => {
  const entry = Date.UTC(2026, 0, 1, 10, 0, 30);
  const bands: PriceBands = {
    minutes: [
      candle(Date.UTC(2026, 0, 1, 10, 0, 0), 500, 1), // contains the entry: pre-entry prices must not leak in
      candle(Date.UTC(2026, 0, 1, 10, 1, 0), 105, 99),
      candle(Date.UTC(2026, 0, 1, 10, 2, 0), 103, 97),
    ],
    hours: [],
  };
  assert.deepEqual(rangeSince(bands, entry, 100), { high: 105, low: 97 });
});

test("older history comes from hourly candles that the minute series does not cover", () => {
  const hour = 3_600_000;
  const start = Date.UTC(2026, 0, 1, 0, 0, 0);
  const bands: PriceBands = {
    minutes: [candle(start + 20 * hour, 100, 100)],
    hours: [candle(start + 1 * hour, 150, 100), candle(start + 5 * hour, 100, 60), candle(start + 20 * hour, 999, 0)],
  };
  // Entered 02:30: the 01:00 hour precedes it, the 05:00 hour counts, the 20:00 hour overlaps the minute series.
  assert.deepEqual(rangeSince(bands, start + 2.5 * hour, 100), { high: 100, low: 60 });
});

test("with no candles the current mark is the whole range", () => {
  assert.deepEqual(rangeSince({ minutes: [], hours: [] }, Date.now(), 42), { high: 42, low: 42 });
});
