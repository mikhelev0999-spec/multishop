// Canvas pipeline: cut-out PNG → studio JPEG on a plain background. Runs in the browser only.
import { alphaBounds, autoLevels, fitBox, sharpen } from "./imageOps";

export const OUTPUT_SIZE = 1600;
const PADDING = 0.08;
const WORK_MAX = 1600;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Браузер не поддерживает обработку изображений");
  return [c, ctx];
}

/** Places the cut-out item on a square canvas with a plain background and a soft shadow. */
export async function composeOnBackground(cutout: Blob, background: string): Promise<Blob> {
  const bitmap = await createImageBitmap(cutout);
  const scale = Math.min(1, WORK_MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const [, workCtx] = canvas(w, h);
  workCtx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const full = workCtx.getImageData(0, 0, w, h);
  const box = alphaBounds(full.data, w, h);
  if (!box) throw new Error("Не нашёл вещь на фото — попробуйте другой снимок");

  const object = workCtx.getImageData(box.x, box.y, box.w, box.h);
  autoLevels(object.data);
  const [objCanvas, objCtx] = canvas(box.w, box.h);
  objCtx.putImageData(new ImageData(sharpen(object.data, box.w, box.h, 0.3), box.w, box.h), 0, 0);

  const [out, outCtx] = canvas(OUTPUT_SIZE, OUTPUT_SIZE);
  outCtx.fillStyle = background;
  outCtx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  const place = fitBox(box.w, box.h, OUTPUT_SIZE, PADDING);
  outCtx.shadowColor = "rgba(0, 0, 0, 0.18)";
  outCtx.shadowBlur = 30;
  outCtx.shadowOffsetY = 12;
  outCtx.drawImage(objCanvas, place.x, place.y, place.w, place.h);

  return new Promise((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error("Не удалось сохранить картинку"))), "image/jpeg", 0.9),
  );
}
