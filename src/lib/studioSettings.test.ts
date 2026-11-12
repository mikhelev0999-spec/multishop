import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "./studioSettings";

describe("parseSettings", () => {
  test("nothing saved gives the defaults", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("not json")).toEqual(DEFAULT_SETTINGS);
  });

  test("saved values are kept", () => {
    const saved = { ...DEFAULT_SETTINGS, background: "#111111", sharpness: 70, shadow: false };
    expect(parseSettings(JSON.stringify(saved))).toEqual(saved);
  });

  test("out-of-range or wrong values fall back per field", () => {
    const parsed = parseSettings(
      JSON.stringify({ background: "red; x", sharpness: 500, brightness: "a", contrast: -20, shadow: 1 }),
    );
    expect(parsed).toEqual({ ...DEFAULT_SETTINGS, sharpness: 100, contrast: -20 });
  });
});
