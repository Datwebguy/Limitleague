export function money(value: number, digits = 0) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

/** Prices keep more decimals when the number is small so cheap tokens do not all read as $0.00. */
export function price(value: number) {
  const digits = value >= 1000 ? 2 : value >= 1 ? 2 : value >= 0.01 ? 4 : 6;
  return money(value, digits);
}

export function signedMoney(value: number, digits = 2) {
  const flat = Math.abs(value) < 0.5 * 10 ** -digits;
  return `${flat || value >= 0 ? "+" : "−"}${money(flat ? 0 : Math.abs(value), digits)}`;
}

export function percent(value: number | null, digits = 1) {
  return value === null ? "—" : `${Math.round(value * 10 ** digits) / 10 ** digits}%`;
}

export function signedPercent(value: number | null, digits = 2) {
  if (value === null) return "—";
  const flat = Math.abs(value) < 0.5 * 10 ** -digits;
  return `${flat || value >= 0 ? "+" : "−"}${Math.abs(flat ? 0 : value).toFixed(digits)}%`;
}

export function tone(value: number | null) {
  if (value === null || Math.abs(value) < 0.005) return "flat";
  return value > 0 ? "up" : "down";
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
export function timeAgo(value: string | Date, now = Date.now()) {
  const seconds = Math.round((new Date(value).getTime() - now) / 1000);
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, size] of steps) if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  return "just now";
}

export function fullDate(value: string | Date) {
  return new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function plural(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

export function baseOf(symbol: string) {
  return symbol.replace(/-USD$/, "");
}
