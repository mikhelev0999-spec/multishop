export interface PriceSummary {
  count: number;
  p25: number;
  median: number;
  p75: number;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Quartiles of comparable prices after dropping outliers beyond 1.5×IQR. */
export function summarize(prices: number[]): PriceSummary | null {
  const sorted = prices.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const kept = sorted.filter((p) => p >= q1 - 1.5 * iqr && p <= q3 + 1.5 * iqr);
  return {
    count: kept.length,
    p25: round2(quantile(kept, 0.25)),
    median: round2(quantile(kept, 0.5)),
    p75: round2(quantile(kept, 0.75)),
  };
}

export function usdToUah(usd: number, rate: number): number {
  const uah = usd * rate;
  return uah >= 500 ? Math.round(uah / 10) * 10 : Math.round(uah);
}

export type ParsedPrice = { uah: number } | { usd: number };

/** Owner's free-form price reply: "1500", "1 500 грн", "1,5к", "$40". */
export function parsePrice(text: string): ParsedPrice | null {
  let s = text.trim().toLowerCase();
  if (!s) return null;
  const usd = /\$|usd|дол/.test(s);
  s = s.replace(/\$|usd|долар\S*|доллар\S*|дол\.?|грн\.?|гривень|гривні|гривна|гривен|гривны|₴|uah/g, " ");
  const thousand = /(\d)\s*(к|k|тис\.?|тыс\.?)\s*$/.test(s);
  s = s.replace(/(к|k|тис\.?|тыс\.?)\s*$/, "").trim();
  s = s.replace(/(\d)\s+(?=\d{3}\b)/g, "$1").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  let value = Number(s);
  if (thousand) value *= 1000;
  if (!(value > 0)) return null;
  value = Math.round(value * 100) / 100;
  return usd ? { usd: value } : { uah: value };
}
