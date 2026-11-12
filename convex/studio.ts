// Photo studio Mini App backend. Every function checks Telegram's signed initData first.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { MAX_LISTING_PHOTOS } from "./lib/draftMessage";
import { claimFile, deleteFile, ownerOf } from "./lib/fileOwners";
import { verifyInitData } from "./lib/webAppAuth";

const MAX_PHOTO_BYTES = 5_000_000;
/** The studio is opened from a fresh button press; a day-old signature is not needed. */
const STUDIO_INIT_DATA_MAX_AGE_SEC = 2 * 60 * 60;
/** A new upload must be this fresh: older unowned files are leftovers, not this session's. */
const UPLOAD_MAX_AGE_MS = 60 * 60 * 1000;

async function requireOwner(initData: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const owner = Number(process.env.OWNER_TELEGRAM_ID);
  if (!token || !owner) throw new Error("Бот не настроен");
  const { userId } = await verifyInitData(
    initData,
    token,
    Math.floor(Date.now() / 1000),
    STUDIO_INIT_DATA_MAX_AGE_SEC,
  );
  if (userId !== owner) throw new Error("Студия доступна только владельцу бота");
}

async function draftItem(ctx: ActionCtx, itemId: Id<"items">): Promise<Doc<"items">> {
  const it: Doc<"items"> | null = await ctx.runQuery(internal.studio.item, { itemId });
  if (!it || it.status !== "draft") throw new Error("Обработать можно только черновик");
  return it;
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
    // Files uploaded but never saved have no owner and are pruned by files.pruneOrphans.
    const urls: string[] = [];
    for (let i = 0; i < count; i++) urls.push(await ctx.storage.generateUploadUrl());
    return urls;
  },
});

/** JPEG by the file's first bytes — the upload's Content-Type is not trusted. */
export function looksLikeJpeg(head: Uint8Array): boolean {
  return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
}

export const fileCheck = internalQuery({
  args: { itemId: v.id("items"), storageId: v.id("_storage") },
  returns: v.union(
    v.object({ kind: v.literal("kept") }),
    v.object({ kind: v.literal("new"), size: v.number() }),
    v.object({ kind: v.literal("foreign") }),
  ),
  handler: async (ctx, { itemId, storageId }) => {
    const owner = await ownerOf(ctx, storageId);
    if (owner) {
      return owner.itemId === itemId && owner.kind === "studio" ? { kind: "kept" as const } : { kind: "foreign" as const };
    }
    const meta = await ctx.db.system.get(storageId);
    if (!meta || meta._creationTime < Date.now() - UPLOAD_MAX_AGE_MS) return { kind: "foreign" as const };
    return { kind: "new" as const, size: meta.size };
  },
});

/**
 * Sets the item's processed photos to exactly `storageIds`: earlier processed photos of this item
 * that are kept stay, the rest are deleted; new ones must be fresh unowned JPEG uploads.
 */
export const save = action({
  args: { initData: v.string(), itemId: v.id("items"), storageIds: v.array(v.id("_storage")) },
  returns: v.null(),
  handler: async (ctx, { initData, itemId, storageIds }) => {
    await requireOwner(initData);
    await draftItem(ctx, itemId);
    if (storageIds.length === 0 || storageIds.length > MAX_LISTING_PHOTOS || new Set(storageIds).size !== storageIds.length) {
      throw new Error(`Нужно от 1 до ${MAX_LISTING_PHOTOS} разных фото`);
    }

    const fresh: Id<"_storage">[] = [];
    let problem = "";
    for (const id of storageIds) {
      const check = await ctx.runQuery(internal.studio.fileCheck, { itemId, storageId: id });
      if (check.kind === "kept") continue;
      if (check.kind === "foreign") {
        // Never touch files that belong to something else.
        problem ||= "в списке есть чужой файл";
        continue;
      }
      fresh.push(id);
      if (check.size > MAX_PHOTO_BYTES) {
        problem ||= "файл больше 5 МБ";
        continue;
      }
      const blob = await ctx.storage.get(id);
      const head = blob ? new Uint8Array(await blob.slice(0, 3).arrayBuffer()) : new Uint8Array();
      if (!looksLikeJpeg(head)) problem ||= "файл не JPEG";
    }

    if (!problem) {
      try {
        await ctx.runMutation(internal.studio.attach, { itemId, storageIds });
        return null;
      } catch (e) {
        problem = e instanceof Error ? e.message : String(e);
      }
    }
    for (const id of fresh) await ctx.storage.delete(id).catch(() => {});
    throw new Error(`Не сохранено: ${problem}`);
  },
});

export const attach = internalMutation({
  args: { itemId: v.id("items"), storageIds: v.array(v.id("_storage")) },
  returns: v.null(),
  handler: async (ctx, { itemId, storageIds }) => {
    const it = await ctx.db.get(itemId);
    if (!it || it.status !== "draft") throw new Error("черновик уже обработан");
    for (const id of storageIds) await claimFile(ctx, id, itemId, "studio");
    for (const old of it.studioPhotoIds ?? []) {
      if (!storageIds.includes(old)) await deleteFile(ctx, old);
    }
    await ctx.db.patch(itemId, { studioPhotoIds: storageIds });
    const added = storageIds.filter((id) => !(it.studioPhotoIds ?? []).includes(id));
    if (added.length > 0) {
      await ctx.scheduler.runAfter(0, internal.bot.sendPhotos, { chatId: it.chatId, storageIds: added });
    }
    return null;
  },
});
