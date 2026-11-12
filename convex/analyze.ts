import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { getUsdUah } from "./fx";
import { runAgent, runRewrite, type AgentDeps } from "./lib/agent";
import { createMessage } from "./lib/claude";
import { searchByImage, searchByKeywords } from "./lib/ebay";
import { isManualMode } from "./lib/mode";
import { showDraft } from "./lib/showDraft";
import { enqueueForChat } from "./manual";
import * as telegram from "./lib/telegramApi";

const deps: AgentDeps = { createMessage, searchByKeywords, searchByImage };

export const start = internalAction({
  args: { itemId: v.id("items"), photoAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { itemId, photoAt }) => {
    if (isManualMode()) {
      await enqueueForChat(ctx, itemId, photoAt);
      return null;
    }
    const job = await ctx.runMutation(internal.items.beginAnalysis, { itemId, photoAt });
    if (!job) return null;

    let statusId: number | undefined;
    // Once the outcome is stored, a failure to show it must not turn the item into "failed".
    let saved = false;
    try {
      statusId = await telegram.sendMessage(job.chatId, `Разбираюсь… (фото: ${job.photoIds.length})`);
      await ctx.runMutation(internal.items.setStatusMessage, { itemId, messageId: statusId });

      const photos = await Promise.all(
        job.photoIds.map(async (id: Id<"_storage">) => {
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
        saved = true;
        await telegram.editMessageText(job.chatId, statusId, `❓ ${result.question}`);
        return null;
      }
      await ctx.runMutation(internal.items.saveDraft, {
        itemId,
        draft: result.draft,
        comparables: result.comparables,
        costUsd: result.costUsd,
      });
      saved = true;
      await showDraft(ctx, itemId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(saved ? "showing result failed" : "analysis failed", itemId, message);
      if (!saved) await ctx.runMutation(internal.items.markFailed, { itemId, error: message });
      const text = saved
        ? `Черновик готов, но Telegram не принял сообщение: ${message}`
        : `Не получилось разобрать: ${message}\nПришлите фото ещё раз.`;
      // Best effort: if Telegram itself is down, the owner can't be told anything.
      await (statusId === undefined
        ? telegram.sendMessage(job.chatId, text)
        : telegram.editMessageText(job.chatId, statusId, text)
      ).catch((err) => console.error("could not report", err));
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

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
