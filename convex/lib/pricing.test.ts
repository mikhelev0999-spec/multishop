import { describe, expect, test } from "vitest";
import { parsePrice, summarize, usdToUah } from "./pricing";

describe("summarize", () => {
  test("empty list", () => {
    expect(summarize([])).toEqual({ count: 0 });
  });

  test("quartiles and median of a clean list", () => {
    expect(summarize([10, 20, 30, 40, 50])).toEqual({ count: 5, p25: 20, median: 30, p75: 40 });
  });

  test("drops outliers beyond 1.5 IQR", () => {
    const s = summarize([100, 105, 110, 115, 120, 5, 900]);
    expect(s).toMatchObject({ count: 5, median: 110 });
  });
});

describe("usdToUah", () => {
  test("rounds to 10 UAH at 500 and above", () => {
    expect(usdToUah(100, 41.37)).toBe(4140);
  });
  test("rounds to 1 UAH below 500", () => {
    expect(usdToUah(5, 41.37)).toBe(207);
  });
});

describe("parsePrice", () => {
  test.each([
    ["1500", { uah: 1500 }],
    ["1 500 грн", { uah: 1500 }],
    ["1500₴", { uah: 1500 }],
    ["1500 гривень", { uah: 1500 }],
    ["1,5к", { uah: 1500 }],
    ["2.5 тис", { uah: 2500 }],
    ["$40", { usd: 40 }],
    ["40$", { usd: 40 }],
    ["40 usd", { usd: 40 }],
  ])("%s", (text, expected) => {
    expect(parsePrice(text)).toEqual(expected);
  });

  test.each(["", "дорого", "0", "-100", "12 34 56 abc"])("rejects %j", (text) => {
    expect(parsePrice(text)).toBeNull();
  });
});
