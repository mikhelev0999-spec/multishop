import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import { getUsdUah } from "./fx";
import { runAgent, runRewrite, type AgentDeps } from "./lib/agent";
import { createMessage } from "./lib/claude";
import { draftKeyboard, formatDraft } from "./lib/draftMessage";
import { searchByImage, searchByKeywords } from "./lib/ebay";
import * as telegram from "./lib/telegramApi";

const deps: AgentDeps = { createMessage, searchByKeywords, searchByImage };

export const start = internalAction({
  args: { itemId: v.id("items"), photoAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { itemId, photoAt }) => {
    const job = await ctx.runMutation(internal.items.beginAnalysis, { itemId, photoAt });
    if (!job) return null;

    const n = job.photoIds.length;
    const statusId = await telegram.sendMessage(job.chatId, `Разбираюсь… (фото: ${n})`);
    await ctx.runMutation(internal.items.setStatusMessage, { itemId, messageId: statusId });

    try {
      const photos = await Promise.all(
        job.photoIds.map(async (id) => {
          const blob = await ctx.storage.get(id);
          if (!blob) throw new Error("фото пропало из хранилища");
          return { mediaType: blob.type || "image/jpeg", base64: toBase64(await blob.arrayBuffer()) };
        }),
      );
      const usdUah = await getUsdUah(ctx);
      const result = await runAgent({ photos, caption: job.caption, answers: job.answers, usdUah }, deps);

      if (result.kind === "question") {
        await ctx.runMutation(internal.items.saveQuestion, {
          itemId,
          question: result.question,
          costUsd: result.costUsd,
        });
        await telegram.editMessageText(job.chatId, statusId, `❓ ${result.question}`);
        return null;
      }
      await ctx.runMutation(internal.items.saveDraft, {
        itemId,
        draft: result.draft,
        comparables: result.comparables,
        costUsd: result.costUsd,
      });
      await showDraft(ctx, itemId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("analysis failed", itemId, message);
      await ctx.runMutation(internal.items.markFailed, { itemId, error: message });
      await telegram.editMessageText(
        job.chatId,
        statusId,
        `Не получилось разобрать: ${message}\nПришлите фото ещё раз.`,
      );
    }
    return null;
  },
});

export const rewrite = internalAction({
  args: { itemId: v.id("items"), instruction: v.string() },
  returns: v.null(),
  handler: async (ctx, { itemId, instruction }) => {
    const item = await ctx.runQuery(internal.items.get, { itemId });
    if (!item?.draft || item.status !== "draft") return null;
    try {
      const result = await runRewrite({ draft: item.draft, instruction }, deps);
      await ctx.runMutation(internal.items.updateDraftText, {
        itemId,
        draft: result.draft,
        costUsd: result.costUsd,
      });
      await showDraft(ctx, itemId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("rewrite failed", itemId, message);
      await telegram.sendMessage(item.chatId, `Не получилось переписать: ${message}`);
    }
    return null;
  },
});

export const show = internalAction({
  args: { itemId: v.id("items") },
  returns: v.null(),
  handler: async (ctx, { itemId }) => {
    await showDraft(ctx, itemId);
    return null;
  },
});

/**
 * Shows the current draft with buttons. The first time it replaces the "Разбираюсь…"
 * message; later versions are sent anew (so they are at the bottom of the chat) and the
 * buttons are removed from the previous one.
 */
async function showDraft(ctx: ActionCtx, itemId: Id<"items">): Promise<void> {
  const item = await ctx.runQuery(internal.items.get, { itemId });
  if (!item?.draft || item.status !== "draft") return;
  const text = formatDraft(item.draft, item.costUsd);
  const keyboard = draftKeyboard(itemId);

  if (item.draftMessageId === undefined && item.statusMessageId !== undefined) {
    await telegram.editMessageText(item.chatId, item.statusMessageId, text, keyboard);
    await ctx.runMutation(internal.items.setDraftMessage, { itemId, messageId: item.statusMessageId });
    return;
  }
  const messageId = await telegram.sendMessage(item.chatId, text, keyboard);
  await ctx.runMutation(internal.items.setDraftMessage, { itemId, messageId });
  if (item.draftMessageId !== undefined) {
    // Best effort: an old message may already be gone.
    await telegram.removeKeyboard(item.chatId, item.draftMessageId).catch(() => {});
  }
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
