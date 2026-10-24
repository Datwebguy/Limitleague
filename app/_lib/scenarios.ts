import type { StrikeCandle } from "./types-candle";

export type ScenarioId = "crash" | "rally" | "chop" | "whipsaw";

export const SCENARIOS: Record<ScenarioId, { name: string; blurb: string }> = {
  crash: { name: "Sudden crash", blurb: "The price drops about 12% within hours, then recovers a little." },
  rally: { name: "Steady rally", blurb: "The price climbs about 9% over two days with no big setbacks." },
  chop: { name: "Choppy sideways", blurb: "The price swings up and down without going anywhere." },
  whipsaw: { name: "Whipsaw", blurb: "A quick jump up, a sharp fall, then a rebound that catches everyone out." },
};

const HOUR = 3_600_000;
const DAY = 86_400_000;
export const WARMUP_HOURS = 24;
export const SCENARIO_HOURS = 48;

/** Repeatable pseudo-random numbers, so a scenario looks the same every time it is run. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How far the price has moved from the start by hour `t` of the scenario, as a fraction. */
function drift(id: ScenarioId, t: number) {
  const ramp = (from: number, to: number, a: number, b: number) => (t <= a ? from : t >= b ? to : from + ((to - from) * (t - a)) / (b - a));
  switch (id) {
    case "crash": return t < 12 ? ramp(0, 0.004, 0, 12) : t < 18 ? ramp(0.004, -0.12, 12, 18) : ramp(-0.12, -0.09, 18, 30);
    case "rally": return ramp(0, 0.09, 0, SCENARIO_HOURS);
    case "chop": return 0.015 * Math.sin((t / 8) * Math.PI * 2);
    case "whipsaw": return t < 10 ? ramp(0, 0.04, 0, 10) : t < 22 ? ramp(0.04, -0.06, 10, 22) : ramp(-0.06, 0.03, 22, 34);
  }
}

/** Hourly candles for a made-up price path that starts from a real price. The first day is a quiet warm-up. */
export function buildScenario(id: ScenarioId, startPrice: number, now = Date.now()): StrikeCandle[] {
  const random = seeded(7919 + id.length * 31);
  const midnight = Math.floor(now / DAY) * DAY;
  const candles: StrikeCandle[] = [];
  let previous = startPrice;
  for (let hour = 0; hour < WARMUP_HOURS + SCENARIO_HOURS; hour += 1) {
    const level = hour < WARMUP_HOURS ? 0 : drift(id, hour - WARMUP_HOURS);
    const close = startPrice * (1 + level) * (1 + (random() - 0.5) * 0.005);
    const high = Math.max(previous, close) * (1 + random() * 0.002);
    const low = Math.min(previous, close) * (1 - random() * 0.002);
    candles.push({ timestamp: midnight + hour * HOUR, open: previous, high, low, close, volume: 0 });
    previous = close;
  }
  return candles;
}
