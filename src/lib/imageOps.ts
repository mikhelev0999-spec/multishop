// Pure pixel operations on RGBA arrays (as in ImageData.data). No canvas here, so they are testable.

/**
 * Per-channel contrast stretch: the darkest `clip` share of visible pixels becomes 0, the brightest
 * becomes 255. Transparent pixels are ignored; alpha is not touched. Works in place.
 */
export function autoLevels(data: Uint8ClampedArray, clip = 0.005): void {
  for (let c = 0; c < 3; c++) {
    const hist = new Array<number>(256).fill(0);
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      hist[data[i + c]]++;
      total++;
    }
    if (total === 0) return;
    const cut = Math.floor(total * clip);
    let lo = 0;
    for (let acc = 0; lo < 255 && acc + hist[lo] <= cut; lo++) acc += hist[lo];
    let hi = 255;
    for (let acc = 0; hi > 0 && acc + hist[hi] <= cut; hi--) acc += hist[hi];
    if (hi <= lo) continue;
    const range = hi - lo;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      data[i + c] = Math.round(((data[i + c] - lo) * 255) / range);
    }
  }
}

/** Unsharp mask with a 3×3 box blur. Returns a new array; alpha is copied as is. */
export function sharpen(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  amount = 0.3,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            sum += data[(yy * w + xx) * 4 + c];
            n++;
          }
        }
        const v = data[i + c];
        out[i + c] = Math.round(v + amount * (v - sum / n));
      }
    }
  }
  return out;
}

export interface Adjustments {
  /** −50…50 */
  brightness: number;
  /** −50…50; +50 = 1.5× contrast */
  contrast: number;
  /** −50…50; −50 = half way to grey, +50 = 1.5× colour */
  saturation: number;
}

/** Brightness, contrast and saturation in one pass; transparent pixels and alpha untouched. */
export function adjust(data: Uint8ClampedArray, a: Adjustments): void {
  if (a.brightness === 0 && a.contrast === 0 && a.saturation === 0) return;
  const shift = (a.brightness / 50) * 64;
  const contrast = 1 + a.contrast / 100;
  const saturation = 1 + a.saturation / 100;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    for (let c = 0; c < 3; c++) {
      let v = data[i + c];
      v = luma + (v - luma) * saturation;
      v = (v - 128) * contrast + 128;
      data[i + c] = Math.round(v + shift);
    }
  }
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bounding box of pixels with alpha above `threshold`, or null if there are none. */
export function alphaBounds(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  threshold = 10,
): Box | null {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Where to draw an object of objW×objH on a size×size canvas with `padding` share on each side. */
export function fitBox(objW: number, objH: number, size: number, padding: number): Box {
  const inner = size * (1 - 2 * padding);
  const scale = Math.min(inner / objW, inner / objH);
  const w = Math.round(objW * scale);
  const h = Math.round(objH * scale);
  return { x: Math.round((size - w) / 2), y: Math.round((size - h) / 2), w, h };
}
