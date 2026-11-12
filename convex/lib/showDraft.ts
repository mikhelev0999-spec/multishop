import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { draftKeyboard, formatDraft } from "./draftMessage";
import * as telegram from "./telegramApi";

/**
 * Shows the current draft with buttons. The first time it replaces the "Разбираюсь…"
 * message; later versions are sent anew (so they are at the bottom of the chat) and the
 * buttons are removed from the previous one.
 */
export async function showDraft(ctx: ActionCtx, itemId: Id<"items">): Promise<void> {
  const item = await ctx.runQuery(internal.items.get, { itemId });
  if (!item?.draft || item.status !== "draft") return;
  const text = formatDraft(item.draft, item.costUsd);
  const keyboard = draftKeyboard(itemId, process.env.STUDIO_URL);

  if (item.draftMessageId === undefined && item.statusMessageId !== undefined) {
    await telegram.editMessageText(item.chatId, item.statusMessageId, text, keyboard, {
      html: true,
    });
    await ctx.runMutation(internal.items.setDraftMessage, {
      itemId,
      messageId: item.statusMessageId,
    });
    return;
  }
  const messageId = await telegram.sendMessage(item.chatId, text, keyboard, { html: true });
  await ctx.runMutation(internal.items.setDraftMessage, { itemId, messageId });
  if (item.draftMessageId !== undefined) {
    // Best effort: an old message may already be gone.
    await telegram.removeKeyboard(item.chatId, item.draftMessageId).catch(() => {});
  }
}
