import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import schema from "./schema";
import { answerValidator, comparableValidator, draftValidator } from "./lib/validators";

export const MAX_PHOTOS = 10;
/** Album photos arrive as separate updates; analysis starts after this quiet period. */
export const ALBUM_QUIET_MS = 4000;

export const itemDocValidator = v.object({
  ...schema.tables.items.validator.fields,
  _id: v.id("items"),
  _creationTime: v.number(),
});

export const get = internalQuery({
  args: { itemId: v.id("items") },
  returns: v.union(itemDocValidator, v.null()),
  handler: (ctx, { itemId }) => ctx.db.get(itemId),
});

export const attachPhoto = internalMutation({
  args: {
    chatId: v.number(),
    storageId: v.id("_storage"),
    mediaGroupId: v.optional(v.string()),
    caption: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { chatId, storageId, mediaGroupId, caption }) => {
    const now = Date.now();
    const group = mediaGroupId
      ? await ctx.db
          .query("items")
          .withIndex("by_media_group", (q) => q.eq("mediaGroupId", mediaGroupId))
          .first()
      : null;

    if (group && group.status !== "collecting") {
      // A straggler from an album that is already being analyzed.
      await ctx.storage.delete(storageId);
      return null;
    }
    if (group && group.photoIds.length >= MAX_PHOTOS) {
      await ctx.storage.delete(storageId);
      if (!group.photoLimitNotified) {
        await ctx.db.patch(group._id, { photoLimitNotified: true });
        await ctx.scheduler.runAfter(0, internal.bot.send, {
          chatId,
          text: `Беру первые ${MAX_PHOTOS} фото, остальные пропускаю.`,
        });
      }
      return null;
    }

    let itemId;
    if (group) {
      itemId = group._id;
      await ctx.db.patch(itemId, {
        photoIds: [...group.photoIds, storageId],
        lastPhotoAt: now,
        ...(caption && !group.caption ? { caption } : {}),
      });
    } else {
      itemId = await ctx.db.insert("items", {
        chatId,
        status: "collecting",
        photoIds: [storageId],
        ...(mediaGroupId ? { mediaGroupId } : {}),
        ...(caption ? { caption } : {}),
        lastPhotoAt: now,
        answers: [],
        costUsd: 0,
      });
    }
    await ctx.scheduler.runAfter(ALBUM_QUIET_MS, internal.analyze.start, { itemId, photoAt: now });
    return null;
  },
});

/** Claims the item for analysis; null when a newer photo arrived or it is not waiting for analysis. */
export const beginAnalysis = internalMutation({
  args: { itemId: v.id("items"), photoAt: v.number() },
  returns: v.union(
    v.null(),
    v.object({
      chatId: v.number(),
      photoIds: v.array(v.id("_storage")),
      caption: v.optional(v.string()),
      answers: v.array(answerValidator),
    }),
  ),
  handler: async (ctx, { itemId, photoAt }) => {
    const item = await ctx.db.get(itemId);
    if (!item || item.lastPhotoAt !== photoAt) return null;
    if (item.status !== "collecting" && item.status !== "needs_input") return null;
    await ctx.db.patch(itemId, { status: "analyzing", question: undefined, error: undefined });
    return {
      chatId: item.chatId,
      photoIds: item.photoIds,
      ...(item.caption ? { caption: item.caption } : {}),
      answers: item.answers,
    };
  },
});

export const setStatusMessage = internalMutation({
  args: { itemId: v.id("items"), messageId: v.number() },
  returns: v.null(),
  handler: async (ctx, { itemId, messageId }) => {
    await ctx.db.patch(itemId, { statusMessageId: messageId });
    return null;
  },
});

export const saveDraft = internalMutation({
  args: {
    itemId: v.id("items"),
    draft: draftValidator,
    comparables: v.array(comparableValidator),
    costUsd: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { itemId, draft, comparables, costUsd }) => {
    const item = await ctx.db.get(itemId);
    if (!item) return null;
    await ctx.db.patch(itemId, { status: "draft", draft, costUsd: item.costUsd + costUsd });
    for (const c of comparables) {
      await ctx.db.insert("priceResearch", { itemId, source: "ebay", ...c });
    }
    return null;
  },
});

export const saveQuestion = internalMutation({
  args: { itemId: v.id("items"), question: v.string(), costUsd: v.number() },
  returns: v.null(),
  handler: async (ctx, { itemId, question, costUsd }) => {
    const item = await ctx.db.get(itemId);
    if (!item) return null;
    await ctx.db.patch(itemId, { status: "needs_input", question, costUsd: item.costUsd + costUsd });
    return null;
  },
});

export const markFailed = internalMutation({
  args: { itemId: v.id("items"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, { itemId, error }) => {
    await ctx.db.patch(itemId, { status: "failed", error });
    return null;
  },
});

export const setDraftMessage = internalMutation({
  args: { itemId: v.id("items"), messageId: v.number() },
  returns: v.null(),
  handler: async (ctx, { itemId, messageId }) => {
    await ctx.db.patch(itemId, { draftMessageId: messageId });
    return null;
  },
});

export const updateDraftText = internalMutation({
  args: { itemId: v.id("items"), draft: draftValidator, costUsd: v.number() },
  returns: v.null(),
  handler: async (ctx, { itemId, draft, costUsd }) => {
    const item = await ctx.db.get(itemId);
    if (!item || item.status !== "draft") return null;
    await ctx.db.patch(itemId, { draft, costUsd: item.costUsd + costUsd });
    return null;
  },
});
