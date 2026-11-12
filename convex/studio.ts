// Photo studio Mini App backend. Every function checks Telegram's signed initData first.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { MAX_LISTING_PHOTOS } from "./lib/draftMessage";
import { verifyInitData } from "./lib/webAppAuth";

const MAX_PHOTO_BYTES = 5_000_000;

async function requireOwner(initData: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const owner = Number(process.env.OWNER_TELEGRAM_ID);
  if (!token || !owner) throw new Error("Бот не настроен");
  const { userId } = await verifyInitData(initData, token, Math.floor(Date.now() / 1000));
  if (userId !== owner) throw new Error("Студия доступна только владельцу бота");
}

async function draftItem(ctx: ActionCtx, itemId: Id<"items">): Promise<Doc<"items">> {
  const item: Doc<"items"> | null = await ctx.runQuery(internal.studio.item, { itemId });
  if (!item || item.status !== "draft") throw new Error("Обработать можно только черновик");
  return item;
}

export const item = internalQuery({
  args: { itemId: v.id("items") },
  returns: v.union(v.any(), v.null()),
  handler: (ctx, { itemId }) => ctx.db.get(itemId),
});

const photoValidator = v.object({ storageId: v.id("_storage"), url: v.string() });

export const load = action({
  args: { initData: v.string(), itemId: v.id("items") },
  returns: v.object({ title: v.string(), photos: v.array(photoValidator), studio: v.array(photoValidator) }),
  handler: async (ctx, { initData, itemId }) => {
    await requireOwner(initData);
    const it = await draftItem(ctx, itemId);
    const withUrls = async (ids: Id<"_storage">[]) => {
      const out = [];
      for (const storageId of ids) {
        const url = await ctx.storage.getUrl(storageId);
        if (url) out.push({ storageId, url });
      }
      return out;
    };
    return {
      title: it.draft?.titleUk ?? "",
      photos: await withUrls(it.photoIds),
      studio: await withUrls(it.studioPhotoIds ?? []),
    };
  },
});

export const uploadUrls = action({
  args: { initData: v.string(), itemId: v.id("items"), count: v.number() },
  returns: v.array(v.string()),
  handler: async (ctx, { initData, itemId, count }) => {
    await requireOwner(initData);
    await draftItem(ctx, itemId);
    if (!Number.isInteger(count) || count < 1 || count > MAX_LISTING_PHOTOS) {
      throw new Error(`Можно загрузить от 1 до ${MAX_LISTING_PHOTOS} фото`);
    }
    const urls: string[] = [];
    for (let i = 0; i < count; i++) urls.push(await ctx.storage.generateUploadUrl());
    return urls;
  },
});

/** JPEG, PNG or WebP by the file's first bytes — the upload's Content-Type is not trusted. */
export function looksLikeImage(head: Uint8Array): boolean {
  const at = (i: number, ...bytes: number[]) => bytes.every((b, k) => head[i + k] === b);
  return (
    at(0, 0xff, 0xd8, 0xff) ||
    at(0, 0x89, 0x50, 0x4e, 0x47) ||
    (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50))
  );
}

export const save = action({
  args: { initData: v.string(), itemId: v.id("items"), storageIds: v.array(v.id("_storage")) },
  returns: v.null(),
  handler: async (ctx, { initData, itemId, storageIds }) => {
    await requireOwner(initData);
    await draftItem(ctx, itemId);
    const problems: string[] = [];
    if (storageIds.length === 0 || storageIds.length > MAX_LISTING_PHOTOS) {
      problems.push(`нужно от 1 до ${MAX_LISTING_PHOTOS} фото`);
    }
    for (const id of storageIds) {
      const blob = await ctx.storage.get(id);
      const head = blob ? new Uint8Array(await blob.slice(0, 12).arrayBuffer()) : new Uint8Array();
      if (!blob || blob.size > MAX_PHOTO_BYTES || !looksLikeImage(head)) {
        problems.push("каждый файл должен быть картинкой JPEG/PNG/WebP до 5 МБ");
        break;
      }
    }
    if (problems.length > 0) {
      for (const id of storageIds) await ctx.storage.delete(id).catch(() => {});
      throw new Error(`Не сохранено: ${problems.join("; ")}`);
    }
    await ctx.runMutation(internal.studio.attach, { itemId, storageIds });
    return null;
  },
});

export const attach = internalMutation({
  args: { itemId: v.id("items"), storageIds: v.array(v.id("_storage")) },
  returns: v.null(),
  handler: async (ctx, { itemId, storageIds }) => {
    const it = await ctx.db.get(itemId);
    if (!it || it.status !== "draft") throw new Error("Обработать можно только черновик");
    for (const old of it.studioPhotoIds ?? []) {
      if (!storageIds.includes(old)) await ctx.storage.delete(old);
    }
    await ctx.db.patch(itemId, { studioPhotoIds: storageIds });
    await ctx.scheduler.runAfter(0, internal.bot.sendPhotos, { chatId: it.chatId, storageIds });
    return null;
  },
});
