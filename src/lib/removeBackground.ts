// Seam to the in-browser background removal model (mocked in tests).
// The model (~40 MB) is downloaded from the imgly CDN on first use and cached by the browser.

export type Progress = (done: number, total: number) => void;

export async function removeBackground(image: Blob, onProgress?: Progress): Promise<Blob> {
  const { removeBackground: run } = await import("@imgly/background-removal");
  return run(image, {
    model: "isnet_quint8",
    output: { format: "image/png" },
    progress: (_key, current, total) => onProgress?.(current, total),
  });
}
