import { describe, expect, test } from "vitest";
import { estimateMs, formatLeft, progressBar, progressText } from "./progress";

describe("progressBar", () => {
  test.each([
    [0, "░░░░░░░░░░"],
    [0.4, "▓▓▓▓░░░░░░"],
    [1, "▓▓▓▓▓▓▓▓▓▓"],
    [7, "▓▓▓▓▓▓▓▓▓▓"],
  ])("%d", (share, bar) => expect(progressBar(share)).toBe(bar));
});

describe("formatLeft", () => {
  test.each([
    [4_000, "≈ 5 с"],
    [42_000, "≈ 45 с"],
    [65_000, "≈ 1 мин"],
    [150_000, "≈ 3 мин"],
  ])("%d ms → %s", (ms, text) => expect(formatLeft(ms)).toBe(text));
});

describe("estimateMs", () => {
  test("the median of recent durations", () => {
    expect(estimateMs([30_000, 90_000, 60_000], 100_000)).toBe(60_000);
  });
  test("falls back without history and ignores nonsense", () => {
    expect(estimateMs([], 90_000)).toBe(90_000);
    expect(estimateMs([-5, 0, 3 * 60 * 60 * 1000], 90_000)).toBe(90_000);
  });
});

describe("progressText", () => {
  test("shows the bar, percent and time left", () => {
    expect(progressText({ photos: 2, elapsedMs: 24_000, etaMs: 60_000 })).toBe(
      "⏳ Разбираю фото (2)…\n▓▓▓▓░░░░░░ 40%\nОсталось ≈ 40 с",
    );
  });
  test("never claims 100% while still waiting", () => {
    const text = progressText({ photos: 1, elapsedMs: 200_000, etaMs: 60_000 });
    expect(text).toContain("95%");
    expect(text).toContain("Почти готово");
  });
});
