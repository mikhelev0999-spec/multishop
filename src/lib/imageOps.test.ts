import { describe, expect, test } from "vitest";
import { alphaBounds, autoLevels, fitBox, sharpen } from "./imageOps";

/** w×h RGBA pixels from [r, g, b, a] tuples. */
const pixels = (list: number[][]) => new Uint8ClampedArray(list.flat());

describe("autoLevels", () => {
  test("stretches a dull range to full contrast", () => {
    const data = pixels([
      [100, 100, 100, 255],
      [150, 150, 150, 255],
      [200, 200, 200, 255],
    ]);
    autoLevels(data, 0);
    expect([...data.slice(0, 3)]).toEqual([0, 0, 0]);
    expect(data[4]).toBe(128);
    expect([...data.slice(8, 11)]).toEqual([255, 255, 255]);
  });

  test("ignores transparent pixels and leaves alpha alone", () => {
    const data = pixels([
      [0, 0, 0, 0],
      [100, 100, 100, 255],
      [200, 200, 200, 128],
    ]);
    autoLevels(data, 0);
    expect([...data.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect(data[4]).toBe(0);
    expect(data[8]).toBe(255);
    expect(data[11]).toBe(128);
  });

  test("a flat image stays as it is", () => {
    const data = pixels([
      [120, 120, 120, 255],
      [120, 120, 120, 255],
    ]);
    autoLevels(data, 0);
    expect(data[0]).toBe(120);
  });
});

describe("sharpen", () => {
  test("a flat area does not change", () => {
    const data = new Uint8ClampedArray(3 * 3 * 4).fill(100);
    expect([...sharpen(data, 3, 3, 0.5)]).toEqual([...data]);
  });

  test("a bright dot gets brighter and keeps alpha", () => {
    const data = new Uint8ClampedArray(3 * 3 * 4);
    for (let i = 0; i < 9; i++) data.set([100, 100, 100, 255], i * 4);
    data.set([160, 160, 160, 255], 4 * 4);
    const out = sharpen(data, 3, 3, 0.5);
    expect(out[4 * 4]).toBeGreaterThan(160);
    expect(out[4 * 4 + 3]).toBe(255);
  });
});

describe("alphaBounds", () => {
  test("finds the box of visible pixels", () => {
    // 4×3, visible pixels at (1,1) and (2,2)
    const data = new Uint8ClampedArray(4 * 3 * 4);
    data[(1 * 4 + 1) * 4 + 3] = 255;
    data[(2 * 4 + 2) * 4 + 3] = 200;
    expect(alphaBounds(data, 4, 3)).toEqual({ x: 1, y: 1, w: 2, h: 2 });
  });

  test("a fully transparent image has no box", () => {
    expect(alphaBounds(new Uint8ClampedArray(2 * 2 * 4), 2, 2)).toBeNull();
  });
});

describe("fitBox", () => {
  test("a tall object fills the height inside the padding, centred", () => {
    expect(fitBox(200, 400, 1000, 0.1)).toEqual({ x: 300, y: 100, w: 400, h: 800 });
  });

  test("a wide object fills the width", () => {
    expect(fitBox(800, 200, 1000, 0.1)).toEqual({ x: 100, y: 400, w: 800, h: 200 });
  });
});
