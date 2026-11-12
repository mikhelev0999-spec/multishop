// The studio page's only way to Convex (mocked in tests).
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export interface StudioPhoto {
  storageId: string;
  url: string;
}
export interface StudioItem {
  title: string;
  photos: StudioPhoto[];
  studio: StudioPhoto[];
}

let client: ConvexHttpClient | null = null;
function convex(): ConvexHttpClient {
  const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
  if (!url) throw new Error("VITE_CONVEX_URL is not set");
  client ??= new ConvexHttpClient(url);
  return client;
}

const asItemId = (id: string) => id as Id<"items">;

export function loadItem(initData: string, itemId: string): Promise<StudioItem> {
  return convex().action(api.studio.load, { initData, itemId: asItemId(itemId) });
}

/** Uploads processed photos and attaches them to the item; the bot then posts them to the chat. */
export async function saveProcessed(initData: string, itemId: string, photos: Blob[]): Promise<void> {
  const urls = await convex().action(api.studio.uploadUrls, {
    initData,
    itemId: asItemId(itemId),
    count: photos.length,
  });
  const storageIds: Id<"_storage">[] = [];
  for (const [i, photo] of photos.entries()) {
    const res = await fetch(urls[i], {
      method: "POST",
      headers: { "Content-Type": photo.type || "image/jpeg" },
      body: photo,
    });
    if (!res.ok) throw new Error(`Не удалось загрузить фото ${i + 1}`);
    const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
    storageIds.push(storageId);
  }
  await convex().action(api.studio.save, { initData, itemId: asItemId(itemId), storageIds });
}
