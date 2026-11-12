// Canvas pipeline: cut-out PNG → studio picture on a plain background. Runs in the browser only.
// Two steps so the preview can be redrawn on every slider move: prepareCutout() once per photo
// (decode, crop to the item), renderInto() per frame (correct, sharpen, place on the background).
import { adjust, alphaBounds, autoLevels, fitBox, sharpen } from "./imageOps";
import type { StudioSettings } from "./studioSettings";

export const OUTPUT_SIZE = 1600;
/** Live preview resolution: small enough to redraw at frame rate on a phone. */
export const PREVIEW_SIZE = 480;

/** The item's pixels, cropped to its visible area, at most `maxSide` on the long side. */
export interface Prepared {
  pixels: ImageData;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Браузер не поддерживает обработку изображений");
  return [c, ctx];
}

// iOS caps total canvas memory; release working canvases as soon as they are done.
const release = (...cs: HTMLCanvasElement[]) =>
  cs.forEach((c) => {
    c.width = 0;
    c.height = 0;
  });

export async function prepareCutout(cutout: Blob, maxSide: number): Promise<Prepared> {
  const bitmap = await createImageBitmap(cutout);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const [work, ctx] = canvas(w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  try {
    const box = alphaBounds(ctx.getImageData(0, 0, w, h).data, w, h);
    if (!box) throw new Error("Не нашёл вещь на фото — попробуйте другой снимок");
    return { pixels: ctx.getImageData(box.x, box.y, box.w, box.h) };
  } finally {
    release(work);
  }
}

/** Draws the prepared item onto `target` (resized to size×size) with the given settings. */
export function renderInto(
  target: HTMLCanvasElement,
  prepared: Prepared,
  settings: StudioSettings,
  size: number,
): void {
  const { width: w, height: h } = prepared.pixels;
  const data = new Uint8ClampedArray(prepared.pixels.data);
  if (settings.auto) autoLevels(data);
  adjust(data, settings);
  const amount = settings.sharpness / 100;
  const pixels = amount > 0 ? sharpen(data, w, h, amount) : data;
  const [item, itemCtx] = canvas(w, h);
  itemCtx.putImageData(new ImageData(new Uint8ClampedArray(pixels), w, h), 0, 0);

  if (target.width !== size) target.width = size;
  if (target.height !== size) target.height = size;
  const ctx = target.getContext("2d");
  if (!ctx) throw new Error("Браузер не поддерживает обработку изображений");
  ctx.save();
  ctx.fillStyle = settings.background;
  ctx.fillRect(0, 0, size, size);
  const place = fitBox(w, h, size, settings.padding / 100);
  if (settings.shadow) {
    // Shadow is specified for the full-size picture; scale it for the preview.
    const k = size / OUTPUT_SIZE;
    ctx.shadowColor = "rgba(0, 0, 0, 0.18)";
    ctx.shadowBlur = 30 * k;
    ctx.shadowOffsetY = 12 * k;
  }
  ctx.drawImage(item, place.x, place.y, place.w, place.h);
  ctx.restore();
  release(item);
}

/** The full-size studio JPEG. */
export async function composeOnBackground(cutout: Blob, settings: StudioSettings): Promise<Blob> {
  const prepared = await prepareCutout(cutout, OUTPUT_SIZE);
  const [out] = canvas(OUTPUT_SIZE, OUTPUT_SIZE);
  renderInto(out, prepared, settings, OUTPUT_SIZE);
  return new Promise((resolve, reject) =>
    out.toBlob(
      (b) => {
        release(out);
        if (b) resolve(b);
        else reject(new Error("Не удалось сохранить картинку"));
      },
      "image/jpeg",
      0.9,
    ),
  );
}
